import { z } from "zod";
import type { PaymentProvider } from "./provider";
import { executeRefund, isSimulatedPaymentId, refundRowSchema, type PaymentsRpc } from "./refunds";
import { SellerTokenError, type SellerToken } from "./seller-token";

/**
 * Barrido de reembolsos: reintenta los que quedaron pendientes o fallidos (Mercado Pago no respondió, el token
 * del docente había vencido, la respuesta se perdió). La base elige cuáles (`retryable_refunds`, migración 0013:
 * pendientes o fallidos, con menos de 8 intentos, sin tocar en los últimos 2 minutos) y cada uno se ejecuta con el
 * token de SU cuenta de cobro. Reintentar es seguro: la clave de idempotencia de cada fila hace que Mercado Pago
 * devuelva la operación original en vez de devolver otra vez.
 *
 * Un fallo en un reembolso no frena a los demás. El informe no lleva secretos: solo ids de reembolso y motivos.
 * Quien lo llame (una ruta programada) tiene que protegerla con un secreto propio: el barrido mueve dinero.
 */
export type RefundSweepDeps = {
  db: PaymentsRpc;
  provider: PaymentProvider;
  /** Token de la cuenta de cobro de Mercado Pago (por su id) que recibió cada pago. */
  loadTokenForAccount: (mpUserId: string) => Promise<SellerToken>;
  /** Cuántos reembolsos tomar como máximo (por defecto 25, tope 100). */
  limit?: number;
};

export type RefundSweepSkipReason =
  | "sin_cuenta_de_cobro"
  | "cuenta_desconocida"
  | "token_vencido"
  | "token_ilegible"
  | "token_no_disponible"
  | "ya_aprobado"
  | "fila_ilegible";

export type RefundSweepReport = {
  /** Reembolsos que se intentaron de verdad (se le pidió la devolución al proveedor, o se cerró uno simulado). */
  attempted: number;
  approved: number;
  failed: number;
  /** Los que ni se intentaron: faltaba la cuenta de cobro o su token. Siguen en la cola. */
  skipped: number;
  failures: { refundId: string; detail: string }[];
  skippedDetails: { refundId: string; reason: RefundSweepSkipReason }[];
};

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;

const retryableSchema = refundRowSchema.extend({ tutor_id: z.string().nullish() });

type TokenLookup = { token: SellerToken } | { reason: RefundSweepSkipReason };

export async function retryPendingRefunds({ db, provider, loadTokenForAccount, limit = DEFAULT_LIMIT }: RefundSweepDeps): Promise<RefundSweepReport> {
  const report: RefundSweepReport = { attempted: 0, approved: 0, failed: 0, skipped: 0, failures: [], skippedDetails: [] };

  const take = Math.min(Math.max(Math.trunc(limit) || DEFAULT_LIMIT, 1), MAX_LIMIT);
  const { data, error } = await db.rpc("retryable_refunds", { p_limit: take });
  if (error) throw new Error("No se pudo leer la cola de reembolsos.");

  const rows: unknown[] = Array.isArray(data) ? data : [];
  const tokens = new Map<string, Promise<TokenLookup>>();
  const lookup = (mpUserId: string) => {
    let pending = tokens.get(mpUserId);
    if (!pending) {
      pending = findToken(loadTokenForAccount, mpUserId);
      tokens.set(mpUserId, pending);
    }
    return pending;
  };

  const skip = (refundId: string, reason: RefundSweepSkipReason) => {
    report.skipped++;
    report.skippedDetails.push({ refundId, reason });
  };

  for (const raw of rows) {
    const parsed = retryableSchema.safeParse(raw);
    if (!parsed.success) {
      skip("desconocido", "fila_ilegible");
      continue;
    }
    const refund = parsed.data;
    if (refund.status === "aprobado") {
      skip(refund.id, "ya_aprobado");
      continue;
    }

    // Un pago simulado (solo desarrollo) no mueve plata ni necesita cuenta de cobro.
    let accessToken: string | null = null;
    if (!isSimulatedPaymentId(refund.mercadopago_payment_id)) {
      if (!refund.mp_user_id) {
        skip(refund.id, "sin_cuenta_de_cobro");
        continue;
      }
      const found = await lookup(refund.mp_user_id);
      if ("reason" in found) {
        skip(refund.id, found.reason);
        continue;
      }
      accessToken = found.token.accessToken;
    }

    report.attempted++;
    try {
      const execution = await executeRefund({ db, provider, accessToken }, refund);
      if (execution.status === "aprobado") report.approved++;
      else {
        report.failed++;
        report.failures.push({ refundId: refund.id, detail: execution.detail.slice(0, 300) });
      }
    } catch {
      // `executeRefund` no lanza, pero un error imprevisto en un reembolso no puede frenar al resto.
      report.failed++;
      report.failures.push({ refundId: refund.id, detail: "Error inesperado al reembolsar." });
    }
  }
  return report;
}

async function findToken(load: RefundSweepDeps["loadTokenForAccount"], mpUserId: string): Promise<TokenLookup> {
  try {
    return { token: await load(mpUserId) };
  } catch (error) {
    if (!(error instanceof SellerTokenError)) return { reason: "token_no_disponible" };
    switch (error.reason) {
      case "unknown_seller":
        return { reason: "cuenta_desconocida" };
      case "expired":
        return { reason: "token_vencido" };
      case "unreadable":
        return { reason: "token_ilegible" };
      default:
        return { reason: "token_no_disponible" };
    }
  }
}
