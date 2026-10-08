import { describe, expect, it, vi } from "vitest";
import { BOOKING_ID, SELLER_MP_ID, SELLER_TOKEN, TUTOR_ID, fakeRpc, refundSummary } from "@/test/payments-kit";
import { computeWebhookSignature } from "./mercadopago/signature";
import { SellerTokenError } from "./seller-token";
import { SimulatedPaymentProvider } from "./simulated-provider";
import { handleMercadoPagoWebhook, type WebhookDeps } from "./webhook-handler";

const SECRET = "clave-de-prueba-no-real";
const PAYMENT_ID = "1234567890";
const TS = "1760000000000";

type RequestOptions = {
  dataId?: string | null;
  bodyDataId?: string | number | null;
  requestId?: string | null;
  ts?: string;
  secret?: string;
  signature?: string | null;
  body?: Record<string, unknown> | string;
  query?: Record<string, string>;
};

/** Un aviso como lo manda Mercado Pago, con la firma calculada con la clave dada. */
function webhookRequest({
  dataId = PAYMENT_ID,
  bodyDataId = dataId,
  requestId = "req-1",
  ts = TS,
  secret = SECRET,
  signature,
  body,
  query = {},
}: RequestOptions = {}) {
  const url = new URL("https://estudiapp.example/api/mercadopago/webhook");
  if (dataId) url.searchParams.set("data.id", dataId);
  url.searchParams.set("type", "payment");
  for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);

  const headers: Record<string, string> = { "content-type": "application/json" };
  if (requestId) headers["x-request-id"] = requestId;
  const v1 = computeWebhookSignature(secret, { dataId, requestId, ts });
  if (signature !== null) headers["x-signature"] = signature ?? `ts=${ts},v1=${v1}`;

  const payload =
    body ??
    ({
      id: 987654321,
      type: "payment",
      action: "payment.updated",
      user_id: SELLER_MP_ID,
      live_mode: false,
      data: bodyDataId == null ? {} : { id: bodyDataId },
    } satisfies Record<string, unknown>);
  return new Request(url, { method: "POST", headers, body: typeof payload === "string" ? payload : JSON.stringify(payload) });
}

function setup(overrides: Partial<WebhookDeps> = {}, rpc: Parameters<typeof fakeRpc>[0] = {}) {
  const provider = new SimulatedPaymentProvider().registerSeller(SELLER_TOKEN, SELLER_MP_ID);
  provider.addPayment({ id: PAYMENT_ID, externalReference: BOOKING_ID, collectorId: SELLER_MP_ID });

  // Un `begin_payment_event` / `finish_payment_event` con memoria, como el de la base.
  const processed = new Set<string>();
  const seen = new Set<string>();
  const db = fakeRpc({
    begin_payment_event: (args) => {
      const id = String(args.p_event_id);
      const state = processed.has(id) ? "duplicado" : seen.has(id) ? "reintento" : "nuevo";
      seen.add(id);
      return { data: state };
    },
    finish_payment_event: (args) => {
      if (args.p_error == null) processed.add(String(args.p_event_id));
      return {};
    },
    apply_payment_notification: { data: { outcome: "confirmada" } },
    ...rpc,
  });
  const log = vi.fn();
  const deps: WebhookDeps = {
    secret: SECRET,
    db: db.db,
    provider,
    loadSellerToken: async () => ({ tutorId: TUTOR_ID, accessToken: SELLER_TOKEN }),
    log,
    ...overrides,
  };
  const send = async (request: Request) => {
    const response = await handleMercadoPagoWebhook(request, deps);
    return { response, status: response.status, body: (await response.json()) as Record<string, unknown> };
  };
  return { send, db, provider, log, deps };
}

