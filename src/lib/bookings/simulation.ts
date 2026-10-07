/**
 * El pago simulado confirma una reserva sin cobrar nada: sirve para probar el
 * recorrido completo mientras no esté Mercado Pago. Está apagado por defecto y
 * no funciona en producción de Vercel aunque la variable esté definida.
 */
export function paymentSimulationEnabled() {
  return (
    process.env.ALLOW_SIMULATED_PAYMENTS === "true" &&
    process.env.VERCEL_ENV !== "production"
  );
}
