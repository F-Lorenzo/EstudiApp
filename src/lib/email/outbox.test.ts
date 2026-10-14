import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetWarnings } from "./log";
import { processEmailOutbox, type EmailRpc } from "./outbox";
import { EmailSendError, type EmailMessage, type EmailSender } from "./sender";

const BASE_URL = "https://estudiapp.example";

const payload = {
  student_name: "Lucía Pérez",
  tutor_name: "Martín Gómez",
  subject: "Matemática",
  starts_at: "2026-10-20T21:00:00+00:00",
  ends_at: "2026-10-20T22:00:00+00:00",
  price: 10000,
};

let seq = 0;
const row = (kind: string, extra: Record<string, unknown> = {}) => ({
  id: `00000000-0000-4000-8000-${String(++seq).padStart(12, "0")}`,
  kind,
  attempts: 1,
  to_email: "lucia@correo.example",
  to_name: "Lucía Pérez",
  payload: { ...payload, amount_paid: 10000 },
  ...extra,
});

type Mark = { id: string; status: string; error: string | null };

function fakeDb(rows: unknown, options: { claimError?: string; markError?: "result" | "throw" } = {}) {
  const marks: Mark[] = [];
  const rpc = vi.fn(async (name: string, args: Record<string, unknown>) => {
    if (name === "claim_pending_emails") {
      return options.claimError ? { data: null, error: { message: options.claimError } } : { data: rows, error: null };
    }
    if (name === "mark_email_result") {
      marks.push({ id: String(args.p_id), status: String(args.p_status), error: (args.p_error as string | null) ?? null });
      if (options.markError === "throw") throw new Error("se cortó la conexión con lucia@correo.example");
      return options.markError === "result" ? { data: null, error: { message: "función caída" } } : { data: null, error: null };
    }
    throw new Error(`rpc inesperada: ${name}`);
  });
  return { db: { rpc } as unknown as EmailRpc, rpc, marks };
}

type SendBehavior = (message: EmailMessage, index: number) => Promise<{ id: string }>;

function fakeSender(behavior: SendBehavior = async (_m, index) => ({ id: `re-${index}` }), configured = true) {
  const sent: EmailMessage[] = [];
  const sender: EmailSender = {
    configured,
    send: async (message) => {
      sent.push(message);
      return behavior(message, sent.length);
    },
  };
  return { sender, sent };
}

const retryable = (status: number, extra: Partial<ConstructorParameters<typeof EmailSendError>[1]> = {}) =>
  new EmailSendError(`Resend respondió ${status}`, { kind: "http", status, retryable: true, systemic: true, ...extra });
const definitive = () => new EmailSendError("Resend respondió 422 (validation_error): destinatario inválido", { kind: "http", status: 422, code: "validation_error", retryable: false });

function setup(rows: unknown, sendBehavior?: SendBehavior, options: Parameters<typeof fakeDb>[1] = {}) {
  const logs: { message: string; data?: Record<string, unknown> }[] = [];
  const db = fakeDb(rows, options);
  const sender = fakeSender(sendBehavior);
  const sleeps: number[] = [];
  const run = (extra: Partial<Parameters<typeof processEmailOutbox>[0]> = {}) =>
    processEmailOutbox({
      db: db.db,
      sender: sender.sender,
      baseUrl: BASE_URL,
      log: (message, data) => void logs.push({ message, data }),
      sleep: async (ms) => void sleeps.push(ms),
      ...extra,
    });
  return { ...db, ...sender, logs, sleeps, run };
}

beforeEach(() => resetWarnings());
afterEach(() => vi.unstubAllEnvs());

