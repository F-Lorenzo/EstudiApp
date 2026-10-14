import { z } from "zod";
import { longDate, timeRange } from "@/lib/format";
import { renderHtml, renderText, type Block, type EmailContent } from "./layout";

/**
 * Plantillas de los emails transaccionales. Cada aviso de la bandeja (`email_outbox.kind`) se arma con
 * la FOTO (`payload`) que dejó la base al anotarlo, no con datos de ese momento: el mail dice lo que
 * pasó cuando pasó. Las claves del payload las define la migración 0015.
 *
 *   reserva_confirmada      alumno   student_name, tutor_name, subject?, starts_at, ends_at, price, amount_paid
 *   nueva_reserva_docente   docente  lo mismo + tutor_amount
 *   reserva_cancelada       alumno   base + cancelled_by, reason, amount_paid, refund_percent, refund_amount
 *                           docente  base + cancelled_by, reason
 *   reembolso_realizado     alumno   base + refund_amount, refund_percent, reason ('cancelacion'|'pago_no_aceptable')
 *
 * `reserva_cancelada` va a las dos partes con el mismo `kind`; el payload no dice cuál es el destinatario,
 * así que se distingue por el contenido: solo la copia del alumno trae datos de dinero (`amount_paid`,
 * `refund_*`). Si la base agregara una clave explícita, conviene usarla acá (`isStudentCopy`).
 *
 * Los textos que escribió una persona (nombres, motivo) llegan sin escapar: el escape ocurre en `layout.ts`.
 * Los enlaces usan el origen del sitio (`NEXT_PUBLIC_SITE_URL`); si no está configurado, los mails salen
 * sin botones.
 */

export const EMAIL_KINDS = ["reserva_confirmada", "nueva_reserva_docente", "reserva_cancelada", "reembolso_realizado"] as const;
export type EmailKind = (typeof EMAIL_KINDS)[number];

export type RenderContext = {
  kind: string;
  payload: unknown;
  /** Nombre del destinatario (de su perfil); se usa para el saludo. */
  toName?: string | null;
  /** Origen del sitio, sin barra final. `null` o inválido: los emails salen sin enlaces. */
  baseUrl?: string | null;
};

export type RenderedEmail = { subject: string; html: string; text: string };

export type RenderResult =
  | { ok: true; email: RenderedEmail }
  /** `unknown_kind`: no hay plantilla. `invalid_payload`: faltan datos imprescindibles (por ejemplo, el horario). */
  | { ok: false; reason: "unknown_kind" | "invalid_payload" };

// --- Lectura del payload --------------------------------------------------------------------------------

const cleanText = (max: number) =>
  z
    .string()
    .transform((value) => value.replace(/\s+/g, " ").trim().slice(0, max))
    .pipe(z.string().min(1));

/** Un dato opcional que, si viene mal, simplemente se ignora (no tira abajo todo el email). */
const optional = <T extends z.ZodType>(schema: T) => schema.optional().catch(undefined);

const amount = z
  .union([z.number(), z.string().regex(/^\d+(\.\d+)?$/)])
  .transform(Number)
  .pipe(z.number().finite().min(0));

const isoDate = z.string().refine((value) => !Number.isNaN(Date.parse(value)), "fecha inválida");

const baseShape = {
  // Hoy la base no lo manda; si algún día lo suma, el botón lleva directo a la reserva.
  booking_id: optional(z.uuid()),
  student_name: optional(cleanText(120)),
  tutor_name: optional(cleanText(120)),
  subject: optional(cleanText(120)),
  starts_at: isoDate,
  ends_at: isoDate,
  price: optional(amount),
};

const confirmedSchema = z.object({ ...baseShape, amount_paid: optional(amount) });
const tutorBookingSchema = z.object({ ...baseShape, amount_paid: optional(amount), tutor_amount: optional(amount) });
const cancelledSchema = z.object({
  ...baseShape,
  cancelled_by: optional(z.enum(["alumno", "docente", "administracion"])),
  reason: optional(cleanText(300)),
  amount_paid: optional(amount),
  refund_percent: optional(amount),
  refund_amount: optional(amount),
});
const refundedSchema = z.object({
  ...baseShape,
  refund_amount: optional(amount),
  refund_percent: optional(amount),
  reason: z.enum(["cancelacion", "pago_no_aceptable"]).catch("cancelacion"),
});

