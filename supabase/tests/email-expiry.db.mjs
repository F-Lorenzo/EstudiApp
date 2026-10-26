// Migración 0023: los emails vencen a las 48 horas sin salir, y la administración ve el estado de la bandeja.
// Se prueba qué vence y qué no (lo reciente, lo enviado, lo que agotó los intentos), que lo vencido no se
// reclame, y que el resumen lo vea solo la administración y no lleve destinatarios.
import { makeDb, as, report } from "./harness.mjs";
import { seed } from "./seed.mjs";
import { makeBookingHelpers } from "./booking-helpers.mjs";

const r = [];
const db = await makeDb();
await seed(db);
const q = (sql) => db.query(sql);
const { reservaPaga } = makeBookingHelpers(db, { slotPrefix: "5a230000" });

const claim = () => as(db, "service", async () => (await q(`select public.claim_pending_emails(100) as r`)).rows[0].r);
const fila = async (id) => (await q(`select * from public.email_outbox where id = '${id}'`)).rows[0];
/** Los dos emails de una reserva paga (alumno y docente), con la antigüedad y el estado que se pidan. */
async function emails(horas, { status = "pendiente", attempts = 0 } = {}) {
  const { booking } = await reservaPaga();
  await db.exec(`update public.email_outbox set created_at = now() - interval '${horas} hours', status = '${status}', attempts = ${attempts}, sent_at = ${status === "enviado" ? "now()" : "null"} where booking_id = '${booking}'`);
  return (await q(`select id from public.email_outbox where booking_id = '${booking}' order by kind`)).rows.map((x) => x.id);
}

// --- Qué vence -----------------------------------------------------------------------------------------------------
{
  const viejos = await emails(49);
  const recientes = await emails(47);
  const fallidosViejos = await emails(72, { status: "fallido", attempts: 2 });
  const agotados = await emails(72, { status: "fallido", attempts: 5 });
  const enviados = await emails(100, { status: "enviado", attempts: 1 });

  const reclamados = (await claim()).map((x) => x.id);
  const v = await fila(viejos[0]);
  r.push([v.status === "omitido" && v.last_error === "Venció sin enviarse (48 horas).", `un email de hace 49 horas vence (${v.status}: ${v.last_error})`]);
  r.push([!viejos.some((id) => reclamados.includes(id)), "...y no se reclama"]);
  r.push([v.attempts === 0 && v.sent_at === null, "...sin sumar un intento ni figurar como enviado"]);
  r.push([recientes.every((id) => reclamados.includes(id)), "uno de hace 47 horas se reclama"]);
  const f = await fila(fallidosViejos[0]);
  r.push([f.status === "omitido" && !reclamados.includes(f.id), "un fallido de hace 3 días que todavía tenía intentos también vence"]);
  const a = await fila(agotados[0]);
  r.push([a.status === "fallido", "uno que agotó los 5 intentos sigue «fallido», para que se vea el problema"]);
  const e = await fila(enviados[0]);
  r.push([e.status === "enviado" && e.last_error === null, "uno ya enviado no cambia aunque sea viejo"]);
}

// --- Resumen para la administración ------------------------------------------------------------------------------------
{
  const s = await as(db, "admin", async () => (await q(`select public.email_outbox_summary() as s`)).rows[0].s);
  r.push([s && typeof s.last_7_days === "object", "la administración ve el resumen"]);
  // Los 10 emails de arriba tienen fechas «falsas» de hace días: solo cuentan los de los últimos 7 días (todos).
  const t = s.last_7_days;
  r.push([t.omitido >= 4 && t.enviado >= 2 && t.fallido >= 2 && t.pendiente >= 2, `cuenta por estado (${JSON.stringify(t)})`]);
  r.push([s.waiting >= 2 && s.oldest_waiting_at !== null, `lo que espera salir (${s.waiting}) y desde cuándo`]);
  r.push([s.last_sent_at !== null, "cuándo salió el último"]);
  const vencido = s.problems.find((p) => p.error === "Venció sin enviarse (48 horas).");
  r.push([vencido && vencido.status === "omitido" && typeof vencido.kind === "string", "los problemas recientes incluyen los vencidos"]);
  r.push([s.problems.length <= 10, "como mucho 10 problemas"]);
  const texto = JSON.stringify(s);
  r.push([!texto.includes("@") && !("recipient_id" in (s.problems[0] ?? {})) && !("payload" in (s.problems[0] ?? {})), "sin destinatarios ni contenido de los emails"]);

  // Los que agotaron los intentos no cuentan como «esperando».
  const sinAgotados = Number((await q(`select count(*)::int as n from public.email_outbox where status in ('pendiente', 'fallido') and attempts < 5`)).rows[0].n);
  r.push([s.waiting === sinAgotados, `«esperando» no cuenta los que agotaron los intentos (${s.waiting} = ${sinAgotados})`]);

  for (const who of ["alumno", "docente"]) {
    const hint = await as(db, who, () => q(`select public.email_outbox_summary()`)).then(() => null, (err) => err.hint);
    r.push([hint === "not_admin", `${who} NO ve el resumen`]);
  }
  const anon = await as(db, "anon", () => q(`select public.email_outbox_summary()`)).then(() => "ok", (err) => String(err.message));
  r.push([/permission denied/.test(anon), "un visitante NO ve el resumen"]);
}

// --- La bandeja sigue siendo solo del backend ----------------------------------------------------------------------------
for (const who of ["alumno", "docente", "admin"]) {
  const out = await as(db, who, () => q(`select public.claim_pending_emails(1)`)).then(() => "ok", (err) => String(err.message));
  r.push([/permission denied/.test(out), `${who} NO reclama emails`]);
}

report(r);