describe("flujo completo", () => {
  it("reclama, arma, envía con la id de la fila como idempotencia y anota «enviado»", async () => {
    const rows = [
      row("reserva_confirmada"),
      row("nueva_reserva_docente", { to_email: "martin@correo.example", to_name: "Martín Gómez", payload: { ...payload, amount_paid: 10000, tutor_amount: 8800 } }),
      row("reembolso_realizado", { payload: { ...payload, refund_amount: 10000, refund_percent: 100, reason: "cancelacion" } }),
    ];
    const t = setup(rows);
    const report = await t.run({ limit: 7, pauseMs: 600 });

    expect(report).toEqual({ claimed: 3, sent: 3, failed: 0, skipped: 0, configured: true });
    expect(t.rpc).toHaveBeenCalledWith("claim_pending_emails", { p_limit: 7 });
    expect(t.sent.map((m) => m.to)).toEqual(["lucia@correo.example", "martin@correo.example", "lucia@correo.example"]);
    expect(t.sent.map((m) => m.idempotencyKey)).toEqual(rows.map((r) => r.id));
    expect(t.sent[0].subject).toBe("Tu clase con Martín Gómez está confirmada");
    expect(t.sent[1].subject).toContain("Nueva reserva de Lucía Pérez");
    expect(t.sent[2].subject).toContain("Ya te devolvimos");
    for (const message of t.sent) {
      expect(message.html).toContain("<!doctype html>");
      expect(message.text.length).toBeGreaterThan(20);
    }
    expect(t.marks).toEqual(rows.map((r) => ({ id: r.id, status: "enviado", error: null })));
    expect(t.logs).toEqual([]);
  });

  it("usa el límite por defecto (10) y espera entre un envío y el siguiente, no antes del primero", async () => {
    const t = setup([row("reserva_confirmada"), row("reserva_confirmada"), row("reserva_confirmada")]);
    await t.run({ pauseMs: 600 });
    expect(t.rpc).toHaveBeenCalledWith("claim_pending_emails", { p_limit: 10 });
    expect(t.sleeps).toEqual([600, 600]);
  });

  it("sin filas pendientes no envía nada", async () => {
    for (const data of [[], null, undefined, "x", {}]) {
      const t = setup(data);
      expect(await t.run()).toEqual({ claimed: 0, sent: 0, failed: 0, skipped: 0, configured: true });
      expect(t.sent).toHaveLength(0);
      expect(t.marks).toHaveLength(0);
    }
  });

  it("el saludo usa el nombre de la cuenta; sin nombre, un saludo neutro", async () => {
    const t = setup([row("reserva_confirmada", { to_name: null }), row("reserva_confirmada", { to_name: "Ana María Díaz" })]);
    await t.run();
    expect(t.sent[0].text).toContain("Hola,");
    expect(t.sent[1].text).toContain("Hola Ana,");
  });

  it("los enlaces salen de baseUrl; con null, sin enlaces; sin indicar, de NEXT_PUBLIC_SITE_URL", async () => {
    const withBase = setup([row("reserva_confirmada")]);
    await withBase.run({ baseUrl: "https://otro.example" });
    expect(withBase.sent[0].html).toContain('href="https://otro.example/alumno/proximas-clases"');

    const without = setup([row("reserva_confirmada")]);
    await without.run({ baseUrl: null });
    expect(without.sent[0].html).not.toContain("href=");

    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://desde-el-entorno.example");
    const fromEnv = setup([row("reserva_confirmada")]);
    await fromEnv.run({ baseUrl: undefined });
    expect(fromEnv.sent[0].html).toContain('href="https://desde-el-entorno.example/alumno/proximas-clases"');

    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "");
    const unset = setup([row("reserva_confirmada")]);
    await unset.run({ baseUrl: undefined });
    expect(unset.sent[0].html).not.toContain("href=");
  });
});