describe("autenticidad", () => {
  it("sin clave configurada no procesa nada (falla cerrado)", async () => {
    const { send, db, provider } = setup({ secret: undefined });
    const { status, body } = await send(webhookRequest());
    expect(status).toBe(500);
    expect(body.status).toBe("not_configured");
    expect(db.calls).toHaveLength(0);
    expect(provider.calls).toHaveLength(0);
  });

  it.each([
    ["sin cabecera de firma", { signature: null }],
    ["firma mal formada", { signature: "basura" }],
    ["firmado con otra clave", { secret: "otra-clave" }],
    ["firma de otro pago (data.id distinto)", { signature: `ts=${TS},v1=${computeWebhookSignature(SECRET, { dataId: "999", requestId: "req-1", ts: TS })}` }],
    ["sin x-request-id pero firmado con él", { requestId: null, signature: `ts=${TS},v1=${computeWebhookSignature(SECRET, { dataId: PAYMENT_ID, requestId: "req-1", ts: TS })}` }],
  ] as [string, RequestOptions][])("%s → 401 y no toca ni la base ni Mercado Pago", async (_label, options) => {
    const { send, db, provider } = setup();
    const { status, body } = await send(webhookRequest(options));
    expect(status).toBe(401);
    expect(body).toEqual({ status: "invalid_signature" });
    expect(db.calls).toHaveLength(0);
    expect(provider.calls).toHaveLength(0);
  });

  it("no revela por qué se rechazó", async () => {
    const { send } = setup();
    const { body } = await send(webhookRequest({ secret: "otra-clave" }));
    expect(JSON.stringify(body)).not.toMatch(/mismatch|secret|clave/i);
  });

  it("un aviso que anuncia ser enorme ni se lee", async () => {
    const { send } = setup();
    const text = vi.fn();
    const request = { url: "https://estudiapp.example/api/mercadopago/webhook", headers: new Headers({ "content-length": "5000000" }), text } as unknown as Request;
    const { status } = await send(request);
    expect(status).toBe(413);
    expect(text).not.toHaveBeenCalled();
  });

  it("un cuerpo enorme se rechaza antes de procesarlo", async () => {
    const { send, db } = setup();
    const { status } = await send(webhookRequest({ body: JSON.stringify({ relleno: "x".repeat(70_000) }) }));
    expect(status).toBe(413);
    expect(db.calls).toHaveLength(0);
  });
});

describe("qué avisos se procesan", () => {
  it("ignora (con 200) los avisos que no son de pagos", async () => {
    const { send, db } = setup();
    const { status, body } = await send(webhookRequest({ body: { type: "merchant_order", data: { id: PAYMENT_ID } }, query: { type: "merchant_order" } }));
    expect(status).toBe(200);
    expect(body).toMatchObject({ status: "ignored" });
    expect(db.calls).toHaveLength(0);
  });

  it("rechaza un aviso cuyo data.id del cuerpo no coincide con el firmado en la dirección", async () => {
    const { send, db } = setup();
    const { status, body } = await send(webhookRequest({ bodyDataId: "555" }));
    expect(status).toBe(400);
    expect(body.status).toBe("inconsistent_data_id");
    expect(db.calls).toHaveLength(0);
  });

  it.each(["abc", "12/../3", "1".repeat(30)])("rechaza un data.id que no es un número de pago (%s)", async (dataId) => {
    const { send, db } = setup();
    const { status } = await send(webhookRequest({ dataId, bodyDataId: dataId }));
    expect(status).toBe(400);
    expect(db.calls).toHaveLength(0);
  });

  it("rechaza un aviso sin ningún data.id", async () => {
    const { send } = setup();
    const { status } = await send(webhookRequest({ dataId: null, bodyDataId: null }));
    expect(status).toBe(400);
  });

  it("acepta el data.id solo en el cuerpo si así se firmó (sin id en la dirección)", async () => {
    const { send, db } = setup();
    const { status } = await send(webhookRequest({ dataId: null, bodyDataId: PAYMENT_ID }));
    expect(status).toBe(200);
    expect(db.of("apply_payment_notification")[0].args.p_mp_payment_id).toBe(PAYMENT_ID);
  });

  it("un cuerpo que no es JSON no rompe: se usa lo que traiga la dirección", async () => {
    const { send } = setup();
    const { status } = await send(webhookRequest({ body: "esto no es json" }));
    expect(status).toBe(200);
  });

  it("un cuerpo con forma inválida se rechaza", async () => {
    const { send } = setup();
    const { status } = await send(webhookRequest({ body: "[1,2]" }));
    expect(status).toBe(400);
  });
});

