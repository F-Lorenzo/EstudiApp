// Migración 0019: decisiones sobre los perfiles docentes y registro de acciones. Se prueba cada acción de
// `decide_tutor_profile` con sus transiciones y motivos, que todo cambio de estado quede registrado (también los que
// no pasan por la función), que el registro no se pueda editar ni borrar, quién lo lee, las cancelaciones y los
// cambios de rol de la administración, y los emails de la reapertura y la baja.
import { makeDb, as, ids, expectFail, report } from "./harness.mjs";
import { seed } from "./seed.mjs";
import { makeBookingHelpers } from "./booking-helpers.mjs";

const r = [];
const db = await makeDb();
await seed(db);
const q = (sql) => db.query(sql);
const { reservaPaga, cancelarA } = makeBookingHelpers(db, { slotPrefix: "5a190000" });

const decidir = (who, tutor, action, reason = null) =>
  as(db, who, async () =>
    (await q(`select public.decide_tutor_profile('${ids[tutor]}', '${action}', ${reason === null ? "null" : `'${reason}'`}) as s`)).rows[0].s);
const hintDe = async (promise) => {
  try { await promise; return null; } catch (e) { return e.hint ?? `sin hint: ${String(e.message).slice(0, 60)}`; }
};
const estado = async (tutor) => (await q(`select verification_status as s, verification_reason as m from public.tutor_profiles where id = '${ids[tutor]}'`)).rows[0];
const registro = async (tutor) =>
  (await q(`select * from public.audit_log where target_type = 'docente' and target_id = '${ids[tutor]}' order by id`)).rows;
const ultimo = async (tutor) => (await registro(tutor)).at(-1);
const emails = async (tutor, kind) =>
  (await q(`select payload from public.email_outbox where recipient_id = '${ids[tutor]}' and kind = '${kind}' order by created_at`)).rows;