type Base = z.infer<z.ZodObject<typeof baseShape>>;

// --- Formatos ------------------------------------------------------------------------------------------

// Espacio de no separación (U+00A0).
const NBSP = String.fromCharCode(0xa0);

/** «$ 10.000»; con centavos solo si los hay («$ 5.000,50»). */
export function formatMoney(value: number): string {
  return new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
    minimumFractionDigits: Number.isInteger(value) ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(value);
}

/** «100 %», con espacio fino para que el signo no quede solo al final de un renglón. */
function formatPercent(value: number): string {
  return `${new Intl.NumberFormat("es-AR", { maximumFractionDigits: 1 }).format(value)}${NBSP}%`;
}

const capitalize = (value: string) => value.charAt(0).toUpperCase() + value.slice(1);

/** Una sola línea, sin caracteres de control (un asunto con saltos de línea abriría la puerta a inyectar cabeceras). */
function oneLine(value: string, max = 150): string {
  let clean = "";
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    // Controles C0, DEL y los separadores de línea y de párrafo de Unicode (U+2028, U+2029).
    clean += code < 0x20 || code === 0x7f || code === 0x2028 || code === 0x2029 ? " " : char;
  }
  clean = clean.replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

/** El origen (https://dominio) de una dirección, o `null` si no sirve para armar enlaces. */
function safeOrigin(baseUrl: string | null | undefined): string | null {
  if (!baseUrl) return null;
  try {
    const url = new URL(baseUrl);
    const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
    if (url.protocol !== "https:" && !(local && url.protocol === "http:")) return null;
    return url.origin;
  } catch {
    return null;
  }
}

function firstName(name: string | null | undefined): string | null {
  const first = name?.trim().split(/\s+/)[0]?.slice(0, 40);
  return first || null;
}

function scheduleOf(payload: Base) {
  // Según la versión de ICU, el día sale «martes 20 de octubre» o «martes, 20 de octubre»: se unifica sin la
  // coma, que en una frase como «la clase del martes, 20 de octubre, 18:00» estorba.
  const day = longDate(payload.starts_at).replace(/^([^\s,]+),\s*/, "$1 ");
  return { day, dayCapitalized: capitalize(day), time: timeRange(payload.starts_at, payload.ends_at) };
}

type Ctx = { greeting: string; origin: string | null };

const withLink = (ctx: Ctx, path: string, label: string): Block[] =>
  ctx.origin ? [{ kind: "button", label, url: `${ctx.origin}${path}` }] : [];

const policyLink = (ctx: Ctx): Block[] =>
  ctx.origin ? [{ kind: "link", label: "Ver la política de cancelación", url: `${ctx.origin}/cancelacion` }] : [];

const row = (label: string, value: string | undefined) => (value ? [{ label, value }] : []);

type Built = { subject: string; content: Omit<EmailContent, "greeting" | "siteUrl"> };

// --- reserva_confirmada (alumno) --------------------------------------------------------------------------

function confirmedForStudent(p: z.infer<typeof confirmedSchema>, ctx: Ctx): Built {
  const when = scheduleOf(p);
  const tutor = p.tutor_name ?? "tu docente";
  const paid = p.amount_paid ?? p.price;
  return {
    subject: p.tutor_name ? `Tu clase con ${p.tutor_name} está confirmada` : "Tu clase está confirmada",
    content: {
      preheader: `${when.dayCapitalized}, ${when.time}. Recibimos tu pago.`,
      title: "¡Tu clase está confirmada!",
      blocks: [
        { kind: "paragraph", text: `Recibimos tu pago y reservamos el horario con ${tutor}. Estos son los datos de tu clase:` },
        {
          kind: "facts",
          rows: [
            ...row("Docente", p.tutor_name),
            ...row("Materia", p.subject),
            { label: "Día", value: when.dayCapitalized },
            { label: "Horario", value: `${when.time} (hora de Argentina)` },
            ...row("Total pagado", paid !== undefined ? formatMoney(paid) : undefined),
          ],
        },
        {
          kind: "paragraph",
          text: "Si necesitás cancelar, hacelo con 24 horas o más de anticipación y te devolvemos el 100 % de lo que pagaste. Con menos de 24 horas devolvemos el 50 %, y con menos de 2 horas no hay reembolso.",
        },
        ...withLink(ctx, p.booking_id ? `/alumno/reservas/${p.booking_id}` : "/alumno/proximas-clases", p.booking_id ? "Ver mi reserva" : "Ver mis próximas clases"),
        ...policyLink(ctx),
      ],
    },
  };
}

