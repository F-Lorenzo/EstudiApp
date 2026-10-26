import type { EmailContent } from "./layout";
import { EmailSendError, describeError } from "./sender";

/** Asunto del email de prueba de `/admin/emails`. */
export const TEST_EMAIL_SUBJECT = "Email de prueba de EstudiApp";

/** El email de prueba: con la misma maqueta que los avisos reales, para ver cómo llegan. */
export function testEmailContent(siteUrl: string | null): EmailContent {
  return {
    preheader: "Si te llegó, el envío de emails de EstudiApp funciona.",
    title: "El envío de emails funciona",
    greeting: "¡Hola!",
    blocks: [
      { kind: "paragraph", text: "Este email lo pediste desde la administración de EstudiApp para probar el envío." },
      {
        kind: "callout",
        text: "Si llegó a la carpeta de spam, marcalo como «no es spam» y revisá los registros DNS del dominio en Resend: puede faltar alguno.",
      },
      ...(siteUrl ? [{ kind: "button" as const, label: "Ir a EstudiApp", url: siteUrl }] : []),
    ],
    siteUrl,
  };
}

/** Qué decirle a la administración cuando el envío de prueba falla. Nunca lleva la clave ni el destinatario. */
export function describeTestFailure(error: unknown): string {
  if (error instanceof EmailSendError) {
    if (error.kind === "not_configured")
      return "Falta configurar el envío: revisá RESEND_API_KEY, EMAIL_FROM y EMAIL_REPLY_TO en Cloudflare.";
    if (error.status === 401) return "Resend rechazó la clave (401). Revisá que RESEND_API_KEY sea la correcta.";
    if (error.status === 403)
      return "Resend rechazó el envío (403): el dominio todavía no está verificado o EMAIL_FROM no es de ese dominio.";
    if (error.kind === "timeout" || error.kind === "network") return "No pudimos comunicarnos con Resend. Probá de nuevo en un momento.";
    return describeError(error);
  }
  return "No se pudo enviar el email de prueba.";
}
