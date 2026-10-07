/**
 * El pago simulado confirma una reserva sin cobrar nada: sirve para probar el
 * recorrido completo mientras no esté Mercado Pago. Está apagado por defecto y
 * solo funciona en desarrollo local o en previews de Vercel; nunca en
 * producción de Vercel ni en un `next start` de producción en otro servidor,
 * aunque la variable esté definida.
 */
export function paymentSimulationEnabled() {
  if (process.env.ALLOW_SIMULATED_PAYMENTS !== "true") return false;
  if (process.env.VERCEL_ENV === "production") return false;
  // Fuera de Vercel, un build de producción (`NODE_ENV=production`) no la admite.
  return process.env.NODE_ENV !== "production" || process.env.VERCEL_ENV === "preview";
}
