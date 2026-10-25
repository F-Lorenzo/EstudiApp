import { describe, expect, it, vi } from "vitest";
import { fakeSupabase } from "@/test/fake-supabase";
import { DailyError, type DailyMeeting } from "./daily";
import {
  listAwaitingAttendance,
  listViewerAwaitingAttendance,
  secondsInRoom,
  settleAttendanceFor,
  settleClassAttendance,
  type AttendanceDeps,
} from "./attendance";

const NOW = new Date("2026-10-24T14:20:00.000Z");
const nowSeconds = Math.floor(NOW.getTime() / 1000);
const CLASS = {
  id: "b0000000-0000-4000-8000-000000000001",
  studentId: "a1",
  tutorId: "d1",
  startsAt: "2026-10-24T13:00:00.000Z",
  endsAt: "2026-10-24T14:00:00.000Z",
};

describe("secondsInRoom", () => {
  const meetings: DailyMeeting[] = [
    { ongoing: false, participants: [{ user_id: "d1", join_time: 1, duration: 400 }, { user_id: "a1", join_time: 1, duration: 3000 }] },
    { ongoing: false, participants: [{ user_id: "d1", join_time: 2, duration: 300 }, { user_id: null, join_time: 2, duration: 999 }] },
  ];

  it("suma todas las entradas de la persona", () => {
    expect(secondsInRoom(meetings, "d1", NOW)).toBe(700);
    expect(secondsInRoom(meetings, "a1", NOW)).toBe(3000);
  });

  it("no cuenta a quien entró sin token (sin user_id) ni a otras personas", () => {
    expect(secondsInRoom(meetings, "otra", NOW)).toBe(0);
  });

  it("en una sesión en curso, quien sigue conectado cuenta desde que entró", () => {
    const live: DailyMeeting[] = [{ ongoing: true, participants: [{ user_id: "d1", join_time: nowSeconds - 900, duration: 0 }] }];
    expect(secondsInRoom(live, "d1", NOW)).toBe(900);
    // Si ya informa su duración, vale esa.
    const left: DailyMeeting[] = [{ ongoing: true, participants: [{ user_id: "d1", join_time: nowSeconds - 900, duration: 120 }] }];
    expect(secondsInRoom(left, "d1", NOW)).toBe(120);
  });
});

function setup({
  meetings = [] as DailyMeeting[] | Error,
  rpc = { data: { outcome: "completada" } } as { data?: unknown; error?: unknown },
  daily = true,
} = {}) {
  const fake = fakeSupabase({ rpc: { record_class_attendance: rpc } });
  const listMeetings = vi.fn(async () => {
    if (meetings instanceof Error) throw meetings;
    return meetings;
  });
  const afterAbsence = vi.fn(async () => {});
  const log = vi.fn();
  const deps: AttendanceDeps = { admin: fake.client as never, daily: daily ? { listMeetings } : null, afterAbsence, now: NOW, log };
  return { deps, fake, listMeetings, afterAbsence, log };
}