// --- Rechazar, reabrir, aprobar y dar de baja ---------------------------------------------------------------------
{
  // docente2 arranca pendiente (seed).
  r.push([(await hintDe(decidir("admin", "docente2", "rechazar"))) === "reason_required", "rechazar exige motivo"]);
  r.push([(await hintDe(decidir("admin", "docente2", "rechazar", "   "))) === "reason_required", "...y un motivo en blanco no cuenta"]);
  r.push([(await decidir("admin", "docente2", "rechazar", "  Falta el respaldo  ")) === "rechazado", "la administración rechaza con motivo"]);
  const e = await estado("docente2");
  r.push([e.s === "rechazado" && e.m === "Falta el respaldo", "...el perfil queda rechazado con el motivo limpio"]);
  const a = await ultimo("docente2");
  r.push([a.action === "rechazar" && a.actor_kind === "administracion" && a.actor_id === ids.admin && a.reason === "Falta el respaldo", "...y queda registrado con quién y por qué"]);
  r.push([a.details.from === "pendiente" && a.details.to === "rechazado" && a.details.tutor_name === "docente d2" && a.actor_name, "...con el cambio de estado y los nombres"]);

  r.push([(await hintDe(decidir("admin", "docente2", "aprobar"))) === "invalid_transition", "no se aprueba un rechazado directamente (primero se reabre)"]);
  r.push([(await hintDe(decidir("admin", "docente2", "dar_de_baja", "x"))) === "invalid_transition", "no se da de baja a un perfil que no está aprobado"]);

  r.push([(await decidir("admin", "docente2", "reabrir", "Mandó el título por mail")) === "pendiente", "reabrir lo devuelve a pendiente"]);
  const e2 = await estado("docente2");
  r.push([e2.s === "pendiente" && e2.m === null, "...sin motivo de rechazo"]);
  const a2 = await ultimo("docente2");
  r.push([a2.action === "reabrir" && a2.reason === "Mandó el título por mail", "...con la nota en el registro"]);
  r.push([(await emails("docente2", "perfil_reabierto")).length === 1, "...y el docente recibe el email de la reapertura"]);

  r.push([(await decidir("admin", "docente2", "aprobar")) === "aprobado", "desde pendiente se aprueba"]);
  r.push([(await ultimo("docente2")).action === "aprobar", "...registrado"]);

  r.push([(await hintDe(decidir("admin", "docente2", "dar_de_baja"))) === "reason_required", "dar de baja exige motivo"]);
  r.push([(await decidir("admin", "docente2", "dar_de_baja", "Denuncia de un alumno")) === "rechazado", "la administración da de baja a un aprobado"]);
  const a3 = await ultimo("docente2");
  r.push([a3.action === "dar_de_baja" && a3.reason === "Denuncia de un alumno" && a3.details.from === "aprobado", "...registrado como baja"]);
  const baja = (await emails("docente2", "perfil_rechazado")).at(-1)?.payload;
  r.push([baja?.was_approved === true && baja.reason === "Denuncia de un alumno", "...y el email dice que es una baja, con el motivo"]);
  const rechazo = (await emails("docente2", "perfil_rechazado"))[0]?.payload;
  r.push([rechazo && !("was_approved" in rechazo), "el email de un rechazo (no baja) no lo dice"]);
  const visible = await as(db, "anon", async () => (await q(`select count(*)::int as n from public.tutor_catalog where id = '${ids.docente2}'`)).rows[0].n);
  r.push([visible === 0, "dado de baja, ya no aparece en el catálogo"]);

  r.push([(await hintDe(decidir("admin", "docente2", "borrar"))) === "invalid_action", "una acción desconocida se rechaza"]);
  r.push([(await hintDe(as(db, "admin", () => q(`select public.decide_tutor_profile('99999999-9999-9999-9999-999999999999', 'aprobar')`)))) === "not_found", "un perfil inexistente: not_found"]);
  for (const who of ["alumno", "docente", "docente2"]) {
    r.push([(await hintDe(decidir(who, "docente2", "reabrir"))) === "not_admin", `${who} NO puede decidir sobre un perfil`]);
  }
  await as(db, "anon", () => expectFail("un visitante NO puede decidir sobre un perfil", q(`select public.decide_tutor_profile('${ids.docente2}', 'reabrir')`), r));
}

// --- Lo que no pasa por la función también queda registrado -----------------------------------------------------------
{
  // El docente reenvía su perfil rechazado.
  await as(db, "docente2", () => q(`update public.tutor_profiles set verification_status = 'pendiente', verification_reason = null where id = '${ids.docente2}'`));
  const a = await ultimo("docente2");
  r.push([a.action === "reenviar" && a.actor_kind === "docente" && a.actor_id === ids.docente2, "el docente que reenvía su perfil queda en el historial"]);
  r.push([(await emails("docente2", "perfil_reabierto")).length === 1, "...y no recibe el email de reapertura (lo hizo él)"]);

  // Desde el SQL Editor (sin sesión).
  await db.exec("select set_config('request.jwt.claim.sub', '', false)");
  await db.exec(`update public.tutor_profiles set verification_status = 'aprobado' where id = '${ids.docente2}'`);
  const b = await ultimo("docente2");
  r.push([b.action === "aprobar" && b.actor_kind === "sistema" && b.actor_id === null, "un cambio sin sesión queda como «sistema»"]);

  // Un update directo de la administración, sin la función.
  await as(db, "admin", () => q(`update public.tutor_profiles set verification_status = 'rechazado', verification_reason = 'Directo' where id = '${ids.docente2}'`));
  const c = await ultimo("docente2");
  r.push([c.action === "dar_de_baja" && c.actor_kind === "administracion" && c.reason === "Directo", "un cambio directo de la administración también se registra, con el motivo"]);
  await as(db, "admin", () => expectFail("un perfil rechazado sin motivo NO se guarda", q(`update public.tutor_profiles set verification_reason = null where id = '${ids.docente2}'`), r));
  const n = (await registro("docente2")).length;
  await as(db, "admin", () => q(`update public.tutor_profiles set bio = 'otra cosa' where id = '${ids.docente2}'`));
  r.push([(await registro("docente2")).length === n, "editar otro dato del perfil no agrega nada al registro"]);
}

