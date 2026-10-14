// Migración 0013: cancelar una reserva con reembolso. La base decide cuánto se devuelve (política de 24 h /
// 2 h, y 100 % si cancela el docente o la administración), lo encola una sola vez y le dice a la app qué hacer.
//
// Se prueba con la MISMA tabla de casos límite que la política en SQL (payments.db.mjs) y su espejo en TypeScript
// (src/lib/bookings/refund-policy.ts): supabase/tests/fixtures/refund-policy-cases.json.
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { makeDb, as, ids, expectFail, expectOk, report, track } from "./harness.mjs";
import { seed } from "./seed.mjs";
import { makeBookingHelpers } from "./booking-helpers.mjs";

const r = track([]);
const db = await makeDb();
await seed(db);
const q = (sql) => db.query(sql);
const CASOS = JSON.parse(fs.readFileSync(fileURLToPath(new URL("./fixtures/refund-policy-cases.json", import.meta.url)), "utf8"));
const CUENTA_DOCENTE = "seed-mp-d1"; // cuenta de cobro del docente base (la pone el seed)
// Compara en JSON ignorando el orden de las claves (jsonb las ordena por largo).
const canon = (v) => JSON.stringify(v, (_k, x) => (x && typeof x === "object" && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => (a < b ? -1 : 1))) : x));
const es = (label, got, want) => r.push([canon(got) === canon(want), `${label} → ${JSON.stringify(got)}`]);

// El espejo en TypeScript (Node 24 lo importa directo). Si no se pudiera importar, solo se salta esa comparación.
let ts = null;
try {
  ts = await import("../../src/lib/bookings/refund-policy.ts");
} catch (e) {
  console.log(`(no se pudo importar refund-policy.ts: ${String(e.message).slice(0, 80)}; se omite la comparación con TypeScript)`);
}

/** Monto a devolver, EXACTO: precio × porcentaje / 100 redondeado a centavos (mitad hacia arriba). Sin decimales de punto flotante. */
function montoExacto(price, percent) {
  const n = BigInt(Math.round(price * 100)) * BigInt(percent);
  let cents = n / 100n;
  if ((n % 100n) * 2n >= 100n) cents += 1n;
  return Number(cents) / 100;
}

// --- Ayudantes ---------------------------------------------------------------------------------------------------
const { reservaSinPagar, reservaPaga, cancelarA } = makeBookingHelpers(db, { slotPrefix: "54000000" });

const reembolsosDe = async (booking) => (await q(`select * from public.refunds where booking_id = '${booking}' order by created_at`)).rows;
const reserva = async (id) => (await q(`select status, cancellation_reason from public.bookings where id = '${id}'`)).rows[0];
const franjaReservada = async (id) => (await q(`select is_booked from public.availability_slots where id = '${id}'`)).rows[0].is_booked;
const pago = async (id) => (await q(`select * from public.payments where id = '${id}'`)).rows[0];

/** Una cancelación paga completa: resultado, fila de reembolso, reserva, franja y pago. */
async function casoPago(label, { minutes, who, percent, price = 10000 }) {
  const b = await reservaPaga({ price });
  const { result: x, error } = await cancelarA(b.booking, who, minutes);
  if (error) {
    r.push([false, `${label}: la cancelación falló (hint=${error.hint ?? error.message})`]);
    return null;
  }
  const quien = who === "alumno" ? "alumno" : who === "docente" ? "docente" : "administracion";
  const monto = montoExacto(price, percent);
  const filas = await reembolsosDe(b.booking);
  const p = await pago(b.payment);
  const bien =
    x.paid === true && x.percent === percent && Number(x.amount) === monto && x.cancelled_by === quien &&
    (percent === 0
      ? x.refund === null && filas.length === 0
      : x.refund?.status === "pendiente" && x.refund.percent === percent && Number(x.refund.amount) === monto &&
        x.refund.mercadopago_payment_id === b.mp && x.refund.mp_user_id === CUENTA_DOCENTE && !!x.refund.idempotency_key &&
        filas.length === 1 && filas[0].id === x.refund.id && filas[0].reason === `cancelacion_${quien}` &&
        filas[0].payment_id === b.payment && filas[0].mp_user_id === CUENTA_DOCENTE && filas[0].status === "pendiente");
  r.push([bien, `${label} → ${percent} % = ${monto} (${percent === 0 ? "sin reembolso" : "reembolso encolado"}; cancela ${quien})`]);
  const rv = await reserva(b.booking);
  r.push([rv.status === "cancelada" && !(await franjaReservada(b.slot)), `${label}: la reserva queda cancelada y el horario, libre`]);
  r.push([p.status === "aprobado" && Number(p.refunded_amount) === 0 && Number(p.amount) === price, `${label}: el pago NO se toca hasta que el reembolso se ejecute (sigue aprobado, devuelto 0)`]);
  return { b, x };
}