describe("settleClassAttendance", () => {
  it("le pasa a la base los segundos de cada uno y devuelve lo que decidió", async () => {
    const { deps, fake, listMeetings } = setup({
      meetings: [{ ongoing: false, participants: [{ user_id: "d1", join_time: 1, duration: 3300 }, { user_id: "a1", join_time: 1, duration: 3100 }] }],
    });
    expect(await settleClassAttendance(deps, CLASS)).toBe("completada");
    expect(listMeetings).toHaveBeenCalledWith({
      roomName: "estudiapp-b0000000000040008000000000000001",
      since: new Date("2026-10-24T12:50:00.000Z"),
    });
    expect(fake.client.rpc).toHaveBeenCalledWith("record_class_attendance", {
      p_booking_id: CLASS.id,
      p_tutor_seconds: 3300,
      p_student_seconds: 3100,
    });
  });

  it("si el docente faltó, ejecuta el reembolso con lo que devolvió la base", async () => {
    const data = { outcome: "docente_ausente", paid: true, percent: 100, amount: 10000, refund: null, cancelled_by: "administracion" };
    const { deps, afterAbsence } = setup({ rpc: { data } });
    expect(await settleClassAttendance(deps, CLASS)).toBe("docente_ausente");
    expect(afterAbsence).toHaveBeenCalledWith(data);
  });

  it("si el reembolso falla, la ausencia igual queda registrada (lo retoma el barrido)", async () => {
    const { deps, afterAbsence, log } = setup({ rpc: { data: { outcome: "docente_ausente" } } });
    afterAbsence.mockRejectedValueOnce(new Error("mp caído"));
    expect(await settleClassAttendance(deps, CLASS)).toBe("docente_ausente");
    expect(log).toHaveBeenCalledWith(expect.stringMatching(/barrido/), expect.objectContaining({ reason: "mp caído" }));
  });

  it("si Daily falla, no registra nada (nunca lo toma como ausencia)", async () => {
    const { deps, fake, afterAbsence } = setup({ meetings: new DailyError("Daily respondió 500.", 500) });
    expect(await settleClassAttendance(deps, CLASS)).toBe("error");
    expect(fake.client.rpc).not.toHaveBeenCalled();
    expect(afterAbsence).not.toHaveBeenCalled();
  });

  it("sin Daily configurado no registra nada", async () => {
    const { deps, fake } = setup({ daily: false });
    expect(await settleClassAttendance(deps, CLASS)).toBe("sin_datos");
    expect(fake.client.rpc).not.toHaveBeenCalled();
  });

  it("una clase que no terminó no se consulta", async () => {
    const { deps, listMeetings } = setup();
    expect(await settleClassAttendance(deps, { ...CLASS, endsAt: "2026-10-24T15:00:00.000Z" })).toBe("pendiente");
    expect(listMeetings).not.toHaveBeenCalled();
  });

  it("ya registrada (o completada por la red de seguridad) no es un error", async () => {
    expect(await settleClassAttendance(setup({ rpc: { data: { outcome: "completada", already: true } } }).deps, CLASS)).toBe("ya_registrada");
    expect(await settleClassAttendance(setup({ rpc: { error: { hint: "not_confirmed" } } }).deps, CLASS)).toBe("ya_registrada");
  });

  it("un error de la base se informa sin datos personales", async () => {
    const { deps, log } = setup({ rpc: { error: { code: "XX000", message: "algo" } } });
    expect(await settleClassAttendance(deps, CLASS)).toBe("error");
    expect(log).toHaveBeenCalledWith(expect.any(String), { bookingId: CLASS.id, code: "XX000" });
  });

  it("varias a la vez devuelven un resumen", async () => {
    const { deps } = setup();
    expect(await settleAttendanceFor(deps, [CLASS, { ...CLASS, endsAt: "2026-10-24T15:00:00.000Z" }])).toEqual({ completada: 1, pendiente: 1 });
  });
});

describe("qué clases esperan su asistencia", () => {
  it("para el cron, las de toda la plataforma", async () => {
    const fake = fakeSupabase({
      rpc: {
        classes_awaiting_attendance: {
          data: [{ booking_id: CLASS.id, student_id: "a1", tutor_id: "d1", starts_at: CLASS.startsAt, ends_at: CLASS.endsAt }, { roto: true }],
        },
      },
    });
    expect(await listAwaitingAttendance(fake.client as never)).toEqual([CLASS]);
    expect(fake.client.rpc).toHaveBeenCalledWith("classes_awaiting_attendance", { p_limit: 25 });
  });

  it("para una persona, sus confirmadas terminadas, leídas con su sesión", async () => {
    const fake = fakeSupabase({
      tables: { bookings: { data: [{ id: CLASS.id, student_id: "a1", tutor_id: "d1", starts_at: CLASS.startsAt, ends_at: CLASS.endsAt }] } },
    });
    expect(await listViewerAwaitingAttendance(fake.client as never, { id: "d1", role: "docente" }, { now: NOW })).toEqual([CLASS]);
    const calls = fake.on("bookings")[0].calls;
    expect(calls).toContainEqual(["eq", ["tutor_id", "d1"]]);
    expect(calls).toContainEqual(["eq", ["status", "confirmada"]]);
    expect(calls).toContainEqual(["lte", ["ends_at", NOW.toISOString()]]);
  });
});