// --- Cancelaciones y cambios de rol de la administración --------------------------------------------------------------
{
  const { booking } = await reservaPaga();
  const { result } = await cancelarA(booking, "admin", 3 * 24 * 60, "Pedido de la familia");
  r.push([result?.cancelled_by === "administracion", "la administración cancela una clase"]);
  const a = (await q(`select * from public.audit_log where target_type = 'reserva' and target_id = '${booking}'`)).rows;
  r.push([a.length === 1 && a[0].action === "cancelar_clase" && a[0].actor_id === ids.admin && a[0].reason === "Pedido de la familia", "...y queda registrada con el motivo"]);
  r.push([a[0].details.student_name === "alumno a1" && a[0].details.tutor_name === "docente d1" && a[0].details.from === "confirmada", "...con los nombres y el estado anterior"]);

  const otra = await reservaPaga();
  await cancelarA(otra.booking, "alumno", 3 * 24 * 60);
  const b = (await q(`select count(*)::int as n from public.audit_log where target_id = '${otra.booking}'`)).rows[0].n;
  r.push([b === 0, "la cancelación de un alumno no es una acción de la administración"]);

  await as(db, "admin", () => q(`update public.profiles set role = 'docente' where id = '${ids.alumno2}'`));
  const c = (await q(`select * from public.audit_log where target_type = 'cuenta' and target_id = '${ids.alumno2}'`)).rows;
  r.push([c.length === 1 && c[0].action === "cambiar_rol" && c[0].details.from === "alumno" && c[0].details.to === "docente" && c[0].actor_kind === "administracion", "un cambio de rol queda registrado"]);
}

// --- Nadie edita ni borra el registro; solo la administración lo lee ----------------------------------------------------
{
  const total = Number((await q(`select count(*) from public.audit_log`)).rows[0].count);
  for (const who of ["admin", "service"]) {
    await as(db, who, () => expectFail(`${who} NO puede editar el registro`, q(`update public.audit_log set reason = 'otro'`), r));
    await as(db, who, () => expectFail(`${who} NO puede borrar el registro`, q(`delete from public.audit_log`), r));
  }
  await expectFail("ni siquiera el dueño de la base lo vacía", q(`truncate public.audit_log`), r);
  await expectFail("...ni lo edita", q(`update public.audit_log set reason = 'otro'`), r);
  await as(db, "admin", () => expectFail("la administración NO escribe filas a mano", q(`insert into public.audit_log (actor_kind, action, target_type, target_id) values ('sistema', 'aprobar', 'docente', '${ids.docente}')`), r));
  r.push([Number((await q(`select count(*) from public.audit_log`)).rows[0].count) === total, "...y el registro sigue intacto"]);

  const ve = async (who) => as(db, who, async () => (await q(`select count(*)::int as n from public.audit_log`)).rows[0].n).catch(() => 0);
  r.push([(await ve("admin")) === total, "la administración ve todo el registro"]);
  r.push([(await ve("anon")) === 0 && (await ve("alumno")) === 0 && (await ve("docente")) === 0 && (await ve("docente2")) === 0, "...nadie más ve nada (ni el docente su propio historial)"]);
}

// --- Emails: una reapertura vieja no se manda -----------------------------------------------------------------------
{
  await db.exec(`update public.tutor_profiles set verification_status = 'rechazado', verification_reason = 'x' where id = '${ids.docente2}'`);
  await decidir("admin", "docente2", "reabrir");
  await decidir("admin", "docente2", "aprobar");
  await as(db, "service", () => q(`select public.claim_pending_emails(100)`));
  const st = (await q(`select status from public.email_outbox where recipient_id = '${ids.docente2}' and kind = 'perfil_reabierto' order by created_at desc limit 1`)).rows[0].status;
  r.push([st === "omitido", "el email de reapertura de un perfil que ya se aprobó no se manda"]);
}

report(r);
