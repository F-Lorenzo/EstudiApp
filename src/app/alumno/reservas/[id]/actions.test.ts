import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeSupabase } from "@/test/fake-supabase";
import { cancelBooking, simulatePayment } from "./actions";

const revalidatePath = vi.hoisted(() => vi.fn());
const createClient = vi.hoisted(() => vi.fn());
const createAdminClient = vi.hoisted(() => vi.fn());
const getViewer = vi.hoisted(() => vi.fn());
const getStudentBooking = vi.hoisted(() => vi.fn());

vi.mock("next/cache", () => ({ revalidatePath }));
vi.mock("@/lib/supabase/server", () => ({ createClient }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient }));
vi.mock("@/lib/auth/viewer", () => ({ getViewer }));
vi.mock("@/lib/bookings/queries", () => ({ getStudentBooking }));

const BOOKING = "b0000000-0000-4000-8000-000000000001";
const STUDENT = { id: "a1", name: "Alumna", role: "alumno" };

const pendiente = { id: BOOKING, status: "pendiente_pago", price: 12500 };

beforeEach(() => {
  for (const mock of [revalidatePath, createClient, createAdminClient, getViewer, getStudentBooking]) mock.mockReset();
  createClient.mockResolvedValue(fakeSupabase().client);
  getViewer.mockResolvedValue(STUDENT);
});
afterEach(() => vi.unstubAllEnvs());

describe("cancelBooking", () => {
  it("rechaza un identificador que no es un UUID", async () => {
    const supabase = fakeSupabase();
    createClient.mockResolvedValue(supabase.client);
    expect(await cancelBooking("xyz")).toEqual({ ok: false, error: expect.stringMatching(/No encontramos/) });
    expect(supabase.client.rpc).not.toHaveBeenCalled();
  });

  it("cancela con cancel_booking y refresca las pantallas del alumno", async () => {
    const supabase = fakeSupabase();
    createClient.mockResolvedValue(supabase.client);

    expect(await cancelBooking(BOOKING)).toEqual({ ok: true });
    expect(supabase.client.rpc).toHaveBeenCalledWith("cancel_booking", { p_booking_id: BOOKING, p_reason: null });
    expect(revalidatePath).toHaveBeenCalledWith(`/alumno/reservas/${BOOKING}`);
  });

  it("si la reserva ya no se puede cancelar, lo dice y vuelve a leer la pantalla", async () => {
    createClient.mockResolvedValue(fakeSupabase({ rpc: { cancel_booking: { error: { hint: "not_cancellable" } } } }).client);

    expect(await cancelBooking(BOOKING)).toEqual({ ok: false, error: expect.stringMatching(/ya no se puede cancelar/) });
    expect(revalidatePath).toHaveBeenCalledWith(`/alumno/reservas/${BOOKING}`);
  });

  it("una reserva pagada pide escribir a soporte (reembolso todavía no disponible)", async () => {
    createClient.mockResolvedValue(fakeSupabase({ rpc: { cancel_booking: { error: { hint: "refund_required" } } } }).client);

    const result = await cancelBooking(BOOKING);
    expect(result).toEqual({ ok: false, error: expect.stringMatching(/reembolso/) });
  });
});

describe("simulatePayment", () => {
  function entorno(valores: Record<string, string>) {
    for (const [clave, valor] of Object.entries(valores)) vi.stubEnv(clave, valor);
  }

  it("está apagado por defecto: no confirma nada ni crea el cliente de servicio", async () => {
    entorno({ ALLOW_SIMULATED_PAYMENTS: "", NODE_ENV: "development" });

    expect(await simulatePayment(BOOKING)).toEqual({ ok: false, error: "El pago simulado no está habilitado." });
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it("nunca funciona en producción de Vercel, aunque esté habilitado", async () => {
    entorno({ ALLOW_SIMULATED_PAYMENTS: "true", VERCEL_ENV: "production", NODE_ENV: "production" });

    expect((await simulatePayment(BOOKING)).ok).toBe(false);
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  describe("habilitado en desarrollo", () => {
    beforeEach(() => entorno({ ALLOW_SIMULATED_PAYMENTS: "true", NODE_ENV: "development", VERCEL_ENV: "" }));

    it("sin sesión no confirma nada", async () => {
      getViewer.mockResolvedValue(null);
      expect((await simulatePayment(BOOKING)).ok).toBe(false);
      expect(createAdminClient).not.toHaveBeenCalled();
    });

    it("solo confirma reservas del propio alumno (la consulta filtra por su id)", async () => {
      getStudentBooking.mockResolvedValue(null);
      const result = await simulatePayment(BOOKING);

      expect(getStudentBooking).toHaveBeenCalledWith(expect.anything(), BOOKING, STUDENT.id);
      expect(result).toEqual({ ok: false, error: expect.stringMatching(/No encontramos/) });
      expect(createAdminClient).not.toHaveBeenCalled();
    });

    it("una reserva que ya no está pendiente no se confirma", async () => {
      getStudentBooking.mockResolvedValue({ ...pendiente, status: "cancelada" });

      expect((await simulatePayment(BOOKING)).ok).toBe(false);
      expect(createAdminClient).not.toHaveBeenCalled();
      expect(revalidatePath).toHaveBeenCalled();
    });

    it("si falta la clave de servicio, avisa en lugar de romper la página", async () => {
      getStudentBooking.mockResolvedValue(pendiente);
      createAdminClient.mockImplementation(() => {
        throw new Error("Falta SUPABASE_SERVICE_ROLE_KEY");
      });

      const result = await simulatePayment(BOOKING);
      expect(result).toEqual({ ok: false, error: expect.stringMatching(/SUPABASE_SERVICE_ROLE_KEY/) });
    });

    it("confirma con confirm_booking_payment por el monto acordado, con la service role", async () => {
      getStudentBooking.mockResolvedValue(pendiente);
      const admin = fakeSupabase();
      createAdminClient.mockReturnValue(admin.client);

      expect(await simulatePayment(BOOKING)).toEqual({ ok: true });
      // No informa comisión: la base usa la que la reserva guardó al crearse.
      expect(admin.client.rpc).toHaveBeenCalledWith("confirm_booking_payment", {
        p_booking_id: BOOKING,
        p_provider_payment_id: `simulado-${BOOKING}`,
        p_amount: 12500,
      });
    });

    it("si la reserva venció justo antes de confirmar, lo dice y refresca", async () => {
      getStudentBooking.mockResolvedValue(pendiente);
      createAdminClient.mockReturnValue(fakeSupabase({ rpc: { confirm_booking_payment: { error: { hint: "hold_expired" } } } }).client);

      expect(await simulatePayment(BOOKING)).toEqual({ ok: false, error: expect.stringMatching(/venció/) });
      expect(revalidatePath).toHaveBeenCalledWith(`/alumno/reservas/${BOOKING}`);
    });
  });
});
