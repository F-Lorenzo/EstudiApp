import path from "node:path";
import { pathToFileURL } from "node:url";
import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { computeWebhookSignature } from "./mercadopago/signature";
import { SimulatedPaymentProvider } from "./simulated-provider";
import { handleMercadoPagoWebhook, type WebhookDeps } from "./webhook-handler";

/**
 * Recorrido completo del cobro SIN Mercado Pago: el aviso firmado entra por el mismo manejador que usa
 * la ruta, el pago lo informa un proveedor simulado y la base es un Postgres real (PGlite) con TODAS las
 * migraciones aplicadas. Es la prueba de que las piezas encajan: los nombres y tipos de los argumentos
 * de las funciones SQL, lo que la base devuelve y lo que el servidor hace con eso.
 *
 * Lo que NO prueba: cómo se comporta Mercado Pago de verdad. Eso se comprueba en la cuenta de prueba (paso 1.5).
 */
type Harness = {
  makeDb(options?: { upTo?: number }): Promise<PGlite>;
  as<T>(db: PGlite, who: string, fn: () => Promise<T>): Promise<T>;
  ids: Record<string, string>;
};

const SECRET = "clave-de-prueba-no-real";
const SELLER_MP_ID = "111222333";
const SELLER_TOKEN = "APP_USR-token-docente";

let db: PGlite;
let harness: Harness;
let provider: SimulatedPaymentProvider;
let paymentSeq = 0;
let tsSeq = 1_760_000_000_000;
const SLOT = (n: number) => `54000000-0000-0000-0000-0000000000${String(n).padStart(2, "0")}`;
let slotSeq = 0;

async function load(file: string) {
  return (await import(/* @vite-ignore */ pathToFileURL(path.resolve(process.cwd(), "supabase/tests", file)).href)) as Record<string, unknown>;
}

/** Lo que haría PostgREST: llama a la función SQL por nombre, con los argumentos por nombre, como service_role. */
function sqlRpc(name: string, args: Record<string, unknown> = {}) {
  const keys = Object.keys(args);
  const placeholders = keys.map((key, index) => `${key} => $${index + 1}`).join(", ");
  const values = keys.map((key) => {
    const value = args[key];
    return value !== null && typeof value === "object" ? JSON.stringify(value) : value;
  });
  return harness
    .as(db, "service", () => db.query<{ v: unknown }>(`select public.${name}(${placeholders}) as v`, values))
    .then((result) => ({ data: result.rows[0].v, error: null }))
    .catch((error: { message: string; hint?: string }) => ({ data: null, error: { message: error.message, hint: error.hint ?? null } }));
}

function deps(overrides: Partial<WebhookDeps> = {}): WebhookDeps {
  return {
    secret: SECRET,
    db: { rpc: sqlRpc } as unknown as WebhookDeps["db"],
    provider,
    loadSellerToken: async () => ({ tutorId: harness.ids.docente, accessToken: SELLER_TOKEN }),
    log: () => undefined,
    ...overrides,
  };
}

/** Un aviso firmado de Mercado Pago sobre ese pago. */
function notification(paymentId: string, { ts = String(++tsSeq), action = "payment.updated", secret = SECRET } = {}) {
  const requestId = `req-${ts}`;
  const url = `https://estudiapp.example/api/mercadopago/webhook?data.id=${paymentId}&type=payment`;
  const signature = `ts=${ts},v1=${computeWebhookSignature(secret, { dataId: paymentId, requestId, ts })}`;
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json", "x-request-id": requestId, "x-signature": signature },
    body: JSON.stringify({ id: 7, type: "payment", action, user_id: SELLER_MP_ID, data: { id: paymentId } }),
  });
}

