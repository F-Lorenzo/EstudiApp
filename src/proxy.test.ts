import { describe, expect, it } from "vitest";
import { config } from "./proxy";

// El `matcher` de Next usa path-to-regexp; para esta forma (un grupo con lookahead negativo) alcanza
// con convertirlo en una expresión regular anclada.
const matcher = new RegExp(`^${config.matcher[0]}$`);

describe("rutas que pasan por el proxy de sesión", () => {
  it.each([
    "/",
    "/docentes",
    "/alumno",
    "/alumno/reservas/123",
    "/docente/disponibilidad",
    "/admin",
    "/auth/confirm",
    "/login",
    // La vinculación de la cuenta de cobro necesita la sesión refrescada: pasa por el proxy.
    "/api/mercadopago/oauth/start",
    "/api/mercadopago/oauth/callback",
    // Solo el aviso exacto queda afuera; cualquier otra ruta parecida pasa por el proxy.
    "/api/mercadopago/webhooks-ajeno",
    "/api/mercadopago/webhookeado",
  ])("%s sí", (pathname) => {
    expect(matcher.test(pathname)).toBe(true);
  });

  it.each([
    // Los avisos de Mercado Pago los manda un servidor, sin sesión.
    "/api/mercadopago/webhook",
    "/api/mercadopago/webhook/",
    "/_next/static/chunks/app.js",
    "/brand/logo.png",
    "/favicon.ico",
    "/mascota.webp",
  ])("%s no", (pathname) => {
    expect(matcher.test(pathname)).toBe(false);
  });
});