describe("un fallo no frena a los demás", () => {
  it("un rechazo definitivo (4xx) se descarta como «omitido» con el motivo y el resto sale", async () => {
    const rows = [row("reserva_confirmada"), row("reserva_confirmada"), row("reserva_confirmada")];
    const t = setup(rows, async (_m, index) => {
      if (index === 2) throw definitive();
      return { id: `re-${index}` };
    });
    const report = await t.run();

    expect(report).toMatchObject({ claimed: 3, sent: 2, failed: 1, skipped: 0 });
    expect(t.sent).toHaveLength(3);
    expect(t.marks.map((m) => m.status)).toEqual(["enviado", "omitido", "enviado"]);
    expect(t.marks[1].error).toContain("El proveedor rechazó el email");
    expect(t.marks[1].error).toContain("422");
  });

  it("una falla reintentable que no es del proveedor (409 en curso) queda «fallido» y sigue con el resto", async () => {
    const rows = [row("reserva_confirmada"), row("reserva_confirmada")];
    const t = setup(rows, async (_m, index) => {
      if (index === 1) throw new EmailSendError("Resend respondió 409", { kind: "http", status: 409, retryable: true, systemic: false });
      return { id: "x" };
    });
    const report = await t.run();
    expect(report).toMatchObject({ sent: 1, failed: 1 });
    expect(t.marks.map((m) => m.status)).toEqual(["fallido", "enviado"]);
  });

  it("si el proveedor falla (503), se corta la tanda: lo que faltaba queda «fallido» SIN intentarse", async () => {
    const rows = [row("reserva_confirmada"), row("reserva_confirmada"), row("reserva_confirmada"), row("reserva_confirmada")];
    const t = setup(rows, async (_m, index) => {
      if (index === 2) throw retryable(503);
      return { id: "x" };
    });
    const report = await t.run();

    expect(report).toMatchObject({ claimed: 4, sent: 1, failed: 3, skipped: 0 });
    expect(t.sent).toHaveLength(2); // el tercero y el cuarto no se intentaron
    expect(t.marks.map((m) => [m.id, m.status])).toEqual([
      [rows[0].id, "enviado"],
      [rows[1].id, "fallido"],
      [rows[2].id, "fallido"],
      [rows[3].id, "fallido"],
    ]);
    expect(t.marks[1].error).toContain("503");
    expect(t.marks[2].error).toContain("No se intentó en esta tanda");
  });

  it.each([429, 401, 403])("un %i también corta la tanda (es del proveedor o de la configuración)", async (status) => {
    const t = setup([row("reserva_confirmada"), row("reserva_confirmada")], async () => {
      throw retryable(status);
    });
    expect(await t.run()).toMatchObject({ sent: 0, failed: 2 });
    expect(t.sent).toHaveLength(1);
  });

  it("un error inesperado (no es de nuestro tipo) se trata como del proveedor: se reintenta y no filtra el mensaje", async () => {
    const t = setup([row("reserva_confirmada"), row("reserva_confirmada")], async () => {
      throw new TypeError("fallo raro con lucia@correo.example dentro");
    });
    const report = await t.run();
    expect(report).toMatchObject({ sent: 0, failed: 2 });
    expect(t.marks[0]).toMatchObject({ status: "fallido", error: "Error inesperado al enviar el email." });
    expect(JSON.stringify([t.marks, t.logs])).not.toContain("lucia@correo.example");
  });

  it("una pausa de 0 no duerme", async () => {
    const t = setup([row("reserva_confirmada"), row("reserva_confirmada")]);
    await t.run({ pauseMs: 0 });
    expect(t.sleeps).toEqual([]);
  });
});

describe("filas que no se pueden armar", () => {
  it("un tipo sin plantilla se omite (no se envía, no se reintenta) y no frena a los demás", async () => {
    const rows = [row("boletin_semanal"), row("reserva_confirmada")];
    const t = setup(rows);
    const report = await t.run();
    expect(report).toEqual({ claimed: 2, sent: 1, failed: 0, skipped: 1, configured: true });
    expect(t.sent).toHaveLength(1);
    expect(t.marks[0]).toMatchObject({ id: rows[0].id, status: "omitido" });
    expect(t.marks[0].error).toContain("No hay plantilla");
    expect(t.marks[0].error).toContain("boletin_semanal");
  });

  it("el tipo desconocido se sanea antes de anotarse (largo y sin emails)", async () => {
    const t = setup([row(`raro ${"x".repeat(200)} a@b.example`)]);
    await t.run();
    expect(t.marks[0].error).not.toContain("a@b.example");
    expect(t.marks[0].error!.length).toBeLessThan(200);
  });

  it("datos incompletos (sin horario) se omiten con el motivo", async () => {
    const t = setup([row("reserva_confirmada", { payload: { tutor_name: "Martín" } }), row("reembolso_realizado", { payload: {} })]);
    const report = await t.run();
    expect(report).toMatchObject({ sent: 0, skipped: 2 });
    expect(t.sent).toHaveLength(0);
    expect(t.marks.map((m) => m.status)).toEqual(["omitido", "omitido"]);
    expect(t.marks[0].error).toBe("Faltan datos para armar el email.");
  });

  it("una fila ilegible con id se descarta; sin id solo se cuenta", async () => {
    const good = row("reserva_confirmada");
    const unreadable = { id: "00000000-0000-4000-8000-0000000000aa", kind: "reserva_confirmada", payload: {}, attempts: "muchos" };
    const t = setup([unreadable, null, "basura", { kind: "reserva_confirmada" }, good]);
    const report = await t.run();
    expect(report).toMatchObject({ claimed: 5, sent: 1, skipped: 4 });
    expect(t.marks).toEqual([
      { id: unreadable.id, status: "omitido", error: "La fila de la bandeja no se pudo leer." },
      { id: good.id, status: "enviado", error: null },
    ]);
  });

  it("un payload que no es un objeto se trata como datos incompletos", async () => {
    const t = setup([row("reserva_confirmada", { payload: "texto" })]);
    expect(await t.run()).toMatchObject({ sent: 0, skipped: 1 });
    expect(t.marks[0].status).toBe("omitido");
  });
});