async function deliver(paymentId: string, options?: Parameters<typeof notification>[1], overrides?: Partial<WebhookDeps>) {
  const response = await handleMercadoPagoWebhook(notification(paymentId, options), deps(overrides));
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

/** Crea una reserva pendiente de pago del alumno (suelta las pendientes anteriores: máximo dos). */
async function newBooking() {
  await db.exec(`update public.bookings set status = 'cancelada' where student_id = '${harness.ids.alumno}' and status = 'pendiente_pago'`);
  const slot = SLOT(++slotSeq);
  await db.exec(`insert into public.availability_slots (id, tutor_id, starts_at, ends_at)
    values ('${slot}', '${harness.ids.docente}', now() + interval '5 days' + ${slotSeq} * interval '1 day', now() + interval '5 days 1 hour' + ${slotSeq} * interval '1 day')`);
  return harness.as(db, "alumno", async () => (await db.query<{ id: string }>(`select public.create_booking('${slot}') as id`)).rows[0].id);
}

/** Registra en el proveedor un pago de esa reserva, como si el alumno hubiera pagado en Mercado Pago. */
function payFor(bookingId: string, overrides: Record<string, unknown> = {}) {
  const id = String(9_000_000 + ++paymentSeq);
  provider.addPayment({ id, externalReference: bookingId, collectorId: SELLER_MP_ID, amount: 10000, ...overrides });
  return id;
}

const one = async <T>(sql: string) => (await db.query<T>(sql)).rows[0];
const bookingStatus = async (id: string) => (await one<{ status: string }>(`select status from public.bookings where id = '${id}'`)).status;
const paymentsOf = async (bookingId: string) => (await db.query<{ status: string; mercadopago_payment_id: string; commission_amount: string; tutor_amount: string; refunded_amount: string }>(`select * from public.payments where booking_id = '${bookingId}'`)).rows;
const refundOf = async (mpPaymentId: string) =>
  one<{ status: string; percent: number; amount: string; attempts: number; mercadopago_refund_id: string | null; reason: string }>(
    `select * from public.refunds where mercadopago_payment_id = '${mpPaymentId}'`,
  );

beforeAll(async () => {
  harness = (await load("harness.mjs")) as unknown as Harness;
  const { seed } = (await load("seed.mjs")) as { seed(db: PGlite): Promise<void> };
  db = await harness.makeDb();
  await seed(db);
  // El seed ya deja una cuenta de cobro de relleno para el docente base: se pasa a la de esta prueba.
  await db.exec(`insert into public.mp_credentials (tutor_id, mp_user_id, access_token, refresh_token, expires_at)
    values ('${harness.ids.docente}', '${SELLER_MP_ID}', 'cifrado', 'cifrado', now() + interval '100 days')
    on conflict (tutor_id) do update set mp_user_id = excluded.mp_user_id, expires_at = excluded.expires_at`);
}, 120_000);

afterAll(async () => {
  await db?.close();
});

describe("cobro de punta a punta (sin Mercado Pago)", () => {
  const fresh = () => {
    provider = new SimulatedPaymentProvider().registerSeller(SELLER_TOKEN, SELLER_MP_ID);
  };

  it("un pago aprobado confirma la reserva, acredita al docente con la comisión descontada y cierra el aviso", async () => {
    fresh();
    const booking = await newBooking();
    const payment = payFor(booking);

    const result = await deliver(payment);
    expect(result).toEqual({ status: 200, body: { status: "ok", outcome: "confirmada" } });

    expect(await bookingStatus(booking)).toBe("confirmada");
    const [row] = await paymentsOf(booking);
    expect(row).toMatchObject({ status: "aprobado", mercadopago_payment_id: payment });
    expect(Number(row.commission_amount)).toBe(1200); // 12 % de 10000
    expect(Number(row.tutor_amount)).toBe(8800);

    const event = await one<{ processed_at: string | null; process_error: string | null; attempts: number }>(
      `select processed_at, process_error, attempts from public.payment_webhook_events order by received_at desc limit 1`,
    );
    expect(event.processed_at).not.toBeNull();
    expect(event.process_error).toBeNull();
    expect(event.attempts).toBe(1);
  });

  it("el mismo aviso otra vez no hace nada, y un aviso nuevo del mismo pago tampoco", async () => {
    fresh();
    const booking = await newBooking();
    const payment = payFor(booking);
    const ts = String(++tsSeq);

    await deliver(payment, { ts });
    const repeated = await deliver(payment, { ts });
    expect(repeated.body).toEqual({ status: "duplicate" });

    const another = await deliver(payment, { action: "payment.created" });
    expect(another.body).toMatchObject({ status: "ok", outcome: "ya_confirmada" });

    expect(await paymentsOf(booking)).toHaveLength(1);
    expect(provider.refunds).toHaveLength(0);
  });

  it("un aviso viejo «pendiente» que llega después del aprobado no deshace nada", async () => {
    fresh();
    const booking = await newBooking();
    const payment = payFor(booking);
    await deliver(payment);

    // Mercado Pago entrega tarde un aviso anterior: el pago, consultado ahora, sigue aprobado.
    const late = await deliver(payment, { action: "payment.created" });
    expect(late.body).toMatchObject({ outcome: "ya_confirmada" });
    expect(await bookingStatus(booking)).toBe("confirmada");
  });

  it("un pago rechazado no cambia la reserva y el reintento aprobado sí la confirma", async () => {
    fresh();
    const booking = await newBooking();
    const rejected = payFor(booking, { status: "rejected", statusDetail: "cc_rejected_insufficient_amount" });
    expect((await deliver(rejected)).body).toMatchObject({ status: "ok", outcome: "rechazada" });
    expect(await bookingStatus(booking)).toBe("pendiente_pago");
    expect(await paymentsOf(booking)).toHaveLength(0);

    const approved = payFor(booking);
    expect((await deliver(approved)).body).toMatchObject({ outcome: "confirmada" });
    expect(await bookingStatus(booking)).toBe("confirmada");
    expect((await paymentsOf(booking))[0].mercadopago_payment_id).toBe(approved);
  });

  it("un pago que llega tarde (la retención venció) se reembolsa solo y no confirma la reserva", async () => {
    fresh();
    const booking = await newBooking();
    await db.exec(`update public.bookings set created_at = now() - interval '20 minutes' where id = '${booking}'`);
    const payment = payFor(booking);

    expect((await deliver(payment)).body).toMatchObject({ status: "ok", outcome: "reembolso_encolado" });

    expect(await bookingStatus(booking)).toBe("pendiente_pago");
    expect(await paymentsOf(booking)).toHaveLength(0);
    expect(provider.refunds).toHaveLength(1);
    expect(provider.refunds[0]).toMatchObject({ paymentId: payment, amount: 10000 });
    const refund = await refundOf(payment);
    expect(refund).toMatchObject({ status: "aprobado", percent: 100, reason: "pago_no_aceptable:hold_expired", mercadopago_refund_id: provider.refunds[0].id });
    expect(provider.payments.get(payment)?.refundedAmount).toBe(10000);
  });

  it("si el reembolso falla de forma pasajera, Mercado Pago reintenta y se completa sin devolver dos veces", async () => {
    fresh();
    const booking = await newBooking();
    await db.exec(`update public.bookings set created_at = now() - interval '20 minutes' where id = '${booking}'`);
    const payment = payFor(booking);
    const ts = String(++tsSeq);

    provider.failNext("refundPayment");
    const first = await deliver(payment, { ts });
    expect(first.status).toBe(500);
    expect(await refundOf(payment)).toMatchObject({ status: "fallido", attempts: 1 });
    expect(provider.refunds).toHaveLength(0);
    expect(await one<{ processed_at: string | null }>(`select processed_at from public.payment_webhook_events where mercadopago_event_id like '%:${ts}'`)).toMatchObject({ processed_at: null });

    // Segunda entrega del mismo aviso: se procesa de nuevo (no estaba cerrado).
    const second = await deliver(payment, { ts });
    expect(second).toEqual({ status: 200, body: { status: "ok", outcome: "reembolso_existente" } });
    expect(await refundOf(payment)).toMatchObject({ status: "aprobado", attempts: 2 });
    expect(provider.refunds).toHaveLength(1);

    // Y una tercera, ya cerrada, no hace nada.
    expect((await deliver(payment, { ts })).body).toEqual({ status: "duplicate" });
    expect(provider.refunds).toHaveLength(1);
  });

  it("un segundo pago de una reserva ya paga se devuelve y la reserva sigue con el primero", async () => {
    fresh();
    const booking = await newBooking();
    const first = payFor(booking);
    await deliver(first);
    const second = payFor(booking);

    expect((await deliver(second)).body).toMatchObject({ outcome: "reembolso_encolado" });
    const [row] = await paymentsOf(booking);
    expect(row.mercadopago_payment_id).toBe(first);
    expect(row.status).toBe("aprobado");
    expect(provider.refunds.map((refund) => refund.paymentId)).toEqual([second]);
    expect(provider.payments.get(first)?.refundedAmount).toBe(0);
  });

  it("un pago por un monto distinto del precio se devuelve completo (lo cobrado, no el precio)", async () => {
    fresh();
    const booking = await newBooking();
    const payment = payFor(booking, { amount: 7500.5 });
    expect((await deliver(payment)).body).toMatchObject({ outcome: "reembolso_encolado" });
    expect(provider.refunds[0].amount).toBe(7500.5);
    expect(await bookingStatus(booking)).toBe("pendiente_pago");
  });

  it("un pago de una reserva cancelada se devuelve", async () => {
    fresh();
    const booking = await newBooking();
    await harness.as(db, "alumno", () => db.query(`select public.cancel_booking('${booking}')`));
    const payment = payFor(booking);
    expect((await deliver(payment)).body).toMatchObject({ outcome: "reembolso_encolado" });
    expect((await refundOf(payment)).reason).toBe("pago_no_aceptable:not_pending");
  });

  it("un pago que entró a la cuenta de otro docente no se confirma ni se devuelve: queda para revisar", async () => {
    fresh();
    const booking = await newBooking();
    await db.exec(`insert into public.mp_credentials (tutor_id, mp_user_id, access_token, refresh_token, expires_at)
      values ('${harness.ids.docente2}', '222', 'cifrado', 'cifrado', now() + interval '100 days') on conflict do nothing`);
    const payment = payFor(booking, { collectorId: "222" });
    provider.registerSeller("OTRO-TOKEN", "222");

    // El aviso dice que la cuenta es la 222 y se consulta con su token; el pago pertenece a la reserva de otro docente.
    const result = await deliver(payment, undefined, { loadSellerToken: async () => ({ tutorId: harness.ids.docente2, accessToken: "OTRO-TOKEN" }) });
    expect(result).toEqual({ status: 200, body: { status: "needs_review" } });
    expect(await bookingStatus(booking)).toBe("pendiente_pago");
    expect(provider.refunds).toHaveLength(0);
    expect(await one(`select process_error from public.payment_webhook_events order by received_at desc limit 1`)).toMatchObject({
      process_error: "requiere_revision:cuenta_distinta",
    });
  });

  it("un aviso con firma inválida no deja rastro en la base ni consulta a Mercado Pago", async () => {
    fresh();
    const booking = await newBooking();
    const payment = payFor(booking);
    const before = await one<{ n: string }>(`select count(*) n from public.payment_webhook_events`);

    const result = await deliver(payment, { secret: "otra-clave" });
    expect(result.status).toBe(401);
    expect((await one<{ n: string }>(`select count(*) n from public.payment_webhook_events`)).n).toBe(before.n);
    expect(provider.calls).toHaveLength(0);
    expect(await bookingStatus(booking)).toBe("pendiente_pago");
  });

  it("un reembolso nuestro cuya respuesta se perdió se da por hecho cuando el aviso muestra el monto devuelto", async () => {
    fresh();
    const booking = await newBooking();
    const payment = payFor(booking);
    await deliver(payment);
    const [paymentRow] = await db.query<{ id: string }>(`select id from public.payments where booking_id = '${booking}'`).then((result) => result.rows);
    // La cola tiene un reembolso del 50 % que quedó «pendiente»…
    await sqlRpc("enqueue_refund", {
      p_mp_payment_id: payment,
      p_booking_id: booking,
      p_payment_id: paymentRow.id,
      p_percent: 50,
      p_amount: 5000,
      p_reason: "cancelacion_alumno",
    });
    // …pero Mercado Pago ya había devuelto los 5000 (la respuesta nunca llegó).
    provider.payments.get(payment)!.refundedAmount = 5000;

    const result = await deliver(payment);
    expect(result.body).toMatchObject({ outcome: "reembolso_confirmado" });
    expect(await refundOf(payment)).toMatchObject({ status: "aprobado" });
    const [row] = await paymentsOf(booking);
    expect(Number(row.refunded_amount)).toBe(5000);
    expect(Number(row.commission_amount)).toBe(600);
    expect(Number(row.tutor_amount)).toBe(4400);
    expect(provider.refunds).toHaveLength(0); // no devolvió dos veces
  });
});
