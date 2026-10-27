import { renderHtml, type EmailContent } from "./layout";

/**
 * Plantillas de los emails que manda Supabase Auth (Authentication → Emails → Templates), con la misma maqueta que
 * los avisos de EstudiApp (`layout.ts`). Supabase no las lee del repo: se pegan a mano en el panel. Los archivos
 * listos para pegar están en `supabase/email-templates/` y salen de acá con `npm run auth-emails`; una prueba
 * comprueba que estén al día.
 *
 * Las variables entre llaves (`{{ .SiteURL }}`, `{{ .TokenHash }}`, …) las completa Supabase al enviar. Los enlaces
 * pasan por `/auth/confirm` (`src/app/auth/confirm/route.ts`) con el tipo escrito fijo, que es lo que la app espera.
 */

export type AuthTemplate = {
  /** Nombre del archivo en `supabase/email-templates/`. */
  file: string;
  /** Cómo se llama la plantilla en el panel de Supabase. */
  supabaseName: string;
  subject: string;
  /** Para qué es, en una línea (va en el README de las plantillas). */
  purpose: string;
  content: EmailContent;
};

const confirmLink = (type: string, next?: string) =>
  `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=${type}${next ? `&next=${next}` : ""}`;

// Supabase no permite «Responder a»: las respuestas irían a avisos@, que no recibe correo. Por eso el pie no invita a
// responder, y no dice «tenés una cuenta» (a quien se registra o recibe una invitación todavía no le pasa).
const base = {
  siteUrl: null,
  footer: "Este es un email automático de EstudiApp sobre el acceso a tu cuenta. No hace falta responderlo.",
} as const;

export const AUTH_TEMPLATES: AuthTemplate[] = [
  {
    file: "confirmar-registro.html",
    supabaseName: "Confirm signup",
    subject: "Confirmá tu cuenta de EstudiApp",
    purpose: "Al registrarse un alumno o un docente.",
    content: {
      ...base,
      preheader: "Un clic y tu cuenta queda lista.",
      title: "Ya casi estás",
      greeting: "¡Hola!",
      blocks: [
        { kind: "paragraph", text: "Gracias por sumarte a EstudiApp. Confirmá tu email para empezar a usar tu cuenta." },
        { kind: "button", label: "Confirmar mi cuenta", url: confirmLink("email") },
        { kind: "paragraph", text: "Si no creaste una cuenta en EstudiApp, ignorá este mensaje: sin confirmar, no se activa nada." },
      ],
    },
  },
  {
    file: "recuperar-contrasena.html",
    supabaseName: "Reset password",
    subject: "Elegí una nueva contraseña",
    purpose: "Al pedir «Olvidé mi contraseña» en /recuperar-password.",
    content: {
      ...base,
      preheader: "El enlace para elegir una contraseña nueva.",
      title: "Recuperá tu cuenta",
      greeting: "¡Hola!",
      blocks: [
        { kind: "paragraph", text: "Pediste cambiar la contraseña de tu cuenta de EstudiApp. Tocá el botón para elegir una nueva." },
        { kind: "button", label: "Elegir una nueva contraseña", url: confirmLink("recovery") },
        { kind: "callout", text: "El enlace sirve una sola vez y vence en poco tiempo. Si venció, pedí otro desde «Olvidé mi contraseña»." },
        { kind: "paragraph", text: "Si no lo pediste, ignorá este mensaje: tu contraseña sigue igual." },
      ],
    },
  },
  {
    file: "cambio-de-email.html",
    supabaseName: "Change email address",
    subject: "Confirmá tu nuevo email",
    purpose: "Cuando una cuenta cambia su dirección de email.",
    content: {
      ...base,
      preheader: "Confirmá el cambio de email de tu cuenta.",
      title: "Confirmá tu nuevo email",
      greeting: "¡Hola!",
      blocks: [
        { kind: "paragraph", text: "Pediste cambiar el email de tu cuenta de EstudiApp." },
        { kind: "facts", rows: [{ label: "Email nuevo", value: "{{ .NewEmail }}" }] },
        { kind: "button", label: "Confirmar el cambio", url: confirmLink("email_change") },
        { kind: "callout", tone: "warning", text: "Si no pediste este cambio, no toques el botón: sin confirmar, tu email sigue siendo el de siempre. Por las dudas, cambiá tu contraseña." },
      ],
    },
  },
  {
    file: "enlace-de-acceso.html",
    supabaseName: "Magic link",
    subject: "Tu enlace para entrar a EstudiApp",
    purpose: "Enlace para entrar sin contraseña. La app no lo ofrece, pero Supabase lo puede mandar.",
    content: {
      ...base,
      preheader: "Entrá a tu cuenta con un clic.",
      title: "Entrá a EstudiApp",
      greeting: "¡Hola!",
      blocks: [
        { kind: "paragraph", text: "Pediste un enlace para entrar a tu cuenta de EstudiApp sin contraseña." },
        { kind: "button", label: "Entrar a mi cuenta", url: confirmLink("email") },
        { kind: "paragraph", text: "Si no lo pediste, ignorá este mensaje: nadie puede entrar sin este enlace." },
      ],
    },
  },
  {
    file: "invitacion.html",
    supabaseName: "Invite user",
    subject: "Te invitaron a EstudiApp",
    purpose: "Cuando la administración invita a alguien desde el panel de Supabase (Authentication → Users → Invite).",
    content: {
      ...base,
      preheader: "Aceptá la invitación y elegí tu contraseña.",
      title: "Te damos la bienvenida",
      greeting: "¡Hola!",
      blocks: [
        { kind: "paragraph", text: "Te invitaron a crear tu cuenta en EstudiApp. Tocá el botón para aceptar y elegir tu contraseña." },
        // Una cuenta invitada no tiene contraseña: después de confirmar va directo a elegirla.
        { kind: "button", label: "Aceptar la invitación", url: confirmLink("invite", "/actualizar-password") },
        { kind: "paragraph", text: "Si no esperabas esta invitación, ignorá este mensaje." },
      ],
    },
  },
  {
    file: "codigo-de-verificacion.html",
    supabaseName: "Reauthentication",
    subject: "Tu código de verificación",
    purpose: "Código para confirmar que sos vos antes de un cambio sensible.",
    content: {
      ...base,
      preheader: "Tu código para confirmar que sos vos.",
      title: "Tu código de verificación",
      greeting: "¡Hola!",
      blocks: [
        { kind: "paragraph", text: "Usá este código para confirmar que sos vos:" },
        { kind: "facts", rows: [{ label: "Código", value: "{{ .Token }}" }] },
        { kind: "paragraph", text: "Si no lo pediste, ignorá este mensaje y cambiá tu contraseña." },
      ],
    },
  },
];

export function renderAuthTemplate(template: AuthTemplate): string {
  return renderHtml(template.subject, template.content);
}
