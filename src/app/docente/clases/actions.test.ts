import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeSupabase } from "@/test/fake-supabase";
import { cancelTutorClass } from "./actions";

const revalidatePath = vi.hoisted(() => vi.fn());
const createClient = vi.hoisted(() => vi.fn());
const getViewer = vi.hoisted(() => vi.fn());
const scheduleEmailDelivery = vi.hoisted(() => vi.fn());
const settleCancelledBooking = vi.hoisted(() => vi.fn());

vi.mock("next/cache", () => ({ revalidatePath }));
vi.mock("@/lib/supabase/server", () => ({ createClient }));
vi.mock("@/lib/auth/viewer", () => ({ getViewer }));
vi.mock("@/lib/email/schedule", () => ({ scheduleEmailDelivery }));
vi.mock("@/lib/payments/cancellation", () => ({ settleCancelledBooking }));
vi.mock("@/lib/payments/runtime", () => ({ createPaymentServices: vi.fn() }));

const BOOKING = "b0000000-0000-4000-8000-000000000001";
const DOCENTE = { id: "d1", name: "Docente", role: "docente" };

beforeEach(() => {
  for (const mock of [revalidatePath, createClient, getViewer, scheduleEmailDelivery, settleCancelledBooking]) mock.mockReset();
  getViewer.mockResolvedValue(DOCENTE);
  settleCancelledBooking.mockResolvedValue({ result: null, refund: null });
});

describe("cancelTutorClass", () => {
  it("rechaza un identificador que no es un UUID sin tocar la base", async () => {
    const supabase = fakeSupabase();
    createClient.mockResolvedValue(supabase.client);
    expect(await cancelTutorClass("xyz")).toMatchObject({ ok: false });
    expect(supabase.client.rpc).not.toHaveBeenCalled();
  });

  it("rechaza un motivo demasiado largo", async () => {
    expect(await cancelTutorClass(BOOKING, "x".repeat(301))).toEqual({ ok: false, error: expect.stringMatching(/300 caracteres/) });
  });

  it("sin sesión, o sin ser docente, no cancela", async () => {
    const supabase = fakeSupabase();
    createClient.mockResolvedValue(supabase.client);
    getViewer.mockResolvedValueOnce(null);
    expect((await cancelTutorClass(BOOKING)).ok).toBe(false);
    getViewer.mockResolvedValueOnce({ id: "a1", name: "Alumna", role: "alumno" });
    expect(await cancelTutorClass(BOOKING)).toEqual({ ok: false, error: expect.stringMatching(/Solo los docentes/) });
    expect(supabase.client.rpc).not.toHaveBeenCalled();
  });

  it("cancela con el motivo (sin espacios de más), ejecuta el reembolso y avisa por email", async () => {
    const supabase = fakeSupabase({ rpc: { cancel_booking: { data: { paid: true } } } });
    createClient.mockResolvedValue(supabase.client);
    const refund = { percent: 100, amount: 10000, status: "aprobado" };
    settleCancelledBooking.mockResolvedValue({ result: {}, refund });

    expect(await cancelTutorClass(BOOKING, "  Me surgió un imprevisto  ")).toEqual({ ok: true, refund });
    expect(supabase.client.rpc).toHaveBeenCalledWith("cancel_booking", { p_booking_id: BOOKING, p_reason: "Me surgió un imprevisto" });
    expect(settleCancelledBooking).toHaveBeenCalledWith({ paid: true }, expect.any(Function));
    expect(scheduleEmailDelivery).toHaveBeenCalled();
    expect(revalidatePath).toHaveBeenCalledWith("/docente");
  });

  it("un motivo vacío se guarda como null", async () => {
    const supabase = fakeSupabase();
    createClient.mockResolvedValue(supabase.client);
    await cancelTutorClass(BOOKING, "   ");
    expect(supabase.client.rpc).toHaveBeenCalledWith("cancel_booking", { p_booking_id: BOOKING, p_reason: null });
  });

  it("si la base rechaza, no ejecuta reembolsos ni manda emails", async () => {
    createClient.mockResolvedValue(fakeSupabase({ rpc: { cancel_booking: { error: { hint: "not_cancellable" } } } }).client);
    expect(await cancelTutorClass(BOOKING)).toMatchObject({ ok: false });
    expect(settleCancelledBooking).not.toHaveBeenCalled();
    expect(scheduleEmailDelivery).not.toHaveBeenCalled();
  });
});
