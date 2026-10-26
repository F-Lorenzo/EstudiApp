// Pruebas de MUTACIONES de las migraciones 0013 a 0017 (y de la 0011 en lo que usa la cancelación): se rompe UNA
// regla a propósito y se comprueba que alguna prueba falle. Una regla que se puede romper sin que nada falle no
// está probada.
//
//   node supabase/tests/mutations.mjs            todas las mutaciones (unos 10 minutos)
//   node supabase/tests/mutations.mjs 14-         solo las que empiezan con «14-»
//   CONC=2 node supabase/tests/mutations.mjs      cuántas corren a la vez (4 por defecto)
//
// Para cada mutación: copia TODAS las migraciones a una carpeta temporal, rompe la regla en la copia, corre las
// suites apuntando a esa carpeta (ESTUDIAPP_MIGRATIONS_DIR, ver harness.mjs) y comprueba que alguna falle («matada»).
// Si sobrevive a las suites principales, prueba con todas las demás antes de darla por viva. Los archivos reales de
// supabase/migrations NO se tocan (se comprueba con una huella antes y después). Termina con código 1 si alguna
// mutación sobrevive o ya no se aplica (el texto de la migración cambió y hay que actualizar el catálogo).
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const TESTS = fileURLToPath(new URL(".", import.meta.url));
const MIG = path.join(TESTS, "..", "migrations");
const huella = () => {
  const h = crypto.createHash("sha256");
  for (const f of fs.readdirSync(MIG).sort()) h.update(f).update(fs.readFileSync(path.join(MIG, f)));
  return h.digest("hex");
};

/** Reemplaza (la primera ocurrencia, o todas) y falla si no encuentra nada: una mutación que no se aplica no prueba nada. */
function sub(src, find, repl, { all = false } = {}) {
  const re = find instanceof RegExp ? find : new RegExp(find.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), all ? "g" : "");
  const g = all && !re.global ? new RegExp(re.source, re.flags + "g") : re;
  if (!g.test(src)) throw new Error(`la mutación no encontró: ${String(find).slice(0, 80)}`);
  g.lastIndex = 0;
  return src.replace(g, repl);
}

const F13 = "0013_cancel_with_refund.sql";
const F14 = "0014_payout_accounts.sql";
const F15 = "0015_email_outbox.sql";
const F16 = "0016_reviews.sql";
const F17 = "0017_class_attendance.sql";
const F18 = "0018_reminder_and_tutor_decision_emails.sql";
const F19 = "0019_admin_audit_log.sql";
const F20 = "0020_admin_metrics.sql";
const F21 = "0021_commission_tiers.sql";
// `claim_pending_emails` se creó en la 0015 y la reemplazan la 0018 y la 0019; `enqueue_tutor_decision_email`, de la
// 0018, la reemplaza la 0019. Sus mutaciones van sobre la versión vigente.
const CLAIM = F19;
const DECISION = F19;
const F11 = "0011_payments_foundation.sql";
const CANCEL = ["cancel-refund", "bookings", "payment-notifications", "email-outbox"];
const PAYOUT = ["payout-accounts", "bookings", "hardening"];
const EMAIL = ["email-outbox", "rls-matrix"];
const REVIEWS = ["reviews", "rls-matrix", "rls-base"];
const ATTENDANCE = ["attendance", "rls-matrix", "hardening"];
const REMINDERS = ["reminders", "email-outbox", "rls-matrix"];
const AUDIT = ["audit-log", "reminders", "rls-matrix", "hardening"];
const METRICS = ["metrics", "rls-matrix"];
const COMMISSION = ["commission", "payments", "rls-matrix"];

