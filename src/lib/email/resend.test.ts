import { describe, expect, it, vi } from "vitest";
import { createResendSender, ResendEmailSender } from "./resend";
import { EmailSendError, sanitizeText, type EmailMessage } from "./sender";

const API_KEY = "re_TestClave1234567890_no_es_real";
const FROM = "EstudiApp <hola@estudiapp.example>";

const message: EmailMessage = {
  to: "lucia@correo.example",
  subject: "Tu clase con Martín está confirmada",
  html: "<p>Hola</p>",
  text: "Hola",
  idempotencyKey: "0b0f1c64-0b6b-4a53-8f0a-111111111111",
};

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

type Step = Response | Error;

function setup(steps: Step[], options: ConstructorParameters<typeof ResendEmailSender>[0] = {}) {
  const queue = [...steps];
  const calls: { url: string; init: RequestInit & { headers: Record<string, string>; body: string } }[] = [];
  const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init as (typeof calls)[number]["init"] });
    const step = queue.shift();
    if (!step) throw new Error("fetch llamado más veces de lo esperado");
    if (step instanceof Error) throw step;
    return step;
  });
  const sender = new ResendEmailSender({ apiKey: API_KEY, from: FROM, fetch: fetchMock as unknown as typeof fetch, ...options });
  return { sender, calls, fetchMock };
}

async function failure(sender: ResendEmailSender, msg: EmailMessage = message): Promise<EmailSendError> {
  try {
    await sender.send(msg);
  } catch (error) {
    expect(error).toBeInstanceOf(EmailSendError);
    return error as EmailSendError;
  }
  throw new Error("debía fallar y no falló");
}

describe("envío correcto", () => {
  it("hace un POST a la API de Resend con la clave, la idempotencia y el cuerpo esperado", async () => {
    const { sender, calls } = setup([json({ id: "re-id-1" })]);
    const result = await sender.send(message);

    expect(result).toEqual({ id: "re-id-1" });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://api.resend.com/emails");
    expect(calls[0].init.method).toBe("POST");
    expect(calls[0].init.headers.Authorization).toBe(`Bearer ${API_KEY}`);
    expect(calls[0].init.headers["Idempotency-Key"]).toBe(message.idempotencyKey);
    expect(calls[0].init.headers["Content-Type"]).toBe("application/json");
    expect(JSON.parse(calls[0].init.body)).toEqual({
      from: FROM,
      to: [message.to],
      subject: message.subject,
      html: message.html,
      text: message.text,
    });
  });

  it("corta a los 8 segundos por defecto (y respeta otro plazo si se lo piden)", async () => {
    const { sender, calls } = setup([json({ id: "a" }), json({ id: "b" })]);
    await sender.send(message);
    expect(calls[0].init.signal).toBeInstanceOf(AbortSignal);

    const timeout = vi.spyOn(AbortSignal, "timeout");
    await sender.send(message);
    expect(timeout).toHaveBeenLastCalledWith(8_000);
    const custom = setup([json({ id: "c" })], { timeoutMs: 1_500 });
    await custom.sender.send(message);
    expect(timeout).toHaveBeenLastCalledWith(1_500);
    timeout.mockRestore();
  });

  it("el asunto viaja en una sola línea", async () => {
    const { sender, calls } = setup([json({ id: "a" })]);
    await sender.send({ ...message, subject: "Hola\r\nBcc: robo@malo.example" });
    expect(JSON.parse(calls[0].init.body).subject).toBe("Hola Bcc: robo@malo.example");
  });

  it("repetir el envío reutiliza la misma clave de idempotencia", async () => {
    const { sender, calls } = setup([json({ id: "a" }), json({ id: "a" })]);
    await sender.send(message);
    await sender.send(message);
    expect(calls[1].init.headers["Idempotency-Key"]).toBe(calls[0].init.headers["Idempotency-Key"]);
  });
});

