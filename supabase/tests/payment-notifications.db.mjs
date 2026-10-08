// Migración 0012: qué hace la base con cada pago que avisa Mercado Pago (apply_payment_notification)
// y la cola de reembolsos (enqueue_refund). Es la regla del dinero: confirma lo aceptable, reembolsa
// lo que no se puede aceptar y nunca hace nada dos veces.
import { makeDb, as, ids, expectFail, expectOk, report } from "./harness.mjs";
import { seed } from "./seed.mjs";

const r = [];
const db = await makeDb();
await seed(db);
const q = (sql) => db.query(sql);
const S = (n) => `53000000-0000-0000-0000-0000000000${String(n).padStart(2, "0")}`;
const NOEXISTE = "99999999-9999-9999-9999-999999999999";

await db.exec(`
  insert into public.mp_credentials (tutor_id, mp_user_id, access_token, refresh_token, expires_at) values
    ('${ids.docente}', '111', 'cifrado', 'cifrado', now() + interval '100 days'),
    ('${ids.docente2}', '222', 'cifrado', 'cifrado', now() + interval '100 days');
  insert into public.availability_slots (id, tutor_id, starts_at, ends_at)
  select ('53000000-0000-0000-0000-0000000000' || lpad(n::text, 2, '0'))::uuid, '${ids.docente}',
         now() + (n + 4) * interval '1 day', now() + (n + 4) * interval '1 day' + interval '1 hour'
  from generate_series(1, 20) n;
`);

// Cada escenario usa su propia reserva. Un alumno puede tener como mucho dos sin pagar, así que antes
// de crear otra se sueltan las pendientes anteriores (como lo haría el vencimiento de los 15 minutos).
const book = async (who, slot) => {
  await db.exec(`update public.bookings set status = 'cancelada' where student_id = '${ids[who]}' and status = 'pendiente_pago'`);
  return as(db, who, async () => (await q(`select public.create_booking('${slot}') as id`)).rows[0].id);
};
let mpSeq = 0;
const nuevoMp = () => `mp-${++mpSeq}`;

/** Llama a la función como lo hace el servidor. Devuelve el JSON de resultado. */
async function aviso({ mp, booking, status = "approved", amount = 10000, currency = "ARS", collector = "111", refunded = 0 }) {
  const lit = (v) => (v === null || v === undefined ? "null" : `'${v}'`);
  return as(db, "service", async () => {
    const x = await q(`select public.apply_payment_notification(${lit(mp)}, ${lit(booking)}, ${lit(status)}, ${amount === null ? "null" : amount},
      ${lit(currency)}, ${lit(collector)}, ${refunded}) as v`);
    return x.rows[0].v;
  });
}
const estadoReserva = async (id) => (await q(`select status from public.bookings where id = '${id}'`)).rows[0].status;
const pagosDe = async (id) => (await q(`select * from public.payments where booking_id = '${id}'`)).rows;
const reembolsosDe = async (mp) => (await q(`select * from public.refunds where mercadopago_payment_id = '${mp}'`)).rows;
const cuenta = async (tabla) => Number((await q(`select count(*) n from public.${tabla}`)).rows[0].n);
const es = (label, got, want) => r.push([JSON.stringify(got) === JSON.stringify(want), `${label} → ${JSON.stringify(got)}`]);