describe("recorrido de un pago aprobado", () => {
  it("anota el aviso, confirma y cierra el evento", async () => {
    const { send, db, provider } = setup();
    const { status, body } = await send(webhookRequest());

    expect(status).toBe(200);
    expect(body).toEqual({ status: "ok", outcome: "confirmada" });
    expect(db.calls.map((call) => call.name)).toEqual(["begin_payment_event", "apply_payment_notification", "finish_payment_event"]);
    expect(provider.calls.map((call) => call.operation)).toEqual(["getPayment"]);
    expect(db.of("finish_payment_event")[0].args.p_error).toBeNull();
  });

  it("guarda el contenido del aviso, sin cabeceras ni la firma", async () => {
    const { send, db } = setup();
    await send(webhookRequest());
    const payload = db.of("begin_payment_event")[0].args.p_payload as Record<string, unknown>;
    expect(payload.body).toMatchObject({ type: "payment", user_id: SELLER_MP_ID });
    expect(JSON.stringify(payload)).not.toMatch(/v1=|x-signature|ts=/);
  });

  it("el mismo aviso otra vez (ya procesado) responde 200 y no hace nada más", async () => {
    const { send, db, provider } = setup();
    await send(webhookRequest());
    const repeated = await send(webhookRequest());
    expect(repeated.status).toBe(200);
    expect(repeated.body).toEqual({ status: "duplicate" });
    expect(db.of("apply_payment_notification")).toHaveLength(1);
    expect(provider.calls).toHaveLength(1);
  });

  it("dos avisos distintos del mismo pago se procesan los dos (creado y luego aprobado)", async () => {
    const { send, db } = setup();
    await send(webhookRequest({ body: { id: 1, type: "payment", action: "payment.created", user_id: SELLER_MP_ID, data: { id: PAYMENT_ID } }, ts: "1760000000001" }));
    await send(webhookRequest({ body: { id: 1, type: "payment", action: "payment.updated", user_id: SELLER_MP_ID, data: { id: PAYMENT_ID } }, ts: "1760000000002" }));
    expect(db.of("apply_payment_notification")).toHaveLength(2);
    const ids = db.of("begin_payment_event").map((call) => call.args.p_event_id);
    expect(new Set(ids).size).toBe(2);
  });
});

describe("fallas", () => {
  it("si no puede anotar el aviso, pide que lo reintenten", async () => {
    const { send, provider } = setup({}, { begin_payment_event: { error: { message: "db caída" } } });
    const { status, body } = await send(webhookRequest());
    expect(status).toBe(500);
    expect(body.status).toBe("retry");
    expect(provider.calls).toHaveLength(0);
  });

  it("una falla pasajera (Mercado Pago caído) responde 500 y deja el motivo anotado", async () => {
    const { send, db, provider } = setup();
    provider.failNext("getPayment");
    const { status, body } = await send(webhookRequest());
    expect(status).toBe(500);
    expect(body).toEqual({ status: "retry" });
    expect(String(db.of("finish_payment_event")[0].args.p_error)).toMatch(/consulta_del_pago/);
  });

  it("tras una falla pasajera, el reintento de Mercado Pago sí se procesa", async () => {
    const { send, db, provider } = setup();
    provider.failNext("getPayment");
    expect((await send(webhookRequest())).status).toBe(500);
    const retried = await send(webhookRequest());
    expect(retried.status).toBe(200);
    expect(retried.body).toMatchObject({ outcome: "confirmada" });
    expect(db.of("apply_payment_notification")).toHaveLength(1);
  });

  it("algo que requiere revisión responde 200 (no tiene sentido que lo reintenten) y queda anotado", async () => {
    const { send, db } = setup({}, { apply_payment_notification: { data: { outcome: "requiere_revision", detail: "cuenta_distinta" } } });
    const { status, body } = await send(webhookRequest());
    expect(status).toBe(200);
    expect(body).toEqual({ status: "needs_review" });
    expect(db.of("finish_payment_event")[0].args.p_error).toBe("requiere_revision:cuenta_distinta");
  });

  it("una cuenta de cobro desconocida responde 200 y queda anotada", async () => {
    const { send, db } = setup({
      loadSellerToken: async () => {
        throw new SellerTokenError("unknown_seller");
      },
    });
    const { status } = await send(webhookRequest());
    expect(status).toBe(200);
    expect(db.of("finish_payment_event")[0].args.p_error).toBe("cuenta_de_cobro_desconocida");
  });

  it("una excepción inesperada responde 500 sin filtrar el detalle", async () => {
    const { send, db } = setup({
      loadSellerToken: async () => {
        throw new Error("clave super secreta filtrada");
      },
    });
    const { status, body } = await send(webhookRequest());
    expect(status).toBe(500);
    expect(JSON.stringify(body)).not.toContain("secreta");
    expect(String(db.of("finish_payment_event")[0].args.p_error)).toMatch(/excepción/);
  });

  it("si no puede cerrar el evento, igual responde según lo que pasó con el pago", async () => {
    const { send, log } = setup({}, { finish_payment_event: { error: { message: "db caída" } } });
    const { status, body } = await send(webhookRequest());
    expect(status).toBe(200);
    expect(body).toMatchObject({ status: "ok" });
    expect(log).toHaveBeenCalledWith("no se pudo cerrar el aviso", expect.anything());
  });

  it("un pago que no se puede aceptar se reembolsa y se responde 200", async () => {
    const { send, provider } = setup(
      {},
      { apply_payment_notification: { data: { outcome: "reembolso_encolado", detail: "hold_expired", refund: refundSummary() } } },
    );
    const { status, body } = await send(webhookRequest());
    expect(status).toBe(200);
    expect(body).toEqual({ status: "ok", outcome: "reembolso_encolado" });
    expect(provider.refunds).toHaveLength(1);
  });
});