describe("errores reintentables (la fila queda «fallida» y vuelve a intentarse)", () => {
  it.each([429, 500, 502, 503, 504, 408])("HTTP %i: reintentable y del proveedor", async (status) => {
    const { sender } = setup([json({ statusCode: status, name: "application_error", message: "falló" }, status)]);
    const error = await failure(sender);
    expect(error).toMatchObject({ kind: "http", status, retryable: true, systemic: true });
  });

  it("429 con el código de cuota o de límite de pedidos", async () => {
    const { sender } = setup([json({ statusCode: 429, name: "rate_limit_exceeded", message: "Too many requests" }, 429, { "retry-after": "1" })]);
    expect(await failure(sender)).toMatchObject({ status: 429, code: "rate_limit_exceeded", retryable: true, systemic: true });
  });

  it("la red caída es reintentable", async () => {
    const { sender } = setup([new TypeError("fetch failed")]);
    expect(await failure(sender)).toMatchObject({ kind: "network", retryable: true, systemic: true, status: null });
  });

  it("el tiempo agotado es reintentable", async () => {
    const timeout = Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" });
    const { sender } = setup([timeout]);
    expect(await failure(sender)).toMatchObject({ kind: "timeout", retryable: true, systemic: true });
  });

  it("una respuesta 200 que no se puede leer se reintenta (la idempotencia evita el duplicado)", async () => {
    for (const body of [new Response("<html>"), json({ sin: "id" }), json({ id: "" }), json(null)]) {
      const { sender } = setup([body]);
      expect(await failure(sender)).toMatchObject({ kind: "invalid_response", retryable: true, systemic: false });
    }
  });

  it("401 y 403 (clave inválida, dominio sin verificar) son configuración: reintentables y cortan la tanda", async () => {
    for (const [status, name] of [[401, "missing_api_key"], [403, "validation_error"], [403, "invalid_api_key"]] as const) {
      const { sender } = setup([json({ statusCode: status, name, message: "The domain is not verified" }, status)]);
      expect(await failure(sender)).toMatchObject({ status, code: name, retryable: true, systemic: true });
    }
  });

  it("un 409 por una petición idéntica en curso se reintenta, sin cortar la tanda", async () => {
    const { sender } = setup([json({ statusCode: 409, name: "concurrent_idempotent_requests", message: "en curso" }, 409)]);
    expect(await failure(sender)).toMatchObject({ status: 409, retryable: true, systemic: false });
  });
});

describe("errores definitivos (Resend rechazó ESE mensaje)", () => {
  it.each([400, 404, 405, 413, 422])("HTTP %i: no se reintenta y no corta la tanda", async (status) => {
    const { sender } = setup([json({ statusCode: status, name: "validation_error", message: "El campo to es inválido" }, status)]);
    const error = await failure(sender);
    expect(error).toMatchObject({ kind: "http", status, retryable: false, systemic: false });
    expect(error.message).toContain(`Resend respondió ${status}`);
    expect(error.message).toContain("El campo to es inválido");
  });

  it("un 409 por reutilizar la clave con otro contenido no se reintenta", async () => {
    const { sender } = setup([json({ statusCode: 409, name: "invalid_idempotent_request", message: "otra carga" }, 409)]);
    expect(await failure(sender)).toMatchObject({ status: 409, code: "invalid_idempotent_request", retryable: false });
  });

  it("un error sin cuerpo legible igual se clasifica por el estado", async () => {
    const { sender } = setup([new Response("no es json", { status: 422 }), new Response("", { status: 503 })]);
    expect(await failure(sender)).toMatchObject({ status: 422, retryable: false, code: null });
    expect(await failure(sender)).toMatchObject({ status: 503, retryable: true });
  });

  it("un código de error con caracteres raros no se copia", async () => {
    const { sender } = setup([json({ name: "<script>alert(1)</script>", message: "x" }, 422)]);
    const error = await failure(sender);
    expect(error.code).toBeNull();
    expect(error.message).not.toContain("<script>");
  });
});