// --- 1. Pago aprobado y aceptable ---------------------------------------------------------------------------------
{
  const b = await book("alumno", S(1));
  const mp = nuevoMp();
  const x = await aviso({ mp, booking: b });
  es("pago aprobado: outcome", x.outcome, "confirmada");
  es("la reserva queda confirmada", await estadoReserva(b), "confirmada");
  const p = (await pagosDe(b))[0];
  r.push([p.status === "aprobado" && p.mercadopago_payment_id === mp && Number(p.amount) === 10000 && Number(p.commission_amount) === 1200 && Number(p.tutor_amount) === 8800,
    `el pago queda aprobado: 10000, comisión 1200 (12 % de la reserva), docente 8800 (${p.amount}, ${p.commission_amount}, ${p.tutor_amount})`]);

  // El mismo aviso otra vez, o llegando fuera de orden, no cambia nada.
  es("el mismo aviso otra vez", (await aviso({ mp, booking: b })).outcome, "ya_confirmada");
  es("un aviso viejo «pendiente» llegando después del aprobado", (await aviso({ mp, booking: b, status: "pending" })).outcome, "ya_confirmada");
  es("un aviso viejo «rechazado» llegando después del aprobado", (await aviso({ mp, booking: b, status: "rejected" })).outcome, "ya_confirmada");
  r.push([(await pagosDe(b)).length === 1 && (await estadoReserva(b)) === "confirmada", "...y sigue habiendo un solo pago y la reserva confirmada"]);
  r.push([(await cuenta("refunds")) === 0, "ningún aviso repetido generó un reembolso"]);
}

// --- 2. Pendiente, rechazado y luego aprobado (el alumno reintenta) -------------------------------------------------
{
  const b = await book("alumno", S(2));
  const mpMalo = nuevoMp();
  es("pago pendiente", (await aviso({ mp: mpMalo, booking: b, status: "in_process" })).outcome, "pendiente");
  es("pago rechazado", (await aviso({ mp: mpMalo, booking: b, status: "rejected" })).outcome, "rechazada");
  es("pago cancelado", (await aviso({ mp: nuevoMp(), booking: b, status: "cancelled" })).outcome, "rechazada");
  r.push([(await estadoReserva(b)) === "pendiente_pago" && (await pagosDe(b)).length === 0, "pendiente y rechazado no cambian la reserva ni crean pagos"]);
  const mpBueno = nuevoMp();
  es("el segundo intento sale aprobado", (await aviso({ mp: mpBueno, booking: b })).outcome, "confirmada");
  es("la reserva queda confirmada", await estadoReserva(b), "confirmada");
  r.push([(await pagosDe(b))[0].mercadopago_payment_id === mpBueno, "el pago registrado es el aprobado, no el rechazado"]);
  es("estado desconocido de Mercado Pago", (await aviso({ mp: nuevoMp(), booking: b, status: "algo_nuevo" })).outcome, "requiere_revision");
}

