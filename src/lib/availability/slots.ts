import { dateKeyAR, timeAR } from "@/lib/format";

/**
 * Franjas de disponibilidad. Cada franja dura 60 minutos y empieza en punto.
 * Se identifican con una «clave» en hora de Argentina, `YYYY-MM-DDTHH`
 * (por ejemplo `2026-10-08T15`), que es lo que viaja entre la pantalla y el
 * servidor; la base guarda el instante (timestamptz).
 */

/** Horas de inicio que se pueden ofrecer: de 08:00 a 21:00. */
export const SLOT_HOURS = Array.from({ length: 14 }, (_, index) => 8 + index);
export const DAY_NAMES = ["LUN", "MAR", "MIÉ", "JUE", "VIE", "SÁB", "DOM"];
/** Cuántas semanas hacia adelante se puede abrir disponibilidad. */
export const MAX_WEEKS_AHEAD = 11;
/** Argentina no cambia de horario en verano: el desfase es fijo. */
const AR_OFFSET = "-03:00";
const SLOT_MINUTES = 60;

const KEY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T([01]\d|2[0-3])$/;

export function slotKey(date: string, hour: number) {
  return `${date}T${String(hour).padStart(2, "0")}`;
}

export function parseSlotKey(key: string) {
  const match = KEY_PATTERN.exec(key);
  if (!match) return null;
  const [, year, month, day, hour] = match;
  const date = `${year}-${month}-${day}`;
  // Descarta fechas imposibles como 2026-02-31.
  const probe = new Date(`${date}T12:00:00Z`);
  if (Number.isNaN(probe.getTime()) || probe.toISOString().slice(0, 10) !== date)
    return null;
  return { date, hour: Number(hour) };
}

/** Instante de inicio de una franja. */
export function slotStart(key: string) {
  const parsed = parseSlotKey(key);
  if (!parsed) return null;
  return new Date(`${parsed.date}T${String(parsed.hour).padStart(2, "0")}:00:00${AR_OFFSET}`);
}

export function slotEnd(key: string) {
  const start = slotStart(key);
  return start ? new Date(start.getTime() + SLOT_MINUTES * 60_000) : null;
}

/** Clave de una franja a partir de su instante de inicio guardado en la base. */
export function keyFromIso(iso: string) {
  return `${dateKeyAR(iso)}T${timeAR(iso).slice(0, 2)}`;
}

export function addDays(date: string, days: number) {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

/** Lunes de la semana de `date`. */
export function mondayOf(date: string) {
  const [year, month, day] = date.split("-").map(Number);
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay(); // 0 = domingo
  return addDays(date, -((weekday + 6) % 7));
}

/** Los siete días (lunes a domingo) de la semana que empieza en `monday`. */
export function weekDates(monday: string) {
  return Array.from({ length: 7 }, (_, index) => addDays(monday, index));
}

/** Instante en que empieza `date` (00:00 de Argentina). */
export function dayStart(date: string) {
  return new Date(`${date}T00:00:00${AR_OFFSET}`);
}

/**
 * Valida una franja que se quiere abrir. Devuelve el motivo si no se puede, o
 * `null` si es válida.
 */
export function openSlotError(key: string, now: Date) {
  const parsed = parseSlotKey(key);
  const start = slotStart(key);
  if (!parsed || !start) return "Hay un horario con un formato inválido.";
  if (!SLOT_HOURS.includes(parsed.hour))
    return "Solo se pueden abrir horarios entre las 08:00 y las 21:00.";
  if (start.getTime() <= now.getTime())
    return "No se pueden abrir horarios que ya pasaron.";
  const horizon = now.getTime() + (MAX_WEEKS_AHEAD + 1) * 7 * 86_400_000;
  if (start.getTime() > horizon)
    return "Solo se puede abrir disponibilidad para las próximas semanas.";
  return null;
}
