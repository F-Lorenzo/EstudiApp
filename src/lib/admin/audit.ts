import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { longDate, relativeDate, timeAR } from "@/lib/format";

/**
 * Lectura del registro de acciones (`audit_log`, migración 0019). Lo escriben solo los triggers de la base y lo
 * lee solo la administración (RLS); acá se traduce cada fila a lo que muestra la pantalla.
 */

const ACTIONS: Record<string, string> = {
  aprobar: "Aprobó el perfil",
  rechazar: "Rechazó el perfil",
  reabrir: "Reabrió el perfil",
  dar_de_baja: "Dio de baja el perfil",
  reenviar: "Reenvió el perfil a revisión",
  cambiar_estado: "Cambió el estado del perfil",
  cancelar_clase: "Canceló una clase",
  cambiar_rol: "Cambió el rol de una cuenta",
  cambiar_comision: "Cambió la configuración de la comisión",
  crear_escalon: "Agregó un escalón de comisión",
  cambiar_escalon: "Cambió un escalón de comisión",
  borrar_escalon: "Borró un escalón de comisión",
  cambiar_hero: "Cambió el texto del inicio",
  cambiar_anuncio: "Cambió la franja de anuncio",
  cambiar_contenido: "Cambió el contenido del inicio",
};

const ROLES: Record<string, string> = { alumno: "alumno", docente: "docente", administrador: "administración" };

const rowSchema = z.object({
  id: z.union([z.number(), z.string()]).transform(String),
  actor_kind: z.enum(["administracion", "docente", "sistema"]),
  actor_name: z.string().nullable(),
  action: z.string(),
  target_type: z.enum(["docente", "reserva", "cuenta", "comision", "contenido"]),
  target_id: z.string(),
  reason: z.string().nullable(),
  details: z.record(z.string(), z.unknown()).catch({}),
  created_at: z.string(),
});

export type AuditEntry = {
  id: string;
  action: string;
  /** «Rechazó el perfil». */
  label: string;
  /** Quién: su nombre, o «Sistema» si no había sesión. */
  actor: string;
  actorKind: "administracion" | "docente" | "sistema";
  reason: string | null;
  targetType: "docente" | "reserva" | "cuenta" | "comision" | "contenido";
  targetId: string;
  /** A quién o a qué se le hizo: el docente, la clase («Lucía con Martín, 20 de octubre»), la cuenta. */
  target: string | null;
  /** Para un cambio de rol, «de alumno a docente». */
  change: string | null;
  createdAt: string;
  /** «20 de octubre, 18:04». */
  when: string;
  ago: string;
};

// Según la versión de ICU, el día sale «lunes 26 de octubre» o «lunes, 26 de octubre»: se unifica sin la coma.
const day = (iso: string) => longDate(iso).replace(/^([^\s,]+),\s*/, "$1 ");

const pct = (value: unknown) => {
  const n = Number(value);
  return Number.isFinite(n) ? `${(Math.round(n * 10000) / 100).toLocaleString("es-AR")} %` : null;
};

/** «Encendida · base 12 % · piso 6 %» o «10 reseñas · 4,5 · 10 %», con lo que quedó (o lo que había, si se borró). */
function describeCommission(details: Record<string, unknown>): string | null {
  const row = (details.after ?? details.before) as Record<string, unknown> | undefined;
  if (!row || typeof row !== "object") return null;
  if ("enabled" in row) {
    return [row.enabled ? "Encendida" : "Apagada", `base ${pct(row.base_rate)}`, `piso ${pct(row.floor_rate)}`].join(" · ");
  }
  const rating = Number(row.min_rating);
  return [
    `${row.min_reviews} reseñas`,
    Number.isFinite(rating) ? `${rating.toLocaleString("es-AR")} o más` : null,
    pct(row.rate),
    row.active === false ? "inactivo" : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

/** Lo que quedó publicado: el anuncio («Encendido · Inscripciones abiertas») o el título del inicio. */
function describeContent(action: string, details: Record<string, unknown>): string | null {
  const after = details.after as Record<string, unknown> | undefined;
  if (!after || typeof after !== "object") return null;
  const short = (value: unknown) => {
    const t = typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
    return t ? `«${t.length > 60 ? `${t.slice(0, 59)}…` : t}»` : null;
  };
  if (action === "cambiar_anuncio") {
    return [after.announcement_enabled ? "Encendido" : "Apagado", short(after.announcement_text)].filter(Boolean).join(" · ");
  }
  return short(after.hero_title) ?? "Texto original";
}

const text = (value: unknown) => (typeof value === "string" && value.trim() ? value.trim() : null);

function describeTarget(row: z.infer<typeof rowSchema>): string | null {
  const d = row.details;
  if (row.target_type === "docente") return text(d.tutor_name);
  if (row.target_type === "cuenta") return text(d.account_name);
  if (row.target_type === "comision") return describeCommission(d);
  if (row.target_type === "contenido") return describeContent(row.action, d);
  const student = text(d.student_name);
  const tutor = text(d.tutor_name);
  const startsAt = text(d.starts_at);
  const who = student && tutor ? `${student} con ${tutor}` : (student ?? tutor);
  const when = startsAt && !Number.isNaN(Date.parse(startsAt)) ? `${day(startsAt)}, ${timeAR(startsAt)}` : null;
  return [who, when].filter(Boolean).join(" · ") || null;
}

export function toAuditEntry(raw: unknown, now: Date = new Date()): AuditEntry | null {
  const parsed = rowSchema.safeParse(raw);
  if (!parsed.success) return null;
  const row = parsed.data;
  const from = text(row.details.from);
  const to = text(row.details.to);
  return {
    id: row.id,
    action: row.action,
    label: ACTIONS[row.action] ?? row.action,
    actor:
      row.actor_name?.trim() ||
      (row.actor_kind === "sistema" ? "Sistema" : row.actor_kind === "docente" ? "El docente" : "Administración"),
    actorKind: row.actor_kind,
    reason: row.reason?.trim() || null,
    targetType: row.target_type,
    targetId: row.target_id,
    target: describeTarget(row),
    change: row.action === "cambiar_rol" && from && to ? `de ${ROLES[from] ?? from} a ${ROLES[to] ?? to}` : null,
    createdAt: row.created_at,
    when: `${day(row.created_at)}, ${timeAR(row.created_at)}`,
    ago: relativeDate(row.created_at, now),
  };
}

const COLUMNS = "id, actor_kind, actor_name, action, target_type, target_id, reason, details, created_at";

function toEntries(data: unknown, now: Date) {
  return (Array.isArray(data) ? data : []).flatMap((row) => {
    const entry = toAuditEntry(row, now);
    return entry ? [entry] : [];
  });
}

/** Lo último que pasó, de lo más nuevo a lo más viejo. */
export async function listAuditLog(
  supabase: Pick<SupabaseClient, "from">,
  { limit = 100, now = new Date() }: { limit?: number; now?: Date } = {},
) {
  const { data, error } = await supabase
    .from("audit_log")
    .select(COLUMNS)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(limit);
  return { entries: toEntries(data, now), error };
}

/** Historial de decisiones de un perfil docente, de lo más nuevo a lo más viejo. */
export async function getTutorHistory(
  supabase: Pick<SupabaseClient, "from">,
  tutorId: string,
  { now = new Date() }: { now?: Date } = {},
) {
  const { data, error } = await supabase
    .from("audit_log")
    .select(COLUMNS)
    .eq("target_type", "docente")
    .eq("target_id", tutorId)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(50);
  return { entries: toEntries(data, now), error };
}
