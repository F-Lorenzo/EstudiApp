/**
 * Estado de la cuenta de cobro de un docente, tal como lo muestra la tarjeta «Cuenta de cobro» del panel.
 * Sale de dos datos que el docente puede leer con SU sesión:
 *
 *   - `tutor_private.mercadopago_account_id`  la cuenta vinculada (la lee solo el dueño, por la RLS);
 *   - `tutor_can_receive_payments(docente)`   si sus credenciales siguen vigentes.
 *
 * Los tokens NUNCA llegan acá ni al navegador: solo un sí/no y el final del id de la cuenta.
 */
export type PayoutAccountStatus =
  /** No hay ninguna cuenta vinculada. */
  | "sin_vincular"
  /** Cuenta vinculada y con credenciales vigentes: ya se pueden reservar sus horarios. */
  | "vinculada"
  /** Hay cuenta, pero las credenciales vencieron: tiene que volver a vincular. */
  | "vencida"
  /** No se pudo leer el estado (falla pasajera de la base). */
  | "no_disponible";

export type PayoutAccountView = {
  status: PayoutAccountStatus;
  /** Id de la cuenta enmascarado (`•••• 1234`), o `null` si no hay cuenta. */
  maskedAccount: string | null;
};

/** Muestra solo los últimos 4 caracteres del id. Un id de 4 o menos no se revela. */
export function maskAccountId(accountId: string | null | undefined): string | null {
  const id = accountId?.trim();
  if (!id) return null;
  return id.length > 4 ? `•••• ${id.slice(-4)}` : "••••";
}

export function buildPayoutAccountView({
  accountId,
  canReceive,
  failed = false,
}: {
  accountId: string | null | undefined;
  canReceive: boolean | null | undefined;
  /** Alguna de las dos consultas falló: no se afirma nada que no se sabe. */
  failed?: boolean;
}): PayoutAccountView {
  if (failed) return { status: "no_disponible", maskedAccount: null };
  const maskedAccount = maskAccountId(accountId);
  if (canReceive) return { status: "vinculada", maskedAccount };
  // Credenciales sin vigencia pero con cuenta registrada: la autorización venció.
  if (maskedAccount) return { status: "vencida", maskedAccount };
  return { status: "sin_vincular", maskedAccount: null };
}