// --- 3. Pagos que NO se pueden aceptar: se reembolsan solos -----------------------------------------------------------------
{
  // 3a. Llegó tarde: la retención de 15 minutos ya venció.
  const b = await book("alumno", S(3));
  await db.exec(`update public.bookings set created_at = now() - interval '20 minutes' where id = '${b}'`);
  const mp = nuevoMp();
  const x = await aviso({ mp, booking: b });
  es("pago tardío: outcome", [x.outcome, x.detail], ["reembolso_encolado", "hold_expired"]);
  r.push([x.refund.status === "pendiente" && Number(x.refund.amount) === 10000 && x.refund.percent === 100 && !!x.refund.idempotency_key,
    "se encola el reembolso del 100 % (10000) con su clave de idempotencia"]);
  r.push([(await estadoReserva(b)) === "pendiente_pago" && (await pagosDe(b)).length === 0, "la reserva NO se confirma ni se registra el pago"]);
  const row = (await reembolsosDe(mp))[0];
  r.push([row.reason === "pago_no_aceptable:hold_expired" && row.booking_id === b && row.payment_id === null, `el reembolso guarda el motivo y la reserva (${row.reason})`]);
  const otra = await aviso({ mp, booking: b });
  es("repetir el aviso del pago tardío", otra.outcome, "reembolso_existente");
  r.push([(await reembolsosDe(mp)).length === 1 && otra.refund.idempotency_key === x.refund.idempotency_key, "...no crea un segundo reembolso y conserva la misma clave de idempotencia"]);

  // 3b. La reserva se canceló antes de que llegara el pago.
  const c = await book("alumno", S(4));
  await as(db, "alumno", () => q(`select public.cancel_booking('${c}')`));
  const y = await aviso({ mp: nuevoMp(), booking: c });
  es("pago de una reserva cancelada", [y.outcome, y.detail], ["reembolso_encolado", "not_pending"]);

  // 3c. Pago duplicado: la reserva ya estaba paga con otro pago.
  const d = await book("alumno", S(5));
  await aviso({ mp: nuevoMp(), booking: d });
  const mpDoble = nuevoMp();
  const z = await aviso({ mp: mpDoble, booking: d });
  es("segundo pago de una reserva ya paga", [z.outcome, z.detail], ["reembolso_encolado", "duplicate_payment"]);
  const pagosD = await pagosDe(d);
  r.push([pagosD.length === 1 && pagosD[0].mercadopago_payment_id !== mpDoble && (await estadoReserva(d)) === "confirmada", "...la reserva sigue paga con el primer pago, no con el segundo"]);

  // 3d. Monto distinto del precio: se devuelve lo que se cobró, no el precio.
  const e = await book("alumno", S(6));
  const w = await aviso({ mp: nuevoMp(), booking: e, amount: 7500.5 });
  es("monto distinto del precio", [w.outcome, w.detail], ["reembolso_encolado", "amount_mismatch"]);
  r.push([Number(w.refund.amount) === 7500.5, `se reembolsan los 7500,50 cobrados (${w.refund.amount})`]);
  r.push([(await estadoReserva(e)) === "pendiente_pago", "la reserva sigue pendiente (puede pagar bien)"]);

  // 3e. Otra moneda.
  const f = await book("alumno", S(7));
  const v = await aviso({ mp: nuevoMp(), booking: f, currency: "USD" });
  es("pago en otra moneda", [v.outcome, v.detail], ["reembolso_encolado", "moneda"]);

  // 3f. La clase ya empezó.
  const g = await book("alumno", S(8));
  await db.exec(`update public.bookings set starts_at = now() - interval '30 minutes', ends_at = now() + interval '30 minutes' where id = '${g}'`);
  const u = await aviso({ mp: nuevoMp(), booking: g });
  es("pago de una clase que ya empezó", [u.outcome, u.detail], ["reembolso_encolado", "class_started"]);

  // 3g. La reserva no existe.
  const t = await aviso({ mp: nuevoMp(), booking: NOEXISTE });
  es("pago de una reserva inexistente", [t.outcome, t.detail], ["reembolso_encolado", "reserva_inexistente"]);
  r.push([t.refund.booking_id === null && Number(t.refund.amount) === 10000, "...se reembolsa igual (sin reserva asociada)"]);
}

// --- 4. Cuentas de cobro: la plata tiene que haber entrado donde corresponde --------------------------------------------
{
  const b = await book("alumno", S(9));
  const antes = await cuenta("refunds");
  es("cuenta de cobro desconocida", (await aviso({ mp: nuevoMp(), booking: b, collector: "999" })).detail, "cuenta_desconocida");
  es("sin cuenta de cobro", (await aviso({ mp: nuevoMp(), booking: b, collector: null })).detail, "cuenta_desconocida");
  es("el pago entró a la cuenta de OTRO docente", (await aviso({ mp: nuevoMp(), booking: b, collector: "222" })).detail, "cuenta_distinta");
  r.push([(await estadoReserva(b)) === "pendiente_pago" && (await pagosDe(b)).length === 0 && (await cuenta("refunds")) === antes,
    "ninguno de esos casos confirma ni reembolsa: los mira una persona"]);
  es("monto 0", (await aviso({ mp: nuevoMp(), booking: b, amount: 0 })).detail, "monto_invalido");
  es("sin monto", (await aviso({ mp: nuevoMp(), booking: b, amount: null })).detail, "monto_invalido");
  es("aprobado pero ya devuelto en parte por fuera", (await aviso({ mp: nuevoMp(), booking: b, refunded: 3000 })).detail, "reembolso_externo");
  es("sin referencia a una reserva", (await aviso({ mp: nuevoMp(), booking: null })).outcome, "ignorado");
  r.push([(await estadoReserva(b)) === "pendiente_pago", "la reserva sigue intacta"]);
}