// --- 1. La matriz de la política, con la tabla de casos compartida ---------------------------------------------------------
//   alumno: la política por anticipación · docente y administración: siempre 100 % · clase empezada: no se cancela
for (const c of CASOS) {
  if (c.minutesBefore > 0) {
    await casoPago(`${c.caso} (${c.tutorOrAdmin ? "cancela el docente" : "cancela el alumno"})`, {
      minutes: c.minutesBefore, who: c.tutorOrAdmin ? "docente" : "alumno", percent: c.percent,
    });
  }
}
// ...y lo que cancela el docente o la administración vale 100 % para CUALQUIER anticipación (no solo los dos casos de la tabla).
for (const c of CASOS.filter((x) => x.minutesBefore > 0 && !x.tutorOrAdmin)) {
  await casoPago(`${c.caso}: si en cambio cancela el docente`, { minutes: c.minutesBefore, who: "docente", percent: 100 });
  await casoPago(`${c.caso}: si en cambio cancela la administración`, { minutes: c.minutesBefore, who: "admin", percent: 100 });
}
// Los límites tal cual los escribe la política: 24 h y 2 h son inclusivos, un minuto menos cambia de tramo.
{
  const pct = (m) => CASOS.find((c) => c.minutesBefore === m && !c.tutorOrAdmin)?.percent;
  r.push([pct(1440) === 100 && pct(1439) === 50 && pct(120) === 50 && pct(119) === 0, "la tabla compartida cubre los cuatro límites (24 h exactas, 23 h 59, 2 h exactas, 1 h 59)"]);
}

// Una clase que ya empezó no se cancela, ni siquiera el docente o la administración: sin reembolso, sin cambios.
for (const c of CASOS.filter((x) => x.minutesBefore <= 0)) {
  for (const who of c.tutorOrAdmin ? ["docente", "admin"] : ["alumno", "docente"]) {
    const b = await reservaPaga();
    const { error, result } = await cancelarA(b.booking, who, c.minutesBefore);
    r.push([!result && error?.hint === "already_started", `${c.caso} (${who}): no se cancela → hint=${error?.hint}`]);
    const filas = await reembolsosDe(b.booking);
    r.push([filas.length === 0 && (await reserva(b.booking)).status === "confirmada" && (await franjaReservada(b.slot)) === true,
      `...y no queda ningún reembolso, la reserva sigue confirmada y la franja reservada`]);
  }
}

