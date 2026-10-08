import { afterEach, describe, expect, it, vi } from "vitest";
import { bookingErrorMessage, isStaleStateError } from "./errors";
import { HOLD_MINUTES, earliestBookableIso, holdExpiresAt } from "./hold";
import { paymentSimulationEnabled } from "./simulation";

describe("errores de reservas", () => {
  it("traduce el código de la base a un texto para la persona", () => {
    expect(bookingErrorMessage({ hint: "slot_taken" })).toMatch(/otra persona/);
    expect(bookingErrorMessage({ hint: "too_many_holds" })).toMatch(/sin pagar/);
  });

  it("nunca muestra un mensaje técnico", () => {
    expect(bookingErrorMessage({ hint: "algo_inesperado" })).toBe(
      "No pudimos completar la operación. Intentá de nuevo.",
    );
    expect(bookingErrorMessage(null)).toBe("No pudimos completar la operación. Intentá de nuevo.");
  });

  it("avisa cuando las reservas todavía no están habilitadas en la base", () => {
    expect(bookingErrorMessage({ code: "PGRST202" })).toMatch(/todavía no están habilitadas/);
  });

  it("distingue los errores de estado desactualizado", () => {
    for (const hint of ["slot_taken", "not_pending", "hold_expired", "not_cancellable"]) {
      expect(isStaleStateError({ hint })).toBe(true);
    }
    for (const hint of ["too_many_holds", "student_overlap", "not_student"]) {
      expect(isStaleStateError({ hint })).toBe(false);
    }
    expect(isStaleStateError(null)).toBe(false);
  });
});

describe("retención del horario", () => {
  it("vence a los 15 minutos de crearse la reserva", () => {
    expect(HOLD_MINUTES).toBe(15);
    expect(holdExpiresAt("2026-10-08T18:00:00.000Z").toISOString()).toBe("2026-10-08T18:15:00.000Z");
  });

  it("solo se ofrecen horarios con una hora de anticipación", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-08T12:00:00.000Z"));
    expect(earliestBookableIso()).toBe("2026-10-08T13:00:00.000Z");
    vi.useRealTimers();
  });
});

describe("pago simulado", () => {
  afterEach(() => vi.unstubAllEnvs());

  function entorno(valores: Record<string, string | undefined>) {
    for (const [clave, valor] of Object.entries(valores)) {
      if (valor === undefined) vi.stubEnv(clave, "");
      else vi.stubEnv(clave, valor);
    }
  }

  it("está apagado por defecto", () => {
    entorno({ ALLOW_SIMULATED_PAYMENTS: undefined, NODE_ENV: "development", VERCEL_ENV: undefined });
    expect(paymentSimulationEnabled()).toBe(false);
  });

  it("funciona en desarrollo local si se habilita a propósito", () => {
    entorno({ ALLOW_SIMULATED_PAYMENTS: "true", NODE_ENV: "development", VERCEL_ENV: undefined });
    expect(paymentSimulationEnabled()).toBe(true);
  });

  it("funciona en una vista previa de Vercel", () => {
    entorno({ ALLOW_SIMULATED_PAYMENTS: "true", NODE_ENV: "production", VERCEL_ENV: "preview" });
    expect(paymentSimulationEnabled()).toBe(true);
  });

  it("nunca funciona en producción de Vercel, aunque esté habilitado", () => {
    entorno({ ALLOW_SIMULATED_PAYMENTS: "true", NODE_ENV: "production", VERCEL_ENV: "production" });
    expect(paymentSimulationEnabled()).toBe(false);
  });

  it("tampoco en un build de producción fuera de Vercel", () => {
    entorno({ ALLOW_SIMULATED_PAYMENTS: "true", NODE_ENV: "production", VERCEL_ENV: undefined });
    expect(paymentSimulationEnabled()).toBe(false);
  });

  it("solo el texto exacto «true» lo habilita", () => {
    entorno({ ALLOW_SIMULATED_PAYMENTS: "1", NODE_ENV: "development", VERCEL_ENV: undefined });
    expect(paymentSimulationEnabled()).toBe(false);
  });
});
