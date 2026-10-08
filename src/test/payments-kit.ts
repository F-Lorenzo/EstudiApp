import { vi } from "vitest";
import type { PaymentsRpc } from "@/lib/payments/refunds";

type RpcResult = { data?: unknown; error?: { message: string; hint?: string | null } | null };
export type RpcHandler = (args: Record<string, unknown>) => RpcResult | Promise<RpcResult>;

/**
 * Base de datos simulada para las pruebas del cobro: solo `rpc`, con el resultado de cada función
 * configurable y todas las llamadas registradas. Lo que no se configura devuelve «sin error».
 */
export function fakeRpc(handlers: Record<string, RpcHandler | RpcResult> = {}) {
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  const rpc = vi.fn(async (name: string, args: Record<string, unknown> = {}) => {
    calls.push({ name, args });
    const handler = handlers[name];
    const result = typeof handler === "function" ? await handler(args) : handler;
    return { data: null, error: null, ...result };
  });
  return {
    db: { rpc } as unknown as PaymentsRpc,
    calls,
    of: (name: string) => calls.filter((call) => call.name === name),
  };
}

export const BOOKING_ID = "b0000000-0000-4000-8000-000000000001";
export const TUTOR_ID = "d1000000-0000-4000-8000-000000000001";
export const SELLER_TOKEN = "APP_USR-token-docente";
export const SELLER_MP_ID = "111222333";

/** Lo que devuelve `refund_summary` en la base. */
export function refundSummary(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "f0000000-0000-4000-8000-000000000001",
    booking_id: BOOKING_ID,
    mercadopago_payment_id: "1234567890",
    status: "pendiente",
    percent: 100,
    amount: 10000,
    idempotency_key: "k0000000-0000-4000-8000-000000000001",
    ...overrides,
  };
}