describe("no filtra datos sensibles", () => {
  it("la clave de API no aparece en el error aunque Resend la repita en su mensaje", async () => {
    const { sender } = setup([json({ statusCode: 401, name: "invalid_api_key", message: `API key ${API_KEY} is invalid; Bearer ${API_KEY}` }, 401)]);
    const error = await failure(sender);
    expect(error.message).not.toContain(API_KEY);
    expect(error.message).not.toContain("re_TestClave");
    expect(JSON.stringify({ ...error, message: error.message, stack: error.stack?.split("\n")[0] })).not.toContain(API_KEY);
  });

  it("el destinatario no aparece en el error aunque Resend lo repita", async () => {
    const { sender } = setup([json({ statusCode: 422, name: "validation_error", message: "Invalid address lucia@correo.example for this domain" }, 422)]);
    const error = await failure(sender);
    expect(error.message).not.toContain("lucia@correo.example");
    expect(error.message).toContain("[email]");
  });

  it("los errores de red no copian el mensaje original (puede traer direcciones o detalles del sistema)", async () => {
    const { sender } = setup([new TypeError("fetch failed: getaddrinfo ENOTFOUND api.resend.com lucia@correo.example")]);
    const error = await failure(sender);
    expect(error.message).toBe("No pudimos comunicarnos con Resend.");
  });

  it("el cuerpo del email no se incluye en ningún error", async () => {
    const secret = "CONTENIDO-PRIVADO-DEL-EMAIL";
    const { sender } = setup([json({ statusCode: 500, name: "application_error", message: "boom" }, 500)]);
    const error = await failure(sender, { ...message, html: `<p>${secret}</p>`, text: secret });
    expect(error.message).not.toContain(secret);
    expect(error.message).not.toContain(message.to);
  });

  it("sanitizeText tapa emails, claves y encabezados, aplana espacios y recorta", () => {
    expect(sanitizeText("falló para a.b+c@d-e.com   en\n la línea")).toBe("falló para [email] en la línea");
    expect(sanitizeText("Authorization: Bearer abc.def.ghi y re_ABCDEF123456")).toBe("Authorization: Bearer [oculto] y [clave]");
    expect(sanitizeText("clave=secreto-largo", ["secreto-largo"])).toBe("clave=[oculto]");
    expect(sanitizeText("x".repeat(400), [], 50)).toHaveLength(50);
  });
});

describe("sin configuración", () => {
  it.each([
    ["sin clave", { apiKey: undefined, from: FROM }],
    ["clave en blanco", { apiKey: "   ", from: FROM }],
    ["sin remitente", { apiKey: API_KEY, from: undefined }],
    ["remitente vacío", { apiKey: API_KEY, from: "" }],
    ["remitente sin arroba", { apiKey: API_KEY, from: "EstudiApp" }],
    ["remitente con salto de línea", { apiKey: API_KEY, from: "EstudiApp <hola@estudiapp.example>\r\nBcc: x@y.example" }],
    ["remitente con varios destinos", { apiKey: API_KEY, from: "a@estudiapp.example, b@estudiapp.example" }],
  ])("%s: queda no configurado y no llama a la red", async (_label, options) => {
    const { sender, fetchMock } = setup([], options);
    expect(sender.configured).toBe(false);
    const error = await failure(sender);
    expect(error).toMatchObject({ kind: "not_configured", retryable: true, systemic: true });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([FROM, "hola@estudiapp.example", "  EstudiApp <hola@estudiapp.example>  "])("remitente válido: %j", (from) => {
    expect(setup([], { from }).sender.configured).toBe(true);
  });

  it("se arma desde RESEND_API_KEY y EMAIL_FROM", () => {
    expect(createResendSender({ RESEND_API_KEY: API_KEY, EMAIL_FROM: FROM }).configured).toBe(true);
    expect(createResendSender({ RESEND_API_KEY: API_KEY }).configured).toBe(false);
    expect(createResendSender({ EMAIL_FROM: FROM }).configured).toBe(false);
    expect(createResendSender({}).configured).toBe(false);
  });
});

describe("pedidos inválidos (no salen a la red)", () => {
  it.each(["", "sin-arroba", "a@b", "dos@arrobas@x.example", "con espacio@x.example", "a@x.example,b@x.example", "<a@x.example>", `${"x".repeat(250)}@x.example`])(
    "destinatario inválido: %j",
    async (to) => {
      const { sender, fetchMock } = setup([]);
      expect(await failure(sender, { ...message, to })).toMatchObject({ kind: "invalid_request", retryable: false, systemic: false });
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it.each(["", "con espacio", "salto\nde-linea", "ñandú", "x".repeat(257)])("clave de idempotencia inválida: %j", async (idempotencyKey) => {
    const { sender, fetchMock } = setup([]);
    expect(await failure(sender, { ...message, idempotencyKey })).toMatchObject({ kind: "invalid_request", retryable: false });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