// --- nueva_reserva_docente --------------------------------------------------------------------------------

function newBookingForTutor(p: z.infer<typeof tutorBookingSchema>, ctx: Ctx): Built {
  const when = scheduleOf(p);
  const student = p.student_name ?? "Un alumno";
  return {
    subject: p.student_name ? `Nueva reserva de ${p.student_name} para el ${when.day}` : `Tenés una nueva reserva para el ${when.day}`,
    content: {
      preheader: `${student} reservó ${when.day}, ${when.time}.`,
      title: "Tenés una nueva reserva",
      blocks: [
        { kind: "paragraph", text: `${student} reservó una clase con vos y el pago ya está confirmado.` },
        {
          kind: "facts",
          rows: [
            ...row("Alumno", p.student_name),
            ...row("Materia", p.subject),
            { label: "Día", value: when.dayCapitalized },
            { label: "Horario", value: `${when.time} (hora de Argentina)` },
            ...row("Pagó el alumno", p.amount_paid !== undefined ? formatMoney(p.amount_paid) : undefined),
            ...row("Te corresponde", p.tutor_amount !== undefined ? `${formatMoney(p.tutor_amount)} (después de la comisión de EstudiApp)` : undefined),
          ],
        },
        {
          kind: "paragraph",
          text: "El horario ya quedó ocupado en tu agenda. Si te surge un imprevisto, cancelá la clase cuanto antes desde EstudiApp: al alumno se le devuelve el 100 % de lo que pagó.",
        },
        ...withLink(ctx, "/docente", "Ir a mi panel"),
      ],
    },
  };
}

// --- reserva_cancelada (alumno y docente) -------------------------------------------------------------

const DEFAULT_REASON = /^cancelada por (el alumno|el docente|la administraci[oó]n)\.?$/i;

/** El motivo que escribió una persona; el texto por defecto que pone la base («Cancelada por el alumno») no agrega nada. */
const writtenReason = (reason: string | undefined) => (reason && !DEFAULT_REASON.test(reason) ? reason : undefined);

/** Solo la copia del alumno trae datos de dinero. */
const isStudentCopy = (p: z.infer<typeof cancelledSchema>) =>
  p.amount_paid !== undefined || p.refund_percent !== undefined || p.refund_amount !== undefined;

function refundBlocks(p: z.infer<typeof cancelledSchema>): Block[] {
  const { cancelled_by: by, refund_percent: percent, refund_amount: money } = p;

  if (percent === undefined && money === undefined) {
    return [{ kind: "paragraph", text: "Si te corresponde un reembolso, te avisamos por email apenas esté hecho." }];
  }
  if (percent === 0 || money === 0) {
    return [
      {
        kind: "callout",
        tone: "warning",
        text:
          by === "alumno"
            ? "Como la cancelaste con menos de 2 horas de anticipación, según nuestra política de cancelación esta clase no tiene reembolso."
            : "En este caso no corresponde reembolso según nuestra política de cancelación.",
      },
    ];
  }

  const share = percent !== undefined ? `el ${formatPercent(percent)} de lo que pagaste` : "lo que pagaste";
  const total = money !== undefined ? ` (${formatMoney(money)})` : "";
  let lead: string;
  if (by === "alumno" && percent === 100) lead = `Cancelaste con 24 horas o más de anticipación, así que te devolvemos ${share}`;
  else if (by === "alumno" && percent === 50) lead = `Cancelaste con menos de 24 horas de anticipación, así que te devolvemos ${share}`;
  else lead = `Te devolvemos ${share}`;

  return [
    { kind: "callout", text: `${lead}${total}.` },
    {
      kind: "paragraph",
      text: "El dinero vuelve al mismo medio de pago que usaste. Apenas el reembolso esté hecho, te mandamos otro email para avisarte.",
    },
  ];
}