describe("sin configuración", () => {
  it("no toca la bandeja: ni reclama ni anota, así las filas siguen pendientes y sin intentos gastados", async () => {
    const db = fakeDb([row("reserva_confirmada")]);
    const { sender, sent } = fakeSender(undefined, false);
    const logs: string[] = [];
    const report = await processEmailOutbox({ db: db.db, sender, baseUrl: BASE_URL, log: (m) => void logs.push(m) });

    expect(report).toEqual({ claimed: 0, sent: 0, failed: 0, skipped: 0, configured: false });
    expect(db.rpc).not.toHaveBeenCalled();
    expect(sent).toHaveLength(0);
    expect(logs).toHaveLength(1);
  });

  it("registra UN solo aviso aunque se llame muchas veces", async () => {
    const db = fakeDb([]);
    const { sender } = fakeSender(undefined, false);
    const logs: { message: string; data?: Record<string, unknown> }[] = [];
    const log = (message: string, data?: Record<string, unknown>) => void logs.push({ message, data });
    for (let i = 0; i < 5; i++) await processEmailOutbox({ db: db.db, sender, log });
    expect(logs).toHaveLength(1);
    expect(logs[0].message).toContain("RESEND_API_KEY");
    expect(logs[0].message).toContain("EMAIL_FROM");
  });

  it("un sender que no declara `configured` se da por configurado", async () => {
    const db = fakeDb([row("reserva_confirmada")]);
    const sender: EmailSender = { send: async () => ({ id: "x" }) };
    expect(await processEmailOutbox({ db: db.db, sender, baseUrl: BASE_URL })).toMatchObject({ sent: 1, configured: true });
  });
});

describe("fallas de la base", () => {
  it("si no se puede reclamar, lanza (es infraestructura) con un mensaje sin datos personales", async () => {
    const t = setup([], undefined, { claimError: "no existe la función claim_pending_emails para a@b.example" });
    await expect(t.run()).rejects.toThrow(/No se pudo reclamar la bandeja de emails: no existe la función/);
    await expect(t.run()).rejects.not.toThrow(/a@b\.example/);
    expect(t.sent).toHaveLength(0);
  });

  it("si no se puede anotar el resultado, el envío cuenta igual y la tanda sigue", async () => {
    for (const markError of ["result", "throw"] as const) {
      const t = setup([row("reserva_confirmada"), row("reserva_confirmada")], undefined, { markError });
      const report = await t.run();
      expect(report).toMatchObject({ sent: 2, failed: 0 });
      expect(t.marks).toHaveLength(2);
      expect(t.logs.filter((l) => l.message === "no se pudo anotar el resultado del email")).toHaveLength(2);
      expect(JSON.stringify(t.logs)).not.toContain("lucia@correo.example");
    }
  });
});

describe("no registra datos personales", () => {
  it("los logs de un fallo llevan la id y el motivo, pero no el email, el contenido ni el nombre", async () => {
    const rows = [row("reserva_confirmada", { attempts: 5 })];
    const t = setup(rows, async () => {
      throw new EmailSendError("Resend respondió 503: caído para lucia@correo.example", { kind: "http", status: 503, retryable: true, systemic: true });
    });
    await t.run();

    const logged = JSON.stringify([t.logs, t.marks]);
    expect(logged).not.toContain("lucia@correo.example");
    expect(logged).not.toContain("Lucía");
    expect(logged).not.toContain("Martín");
    expect(logged).not.toContain("<!doctype");
    const failure = t.logs.find((l) => l.message === "no se pudo enviar un email");
    expect(failure?.data).toMatchObject({ id: rows[0].id, kind: "reserva_confirmada", attempt: 5, retryable: true, exhausted: true, status: 503 });
  });

  it("un reintento que todavía tiene intentos no figura como agotado", async () => {
    const t = setup([row("reserva_confirmada", { attempts: 2 })], async () => {
      throw retryable(503);
    });
    await t.run();
    expect(t.logs.find((l) => l.message === "no se pudo enviar un email")?.data).toMatchObject({ exhausted: false });
  });
});
