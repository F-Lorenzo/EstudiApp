import { z } from "zod";

/**
 * Lo que manda el formulario de tarjeta de Mercado Pago (Card Payment Brick) al confirmar. El número de la
 * tarjeta nunca llega: solo el token que Mercado Pago generó en el navegador. El monto NO se acepta desde acá:
 * sale siempre de la reserva en la base.
 */
export const cardPaymentSchema = z.object({
  token: z.string().trim().min(1).max(200),
  payment_method_id: z.string().trim().regex(/^[a-z0-9_]{1,40}$/),
  issuer_id: z
    .union([z.string(), z.number()])
    .transform(String)
    .pipe(z.string().regex(/^\d{1,20}$/))
    .nullish(),
  installments: z.coerce.number().int().min(1).max(48),
  payer: z.object({
    email: z.email().max(254),
    identification: z
      .object({
        type: z.string().trim().min(1).max(20),
        number: z.string().trim().regex(/^[0-9A-Za-z-]{1,30}$/),
      })
      .nullish(),
  }),
});

export type CardPaymentData = z.infer<typeof cardPaymentSchema>;
