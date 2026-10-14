/**
 * Resultado de la vinculación de la cuenta de cobro, tal como viaja en la dirección del panel docente
 * (`/docente?cuenta=<aviso>`). Es solo un código cerrado: nunca lleva tokens, códigos ni datos de la
 * cuenta. Módulo puro y sin dependencias de servidor: lo usan las rutas del OAuth y el panel.
 */
export const ACCOUNT_NOTICES = [
  /** La cuenta quedó vinculada. */
  "vinculada",
  /** El docente rechazó la autorización en Mercado Pago. */
  "cancelada",
  /** Esa cuenta de Mercado Pago ya está vinculada a otro docente. */
  "ya_vinculada",
  /** Quiso cambiar de cuenta pero tiene clases por dar o reembolsos sin cerrar con la actual. */
  "cambio_bloqueado",
  /** Algo falló del lado nuestro o de Mercado Pago; no se guardó nada. */
  "error",
  /** Falta configuración del servidor. */
  "sin_configurar",
] as const;

export type AccountNotice = (typeof ACCOUNT_NOTICES)[number];

/** Lee el parámetro `cuenta` de la dirección; cualquier valor que no sea uno de los códigos se ignora. */
export function parseAccountNotice(value: string | string[] | undefined | null): AccountNotice | null {
  const single = Array.isArray(value) ? value[0] : value;
  return ACCOUNT_NOTICES.find((notice) => notice === single) ?? null;
}
