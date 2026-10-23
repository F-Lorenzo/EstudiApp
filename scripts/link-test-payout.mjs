// Vincula a UN docente con las credenciales de PRUEBA de la cuenta real dueña de la aplicación, para probar
// el pago con tarjeta de punta a punta.
//
// Por qué existe: la documentación de Mercado Pago (Checkout Bricks → «Make test purchase») dice que las
// tarjetas se prueban con las credenciales de prueba de la cuenta REAL y cualquier email de pagador (distinto
// del de esa cuenta). Con un vendedor de prueba vinculado por OAuth, en cambio, `/v1/payments` exige que el
// pagador sea un usuario de prueba (cause 2198), y crearlos por API está bloqueado para la cuenta.
//
// El docente queda «vinculado» a la cuenta dueña de la app: cobra, recibe avisos y reembolsa con el token de
// prueba de esa cuenta, sin cambiar nada del código. Es SOLO para probar: para volver a la normalidad, el
// docente desvincula desde /docente/cuenta-de-cobro y vincula su cuenta real por OAuth.
//
// Uso (en tu máquina, nunca en el repo ni en Cloudflare):
//   NEXT_PUBLIC_SUPABASE_URL=...  SUPABASE_SERVICE_ROLE_KEY=...  MERCADOPAGO_TOKEN_ENCRYPTION_KEY=...
//   MP_TEST_ACCESS_TOKEN=TEST-...  MP_TEST_PUBLIC_KEY=TEST-...  TUTOR_EMAIL=docente@...
//   LINK_TEST_CONFIRM=<host del proyecto de Supabase>
//   node scripts/link-test-payout.mjs
//
// La clave de cifrado tiene que ser LA MISMA que usa el sitio (si no, el sitio no puede leer el token).

import { createCipheriv, randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const env = process.env;
const required = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "MERCADOPAGO_TOKEN_ENCRYPTION_KEY",
  "MP_TEST_ACCESS_TOKEN",
  "MP_TEST_PUBLIC_KEY",
  "TUTOR_EMAIL",
];
const missing = required.filter((name) => !env[name]?.trim());
if (missing.length > 0) {
  console.error(`Faltan en el entorno: ${missing.join(", ")}`);
  process.exit(1);
}

const accessToken = env.MP_TEST_ACCESS_TOKEN.trim();
const publicKey = env.MP_TEST_PUBLIC_KEY.trim();
if (!accessToken.startsWith("TEST-") || !publicKey.startsWith("TEST-")) {
  console.error("MP_TEST_ACCESS_TOKEN y MP_TEST_PUBLIC_KEY tienen que ser credenciales de PRUEBA (empiezan con TEST-).");
  process.exit(1);
}

const supabaseHost = new URL(env.NEXT_PUBLIC_SUPABASE_URL).host;
if (env.LINK_TEST_CONFIRM !== supabaseHost) {
  console.error(
    `Este script cambia la cuenta de cobro de un docente en ${supabaseHost}.\n` +
      `Confirmalo repitiendo el host: LINK_TEST_CONFIRM=${supabaseHost}`,
  );
  process.exit(1);
}

const key = Buffer.from(env.MERCADOPAGO_TOKEN_ENCRYPTION_KEY, "base64");
if (key.length !== 32) {
  console.error("MERCADOPAGO_TOKEN_ENCRYPTION_KEY tiene que ser de 32 bytes en base64.");
  process.exit(1);
}

// Mismo formato que `src/lib/payments/token-crypto.ts` (AES-256-GCM, `v1.<iv>.<tag>.<texto>`, la fila como aad).
function encryptToken(plaintext, aad) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(aad, "utf8"));
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), ciphertext.toString("base64url")].join(".");
}
const tokenAad = (tutorId, kind) => `mp_credentials:${tutorId}:${kind}`;

const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function findUserIdByEmail(email) {
  for (let page = 1; ; page++) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    const user = data.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
    if (user) return user.id;
    if (data.users.length < 200) return null;
  }
}

// 1. De qué cuenta son las credenciales: los avisos de pago llegan con ese `user_id`.
const me = await fetch("https://api.mercadopago.com/users/me", { headers: { Authorization: `Bearer ${accessToken}` } });
if (!me.ok) {
  console.error(`Mercado Pago rechazó el token de prueba (GET /users/me respondió ${me.status}).`);
  process.exit(1);
}
const mpUserId = String((await me.json()).id);

// 2. El docente.
const tutorId = await findUserIdByEmail(env.TUTOR_EMAIL.trim());
if (!tutorId) {
  console.error(`No hay ninguna cuenta con el email ${env.TUTOR_EMAIL}.`);
  process.exit(1);
}

// 3. Guardar. Las credenciales de prueba no tienen refresh_token: se guarda uno de relleno y un vencimiento a
//    90 días, fuera de la ventana de renovación (30 días). No hace falta renovarlas para probar.
const { error } = await supabase.rpc("save_mp_credentials", {
  p_tutor_id: tutorId,
  p_mp_user_id: mpUserId,
  p_access_token: encryptToken(accessToken, tokenAad(tutorId, "access")),
  p_refresh_token: encryptToken("sin-refresh-token", tokenAad(tutorId, "refresh")),
  p_public_key: publicKey,
  p_expires_at: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString(),
  p_live_mode: false,
});
if (error) {
  console.error(`No se pudo guardar la cuenta de cobro: ${error.hint ?? error.message}`);
  process.exit(1);
}

console.log(`Listo: ${env.TUTOR_EMAIL} cobra con las credenciales de prueba de la cuenta ${mpUserId}.`);