const M = [
  // ---------------------------------------------------------------- 0013
  [F13, "13-01 el docente/administración cancelan con la política del alumno (tutor_or_admin invertido)", (s) => sub(s, "v_by <> 'alumno'", "v_by = 'alumno'"), CANCEL],
  [F13, "13-02 cancel_booking sin «for update» en la reserva", (s) => sub(s, /(where id = p_booking_id)\s+for update;/, "$1;"), CANCEL],
  [F13, "13-03 cancel_booking sin «for update» en el pago", (s) => sub(s, /(where booking_id = v_booking\.id and status = 'aprobado')\s+for update;/, "$1;"), CANCEL],
  [F13, "13-04 el monto se trunca en vez de redondear", (s) => sub(s, "round(v_payment.amount * v_percent / 100, 2)", "trunc(v_payment.amount * v_percent / 100, 2)"), CANCEL],
  [F11, "13-05 umbral de 24 h exclusivo (> en vez de >=)", (s) => sub(s, "p_starts_at - p_at >= interval '24 hours'", "p_starts_at - p_at > interval '24 hours'"), CANCEL],
  [F11, "13-06 umbral de 2 h exclusivo (> en vez de >=)", (s) => sub(s, "p_starts_at - p_at >= interval '2 hours'", "p_starts_at - p_at > interval '2 hours'"), CANCEL],
  [F11, "13-07 el tramo parcial pasa a 60 %", (s) => sub(s, "else 0\n  end;", "else 0\n  end;").replace("when p_starts_at - p_at >= interval '2 hours' then 50", "when p_starts_at - p_at >= interval '2 hours' then 60"), CANCEL],
  [F13, "13-08 se encola reembolso aunque el porcentaje sea 0", (s) => sub(s, "if v_percent > 0 and v_amount > 0 then", "if v_amount >= 0 then"), CANCEL],
  [F13, "13-09 si el pago ya tenía reembolso, se informa el calculado (no el existente)", (s) => sub(s, /      if not \(v_enq ->> 'created'\)::boolean then[\s\S]*?      end if;\n/, ""), CANCEL],
  [F13, "13-10 el reembolso no guarda la cuenta de cobro del docente", (s) => sub(s, /\(select c\.mp_user_id from public\.mp_credentials c where c\.tutor_id = v_booking\.tutor_id\)\)/, "null)"), CANCEL],
  [F13, "13-11 retryable_refunds reintenta hasta 9 intentos (<= 8)", (s) => sub(s, "r.attempts < 8", "r.attempts <= 8"), CANCEL],
  [F13, "13-12 retryable_refunds no espera los 2 minutos", (s) => sub(s, "and r.updated_at <= now() - interval '2 minutes'", "and r.updated_at <= now()"), CANCEL],
  [F13, "13-13 refund_summary sin mp_user_id", (s) => sub(s, /,\n    'mp_user_id', r\.mp_user_id\n  \);/, "\n  );"), CANCEL],
  [F13, "13-14 apply_payment_notification no pasa la cuenta de cobro al reembolso", (s) => sub(s, "'pago_no_aceptable:' || v_reason, p_collector_id);", "'pago_no_aceptable:' || v_reason);"), CANCEL],
  [F13, "13-15 retryable_refunds abierta a authenticated", (s) => s + "\ngrant execute on function public.retryable_refunds(integer) to authenticated;\n", ["cancel-refund", "rls-matrix"]],
  [F13, "13-16 se puede cancelar una clase que ya empezó", (s) => sub(s, "if v_booking.status = 'confirmada' and v_booking.starts_at <= now() then", "if false then"), CANCEL],
  [F13, "13-17 al cancelar no se libera el horario", (s) => sub(s, /(update public\.availability_slots\n  set is_booked = )false/, "$1true"), CANCEL],
  [F13, "13-18 el motivo del reembolso no distingue quién canceló", (s) => sub(s, "'cancelacion_' || v_by,", "'cancelacion_alumno',"), CANCEL],
  [F13, "13-19 retryable_refunds incluye los aprobados", (s) => sub(s, "where r.status in ('pendiente', 'fallido')\n      and", "where r.status in ('pendiente', 'fallido', 'aprobado')\n      and"), CANCEL],
  [F13, "13-20 se puede cancelar una clase completada", (s) => sub(s, "if v_booking.status not in ('pendiente_pago', 'confirmada') then", "if v_booking.status not in ('pendiente_pago', 'confirmada', 'completada') then"), CANCEL],
  [F13, "13-21 cualquiera puede cancelar una reserva ajena", (s) => sub(s, /\n\s+or not \(v_booking\.student_id = v_uid or v_booking\.tutor_id = v_uid or public\.is_admin\(\)\) then/, " then"), CANCEL],
  [F13, "13-22 enqueue_refund acepta un pago sin identificador", (s) => sub(s, "if p_mp_payment_id is null or btrim(p_mp_payment_id) = '' then", "if false then"), CANCEL],
  [F13, "13-23 retryable_refunds ordena del más nuevo al más viejo", (s) => sub(s, "order by r.created_at, r.id\n    limit", "order by r.created_at desc, r.id\n    limit"), CANCEL],
  [F13, "13-24 retryable_refunds ignora el límite", (s) => sub(s, "limit greatest(coalesce(p_limit, 25), 0)", "limit 1000"), CANCEL],
  [F13, "13-25 la reserva se cancela con el pago marcado sin comprobar (se salta el chequeo de cuenta sin sesión)", (s) => sub(s, "if v_uid is null then\n    raise exception 'Necesitás iniciar sesión.' using hint = 'not_authenticated';", "if false then\n    raise exception 'Necesitás iniciar sesión.' using hint = 'not_authenticated';"), CANCEL],
  // ---------------------------------------------------------------- 0014
  [F14, "14-01 save_mp_credentials: sin control de cuenta ya vinculada a otro docente", (s) => sub(s, /exception when unique_violation then[\s\S]*?using hint = 'account_already_linked';\n/, ""), PAYOUT],
  [F14, "14-02 save_mp_credentials acepta credenciales ya vencidas", (s) => sub(s, "p_expires_at <= now() then\n    raise exception 'Las credenciales de Mercado Pago no son válidas.' using hint = 'invalid_credentials';\n  end if;\n\n  -- Ordena esta operación con las reservas nuevas del docente y con su desvinculación.", "false then\n    raise exception 'Las credenciales de Mercado Pago no son válidas.' using hint = 'invalid_credentials';\n  end if;\n\n  -- Ordena esta operación con las reservas nuevas del docente y con su desvinculación."), PAYOUT],
  [F14, "14-03 save_mp_credentials no fija tutor_private.mercadopago_account_id", (s) => sub(s, /  insert into public\.tutor_private \(id, mercadopago_account_id\)\n  values \(p_tutor_id, p_mp_user_id\)\n  on conflict \(id\) do update set mercadopago_account_id = excluded\.mercadopago_account_id;\n/, ""), PAYOUT],
  [F14, "14-04 save_mp_credentials acepta un token de acceso vacío", (s) => sub(s, "or p_access_token is null or btrim(p_access_token) = ''", ""), PAYOUT],
  [F14, "14-05 el impedimento por reservas por dar no existe", (s) => sub(s, ") then 'has_active_bookings'", ") then null"), PAYOUT],
  [F14, "14-06 el impedimento por reembolsos sin cerrar no existe", (s) => sub(s, ") then 'has_pending_refunds'", ") then null"), PAYOUT],
  [F14, "14-07 unlink_my_mp_account no mira los impedimentos", (s) => sub(s, "v_blocker := public.mp_account_blocker(v_uid);", "v_blocker := null;"), PAYOUT],
  [F14, "14-08 save_mp_credentials deja cambiar de cuenta con plata en camino", (s) => sub(s, "v_blocker := public.mp_account_blocker(p_tutor_id);", "v_blocker := null;"), PAYOUT],
  [F14, "14-09 tutor_can_receive_payments ignora el vencimiento", (s) => sub(s, "where tutor_id = p_tutor and expires_at > now()", "where tutor_id = p_tutor"), PAYOUT],
  [F14, "14-10 create_booking no exige que el docente pueda cobrar", (s) => sub(s, "if not public.tutor_can_receive_payments(v_slot.tutor_id) then", "if false then"), PAYOUT],
  [F14, "14-11 save_mp_credentials abierta a authenticated", (s) => s + "\ngrant execute on function public.save_mp_credentials(uuid, text, text, text, text, timestamptz, boolean) to authenticated;\n", ["payout-accounts", "rls-matrix"]],
  [F14, "14-12 rotate_mp_tokens no avisa not_linked", (s) => sub(s, "if not found then\n    raise exception 'Este docente no tiene una cuenta de Mercado Pago vinculada.'", "if false then\n    raise exception 'Este docente no tiene una cuenta de Mercado Pago vinculada.'"), PAYOUT],
  [F14, "14-13 unlink_my_mp_account no limpia tutor_private", (s) => sub(s, "set mercadopago_account_id = null\n  where id = v_uid;", "set mercadopago_account_id = mercadopago_account_id\n  where id = v_uid;"), PAYOUT],
  [F14, "14-14 unlink_my_mp_account borra las credenciales de TODOS", (s) => sub(s, "delete from public.mp_credentials where tutor_id = v_uid;", "delete from public.mp_credentials;"), PAYOUT],
  [F14, "14-15 tutor_can_receive_payments cerrada a los visitantes (sin el permiso por defecto de anon)", (s) => sub(sub(s, "revoke all on function public.tutor_can_receive_payments(uuid) from public;", "revoke all on function public.tutor_can_receive_payments(uuid) from public, anon;"), "grant execute on function public.tutor_can_receive_payments(uuid) to anon, authenticated, service_role;", "grant execute on function public.tutor_can_receive_payments(uuid) to authenticated, service_role;"), PAYOUT],
  [F14, "14-16 create_booking sin el candado de la cuenta de cobro", (s) => sub(s, "perform pg_advisory_xact_lock_shared(hashtext('mp_account:' || v_slot.tutor_id::text));", ""), PAYOUT],
  [F14, "14-17 save_mp_credentials bloquea también renovar la MISMA cuenta", (s) => sub(s, "if found and v_current <> p_mp_user_id then", "if found then"), PAYOUT],
  [F14, "14-18 unlink_my_mp_account sin comprobar la sesión", (s) => sub(s, "if v_uid is null then\n    raise exception 'Necesitás iniciar sesión.' using hint = 'not_authenticated';", "if false then\n    raise exception 'Necesitás iniciar sesión.' using hint = 'not_authenticated';"), PAYOUT],
  [F14, "14-19 rotate_mp_tokens acepta tokens vencidos", (s) => sub(s, /(create function public\.rotate_mp_tokens[\s\S]*?)p_expires_at <= now\(\) then/, "$1false then"), PAYOUT],
  [F14, "14-20 tutor_can_receive_payments abierta: devuelve true siempre", (s) => sub(s, "select exists (\n    select 1 from public.mp_credentials\n    where tutor_id = p_tutor and expires_at > now()\n  );", "select true;"), PAYOUT],
  [F14, "14-21 el impedimento ignora las reservas pendientes de pago", (s) => sub(s, "(b.status = 'pendiente_pago' or (b.status = 'confirmada' and b.starts_at > now()))", "((b.status = 'confirmada' and b.starts_at > now()))"), PAYOUT],
  [F14, "14-22 el impedimento por reembolsos ignora los pagos que entraron a SU cuenta (sin reserva)", (s) => sub(s, /\n\s+b\.tutor_id = p_tutor\n\s+or r\.mp_user_id = \(select c\.mp_user_id from public\.mp_credentials c where c\.tutor_id = p_tutor\)/, "\n          b.tutor_id = p_tutor"), PAYOUT],
  // ---------------------------------------------------------------- 0015
  [F15, "15-01 la confirmación sin «on conflict do nothing»", (s) => sub(s, "    on conflict (kind, booking_id, recipient_id) do nothing;\n  exception when others then\n    raise warning 'No se pudo anotar el email de la reserva confirmada", "  ;\n  exception when others then\n    raise warning 'No se pudo anotar el email de la reserva confirmada"), EMAIL],
  [F15, "15-02 el payload incluye el email del alumno", (s) => sub(s, "'price', p_booking.price))", "'price', p_booking.price, 'email', (select u.email from auth.users u where u.id = p_booking.student_id)))"), EMAIL],
  [F15, "15-03 mark_email_result deja volver atrás una fila enviada", (s) => sub(s, "if v_current in ('enviado', 'omitido') then\n    return;\n  end if;", ""), EMAIL],
  [CLAIM, "15-04 claim_pending_emails sin tope de 5 intentos", (s) => sub(s, "o.attempts < 5", "o.attempts < 99", { all: true }), EMAIL],
  [CLAIM, "15-05 claim_pending_emails sin espera entre intentos", (s) => sub(s, "interval '5 minutes'", "interval '0 minutes'", { all: true }), EMAIL],
  [CLAIM, "15-06 claim_pending_emails no omite a quien no tiene email", (s) => sub(s, "set status = 'omitido',\n      last_error = 'El destinatario no tiene email.'", "set status = status,\n      last_error = 'El destinatario no tiene email.'"), EMAIL],
  [CLAIM, "15-07 claim_pending_emails no suma el intento", (s) => sub(s, "set attempts = o.attempts + 1,", "set attempts = o.attempts,"), EMAIL],
  [F15, "15-08 la cancelación de una reserva SIN pago también anota emails", (s) => sub(s, "when (old.status = 'confirmada' and new.status = 'cancelada')", "when (old.status in ('confirmada', 'pendiente_pago') and new.status = 'cancelada')"), EMAIL],
  [F15, "15-09 el trigger de confirmación hace fallar la operación si el email falla", (s) => sub(s, "exception when others then\n    raise warning 'No se pudo anotar el email de la reserva confirmada", "exception when no_data_found then\n    raise warning 'No se pudo anotar el email de la reserva confirmada"), EMAIL],
  [F15, "15-10 el trigger de cancelación hace fallar la operación si el email falla", (s) => sub(s, "exception when others then\n    raise warning 'No se pudo anotar el email de la reserva cancelada", "exception when no_data_found then\n    raise warning 'No se pudo anotar el email de la reserva cancelada"), EMAIL],
  [F15, "15-11 el trigger del reembolso hace fallar la operación si el email falla", (s) => sub(s, "exception when others then\n    raise warning 'No se pudo anotar el email del reembolso", "exception when no_data_found then\n    raise warning 'No se pudo anotar el email del reembolso"), EMAIL],
  [CLAIM, "15-12 claim_pending_emails abierta a authenticated", (s) => s + "\ngrant execute on function public.claim_pending_emails(integer) to authenticated;\n", EMAIL],
  [F15, "15-13 mark_email_result guarda los emails que vengan en el error", (s) => sub(s, /left\(regexp_replace\(p_error, [^\n]*?'g'\), 500\)/, "left(p_error, 500)"), EMAIL],
  [F15, "15-14 la bandeja legible por authenticated", (s) => s + "\ngrant select on public.email_outbox to authenticated;\n", EMAIL],
  [F15, "15-15 el email del reembolso confunde el motivo", (s) => sub(s, "then 'pago_no_aceptable' else 'cancelacion' end", "then 'cancelacion' else 'pago_no_aceptable' end"), EMAIL],
  [F15, "15-16 cancelled_by siempre «alumno»", (s) => sub(s, "      else 'administracion'\n    end;", "      else 'alumno'\n    end;"), EMAIL],
  [F15, "15-17 enviado no guarda la hora de envío", (s) => sub(s, "sent_at = case when p_status = 'enviado' then now() else sent_at end,", "sent_at = sent_at,"), EMAIL],
  [CLAIM, "15-18 claim_pending_emails sin «skip locked»", (s) => sub(s, "for update of o skip locked", "for update of o"), EMAIL],
  [F15, "15-19 «nueva_reserva_docente» va al alumno", (s) => sub(s, "('nueva_reserva_docente', new.id, new.tutor_id,", "('nueva_reserva_docente', new.id, new.student_id,"), EMAIL],
  [F15, "15-20 el email del reembolso va al docente", (s) => sub(s, "        v_booking.id,\n        v_booking.student_id,", "        v_booking.id,\n        v_booking.tutor_id,"), EMAIL],
  [F15, "15-21 la bandeja sin RLS", (s) => sub(s, "alter table public.email_outbox enable row level security;", ""), EMAIL],
  [F15, "15-22 sin restricción única en la bandeja", (s) => sub(s, /,\n  -- Un mismo aviso[^\n]*\n  constraint email_outbox_event_key unique \(kind, booking_id, recipient_id\)/, ""), EMAIL],
  [F15, "15-23 mark_email_result acepta cualquier estado", (s) => sub(s, "if p_status is null or p_status not in ('enviado', 'fallido', 'omitido') then", "if false then"), EMAIL],
  [F15, "15-24 el email de cancelación al alumno no lleva el reembolso", (s) => sub(s, "'refund_percent', case when v_payment.id is not null then coalesce(v_refund.percent, 0) end,", "'refund_percent', null,"), EMAIL],
  [F15, "15-25 los emails de un pago tardío reembolsado se pierden (el trigger no mira starts_with)", (s) => sub(s, "starts_with(new.reason, 'pago_no_aceptable')", "false"), EMAIL],
  [F15, "15-26 el email de cancelación no mira el reembolso encolado", (s) => sub(s, "select * into v_refund from public.refunds where booking_id = new.id order by created_at limit 1;", "select * into v_refund from public.refunds where false;"), EMAIL],
  [CLAIM, "15-27 claim_pending_emails reclama sin respetar el orden de llegada", (s) => sub(s, "    order by o.created_at, o.id\n    limit greatest(coalesce(p_limit, 20), 0)", "    order by o.id desc\n    limit greatest(coalesce(p_limit, 20), 0)"), EMAIL],
  // ---------------------------------------------------------------- 0016
  [F16, "16-01 la tabla de calificaciones sigue siendo pública", (s) => sub(s, "using (student_id = auth.uid() or tutor_id = auth.uid() or public.is_admin());", "using (true);"), REVIEWS],
  [F16, "16-02 se califica sin límite de días", (s) => sub(s, "\n        and b.ends_at > now() - interval '30 days'", ""), REVIEWS],
  [F16, "16-03 se califica la clase de otro docente", (s) => sub(s, "\n        and b.tutor_id = ratings.tutor_id", ""), REVIEWS],
  [F16, "16-04 quien califica elige la fecha", (s) => sub(s, "    new.created_at := now();\n", ""), REVIEWS],
  [F16, "16-05 el comentario no se limpia", (s) => sub(s, "new.comment := nullif(btrim(new.comment), '');", "new.comment := new.comment;"), REVIEWS],
  [F16, "16-06 tutor_reviews muestra el nombre completo", (s) => sub(s, "else n.first || ' ' || upper(left(n.second, 1)) || '.'", "else p.full_name"), REVIEWS],
  [F16, "16-07 tutor_reviews muestra opiniones de docentes no aprobados", (s) => sub(s, " and tp.verification_status = 'aprobado'", ""), REVIEWS],
  [F16, "16-08 tutor_reviews cuenta solo las filas devueltas", (s) => sub(s, "    count(*) over ()\n", "    1::bigint\n"), REVIEWS],
  [F16, "16-09 el trigger que limpia la calificación queda abierto a la API", (s) => sub(s, "revoke all on function public.normalize_rating() from public, anon, authenticated;", ""), REVIEWS],
  // ---------------------------------------------------------------- 0017
  [F17, "17-01 alcanza con 5 minutos del docente", (s) => sub(s, "v_min_seconds constant integer := 600;", "v_min_seconds constant integer := 300;"), ATTENDANCE],
  [F17, "17-02 la ausencia se decide sin esperar a que cierre la sala", (s) => sub(s, "if v_booking.ends_at + v_room_grace > now() then", "if false then"), ATTENDANCE],
  [F17, "17-03 se completa antes de que termine el horario", (s) => sub(s, "if v_booking.ends_at > now() then\n    return jsonb_build_object('outcome', 'pendiente');", "if false then\n    return jsonb_build_object('outcome', 'pendiente');"), ATTENDANCE],
  [F17, "17-04 por ausencia del docente se devuelve el 50 %", (s) => sub(s, "v_percent := 100;", "v_percent := 50;"), ATTENDANCE],
  [F17, "17-05 la ausencia no cancela la reserva", (s) => sub(s, "  set status = 'cancelada',\n      cancellation_reason = 'El docente no se presentó a la clase.'", "  set cancellation_reason = 'El docente no se presentó a la clase.'"), ATTENDANCE],
  [F17, "17-06 registrar de nuevo pisa lo registrado", (s) => sub(s, "  if found then\n    return jsonb_build_object('outcome', v_existing.outcome, 'already', true);\n  end if;\n", ""), ATTENDANCE],
  [F17, "17-07 se registra una reserva no confirmada", (s) => sub(s, "if v_booking.status <> 'confirmada' then\n    raise exception 'La reserva no está confirmada.'", "if false then\n    raise exception 'La reserva no está confirmada.'"), ATTENDANCE],
  [F17, "17-08 record_class_attendance abierta a authenticated", (s) => s + "\ngrant execute on function public.record_class_attendance(uuid, integer, integer) to authenticated;\n", ATTENDANCE],
  [F17, "17-09 sync_bookings sigue completando al terminar", (s) => sub(s, "and ends_at < now() - interval '3 days';", "and ends_at < now();"), ATTENDANCE],
  [F17, "17-10 la asistencia la lee cualquiera con sesión", (s) => sub(s, /using \(\n    public\.is_admin\(\)\n    or exists \([\s\S]*?\)\n  \);/, "using (true);"), ATTENDANCE],
  [F17, "17-11 sin pago se informa como pagado", (s) => sub(s, "'paid', v_payment.id is not null,", "'paid', true,"), ATTENDANCE],
  // ---------------------------------------------------------------- 0018
  [F18, "18-01 se recuerda una reserva no confirmada", (s) => sub(s, "where b.status = 'confirmada'\n      and b.starts_at > now() + interval '2 hours'", "where true\n      and b.starts_at > now() + interval '2 hours'"), REMINDERS],
  [F18, "18-02 el de 24 horas sale desde 30 horas antes", (s) => sub(s, "b.starts_at <= now() + interval '24 hours 30 minutes'", "b.starts_at <= now() + interval '30 hours'"), REMINDERS],
  [F18, "18-03 el de 24 horas llega pegado al de la reserva", (s) => sub(s, "and b.created_at <= b.starts_at - interval '25 hours'", ""), REMINDERS],
  [F18, "18-04 el de 1 hora sale desde 3 horas antes", (s) => sub(s, "b.starts_at <= now() + interval '90 minutes'", "b.starts_at <= now() + interval '3 hours'"), REMINDERS],
  [F18, "18-05 se recuerda una clase que ya empezó", (s) => sub(s, "      and b.starts_at > now()\n      and b.starts_at <= now() + interval '90 minutes'", "      and b.starts_at <= now() + interval '90 minutes'"), REMINDERS],
  [F18, "18-06 solo se le recuerda al alumno", (s) => sub(s, "(values ((d.booking).student_id, 'alumno'), ((d.booking).tutor_id, 'docente'))", "(values ((d.booking).student_id, 'alumno'))"), REMINDERS],
  [F18, "18-07 los recordatorios se duplican", (s) => sub(s, "    on conflict (kind, booking_id, recipient_id) do nothing\n    returning 1", "    returning 1"), REMINDERS],
  [CLAIM, "18-08 se reclama el recordatorio de una clase cancelada", (s) => sub(s, "where b.id = o.booking_id and b.status = 'confirmada' and b.starts_at > now());", "where b.id = o.booking_id);"), REMINDERS],
  [CLAIM, "18-09 se manda el rechazo de un perfil que se reenvió", (s) => sub(s, "      last_error = 'El estado del perfil cambió.'\n  where o.status in ('pendiente', 'fallido')", "      last_error = 'El estado del perfil cambió.'\n  where false"), REMINDERS],
  [DECISION, "18-10 el rechazo sale sin motivo", (s) => sub(s, "then nullif(btrim(new.verification_reason), '') end", "then null end"), REMINDERS],
  [DECISION, "18-11 un fallo del email tira abajo la decisión", (s) => sub(s, "  exception when others then\n    raise warning 'No se pudo anotar el email de la decisión", "  exception when division_by_zero then\n    raise warning 'No se pudo anotar el email de la decisión"), REMINDERS],
  [F18, "18-12 enqueue_class_reminders abierta a authenticated", (s) => s + "\ngrant execute on function public.enqueue_class_reminders() to authenticated;\n", REMINDERS],
  // ---------------------------------------------------------------- 0019
  [F19, "19-01 se rechaza sin motivo", (s) => sub(s, "if v_to = 'rechazado' and v_reason is null then", "if false then"), AUDIT],
  [F19, "19-02 reabrir aprueba directamente", (s) => sub(s, "when 'reabrir' then v_from := 'rechazado'; v_to := 'pendiente';", "when 'reabrir' then v_from := 'rechazado'; v_to := 'aprobado';"), AUDIT],
  [F19, "19-03 se decide sin mirar el estado actual", (s) => sub(s, "if v_current <> v_from then", "if false then"), AUDIT],
  [F19, "19-04 cualquiera con sesión decide sobre un perfil", (s) => sub(s, "if not public.is_admin() then\n    raise exception 'Solo la administración", "if false then\n    raise exception 'Solo la administración"), AUDIT],
  [F19, "19-05 el registro se puede editar y borrar", (s) => sub(s, "create trigger audit_log_immutable\n  before update or delete on public.audit_log\n  for each row execute function public.protect_audit_log();", ""), AUDIT],
  [F19, "19-06 el registro lo lee cualquiera con sesión", (s) => sub(s, "on public.audit_log for select\n  using (public.is_admin());", "on public.audit_log for select\n  using (true);"), AUDIT],
  [F19, "19-07 las cancelaciones de la administración no se registran", (s) => sub(s, "if v_actor.kind <> 'administracion' then", "if true then"), AUDIT],
  [F19, "19-08 los cambios de rol no se registran", (s) => sub(s, "create trigger profiles_audit_role\n  after update of role on public.profiles", "create trigger profiles_audit_role\n  after update of full_name on public.profiles"), AUDIT],
  [F19, "19-09 reabrir no avisa al docente", (s) => sub(s, "      when new.verification_status = 'pendiente' and old.verification_status = 'rechazado' and public.is_admin()\n        then 'perfil_reabierto'\n", ""), AUDIT],
  [F19, "19-10 un rechazo sin motivo se guarda", (s) => sub(s, "alter table public.tutor_profiles\n  add constraint tutor_profiles_rejection_reason", "alter table public.tutor_profiles\n  add constraint tutor_profiles_rejection_reason check (true) not valid;\nselect 1 where false and"), AUDIT],
  [F19, "19-11 la administración figura como «sistema»", (s) => sub(s, "when p.role = 'administrador' then 'administracion'", "when p.role = 'administrador' then 'sistema'"), AUDIT],
  [F19, "19-12 el docente que reenvía figura como reapertura", (s) => sub(s, "and old.verification_status = 'rechazado' and new.verification_status = 'pendiente' then 'reenviar'", "and false then 'reenviar'"), AUDIT],
  [F19, "19-13 la baja no se distingue de un rechazo en el email", (s) => sub(s, "'was_approved', case when v_kind = 'perfil_rechazado' and old.verification_status = 'aprobado' then true end,", ""), AUDIT],
  // ---------------------------------------------------------------- 0020
  [F20, "20-01 cualquiera con sesión ve las métricas", (s) => sub(s, "if not public.is_admin() then\n    raise exception 'Solo la administración ve", "if false then\n    raise exception 'Solo la administración ve"), METRICS],
  [F20, "20-02 los pagos devueltos enteros no cuentan como cobrados", (s) => sub(s, "from public.payments where status in ('aprobado', 'reembolsado') and created_at >= v_since", "from public.payments where status = 'aprobado' and created_at >= v_since", { all: true }), METRICS],
  [F20, "20-03 los reembolsos pendientes cuentan como devueltos", (s) => sub(s, "from public.refunds where status = 'aprobado' and updated_at >= v_since", "from public.refunds where updated_at >= v_since"), METRICS],
  [F20, "20-04 las clases futuras cuentan como dadas", (s) => sub(s, "where status = 'completada' and starts_at >= v_since and starts_at <= now()", "where status in ('completada', 'confirmada') and starts_at >= v_since"), METRICS],
  [F20, "20-05 las semanas no son de lunes a domingo", (s) => sub(s, "date_trunc('week', now() at time zone v_tz))::date - (v_weeks - 1) * 7", "date_trunc('week', now() at time zone v_tz))::date - (v_weeks - 1) * 7 + 2"), METRICS],
  [F20, "20-06 sin tope de semanas", (s) => sub(s, "least(coalesce(p_weeks, 8), 26)", "coalesce(p_weeks, 8)"), METRICS],
  [F20, "20-07 las reservas vencidas se cuentan como canceladas pagas", (s) => sub(s, "        where b.status = 'cancelada' and b.updated_at >= v_since\n          and exists", "        where b.status = 'cancelada' and b.updated_at >= v_since\n          and true or exists"), METRICS],
  // ---------------------------------------------------------------- 0021
  [F21, "21-01 arranca encendida", (s) => sub(s, "enabled boolean not null default false,", "enabled boolean not null default true,"), COMMISSION],
  [F21, "21-02 apagada igual aplica los escalones", (s) => sub(s, "if not v_settings.enabled then\n    return v_settings.base_rate;\n  end if;", ""), COMMISSION],
  [F21, "21-03 sin piso", (s) => sub(s, "return greatest(v_settings.floor_rate, least(", "return greatest(0, least("), COMMISSION],
  [F21, "21-04 se elige el escalón más alto en vez del más bajo", (s) => sub(s, "select min(t.rate) into v_tier", "select max(t.rate) into v_tier"), COMMISSION],
  [F21, "21-05 un escalón desactivado cuenta", (s) => sub(s, "  where t.active and v_reviews >= t.min_reviews and v_average >= t.min_rating;", "  where v_reviews >= t.min_reviews and v_average >= t.min_rating;"), COMMISSION],
  [F21, "21-06 no se mira la calificación mínima", (s) => sub(s, "  where t.active and v_reviews >= t.min_reviews and v_average >= t.min_rating;", "  where t.active and v_reviews >= t.min_reviews;"), COMMISSION],
  [F21, "21-07 un alumno con varias clases cuenta varias veces", (s) => sub(s, "    group by r.student_id\n", "    group by r.student_id, r.id\n"), COMMISSION],
  [F21, "21-08 cuentan las clases sin pago aprobado", (s) => sub(s, "    join public.payments p on p.booking_id = b.id and p.status = 'aprobado'\n    where r.tutor_id = p_tutor", "    left join public.payments p on p.booking_id = b.id\n    where r.tutor_id = p_tutor"), COMMISSION],
  [F21, "21-09 cualquiera con sesión edita los escalones", (s) => sub(s, `create policy "commission_tiers_insert_admin" on public.commission_tiers for insert with check (public.is_admin());`, `create policy "commission_tiers_insert_admin" on public.commission_tiers for insert with check (true);`), COMMISSION],
  [F21, "21-10 los cambios de la configuración no se registran", (s) => sub(s, "create trigger commission_settings_audit\n  after update on public.commission_settings", "create trigger commission_settings_audit\n  after insert on public.commission_settings"), COMMISSION],
  [F21, "21-11 cualquiera ve la vista previa", (s) => sub(s, "if not public.is_admin() then\n    raise exception 'Solo la administración ve la comisión", "if false then\n    raise exception 'Solo la administración ve la comisión"), COMMISSION],
  [F21, "21-12 el piso puede quedar por encima de la base", (s) => sub(s, "check (floor_rate >= 0 and floor_rate <= base_rate and base_rate < 1)", "check (floor_rate >= 0 and base_rate < 1)"), COMMISSION],
  [F19, "19-14 se manda la reapertura de un perfil que ya no está pendiente", (s) => sub(s, "          else 'pendiente'\n        end);", "          else tp.verification_status::text\n        end);"), AUDIT],
];

