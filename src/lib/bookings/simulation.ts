/**
 * El pago simulado confirma una reserva sin cobrar nada: sirve para probar el recorrido completo en una máquina de
 * desarrollo, sin Mercado Pago. Está apagado por defecto y se habilita ÚNICAMENTE cuando se cumplen las tres
 * condiciones a la vez:
 *
 *  - `ALLOW_SIMULATED_PAYMENTS` es exactamente «true»;
 *  - `NODE_ENV` es «development» (`next dev`): ni un build de producción ni las pruebas lo habilitan;
 *  - `VERCEL_ENV` no está definida: en cualquier entorno de Vercel (production, preview o development) queda apagado.
 *    Las vistas previas de Vercel comparten la base REAL con producción, así que una reserva «pagada» en una
 *    preview sería una reserva confirmada de verdad, sin cobro.
 */
export function paymentSimulationEnabled() {
  if (process.env.ALLOW_SIMULATED_PAYMENTS !== "true") return false;
  if (process.env.NODE_ENV !== "development") return false;
  // `VERCEL_ENV` vacía cuenta como no definida (así llega desde un archivo .env con la variable en blanco).
  return !process.env.VERCEL_ENV;
}