function cancelledForStudent(p: z.infer<typeof cancelledSchema>, ctx: Ctx): Built {
  const when = scheduleOf(p);
  const tutor = p.tutor_name ?? "tu docente";
  const by = p.cancelled_by;
  const detail = `con ${tutor} del ${when.day}, ${when.time}`;

  let title: string;
  let intro: string;
  if (by === "alumno") {
    title = "Cancelaste tu clase";
    intro = `Cancelaste tu clase ${detail}.`;
  } else if (by === "docente") {
    title = "Tu clase fue cancelada";
    intro = `${capitalize(tutor)} tuvo que cancelar la clase del ${when.day}, ${when.time}. Lamentamos el inconveniente.`;
  } else if (by === "administracion") {
    title = "Tu clase fue cancelada";
    intro = `La administración de EstudiApp canceló tu clase ${detail}.`;
  } else {
    title = "Tu clase fue cancelada";
    intro = `Se canceló tu clase ${detail}.`;
  }
  const reason = writtenReason(p.reason);

  return {
    subject: by === "alumno" ? `Cancelaste tu clase del ${when.day}` : `Se canceló tu clase del ${when.day}`,
    content: {
      preheader: by === "alumno" ? "Registramos tu cancelación." : "Tu clase se canceló y te contamos cómo sigue.",
      title,
      blocks: [
        { kind: "paragraph", text: intro },
        ...(reason ? [{ kind: "callout", text: `Motivo: ${reason}` } satisfies Block] : []),
        {
          kind: "facts",
          rows: [
            ...row("Docente", p.tutor_name),
            ...row("Materia", p.subject),
            { label: "Día", value: when.dayCapitalized },
            { label: "Horario", value: when.time },
            ...row("Total pagado", p.amount_paid !== undefined ? formatMoney(p.amount_paid) : undefined),
          ],
        },
        ...refundBlocks(p),
        ...withLink(ctx, "/docentes", "Buscar otra clase"),
        ...policyLink(ctx),
      ],
    },
  };
}

function cancelledForTutor(p: z.infer<typeof cancelledSchema>, ctx: Ctx): Built {
  const when = scheduleOf(p);
  const student = p.student_name ?? "El alumno";
  const by = p.cancelled_by;
  const detail = `con ${p.student_name ?? "el alumno"} del ${when.day}, ${when.time}`;
  const free = "El horario vuelve a quedar disponible en tu agenda.";

  let subject: string;
  let title: string;
  let intro: string;
  if (by === "alumno") {
    subject = `${student} canceló la clase del ${when.day}`;
    title = "Se canceló una clase";
    intro = `${student} canceló la clase del ${when.day}, ${when.time}. ${free}`;
  } else if (by === "docente") {
    subject = `Cancelaste la clase del ${when.day}`;
    title = "Cancelaste una clase";
    intro = `Confirmamos que cancelaste la clase ${detail}. Le avisamos al alumno y se le devuelve el 100 % de lo que pagó. ${free}`;
  } else if (by === "administracion") {
    subject = `Se canceló la clase del ${when.day}`;
    title = "Se canceló una clase";
    intro = `La administración de EstudiApp canceló la clase ${detail}. ${free}`;
  } else {
    subject = `Se canceló la clase del ${when.day}`;
    title = "Se canceló una clase";
    intro = `Se canceló la clase ${detail}. ${free}`;
  }
  const reason = writtenReason(p.reason);

  return {
    subject,
    content: {
      preheader: `${when.dayCapitalized}, ${when.time}.`,
      title,
      blocks: [
        { kind: "paragraph", text: intro },
        ...(reason ? [{ kind: "callout", text: `Motivo: ${reason}` } satisfies Block] : []),
        {
          kind: "facts",
          rows: [
            ...row("Alumno", p.student_name),
            ...row("Materia", p.subject),
            { label: "Día", value: when.dayCapitalized },
            { label: "Horario", value: when.time },
          ],
        },
        ...withLink(ctx, "/docente", "Ir a mi panel"),
      ],
    },
  };
}