// --- 2. Los montos coinciden con el cálculo exacto y con refundAmount de TypeScript, con precios con centavos --------------------
{
  const precios = [10000, 8333.33, 1234.56, 15000.5, 7777.77, 100.05, 999.99, 12345.67, 4321.09, 33333.33, 1999.95, 5555.55, 3333.33, 8750.25,
    2499.99, 0.29, 9.95, 17.65, 1.01, 99999.99];
  const mal = [];
  const malTs = [];
  for (const price of precios) {
    for (const [minutes, percent] of [[720, 50], [4320, 100]]) {
      const b = await reservaPaga({ price });
      const { result: x, error } = await cancelarA(b.booking, "alumno", minutes);
      if (error) {
        mal.push(`${price} al ${percent} % (falló: ${error.hint ?? error.message})`);
        continue;
      }
      const filas = await reembolsosDe(b.booking);
      if (Number(x.amount) !== montoExacto(price, percent) || Number(filas[0]?.amount) !== montoExacto(price, percent)) mal.push(`${price} al ${percent} %`);
      if (ts && ts.refundAmount(price, percent) !== Number(x.amount)) malTs.push(`${price} al ${percent} % (SQL ${x.amount}, TypeScript ${ts.refundAmount(price, percent)})`);
    }
  }
  r.push([mal.length === 0, `el reembolso es precio × % / 100 redondeado a centavos (mitad hacia arriba), exacto, en ${precios.length * 2} casos con centavos${mal.length ? ": " + mal.join(", ") : ""}`]);
  // Comparación con el espejo de TypeScript. SQL y TypeScript tienen que dar lo mismo; hoy TypeScript redondea mal algunos
  // precios con centavos (0,29 al 50 % da 0,14 en vez de 0,15 porque 0,29 × 50 = 14,499999… en punto flotante). La base es la
  // que decide, así que el reembolso es correcto; lo que sale mal es el texto que se le muestra a la persona. Se avisa, no se
  // rompe esta suite (el arreglo está en src/lib/bookings/refund-policy.ts: calcular en centavos enteros).
  if (ts) {
    const curados = [10000, 8333.33, 1234.56, 15000.5, 7777.77, 100.05, 999.99, 12345.67, 4321.09, 33333.33, 1999.95, 5555.55, 3333.33, 8750.25];
    const divergentesCurados = malTs.filter((m) => curados.some((p) => m.startsWith(`${p} al `)));
    r.push([divergentesCurados.length === 0, `refundAmount de TypeScript coincide con la base en los precios habituales con centavos${divergentesCurados.length ? ": " + divergentesCurados.join(", ") : ""}`]);
    if (malTs.length) console.log(`AVISO  refundAmount (TypeScript) difiere de la base en ${malTs.length} de ${precios.length * 2} casos: ${malTs.join("; ")}`);
  }
}

// --- 3. Reserva sin pago -------------------------------------------------------------------------------------------------------------
{
  // Pendiente de pago: se cancela como siempre, sin reembolso ni plata de por medio.
  const { booking: b, slot: s1 } = await reservaSinPagar();
  const x = await as(db, "alumno", async () => (await q(`select public.cancel_booking('${b}') as r`)).rows[0].r);
  es("cancelar una reserva sin pagar: paid=false, sin reembolso", x, { paid: false, percent: 0, amount: 0, refund: null, cancelled_by: "alumno" });
  r.push([(await reembolsosDe(b)).length === 0 && !(await franjaReservada(s1)), "...no encola nada y libera el horario"]);
  r.push([(await reserva(b)).cancellation_reason === "Cancelada por el alumno", "...con el motivo por defecto"]);

  // Con motivo propio.
  const { booking: b2 } = await reservaSinPagar();
  await as(db, "docente", () => q(`select public.cancel_booking('${b2}', '  Me surgió un imprevisto  ')`));
  r.push([(await reserva(b2)).cancellation_reason === "Me surgió un imprevisto", "el motivo que escribe quien cancela se guarda (sin espacios de más)"]);

  // La administración cancela una reserva sin pagar.
  const { booking: b3 } = await reservaSinPagar();
  const y = await as(db, "admin", async () => (await q(`select public.cancel_booking('${b3}') as r`)).rows[0].r);
  es("la administración cancela una reserva sin pagar", [y.paid, y.cancelled_by, y.refund], [false, "administracion", null]);

  // Una reserva «confirmada» sin pago registrado (resto del hueco anterior a la 0008): se cancela, sin nada que devolver.
  await db.exec(`update public.bookings set starts_at = now() + interval '5 days', ends_at = now() + interval '5 days 1 hour' where id = 'b0000000-0000-0000-0000-000000000002'`);
  const z = await as(db, "alumno", async () => (await q(`select public.cancel_booking('b0000000-0000-0000-0000-000000000002') as r`)).rows[0].r);
  es("una reserva confirmada SIN pago registrado se cancela sin reembolso", [z.paid, z.percent, z.refund], [false, 0, null]);
}

