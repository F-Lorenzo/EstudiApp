import { describe, expect, it, vi } from "vitest";
import { isAuthorizedCron, runMaintenance, type MaintenanceTasks } from "./maintenance";

const SECRET = "secreto-de-prueba-largo";
const auth = `Bearer ${SECRET}`;

function tasks(overrides: Partial<MaintenanceTasks> = {}): MaintenanceTasks & { calls: string[] } {
  const calls: string[] = [];
  const make = (name: string, value: unknown) => async () => {
    calls.push(name);
    return value;
  };
  return {
    calls,
    refreshTokens: make("refreshTokens", { renewed: 1 }),
    retryRefunds: make("retryRefunds", { approved: 2 }),
    sendEmails: make("sendEmails", { sent: 3 }),
    ...overrides,
  };
}

describe("autorización del cron", () => {
  it("acepta solo el secreto exacto", () => {
    expect(isAuthorizedCron(auth, SECRET)).toBe(true);
    expect(isAuthorizedCron("Bearer otro-secreto-de-igual-largo", SECRET)).toBe(false);
    expect(isAuthorizedCron(`Bearer ${SECRET}x`, SECRET)).toBe(false);
    expect(isAuthorizedCron(SECRET, SECRET)).toBe(false);
    expect(isAuthorizedCron(null, SECRET)).toBe(false);
  });

  it("sin secreto configurado nunca autoriza (ni siquiera un valor vacío)", () => {
    expect(isAuthorizedCron("Bearer ", "")).toBe(false);
    expect(isAuthorizedCron("Bearer x", undefined)).toBe(false);
  });
});

describe("mantenimiento", () => {
  it("sin secreto configurado no corre nada", async () => {
    const t = tasks();
    expect(await runMaintenance({ authorization: auth, secret: undefined }, t)).toEqual({ status: 500, body: { status: "not_configured" } });
    expect(t.calls).toEqual([]);
  });

  it("con otro secreto o sin cabecera responde 401 y no corre nada", async () => {
    for (const authorization of [null, "Bearer incorrecto", ""]) {
      const t = tasks();
      expect((await runMaintenance({ authorization, secret: SECRET }, t)).status).toBe(401);
      expect(t.calls).toEqual([]);
    }
  });

  it("corre los tres barridos y devuelve los informes", async () => {
    const t = tasks();
    const result = await runMaintenance({ authorization: auth, secret: SECRET }, t);
    expect(result).toEqual({
      status: 200,
      body: { status: "ok", refreshTokens: { renewed: 1 }, retryRefunds: { approved: 2 }, sendEmails: { sent: 3 } },
    });
    expect(t.calls).toEqual(["refreshTokens", "retryRefunds", "sendEmails"]);
  });

  it("si un barrido falla, los demás igual corren y no se filtra el detalle", async () => {
    const log = vi.fn();
    const t = tasks({
      retryRefunds: async () => {
        throw new Error("clave APP_USR-secreta en el mensaje");
      },
    });
    const result = await runMaintenance({ authorization: auth, secret: SECRET }, t, log);
    expect(result.status).toBe(500);
    expect(result.body).toMatchObject({ status: "partial", retryRefunds: { error: "falló" }, sendEmails: { sent: 3 } });
    expect(JSON.stringify(result.body)).not.toContain("APP_USR");
    expect(t.calls).toEqual(["refreshTokens", "sendEmails"]);
    expect(log).toHaveBeenCalledOnce();
  });
});
