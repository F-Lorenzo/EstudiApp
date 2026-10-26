import { getEmailSetup } from "@/lib/admin/email-status";
import { paymentsConfigured } from "@/lib/payments/config";
import { oauthTestTokenEnabled } from "@/lib/payments/mercadopago/client";
import { siteUrlOrNull } from "@/lib/payments/site-url";
import { parseEncryptionKey } from "@/lib/payments/token-crypto";

/**
 * ¿Está todo listo para lanzar? (`/admin/sistema`, decisión del 26 de octubre de 2026). Revisa la configuración del
 * servidor que no se ve desde el código: qué variables están cargadas en el Worker, si tienen la forma correcta y si
 * quedó encendido algo que es solo para pruebas. **Nunca devuelve el valor de una clave**: solo si está o no. Lo que
 * sí muestra (la dirección del sitio, la del aviso de Mercado Pago, el remitente) es público.
 */

export type CheckStatus = "ok" | "revisar" | "apagado";

export type SystemCheck = {
  label: string;
  status: CheckStatus;
  /** Lo que se ve al lado de la etiqueta: «Cargada», «Falta», una dirección. */
  value: string;
  hint?: string;
};

export type SystemGroup = { title: string; checks: SystemCheck[] };

export type SystemInput = {
  env: Record<string, string | undefined>;
  /** Los limitadores de `wrangler.jsonc` existen (solo dentro de un Worker). */
  rateLimiters: boolean;
  /** La base responde con la última migración (0025): `null` si no se pudo comprobar. */
  databaseCurrent: boolean | null;
};

const has = (value: string | undefined) => Boolean(value?.trim());
const loaded = (value: string | undefined, hintIfMissing: string): Pick<SystemCheck, "status" | "value" | "hint"> =>
  has(value) ? { status: "ok", value: "Cargada" } : { status: "revisar", value: "Falta", hint: hintIfMissing };