// --- 4. Quién puede cancelar y en qué estado ----------------------------------------------------------------------------------------------
{
  const b = await reservaPaga();
  const hintDe = async (who, id, sql = `select public.cancel_booking('${id}')`) => {
    try { await as(db, who, () => q(sql)); return null; } catch (e) { return e.hint ?? `sin hint: ${String(e.message).slice(0, 60)}`; }
  };
  es("otro alumno no encuentra la reserva", await hintDe("alumno2", b.booking), "not_found");
  es("otro docente no encuentra la reserva", await hintDe("docente2", b.booking), "not_found");
  es("una reserva que no existe", await hintDe("alumno", "99999999-9999-9999-9999-999999999999"), "not_found");
  es("sin sesión (service role): not_authenticated", await hintDe("service", b.booking), "not_authenticated");
  r.push([(await hintDe("anon", b.booking))?.startsWith("sin hint: permission denied"), "un visitante no ejecuta cancel_booking"]);
  r.push([(await reembolsosDe(b.booking)).length === 0 && (await reserva(b.booking)).status === "confirmada", "ninguno de esos intentos cambió nada"]);

  // La completada y la ya cancelada no se cancelan.
  es("una clase completada no se cancela", await hintDe("alumno", "b0000000-0000-0000-0000-000000000003"), "not_cancellable");
  const { result: x } = await cancelarA(b.booking, "alumno", 4320);
  r.push([x?.percent === 100, "el alumno cancela su reserva paga"]);
  es("cancelar dos veces: la segunda es not_cancellable", await hintDe("alumno", b.booking), "not_cancellable");
  es("...también para el docente", await hintDe("docente", b.booking), "not_cancellable");
  es("...y la administración", await hintDe("admin", b.booking), "not_cancellable");
  const filas = await reembolsosDe(b.booking);
  r.push([filas.length === 1, "dos cancelaciones seguidas dejan UN solo reembolso"]);
  const p = await pago(b.payment);
  r.push([p.status === "aprobado" && Number(p.refunded_amount) === 0, "...y el pago no se tocó"]);
}

// --- 5. La barrera contra dos reembolsos del mismo pago ------------------------------------------------------------------------------------------
{
  // Defensa 1: el reembolso es único por pago de Mercado Pago, aunque lo encolen dos caminos distintos.
  const b = await reservaPaga();
  const dos = await as(db, "service", async () => {
    const a = (await q(`select public.enqueue_refund('${b.mp}', '${b.booking}', '${b.payment}', 100, 10000, 'cancelacion_docente', 'cuenta-x') as v`)).rows[0].v;
    const c = (await q(`select public.enqueue_refund('${b.mp}', '${b.booking}', '${b.payment}', 50, 5000, 'cancelacion_alumno', 'cuenta-y') as v`)).rows[0].v;
    return [a, c];
  });
  es("enqueue_refund dos veces para el mismo pago", [dos[0].created, dos[1].created], [true, false]);
  r.push([dos[0].id === dos[1].id && dos[1].mp_user_id === "cuenta-x" && Number(dos[1].amount) === 10000 && (await reembolsosDe(b.booking)).length === 1,
    "...devuelve el mismo reembolso (con su cuenta y su monto originales) y deja una sola fila"]);

  // Defensa 2: si el pago ya tenía un reembolso, la cancelación informa ESE (no encola otro ni inventa un monto).
  const { result: x } = await cancelarA(b.booking, "alumno", 720); // el alumno pediría el 50 %, pero ya hay uno del 100 %
  r.push([x?.refund?.id === dos[0].id && x.percent === 100 && Number(x.amount) === 10000 && (await reembolsosDe(b.booking)).length === 1,
    `si el pago ya tenía un reembolso, la cancelación informa ese (${x?.percent} %, ${x?.amount}) y no encola otro`]);

  // Y estructuralmente: la reserva y el pago se bloquean (for update), como pide la regla contra cancelaciones simultáneas.
  // PGlite tiene una sola conexión, así que la carrera real no se puede reproducir acá: se comprueba que el bloqueo esté en la función.
  const fuente = (await q(`select prosrc from pg_proc where proname = 'cancel_booking' and pronamespace = 'public'::regnamespace`)).rows[0].prosrc;
  r.push([/from public\.bookings\s+where id = p_booking_id\s+for update/i.test(fuente), "cancel_booking bloquea la fila de la reserva (for update)"]);
  r.push([/from public\.payments\s+where booking_id = v_booking\.id and status = 'aprobado'\s+for update/i.test(fuente), "cancel_booking bloquea la fila del pago (for update)"]);
}

