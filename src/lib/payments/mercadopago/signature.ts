import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Verificación de la firma de los avisos (webhooks) de Mercado Pago.
 *
 * Mercado Pago manda la cabecera `x-signature: ts=<marca de tiempo>,v1=<firma>` y `x-request-id`.
 * La firma es un HMAC SHA-256 (en hexadecimal) con la «clave secreta» de la aplicación sobre este texto:
 *
 *     id:<data.id de la URL>;request-id:<x-request-id>;ts:<ts>;
 *
 * Si falta alguno de los tres datos, se omite esa parte del texto. Si `data.id` es alfanumérico se
 * pasa a minúsculas. (Documentación oficial: «Notificaciones Webhooks → Validar origen».)
 *
 * IMPORTANTE: la firma solo prueba que el aviso lo generó Mercado Pago; NO es la fuente de verdad
 * del pago. Siempre se vuelve a consultar el pago antes de actuar, así que repetir un aviso viejo
 * firmado (la firma no vence) no puede hacer nada que el estado real del pago no justifique.
 */
export type SignatureInput = {
  secret: string | undefined;
  /** Contenido de la cabecera `x-signature`. */
  signature: string | null;
  /** Contenido de la cabecera `x-request-id`. */
  requestId: string | null;
  /** Parámetro `data.id` de la dirección. */
  dataId: string | null;
};

export type SignatureResult =
  | { ok: true; ts: string }
  | { ok: false; reason: "missing_secret" | "missing_signature" | "malformed_signature" | "mismatch" };

/** El texto que se firma. Se exporta para que las pruebas armen avisos válidos. */
export function webhookManifest({ dataId, requestId, ts }: { dataId: string | null; requestId: string | null; ts: string }) {
  let manifest = "";
  if (dataId) manifest += `id:${/^[a-z0-9]+$/i.test(dataId) ? dataId.toLowerCase() : dataId};`;
  if (requestId) manifest += `request-id:${requestId};`;
  manifest += `ts:${ts};`;
  return manifest;
}

export function computeWebhookSignature(secret: string, parts: { dataId: string | null; requestId: string | null; ts: string }) {
  return createHmac("sha256", secret).update(webhookManifest(parts)).digest("hex");
}

function parseSignatureHeader(header: string) {
  const values = new Map<string, string>();
  for (const part of header.split(",")) {
    const separator = part.indexOf("=");
    if (separator === -1) continue;
    values.set(part.slice(0, separator).trim(), part.slice(separator + 1).trim());
  }
  const ts = values.get("ts");
  const v1 = values.get("v1");
  return ts && v1 ? { ts, v1 } : null;
}

export function verifyWebhookSignature({ secret, signature, requestId, dataId }: SignatureInput): SignatureResult {
  // Sin clave configurada no se acepta nada: nunca se procesa un aviso sin poder comprobarlo.
  if (!secret) return { ok: false, reason: "missing_secret" };
  if (!signature) return { ok: false, reason: "missing_signature" };

  const parsed = parseSignatureHeader(signature);
  if (!parsed || !/^\d+$/.test(parsed.ts) || !/^[0-9a-f]{64}$/i.test(parsed.v1)) {
    return { ok: false, reason: "malformed_signature" };
  }

  const expected = Buffer.from(computeWebhookSignature(secret, { dataId, requestId, ts: parsed.ts }), "hex");
  const received = Buffer.from(parsed.v1, "hex");
  // Comparación de tiempo constante (y de igual largo, que `timingSafeEqual` exige).
  if (expected.length !== received.length || !timingSafeEqual(expected, received)) {
    return { ok: false, reason: "mismatch" };
  }
  return { ok: true, ts: parsed.ts };
}
