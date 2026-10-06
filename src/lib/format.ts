/** Formatos de presentación compartidos (es-AR). */

export function money(value: number) {
  return new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
    maximumFractionDigits: 0,
  }).format(value);
}

/** Todas las fechas se muestran en hora de Argentina, sin importar dónde corra el código. */
const TIME_ZONE = "America/Argentina/Buenos_Aires";

function part(iso: string, options: Intl.DateTimeFormatOptions) {
  return new Intl.DateTimeFormat("es-AR", {
    timeZone: TIME_ZONE,
    ...options,
  }).format(new Date(iso));
}

/** «30», «sept», «miércoles», «septiembre» de una fecha ISO. */
export function dayParts(iso: string) {
  return {
    day: part(iso, { day: "numeric" }),
    month: part(iso, { month: "short" }).replace(".", ""),
    monthLong: part(iso, { month: "long" }),
    weekday: part(iso, { weekday: "long" }),
  };
}

const HOUR_MINUTE = {
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
} as const;

/** «18:00». */
export function timeAR(iso: string) {
  return part(iso, HOUR_MINUTE);
}

/** «2026-10-01», la fecha de un instante en hora de Argentina. */
export function dateKeyAR(iso: string | number | Date) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE }).format(
    new Date(iso),
  );
}

/** «18:00 – 19:00 h». */
export function timeRange(startIso: string, endIso: string) {
  return `${timeAR(startIso)} – ${timeAR(endIso)} h`;
}

/** «miércoles 30 de septiembre». */
export function longDate(iso: string) {
  return part(iso, { weekday: "long", day: "numeric", month: "long" });
}

/** «hace 2 días», «hace 3 horas», «hace un momento». Pensado para correr en el servidor. */
export function relativeFromNow(iso: string) {
  const seconds = Math.round((new Date(iso).getTime() - Date.now()) / 1000);
  const rtf = new Intl.RelativeTimeFormat("es-AR", { numeric: "auto" });
  const steps: [Intl.RelativeTimeFormatUnit, number][] = [
    ["day", 86400],
    ["hour", 3600],
    ["minute", 60],
  ];
  for (const [unit, size] of steps) {
    if (Math.abs(seconds) >= size) return rtf.format(Math.round(seconds / size), unit);
  }
  return "hace un momento";
}

/** Hoy como `YYYY-MM-DD`, en hora de Argentina. */
export function todayAR() {
  return dateKeyAR(Date.now());
}

export function isToday(iso: string) {
  return dateKeyAR(iso) === todayAR();
}

/** Iniciales para avatares sin foto: «Elena Martínez» → «EM». */
export function initials(name: string) {
  return (
    name
      .trim()
      .split(/\s+/)
      .map((part) => part[0])
      .filter(Boolean)
      .slice(0, 2)
      .join("")
      .toUpperCase() || "E"
  );
}