export function getSystemStatus({ env, rateLimiters, databaseCurrent }: SystemInput): SystemGroup[] {
  const site = siteUrlOrNull(env);
  const publicSite = site !== null && new URL(site).protocol === "https:";
  const indexing = env.SITE_INDEXABLE?.trim().toLowerCase() === "true";
  const simulated = env.ALLOW_SIMULATED_PAYMENTS?.trim() === "true";
  let encryptionKey = true;
  try {
    parseEncryptionKey(env.MERCADOPAGO_TOKEN_ENCRYPTION_KEY);
  } catch {
    encryptionKey = false;
  }
  const turnstileKeys = [env.TURNSTILE_SITE_KEY, env.TURNSTILE_SECRET_KEY].filter(has).length;
  const email = getEmailSetup(env);

  return [
    {
      title: "Sitio",
      checks: [
        {
          label: "Dirección (NEXT_PUBLIC_SITE_URL)",
          status: publicSite ? "ok" : "revisar",
          value: site ?? "Falta",
          hint: publicSite ? undefined : "Tiene que ser la dirección pública con https: la usan los emails y Mercado Pago.",
        },
        {
          label: "Indexación en buscadores (SITE_INDEXABLE)",
          status: indexing ? "ok" : "apagado",
          value: indexing ? "Encendida" : "Apagada",
          hint: indexing
            ? "Google puede indexar el sitio (solo en la dirección de arriba; las versiones de prueba nunca)."
            : "Google no indexa el sitio. Se enciende el día del lanzamiento con SITE_INDEXABLE=true, sin volver a desplegar.",
        },
        {
          label: "Pago simulado (ALLOW_SIMULATED_PAYMENTS)",
          status: simulated ? "revisar" : "ok",
          value: simulated ? "Encendido" : "Apagado",
          hint: simulated ? "En producción no funciona igual (solo con next dev), pero la variable no tiene que estar." : undefined,
        },
      ],
    },
    {
      title: "Base de datos",
      checks: [
        {
          label: "Conexión pública (NEXT_PUBLIC_SUPABASE_URL y la clave pública)",
          ...(has(env.NEXT_PUBLIC_SUPABASE_URL) && has(env.NEXT_PUBLIC_SUPABASE_ANON_KEY)
            ? { status: "ok" as const, value: "Cargadas" }
            : { status: "revisar" as const, value: "Falta", hint: "Van en el build: sin ellas no anda nada." }),
        },
        { label: "Clave de servicio (SUPABASE_SERVICE_ROLE_KEY)", ...loaded(env.SUPABASE_SERVICE_ROLE_KEY, "Sin ella no se cobra, no se confirman reservas ni salen los emails.") },
        {
          label: "Migraciones",
          status: databaseCurrent ? "ok" : "revisar",
          value: databaseCurrent ? "Al día (hasta la 0025)" : databaseCurrent === false ? "Falta la 0025" : "No se pudo comprobar",
          hint: databaseCurrent ? undefined : "Corré supabase/checks/1-diagnostico.sql en el SQL Editor.",
        },
      ],
    },
    {
      title: "Mercado Pago",
      checks: [
        { label: "Aplicación (MERCADOPAGO_CLIENT_ID)", ...loaded(env.MERCADOPAGO_CLIENT_ID, "Sin ella los docentes no pueden vincular su cuenta.") },
        { label: "Clave de la aplicación (MERCADOPAGO_CLIENT_SECRET)", ...loaded(env.MERCADOPAGO_CLIENT_SECRET, "Sin ella los docentes no pueden vincular su cuenta.") },
        {
          label: "Firma de los avisos (MERCADOPAGO_WEBHOOK_SECRET)",
          ...loaded(env.MERCADOPAGO_WEBHOOK_SECRET, "Sin ella se rechazan todos los avisos de pago y no se ofrece pagar con tarjeta."),
        },
        {
          label: "Dirección de los avisos",
          status: publicSite ? "ok" : "revisar",
          value: site ? `${site}/api/mercadopago/webhook` : "Falta la dirección del sitio",
          hint: "Es la que va en Mercado Pago → tu aplicación → Webhooks (evento «Pagos»).",
        },
        {
          label: "Cifrado de los tokens (MERCADOPAGO_TOKEN_ENCRYPTION_KEY)",
          status: encryptionKey ? "ok" : "revisar",
          value: encryptionKey ? "Cargada" : has(env.MERCADOPAGO_TOKEN_ENCRYPTION_KEY) ? "Mal formada" : "Falta",
          hint: encryptionKey ? undefined : "Tienen que ser 32 bytes en base64 (openssl rand -base64 32). Si ya había docentes vinculados, no la cambies.",
        },
        {
          label: "Credenciales de prueba (MERCADOPAGO_OAUTH_TEST_TOKEN)",
          status: oauthTestTokenEnabled(env) ? "revisar" : "ok",
          value: oauthTestTokenEnabled(env) ? "Encendidas" : "Apagadas",
          hint: oauthTestTokenEnabled(env) ? "Con docentes reales va apagado: Mercado Pago rechaza a los alumnos que no son usuarios de prueba." : undefined,
        },
        {
          label: "Pago con tarjeta",
          status: paymentsConfigured(env) ? "ok" : "revisar",
          value: paymentsConfigured(env) ? "Disponible" : "No disponible",
          hint: paymentsConfigured(env) ? undefined : "Hacen falta la clave de servicio, la firma de los avisos, la dirección y la clave de cifrado.",
        },
      ],
    },
    {
      title: "Clases, emails y mantenimiento",
      checks: [
        { label: "Videollamada (DAILY_API_KEY)", ...loaded(env.DAILY_API_KEY, "Sin ella la sala de la clase no abre.") },
        {
          label: "Emails (Resend)",
          status: email.ready ? "ok" : "revisar",
          value: email.ready ? "Enviando" : "Sin configurar",
          hint: email.ready ? undefined : "El detalle está en Emails.",
        },
        {
          label: "Mantenimiento de cada hora (CRON_SECRET)",
          ...(has(env.CRON_SECRET) || has(env.MERCADOPAGO_CRON_SECRET)
            ? { status: "ok" as const, value: "Cargada" }
            : {
                status: "revisar" as const,
                value: "Falta",
                hint: "Sin ella no se registra la asistencia, no se reintentan reembolsos ni salen los recordatorios.",
              }),
        },
      ],
    },
    {
      title: "Seguridad",
      checks: [
        {
          label: "Turnstile (TURNSTILE_SITE_KEY y TURNSTILE_SECRET_KEY)",
          status: turnstileKeys === 2 ? "ok" : "revisar",
          value: turnstileKeys === 2 ? "Encendido" : turnstileKeys === 1 ? "Falta una de las dos" : "Apagado",
          hint: turnstileKeys === 2 ? undefined : "Protege el login, el registro y la recuperación de robots. Pasos en docs/CLOUDFLARE.md.",
        },
        {
          label: "Límite de intentos por IP",
          status: rateLimiters ? "ok" : "revisar",
          value: rateLimiters ? "Activo" : "No disponible",
          hint: rateLimiters ? undefined : "Los limitadores de wrangler.jsonc existen solo dentro del Worker de Cloudflare.",
        },
      ],
    },
  ];
}

/** Cuántas comprobaciones hay que revisar (las apagadas a propósito, como la indexación, no cuentan). */
export function pendingChecks(groups: SystemGroup[]) {
  return groups.flatMap((group) => group.checks).filter((check) => check.status === "revisar").length;
}
