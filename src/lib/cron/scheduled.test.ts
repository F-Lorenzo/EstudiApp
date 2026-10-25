import { describe, expect, it, vi } from "vitest";
import { MAINTENANCE_PATH, runScheduledMaintenance } from "./scheduled";

type Handler = (request: Request, env: unknown, ctx: unknown) => Promise<Response>;
const okHandler = () => vi.fn<Handler>(async () => Response.json({ status: "ok" }, { status: 200 }));

describe("cron de Cloudflare", () => {
  it("le pide la ruta de mantenimiento al propio Worker, con el secreto", async () => {
    const handler = okHandler();
    const env = { CRON_SECRET: "secreto", NEXT_PUBLIC_SITE_URL: "https://estudiapp.app" };
    const ctx = {};
    const log = vi.fn();
    await runScheduledMaintenance(handler, env, ctx, log);
    const [request, passedEnv, passedCtx] = handler.mock.calls[0];
    expect(request.url).toBe(`https://estudiapp.app${MAINTENANCE_PATH}`);
    expect(request.method).toBe("GET");
    expect(request.headers.get("authorization")).toBe("Bearer secreto");
    expect(passedEnv).toBe(env);
    expect(passedCtx).toBe(ctx);
    expect(log).toHaveBeenCalledWith("mantenimiento", { status: 200, report: '{"status":"ok"}' });
  });

  it("acepta el nombre viejo del secreto y usa el dominio de producción por defecto", async () => {
    const handler = okHandler();
    await runScheduledMaintenance(handler, { MERCADOPAGO_CRON_SECRET: "viejo" }, {}, vi.fn());
    const [request] = handler.mock.calls[0];
    expect(request.url).toBe(`https://estudiapp.app${MAINTENANCE_PATH}`);
    expect(request.headers.get("authorization")).toBe("Bearer viejo");
  });

  it("sin secreto no llama a la ruta y marca la ejecución como fallida", async () => {
    const handler = okHandler();
    const log = vi.fn();
    await expect(runScheduledMaintenance(handler, { CRON_SECRET: "  " }, {}, log)).rejects.toThrow(/CRON_SECRET/);
    expect(handler).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith(expect.stringMatching(/falta CRON_SECRET/));
  });

  it("si un barrido falla, la ejecución queda como fallida (con el informe en el log)", async () => {
    const handler = vi.fn(async () => Response.json({ status: "partial", retryRefunds: { error: "falló" } }, { status: 500 }));
    const log = vi.fn();
    await expect(runScheduledMaintenance(handler, { CRON_SECRET: "s" }, {}, log)).rejects.toThrow(/500/);
    expect(log).toHaveBeenCalledWith("mantenimiento", { status: 500, report: expect.stringContaining("partial") });
  });
});