// --- 5. Reembolsos hechos por fuera y reembolsos nuestros de resultado incierto ----------------------------------------------
{
  const b = await book("alumno", S(10));
  const mp = nuevoMp();
  await aviso({ mp, booking: b });
  const ext = await aviso({ mp, booking: b, status: "refunded", refunded: 10000 });
  es("reembolso hecho por fuera de la app", [ext.outcome, ext.detail], ["requiere_revision", "reembolso_externo"]);
  const cc = await aviso({ mp, booking: b, status: "charged_back" });
  es("contracargo", [cc.outcome, cc.detail], ["requiere_revision", "contracargo"]);
  es("el pago sigue aprobado (no se toca plata sin una persona)", (await pagosDe(b))[0].status, "aprobado");
  es("«reembolsado» de un pago que no conocemos", (await aviso({ mp: nuevoMp(), booking: b, status: "refunded" })).outcome, "ignorado");

  // Reembolso nuestro del 50 % cuya respuesta se perdió: Mercado Pago ya devolvió 5000.
  const pago = (await pagosDe(b))[0];
  const enq = await as(db, "service", async () => (await q(`select public.enqueue_refund('${mp}', '${b}', '${pago.id}', 50, 5000, 'cancelacion_alumno') as v`)).rows[0].v);
  es("enqueue_refund crea el reembolso", [enq.created, enq.status], [true, "pendiente"]);
  const cura = await aviso({ mp, booking: b, status: "approved", refunded: 5000 });
  es("el aviso confirma el reembolso que quedó incierto", [cura.outcome, cura.refund.status], ["reembolso_confirmado", "aprobado"]);
  const p = (await pagosDe(b))[0];
  r.push([Number(p.refunded_amount) === 5000 && Number(p.commission_amount) === 600 && Number(p.tutor_amount) === 4400,
    `el pago se actualiza: devuelto 5000, comisión 600, docente 4400 (${p.refunded_amount}, ${p.commission_amount}, ${p.tutor_amount})`]);
  const otra = await aviso({ mp, booking: b, status: "approved", refunded: 5000 });
  r.push([otra.outcome === "reembolso_existente" || otra.outcome === "ya_confirmada", `repetir ese aviso no devuelve dos veces (${otra.outcome}, devuelto ${(await pagosDe(b))[0].refunded_amount})`]);
  r.push([Number((await pagosDe(b))[0].refunded_amount) === 5000, "refunded_amount sigue en 5000"]);

  // Con un reembolso parcial MENOR al esperado no se da por hecho.
  const c = await book("alumno", S(11));
  const mp2 = nuevoMp();
  await aviso({ mp: mp2, booking: c });
  const pago2 = (await pagosDe(c))[0];
  await as(db, "service", () => q(`select public.enqueue_refund('${mp2}', '${c}', '${pago2.id}', 100, 10000, 'cancelacion_docente')`));
  const parcial = await aviso({ mp: mp2, booking: c, status: "approved", refunded: 4000 });
  r.push([parcial.outcome !== "reembolso_confirmado", `con solo 4000 devueltos de 10000 el reembolso NO se da por hecho (${parcial.outcome})`]);
  es("...y sigue pendiente", (await reembolsosDe(mp2))[0].status, "pendiente");
}

// --- 6. Pago que ya se mandó a reembolsar: no se reevalúa --------------------------------------------------------------
{
  const b = await book("alumno", S(12));
  await db.exec(`update public.bookings set created_at = now() - interval '20 minutes' where id = '${b}'`);
  const mp = nuevoMp();
  await aviso({ mp, booking: b });
  // Aunque ahora la reserva volviera a estar vigente, el pago ya está en la cola de reembolsos.
  await db.exec(`update public.bookings set created_at = now() where id = '${b}'`);
  es("el pago ya reembolsable no se confirma después", (await aviso({ mp, booking: b })).outcome, "reembolso_existente");
  r.push([(await estadoReserva(b)) === "pendiente_pago", "la reserva no se confirma con un pago que se está devolviendo"]);
}