const ALL_SUITES = fs.readdirSync(TESTS).filter((f) => f.endsWith(".db.mjs")).map((f) => f.replace(".db.mjs", "")).filter((n) => n !== "fresh-install");

function runSuite(name, dir) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", path.join(TESTS, `${name}.db.mjs`)], {
      env: { ...process.env, ESTUDIAPP_MIGRATIONS_DIR: dir },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (out += d));
    child.on("close", (code) => {
      const fails = out.split("\n").filter((l) => l.startsWith("FAIL ")).map((l) => l.slice(5, 110));
      const crash = code !== 0 && fails.length === 0 ? out.split("\n").find((l) => /error|Error/.test(l))?.slice(0, 110) ?? "falló sin detalle" : null;
      resolve({ name, code, fails, crash });
    });
  });
}

async function mutar([file, desc, fn, suites]) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mut-"));
  try {
    for (const f of fs.readdirSync(MIG)) fs.copyFileSync(path.join(MIG, f), path.join(dir, f));
    const original = fs.readFileSync(path.join(dir, file), "utf8").replace(/\r\n/g, "\n");
    let mutado;
    try {
      mutado = fn(original);
    } catch (e) {
      return { desc, estado: "NO SE APLICÓ", detalle: e.message };
    }
    if (mutado === original) return { desc, estado: "NO SE APLICÓ", detalle: "el texto quedó igual" };
    fs.writeFileSync(path.join(dir, file), mutado);
    for (const s of suites) {
      const res = await runSuite(s, dir);
      if (res.code !== 0) return { desc, estado: "MATADA", por: s, detalle: (res.fails[0] ?? res.crash ?? "").slice(0, 100) };
    }
    // Sobrevivió a las suites principales: se prueba con todas las demás antes de darla por viva.
    for (const s of ALL_SUITES.filter((n) => !suites.includes(n))) {
      const res = await runSuite(s, dir);
      if (res.code !== 0) return { desc, estado: "MATADA (por otra suite)", por: s, detalle: (res.fails[0] ?? res.crash ?? "").slice(0, 100) };
    }
    return { desc, estado: "SOBREVIVIÓ", detalle: "ninguna suite falló" };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const antes = huella();
const filtro = process.argv[2];
const lista = M.filter(([, desc]) => !filtro || desc.startsWith(filtro) || new RegExp(filtro).test(desc.slice(0, 5)));
const resultados = [];
const CONC = Number(process.env.CONC ?? 4);
let i = 0;
async function worker() {
  while (i < lista.length) {
    const m = lista[i++];
    const t0 = Date.now();
    const res = await mutar(m);
    resultados.push(res);
    console.log(`${res.estado.padEnd(24)} ${res.desc}${res.por ? `  ← ${res.por}` : ""}${res.estado.startsWith("MATADA") ? "" : `  [${res.detalle}]`}  (${Math.round((Date.now() - t0) / 1000)} s)`);
  }
}
await Promise.all(Array.from({ length: CONC }, worker));
const despues = huella();
const resumen = {
  total: resultados.length,
  matadas: resultados.filter((x) => x.estado.startsWith("MATADA")).length,
  sobrevivieron: resultados.filter((x) => x.estado === "SOBREVIVIÓ").map((x) => x.desc),
  noSeAplicaron: resultados.filter((x) => x.estado === "NO SE APLICÓ").map((x) => `${x.desc}: ${x.detalle}`),
  migracionesIntactas: antes === despues,
};
console.log("\n" + JSON.stringify(resumen, null, 2));
process.exitCode = resumen.sobrevivieron.length || resumen.noSeAplicaron.length || !resumen.migracionesIntactas ? 1 : 0;