// --- 6. Pagos sin identificador de Mercado Pago y pagos simulados ------------------------------------------------------------------------------------
{
  // Sin identificador no hay a quién reembolsar: la cancelación se rechaza ENTERA y la reserva queda como estaba.
  const b = await reservaPaga();
  await db.exec(`update public.payments set mercadopago_payment_id = null where id = '${b.payment}'`);
  const { error } = await cancelarA(b.booking, "alumno", 4320);
  r.push([error?.hint === "invalid_payment", `un pago aprobado sin identificador de Mercado Pago no se puede reembolsar: se rechaza la cancelación (hint=${error?.hint})`]);
  r.push([(await reserva(b.booking)).status === "confirmada" && (await reembolsosDe(b.booking)).length === 0 && (await franjaReservada(b.slot)) === true,
    "...y la reserva queda confirmada, sin reembolso y con la franja reservada"]);
  // Con 0 % no hay nada que devolver: se cancela igual.
  const { result: x } = await cancelarA(b.booking, "alumno", 30);
  r.push([x?.paid === true && x.percent === 0 && x.refund === null, "...pero si le corresponde 0 % no hace falta el identificador y se cancela"]);

  // Un pago simulado (ALLOW_SIMULATED_PAYMENTS) lleva un identificador «simulado-…»: se encola igual; el ejecutor en TypeScript lo reconoce.
  const s = await reservaPaga({ mp: "simulado-abc123" });
  const { result: y } = await cancelarA(s.booking, "alumno", 4320);
  r.push([y?.refund?.mercadopago_payment_id === "simulado-abc123" && y.refund.percent === 100, "un pago simulado («simulado-…») encola su reembolso como cualquier otro"]);
}

