import { describe, expect, it, vi } from "vitest";
import { fakeSupabase } from "@/test/fake-supabase";
import { getRoomAccess } from "./room-access";

const BOOKING = "b0000000-0000-4000-8000-000000000001";
const STUDENT = { id: "a1", role: "alumno" };
const TUTOR = { id: "d1", role: "docente" };
const START = "2026-10-24T13:00:00.000Z";
const END = "2026-10-24T14:00:00.000Z";

const booking = (overrides: Record<string, unknown> = {}) => ({
  id: BOOKING,
  status: "confirmada",
  student_id: "a1",
  tutor_id: "d1",
  starts_at: START,
  ends_at: END,
  profiles: { full_name: "Sofía Martínez", avatar_url: null },
  tutor_profiles: { profiles: { full_name: "María González", avatar_url: "https://example.com/m.png" } },
  ...overrides,
});

function setup({ row = booking() as unknown, now = "2026-10-24T12:55:00.000Z", daily = true } = {}) {
  const supabase = fakeSupabase({ tables: { bookings: { data: row } } });
  const client = {
    ensureRoom: vi.fn(async ({ name }: { name: string }) => ({ name, url: `https://estudiapp.daily.co/${name}` })),
    createMeetingToken: vi.fn(async () => "tok"),
  };
  const run = (viewer: { id: string; role: string | null }, bookingId = BOOKING) =>
    getRoomAccess({ supabase: supabase.client as never, daily: daily ? client : null, now: new Date(now) }, { bookingId, viewer });
  return { run, client };
}

describe("quién entra a la sala", () => {
  it("el alumno de la reserva entra, con el nombre de su perfil y sin ser dueño", async () => {
    const { run, client } = setup();
    const access = await run(STUDENT);
    expect(access).toMatchObject({ state: "open", token: "tok", view: { role: "alumno", otherName: "María González" } });
    expect(client.createMeetingToken).toHaveBeenCalledWith(expect.objectContaining({ userName: "Sofía Martínez", userId: "a1", isOwner: false }));
  });

  it("el docente de la reserva entra como dueño de la sala y ve el nombre del alumno", async () => {
    const { run, client } = setup();
    expect(await run(TUTOR)).toMatchObject({ state: "open", view: { role: "docente", otherName: "Sofía Martínez" } });
    expect(client.createMeetingToken).toHaveBeenCalledWith(expect.objectContaining({ userName: "María González", isOwner: true }));
  });

  it("otra persona que pudiera leer la reserva no entra", async () => {
    const { run, client } = setup();
    expect(await run({ id: "a2", role: "alumno" })).toEqual({ state: "not_found" });
    expect(await run({ id: "d2", role: "docente" })).toEqual({ state: "not_found" });
    expect(await run({ id: "a1", role: "administrador" })).toEqual({ state: "not_found" });
    expect(client.createMeetingToken).not.toHaveBeenCalled();
  });

  it.each(["pendiente_pago", "cancelada"])("una reserva %s no abre la sala", async (status) => {
    const { run, client } = setup({ row: booking({ status }) });
    expect(await run(STUDENT)).toEqual({ state: "not_found" });
    expect(client.ensureRoom).not.toHaveBeenCalled();
  });

  it("un id inválido o una reserva que no se puede leer no existen", async () => {
    expect(await setup().run(STUDENT, "xyz")).toEqual({ state: "not_found" });
    expect(await setup({ row: null }).run(STUDENT)).toEqual({ state: "not_found" });
  });
});

describe("cuándo se entra", () => {
  it("antes de los 10 minutos previos no se genera token: dice cuándo abre", async () => {
    const { run, client } = setup({ now: "2026-10-24T12:49:59.000Z" });
    expect(await run(STUDENT)).toMatchObject({ state: "not_yet", opensAt: "2026-10-24T12:50:00.000Z" });
    expect(client.createMeetingToken).not.toHaveBeenCalled();
  });

  it("desde 10 minutos antes se entra; la sala y el token vencen 10 minutos después del final", async () => {
    const { run, client } = setup({ now: "2026-10-24T12:50:00.000Z" });
    expect((await run(STUDENT)).state).toBe("open");
    expect(client.ensureRoom).toHaveBeenCalledWith(
      expect.objectContaining({ opensAt: new Date("2026-10-24T12:50:00.000Z"), closesAt: new Date("2026-10-24T14:10:00.000Z") }),
    );
  });

  it("al terminar la clase (o si ya figura completada) la sala está cerrada", async () => {
    expect((await setup({ now: END }).run(STUDENT)).state).toBe("ended");
    expect((await setup({ row: booking({ status: "completada" }), now: "2026-10-24T13:30:00.000Z" }).run(STUDENT)).state).toBe("ended");
  });

  it("sin Daily configurado avisa que no está disponible; si Daily falla, se puede reintentar", async () => {
    expect((await setup({ daily: false }).run(STUDENT)).state).toBe("unavailable");
    const failing = setup();
    failing.client.ensureRoom.mockRejectedValueOnce(new Error("caída"));
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect((await failing.run(STUDENT)).state).toBe("error");
  });
});