// --- 6b. Dos avisos a la vez del mismo pago: la cola tiene una sola fila --------------------------------------------------
{
  const enq = (mp) =>
    as(db, "service", async () => (await q(`select public.enqueue_refund('${mp}', null, null, 100, 10000, 'pago_no_aceptable:prueba') as v`)).rows[0].v);
  const a = await enq("mp-carrera");
  const b = await enq("mp-carrera");
  es("enqueue_refund dos veces para el mismo pago", [a.created, b.created], [true, false]);
  r.push([(await reembolsosDe("mp-carrera")).length === 1 && a.id === b.id && a.idempotency_key === b.idempotency_key, "...deja una sola fila y la misma clave de idempotencia"]);
}

// --- 7. Permisos y datos inválidos -------------------------------------------------------------------------------------------
for (const who of ["anon", "alumno", "docente", "admin"]) {
  await as(db, who, () => expectFail(`${who} NO ejecuta apply_payment_notification`, q(`select public.apply_payment_notification('x', null, 'approved', 1, 'ARS', '111')`), r));
  await as(db, who, () => expectFail(`${who} NO ejecuta enqueue_refund`, q(`select public.enqueue_refund('x', null, null, 100, 1, 'x')`), r));
}
await as(db, "service", () => expectFail("un pago sin identificador es inválido", q(`select public.apply_payment_notification(' ', null, 'approved', 1, 'ARS', '111')`), r));
await as(db, "service", () => expectFail("un aviso sin estado es inválido", q(`select public.apply_payment_notification('x', null, null, 1, 'ARS', '111')`), r));
await as(db, "service", () => expectFail("un reembolso de monto 0 se rechaza", q(`select public.enqueue_refund('mp-cero', null, null, 100, 0, 'x')`), r));
await as(db, "service", () => expectFail("un reembolso con porcentaje fuera de rango se rechaza", q(`select public.enqueue_refund('mp-pct', null, null, 150, 10, 'x')`), r));
{
  // Un error inesperado (acá, un monto que no entra en la columna) NO se confunde con «pago no aceptable»:
  // se propaga para que el aviso se reintente y no queda nada a medias.
  const b = await book("alumno", S(13));
  const filas = await cuenta("refunds");
  await db.exec(`
    create function public.test_boom() returns trigger language plpgsql as $$ begin raise exception 'boom'; end $$;
    create trigger test_boom before insert on public.payments for each row execute function public.test_boom();`);
  await as(db, "service", () => expectFail("un error inesperado al confirmar se propaga (no se confunde con «pago no aceptable»)", q(
    `select public.apply_payment_notification('${nuevoMp()}', '${b}', 'approved', 10000, 'ARS', '111')`), r));
  await db.exec("drop trigger test_boom on public.payments; drop function public.test_boom();");
  r.push([(await cuenta("refunds")) === filas && (await estadoReserva(b)) === "pendiente_pago" && (await pagosDe(b)).length === 0,
    "...y no deja reembolsos, pagos ni cambios a medias (el aviso se va a reintentar)"]);
  es("pasado el problema, el reintento confirma", (await aviso({ mp: nuevoMp(), booking: b })).outcome, "confirmada");

  // Un monto que no entra en la columna también es un error, no un «pago no aceptable».
  const c = await book("alumno", S(14));
  await as(db, "service", () => expectFail("un monto absurdo propaga el error en vez de reembolsarlo", q(
    `select public.apply_payment_notification('${nuevoMp()}', '${c}', 'approved', 99999999999, 'ARS', '111')`), r));
}
await as(db, "service", () => expectOk("el backend sí ejecuta ambas funciones", q(`select public.enqueue_refund('mp-ok', null, null, 100, 1, 'prueba')`), r));

report(r);