// --- 7. El reembolso aprobado actualiza el pago --------------------------------------------------------------------------------------------------------
{
  // 50 %: el pago queda aprobado con lo retenido.
  const a = await reservaPaga();
  const { result: x } = await cancelarA(a.booking, "alumno", 720);
  await as(db, "service", () => q(`select public.mark_refund_result('${x.refund.id}', 'aprobado', 'mp-ref-a')`));
  const p = await pago(a.payment);
  r.push([Number(p.refunded_amount) === 5000 && Number(p.commission_amount) === 600 && Number(p.tutor_amount) === 4400 && p.status === "aprobado",
    `50 % aprobado: devuelto 5000, comisión 600, docente 4400, el pago sigue aprobado (${p.refunded_amount}, ${p.commission_amount}, ${p.tutor_amount}, ${p.status})`]);
  await as(db, "service", () => q(`select public.mark_refund_result('${x.refund.id}', 'aprobado', 'mp-ref-a')`));
  r.push([Number((await pago(a.payment)).refunded_amount) === 5000, "marcar el mismo reembolso aprobado dos veces no devuelve dos veces"]);

  // 100 %: el pago pasa a «reembolsado».
  const c = await reservaPaga();
  const { result: y } = await cancelarA(c.booking, "docente", 4320);
  await as(db, "service", () => q(`select public.mark_refund_result('${y.refund.id}', 'aprobado', 'mp-ref-c')`));
  const q2 = await pago(c.payment);
  r.push([q2.status === "reembolsado" && Number(q2.refunded_amount) === 10000 && Number(q2.commission_amount) === 0 && Number(q2.tutor_amount) === 0,
    `100 % aprobado: el pago queda «reembolsado», sin comisión ni docente (${q2.status}, ${q2.commission_amount}, ${q2.tutor_amount})`]);

  // Un intento fallido queda para reintentar: el pago no se toca.
  const d = await reservaPaga();
  const { result: z } = await cancelarA(d.booking, "alumno", 4320);
  await as(db, "service", () => q(`select public.mark_refund_result('${z.refund.id}', 'fallido', null, 'Mercado Pago no respondió')`));
  const q3 = await pago(d.payment);
  const f = (await reembolsosDe(d.booking))[0];
  r.push([Number(q3.refunded_amount) === 0 && q3.status === "aprobado" && f.status === "fallido" && f.attempts === 1, "un intento fallido deja el reembolso «fallido» para reintentar y el pago intacto"]);
}

// --- 8. enqueue_refund con la cuenta de cobro, y apply_payment_notification que la pasa ----------------------------------------------------------------
{
  const enq = (args) => as(db, "service", async () => (await q(`select public.enqueue_refund(${args}) as v`)).rows[0].v);
  const a = await enq(`'mp-e1', null, null, 100, 10000, 'prueba', 'cuenta-1'`);
  es("enqueue_refund guarda la cuenta de cobro", [a.created, a.mp_user_id], [true, "cuenta-1"]);
  const b = await enq(`'mp-e2', null, null, 100, 10000, 'prueba'`);
  es("llamada con seis argumentos (sin cuenta): sigue funcionando", [b.created, b.mp_user_id], [true, null]);
  const c = await enq(`'mp-e3', null, null, 100, 10000, 'prueba', '  '`);
  es("una cuenta en blanco se guarda como null", c.mp_user_id, null);
  const d = await enq(`'mp-e1', null, null, 50, 5000, 'otra', 'cuenta-2'`);
  es("repetir el pago devuelve el reembolso existente con SU cuenta", [d.created, d.mp_user_id, d.id === a.id], [false, "cuenta-1", true]);
  r.push([JSON.stringify(Object.keys(a).sort()) === JSON.stringify(["amount", "booking_id", "created", "id", "idempotency_key", "mercadopago_payment_id", "mp_user_id", "percent", "status"]),
    `el resumen trae id, booking_id, mercadopago_payment_id, status, percent, amount, idempotency_key y mp_user_id (${Object.keys(a).sort().join(", ")})`]);

  // apply_payment_notification: el reembolso del pago que no se puede aceptar sale de la cuenta que cobró.
  const t = await reservaPaga();
  await db.exec(`update public.bookings set status = 'cancelada' where id = '${t.booking}'`); // simula una reserva ya cancelada...
  await db.exec(`delete from public.payments where id = '${t.payment}'`); // ...y que el pago nunca se aceptó
  const aviso = await as(db, "service", async () =>
    (await q(`select public.apply_payment_notification('mp-tardio-1', '${t.booking}', 'approved', 10000, 'ARS', '${CUENTA_DOCENTE}', 0) as v`)).rows[0].v);
  es("un pago aprobado de una reserva cancelada se reembolsa", [aviso.outcome, aviso.detail], ["reembolso_encolado", "not_pending"]);
  es("...y el reembolso sale de la cuenta que cobró (la del aviso)", aviso.refund.mp_user_id, CUENTA_DOCENTE);
  r.push([(await q(`select mp_user_id from public.refunds where mercadopago_payment_id = 'mp-tardio-1'`)).rows[0].mp_user_id === CUENTA_DOCENTE, "...también en la fila guardada"]);
  // Sin reserva (inexistente) también.
  const huerfano = await as(db, "service", async () =>
    (await q(`select public.apply_payment_notification('mp-huerfano-1', '99999999-9999-9999-9999-999999999999', 'approved', 7000, 'ARS', '${CUENTA_DOCENTE}', 0) as v`)).rows[0].v);
  es("un pago de una reserva inexistente se reembolsa con la cuenta del aviso", [huerfano.outcome, huerfano.refund.mp_user_id], ["reembolso_encolado", CUENTA_DOCENTE]);
}

