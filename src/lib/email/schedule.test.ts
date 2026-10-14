import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetWarnings } from "./log";
import type { EmailDeps } from "./production";
import { createEmailScheduler, scheduleEmailDelivery, type SchedulerDeps } from "./schedule";

const fakeDeps = { db: {}, sender: { configured: true, send: vi.fn() }, baseUrl: "https://estudiapp.example" } as unknown as EmailDeps;
const REPORT = { claimed: 0, sent: 0, failed: 0, skipped: 0, configured: true };

function setup(overrides: Partial<SchedulerDeps> = {}) {
  const tasks: (() => Promise<void>)[] = [];
  const logs: { message: string; data?: Record<string, unknown> }[] = [];
  const process = vi.fn(async () => REPORT);
  const createDeps = vi.fn(() => fakeDeps);
  const deps: SchedulerDeps = {
    after: (task) => void tasks.push(task),
    isConfigured: () => true,
    createDeps,
    process,
    log: (message, data) => void logs.push({ message, data }),
    limit: 10,
    ...overrides,
  };
  return { schedule: createEmailScheduler(deps), tasks, logs, process, createDeps };
}

beforeEach(() => resetWarnings());
afterEach(() => vi.unstubAllEnvs());

describe("scheduleEmailDelivery", () => {
  it("deja el trabajo para DESPUÉS de responder: al llamarla no envía nada ni arma dependencias", () => {
    const t = setup();
    expect(t.schedule()).toBeUndefined();
    expect(t.tasks).toHaveLength(1);
    expect(t.process).not.toHaveBeenCalled();
    expect(t.createDeps).not.toHaveBeenCalled();
  });

  it("cuando corre la tarea procesa la bandeja con las dependencias de producción y el límite", async () => {
    const t = setup();
    t.schedule();
    await t.tasks[0]();
    expect(t.createDeps).toHaveBeenCalledTimes(1);
    expect(t.process).toHaveBeenCalledWith({ ...fakeDeps, limit: 10 });
    expect(t.logs).toEqual([]);
  });

  it("no hace nada si el envío no está configurado, y avisa una sola vez", () => {
    const t = setup({ isConfigured: () => false });
    for (let i = 0; i < 4; i++) t.schedule();
    expect(t.tasks).toHaveLength(0);
    expect(t.createDeps).not.toHaveBeenCalled();
    expect(t.logs).toHaveLength(1);
    expect(t.logs[0].message).toContain("RESEND_API_KEY");
  });

  it("fuera de una solicitud (after lanza) no lanza ni hace nada", () => {
    const t = setup({
      after: () => {
        throw new Error("`after` was called outside a request scope.");
      },
    });
    expect(() => t.schedule()).not.toThrow();
    expect(t.process).not.toHaveBeenCalled();
  });

  it("si la comprobación de configuración lanza, tampoco lanza", () => {
    const t = setup({
      isConfigured: () => {
        throw new Error("boom");
      },
    });
    expect(() => t.schedule()).not.toThrow();
    expect(t.tasks).toHaveLength(0);
  });

  it("si procesar falla, la tarea no lanza (no rompe el after) y deja el motivo sin datos personales", async () => {
    const t = setup({
      process: vi.fn(async () => {
        throw new Error("se cayó la base con lucia@correo.example");
      }),
    });
    t.schedule();
    await expect(t.tasks[0]()).resolves.toBeUndefined();
    expect(t.logs).toHaveLength(1);
    expect(t.logs[0].message).toBe("falló el envío de emails");
    expect(JSON.stringify(t.logs)).not.toContain("lucia@correo.example");
  });

  it("si armar las dependencias falla (falta la service role), la tarea no lanza", async () => {
    const t = setup({
      createDeps: () => {
        throw new Error("Falta SUPABASE_SERVICE_ROLE_KEY para esta operación.");
      },
    });
    t.schedule();
    await expect(t.tasks[0]()).resolves.toBeUndefined();
    expect(t.process).not.toHaveBeenCalled();
    expect(t.logs[0].data).toMatchObject({ error: "Falta SUPABASE_SERVICE_ROLE_KEY para esta operación." });
  });

  it("deja registro cuando la tanda tuvo fallos, y nada cuando todo salió bien", async () => {
    const failing = setup({ process: vi.fn(async () => ({ ...REPORT, claimed: 3, sent: 1, failed: 2 })) });
    failing.schedule();
    await failing.tasks[0]();
    expect(failing.logs).toEqual([{ message: "tanda de emails con fallos", data: { claimed: 3, sent: 1, failed: 2, skipped: 0, configured: true } }]);

    const fine = setup({ process: vi.fn(async () => ({ ...REPORT, claimed: 2, sent: 2 })) });
    fine.schedule();
    await fine.tasks[0]();
    expect(fine.logs).toEqual([]);
  });

  it("cada llamada agenda su propia tanda (varios hechos en la misma solicitud se barren juntos igual)", async () => {
    const t = setup();
    t.schedule();
    t.schedule();
    expect(t.tasks).toHaveLength(2);
    await Promise.all(t.tasks.map((task) => task()));
    expect(t.process).toHaveBeenCalledTimes(2);
  });
});

describe("la función real", () => {
  it("conserva el contrato: función sin argumentos que devuelve undefined", () => {
    expect(typeof scheduleEmailDelivery).toBe("function");
    expect(scheduleEmailDelivery.length).toBe(0);
  });

  it("sin variables de entorno no hace nada ni lanza", () => {
    vi.stubEnv("RESEND_API_KEY", "");
    vi.stubEnv("EMAIL_FROM", "");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(scheduleEmailDelivery()).toBeUndefined();
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it("completamente configurada pero fuera de una solicitud (como en las pruebas o un script) tampoco lanza ni sale a la red", () => {
    vi.stubEnv("RESEND_API_KEY", "re_clave_de_prueba_123456");
    vi.stubEnv("EMAIL_FROM", "EstudiApp <hola@estudiapp.example>");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://proyecto.supabase.example");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-role-de-prueba");
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    expect(() => scheduleEmailDelivery()).not.toThrow();
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});