// --- reembolso_realizado (alumno) ---------------------------------------------------------------------------

function refunded(p: z.infer<typeof refundedSchema>, ctx: Ctx): Built {
  const when = scheduleOf(p);
  const money = p.refund_amount !== undefined ? formatMoney(p.refund_amount) : undefined;
  const tutor = p.tutor_name ?? "tu docente";
  const timing =
    "El dinero vuelve al mismo medio de pago con el que pagaste. Según tu banco o tu tarjeta, puede tardar unos días en aparecer en tu resumen.";

  if (p.reason === "pago_no_aceptable") {
    return {
      subject: "Te devolvimos tu pago",
      content: {
        preheader: money ? `Te devolvimos ${money}.` : "Te devolvimos el importe completo.",
        title: "Te devolvimos tu pago",
        blocks: [
          {
            kind: "paragraph",
            text: `No pudimos confirmar tu reserva con ${tutor} del ${when.day} con ese pago, así que te devolvimos el importe completo${money ? ` (${money})` : ""}.`,
          },
          { kind: "paragraph", text: timing },
          { kind: "paragraph", text: "Si todavía querés la clase, podés volver a reservar el horario mientras siga libre." },
          ...withLink(ctx, "/docentes", "Buscar una clase"),
        ],
      },
    };
  }

  return {
    subject: money ? `Ya te devolvimos ${money}` : "Hicimos tu reembolso",
    content: {
      preheader: `Reembolso de tu clase del ${when.day}.`,
      title: "Hicimos tu reembolso",
      blocks: [
        { kind: "paragraph", text: `Ya hicimos el reembolso de tu clase cancelada con ${tutor} del ${when.day}, ${when.time}.` },
        {
          kind: "facts",
          rows: [
            ...row("Reembolso", money),
            ...row("Porcentaje", p.refund_percent !== undefined ? formatPercent(p.refund_percent) : undefined),
            { label: "Clase", value: `${when.dayCapitalized}, ${when.time}` },
          ],
        },
        { kind: "paragraph", text: timing },
        ...withLink(ctx, "/alumno", "Ir a mi cuenta"),
      ],
    },
  };
}

// --- Punto de entrada --------------------------------------------------------------------------------------

export function renderEmail({ kind, payload, toName, baseUrl }: RenderContext): RenderResult {
  const first = firstName(toName);
  const origin = safeOrigin(baseUrl);
  const ctx: Ctx = { greeting: first ? `Hola ${first},` : "Hola,", origin };

  let built: Built;
  switch (kind) {
    case "reserva_confirmada": {
      const parsed = confirmedSchema.safeParse(payload);
      if (!parsed.success) return { ok: false, reason: "invalid_payload" };
      built = confirmedForStudent(parsed.data, ctx);
      break;
    }
    case "nueva_reserva_docente": {
      const parsed = tutorBookingSchema.safeParse(payload);
      if (!parsed.success) return { ok: false, reason: "invalid_payload" };
      built = newBookingForTutor(parsed.data, ctx);
      break;
    }
    case "reserva_cancelada": {
      const parsed = cancelledSchema.safeParse(payload);
      if (!parsed.success) return { ok: false, reason: "invalid_payload" };
      built = isStudentCopy(parsed.data) ? cancelledForStudent(parsed.data, ctx) : cancelledForTutor(parsed.data, ctx);
      break;
    }
    case "reembolso_realizado": {
      const parsed = refundedSchema.safeParse(payload);
      if (!parsed.success) return { ok: false, reason: "invalid_payload" };
      built = refunded(parsed.data, ctx);
      break;
    }
    default:
      return { ok: false, reason: "unknown_kind" };
  }

  const subject = oneLine(built.subject);
  const content: EmailContent = { ...built.content, greeting: ctx.greeting, siteUrl: origin };
  return { ok: true, email: { subject, html: renderHtml(subject, content), text: renderText(content) } };
}