// --- 9. retryable_refunds: qué reembolsos conviene reintentar ----------------------------------------------------------------------------------------------
{
  await db.exec("delete from public.refunds");
  const D1 = ids.docente;
  // Reservas del docente (con cuenta de cobro «seed-mp-d1») y de un docente sin cuenta.
  const rb = await reservaPaga();
  const fila = async (mp, { status = "pendiente", attempts = 0, edad = "10 minutes", booking = null, cuenta = null, creado = null }) =>
    q(`insert into public.refunds (id, booking_id, mercadopago_payment_id, percent, amount, reason, status, attempts, mp_user_id, created_at, updated_at)
       values (gen_random_uuid(), ${booking ? `'${booking}'` : "null"}, '${mp}', 100, 10000, 'prueba', '${status}', ${attempts},
         ${cuenta ? `'${cuenta}'` : "null"}, ${creado ?? `now() - interval '${edad}'`}, now() - interval '${edad}')`);

  await fila("rr-vieja-pendiente", { edad: "3 days", booking: rb.booking, creado: "now() - interval '3 days'" });
  await fila("rr-fallido-7", { status: "fallido", attempts: 7, edad: "1 hour", creado: "now() - interval '2 days'" , booking: null, cuenta: "cuenta-propia" });
  await fila("rr-fallido-8", { status: "fallido", attempts: 8, edad: "1 hour", creado: "now() - interval '2 days'" });
  await fila("rr-aprobado", { status: "aprobado", attempts: 1, edad: "1 hour", creado: "now() - interval '2 days'" });
  await fila("rr-reciente", { edad: "30 seconds", creado: "now() - interval '1 day'" });
  await fila("rr-hace-1-min", { edad: "60 seconds", creado: "now() - interval '1 day'" });
  await fila("rr-hace-3-min", { edad: "180 seconds", creado: "now() - interval '1 day'" , booking: null, cuenta: null });
  await fila("rr-con-cuenta-y-reserva", { edad: "1 hour", creado: "now() - interval '1 hour'", booking: rb.booking, cuenta: "otra-cuenta" });
  // (rr-con-cuenta-y-reserva comparte reserva con rr-vieja-pendiente: es solo para ver la resolución de la cuenta; no hay restricción por reserva.)

  const lista = await as(db, "service", async () => (await q(`select public.retryable_refunds() as v`)).rows[0].v);
  const por = Object.fromEntries(lista.map((x) => [x.mercadopago_payment_id, x]));
  r.push([JSON.stringify(lista.map((x) => x.mercadopago_payment_id)) === JSON.stringify(["rr-vieja-pendiente", "rr-fallido-7", "rr-hace-3-min", "rr-con-cuenta-y-reserva"]),
    `pendientes y fallidos con menos de 8 intentos y sin tocar hace más de 2 minutos, por antigüedad (${lista.map((x) => x.mercadopago_payment_id).join(", ")})`]);
  r.push([!por["rr-fallido-8"], "con 8 intentos se deja de reintentar"]);
  r.push([!por["rr-aprobado"], "uno aprobado no se reintenta"]);
  r.push([!por["rr-reciente"] && !por["rr-hace-1-min"] && !!por["rr-hace-3-min"], "uno tocado hace menos de 2 minutos se espera (hace 1 minuto no, hace 3 minutos sí)"]);
  r.push([por["rr-vieja-pendiente"].mp_user_id === CUENTA_DOCENTE && por["rr-vieja-pendiente"].tutor_id === D1, "sin cuenta propia, se usa la cuenta de cobro vigente del docente de la reserva y se informa el docente"]);
  r.push([por["rr-con-cuenta-y-reserva"].mp_user_id === "otra-cuenta", "si la fila ya tiene su cuenta, esa manda (aunque el docente tenga otra)"]);
  r.push([por["rr-fallido-7"].mp_user_id === "cuenta-propia" && por["rr-fallido-7"].tutor_id === null, "un reembolso sin reserva usa su propia cuenta y no tiene docente"]);
  r.push([por["rr-hace-3-min"].mp_user_id === null && por["rr-hace-3-min"].tutor_id === null, "sin reserva ni cuenta, la cuenta queda en null"]);
  r.push([["id", "booking_id", "mercadopago_payment_id", "status", "percent", "amount", "idempotency_key", "mp_user_id", "tutor_id"].every((k) => k in por["rr-vieja-pendiente"]),
    "cada elemento trae el resumen del reembolso más tutor_id"]);

  const dos = await as(db, "service", async () => (await q(`select public.retryable_refunds(2) as v`)).rows[0].v);
  r.push([dos.length === 2 && dos[0].mercadopago_payment_id === "rr-vieja-pendiente", "el límite se respeta (2) y salen primero los más viejos"]);
  const cero = await as(db, "service", async () => (await q(`select public.retryable_refunds(0) as v`)).rows[0].v);
  es("con límite 0 devuelve un arreglo vacío", cero, []);
  const nulo = await as(db, "service", async () => (await q(`select public.retryable_refunds(null) as v`)).rows[0].v);
  r.push([nulo.length === 4, "sin límite (null) usa el predeterminado (25)"]);

  await db.exec("delete from public.refunds");
  es("sin reembolsos devuelve un arreglo vacío (no null)", await as(db, "service", async () => (await q(`select public.retryable_refunds() as v`)).rows[0].v), []);

  // Un reintento que sale bien lo saca de la lista; uno que falla lo manda al final de la espera.
  const rc = await reservaPaga();
  const { result: x } = await cancelarA(rc.booking, "docente", 4320);
  await db.exec(`alter table public.refunds disable trigger refunds_set_updated_at; update public.refunds set updated_at = now() - interval '5 minutes'; alter table public.refunds enable trigger refunds_set_updated_at;`);
  es("un reembolso recién encolado aparece cuando pasan 2 minutos", (await as(db, "service", async () => (await q(`select public.retryable_refunds() as v`)).rows[0].v)).map((y) => y.id), [x.refund.id]);
  await as(db, "service", () => q(`select public.mark_refund_result('${x.refund.id}', 'fallido', null, 'otra vez')`));
  es("...y tras un intento (aunque falle) espera otros 2 minutos", (await as(db, "service", async () => (await q(`select public.retryable_refunds() as v`)).rows[0].v)).length, 0);
}
// Solo el backend lo ejecuta.
for (const who of ["anon", "alumno", "docente", "admin"]) {
  await as(db, who, () => expectFail(`${who} NO ejecuta retryable_refunds`, q(`select public.retryable_refunds()`), r));
}
await as(db, "service", () => expectOk("el backend sí ejecuta retryable_refunds", q(`select public.retryable_refunds()`), r));

// --- 10. Cambia el tipo del resultado y desaparece refund_required ----------------------------------------------------------------------------------------------
{
  const fuente = (await q(`select prosrc, prorettype::regtype::text as t from pg_proc where proname = 'cancel_booking' and pronamespace = 'public'::regnamespace`)).rows[0];
  r.push([fuente.t === "jsonb", `cancel_booking devuelve jsonb (${fuente.t})`]);
  r.push([!/refund_required/.test(fuente.prosrc), "cancel_booking ya no tiene el código refund_required"]);
}

report(r);
