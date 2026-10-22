import { z } from "zod";

/**
 * Lo que se lee de las respuestas de Mercado Pago. Los esquemas piden solo los campos que el
 * código usa y dejan pasar el resto (Mercado Pago agrega campos seguido). Los identificadores
 * llegan como número o como texto según el endpoint: se normalizan a texto.
 */
const id = z.union([z.number(), z.string()]).transform((value) => String(value));

export const paymentResponseSchema = z.object({
  id,
  status: z.string(),
  status_detail: z.string().nullish(),
  transaction_amount: z.number(),
  currency_id: z.string().nullish(),
  external_reference: z.string().nullish(),
  collector_id: id.nullish(),
  collector: z.object({ id }).nullish(),
  transaction_amount_refunded: z.number().nullish(),
});

export const refundResponseSchema = z.object({
  id,
  status: z.string().nullish(),
  amount: z.number().nullish(),
});

export const oauthTokenResponseSchema = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().min(1),
  user_id: id,
  expires_in: z.number().positive(),
  public_key: z.string().nullish(),
  live_mode: z.boolean().nullish(),
});

export const errorBodySchema = z.object({
  message: z.string().nullish(),
  error: z.string().nullish(),
  cause: z
    .array(z.object({ code: z.union([z.number(), z.string()]).nullish(), description: z.string().nullish() }))
    .nullish(),
});
