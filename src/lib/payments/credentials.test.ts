import { describe, expect, it } from "vitest";
import { fakeRpc } from "@/test/payments-kit";
import { CredentialsError, rotateSellerCredentials, saveSellerCredentials } from "./credentials";
import type { OAuthTokens } from "./mercadopago/client";
import { decryptToken, tokenAad } from "./token-crypto";

const KEY = Buffer.alloc(32, 9);
const TUTOR = "d1000000-0000-4000-8000-000000000001";
const OTHER_TUTOR = "d2000000-0000-4000-8000-000000000002";
const ACCESS = "APP_USR-acceso-secreto-1234";
const REFRESH = "TG-renovacion-secreta-5678";
const EXPIRES = new Date("2027-04-09T12:00:00.000Z");

const tokens: OAuthTokens = {
  accessToken: ACCESS,
  refreshToken: REFRESH,
  mpUserId: "224438158",
  publicKey: "APP_USR-publica",
  liveMode: false,
  expiresAt: EXPIRES,
};

const rejection = (hint: string | null) => ({ error: { message: "texto de la base que no se muestra: 224438158", hint } });

describe("saveSellerCredentials", () => {
  it("llama a save_mp_credentials con los tokens CIFRADOS y atados al docente", async () => {
    const { db, of } = fakeRpc();
    await saveSellerCredentials(db, { tutorId: TUTOR, tokens, key: KEY });

    const [call] = of("save_mp_credentials");
    expect(call.args).toMatchObject({
      p_tutor_id: TUTOR,
      p_mp_user_id: "224438158",
      p_public_key: "APP_USR-publica",
      p_expires_at: "2027-04-09T12:00:00.000Z",
      p_live_mode: false,
    });
    // Los tokens en claro no viajan a la base.
    expect(JSON.stringify(call.args)).not.toContain(ACCESS);
    expect(JSON.stringify(call.args)).not.toContain(REFRESH);
    expect(call.args.p_access_token).toMatch(/^v1\./);
    expect(call.args.p_refresh_token).toMatch(/^v1\./);
    // Con la clave y el docente correctos se recuperan; con otro docente o el otro tipo, no.
    expect(decryptToken(call.args.p_access_token as string, KEY, tokenAad(TUTOR, "access"))).toBe(ACCESS);
    expect(decryptToken(call.args.p_refresh_token as string, KEY, tokenAad(TUTOR, "refresh"))).toBe(REFRESH);
    expect(() => decryptToken(call.args.p_access_token as string, KEY, tokenAad(OTHER_TUTOR, "access"))).toThrow();
    expect(() => decryptToken(call.args.p_access_token as string, KEY, tokenAad(TUTOR, "refresh"))).toThrow();
  });

  it("pasa null cuando Mercado Pago no informó la clave pública ni el modo", async () => {
    const { db, of } = fakeRpc();
    await saveSellerCredentials(db, { tutorId: TUTOR, tokens: { ...tokens, publicKey: null, liveMode: null }, key: KEY });
    expect(of("save_mp_credentials")[0].args).toMatchObject({ p_public_key: null, p_live_mode: null });
  });

  it.each([
    "not_a_tutor",
    "invalid_credentials",
    "account_already_linked",
    "has_active_bookings",
    "has_pending_refunds",
  ])("traduce el hint %s a un error tipado", async (hint) => {
    const { db } = fakeRpc({ save_mp_credentials: rejection(hint) });
    const error = await saveSellerCredentials(db, { tutorId: TUTOR, tokens, key: KEY }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(CredentialsError);
    expect((error as CredentialsError).reason).toBe(hint);
  });

  it("un error sin hint conocido es «unavailable» y no filtra nada de la base ni de los tokens", async () => {
    for (const hint of [null, "otra_cosa", ""]) {
      const { db } = fakeRpc({ save_mp_credentials: rejection(hint) });
      const error = (await saveSellerCredentials(db, { tutorId: TUTOR, tokens, key: KEY }).catch((e: unknown) => e)) as CredentialsError;
      expect(error.reason).toBe("unavailable");
      expect(error.message).not.toContain("224438158");
      expect(error.message).not.toContain(ACCESS);
      expect(error.message).not.toContain(REFRESH);
    }
  });

  it("un hint de otra función (not_linked) no se toma como propio", async () => {
    const { db } = fakeRpc({ save_mp_credentials: rejection("not_linked") });
    const error = (await saveSellerCredentials(db, { tutorId: TUTOR, tokens, key: KEY }).catch((e: unknown) => e)) as CredentialsError;
    expect(error.reason).toBe("unavailable");
  });

  it("un vencimiento inválido se rechaza sin llamar a la base", async () => {
    const { db, calls } = fakeRpc();
    const error = (await saveSellerCredentials(db, { tutorId: TUTOR, tokens: { ...tokens, expiresAt: new Date("no") }, key: KEY }).catch(
      (e: unknown) => e,
    )) as CredentialsError;
    expect(error.reason).toBe("invalid_credentials");
    expect(calls).toHaveLength(0);
  });
});

describe("rotateSellerCredentials", () => {
  const input = { tutorId: TUTOR, accessToken: ACCESS, refreshToken: REFRESH, expiresAt: EXPIRES, key: KEY };

  it("llama a rotate_mp_tokens con los tokens cifrados y sin tocar la cuenta", async () => {
    const { db, of } = fakeRpc();
    await rotateSellerCredentials(db, input);

    const [call] = of("rotate_mp_tokens");
    expect(Object.keys(call.args).sort()).toEqual(["p_access_token", "p_expires_at", "p_refresh_token", "p_tutor_id"]);
    expect(call.args.p_expires_at).toBe("2027-04-09T12:00:00.000Z");
    expect(JSON.stringify(call.args)).not.toContain(ACCESS);
    expect(JSON.stringify(call.args)).not.toContain(REFRESH);
    expect(decryptToken(call.args.p_access_token as string, KEY, tokenAad(TUTOR, "access"))).toBe(ACCESS);
    expect(decryptToken(call.args.p_refresh_token as string, KEY, tokenAad(TUTOR, "refresh"))).toBe(REFRESH);
  });

  it.each(["not_linked", "invalid_credentials"])("traduce el hint %s", async (hint) => {
    const { db } = fakeRpc({ rotate_mp_tokens: rejection(hint) });
    const error = (await rotateSellerCredentials(db, input).catch((e: unknown) => e)) as CredentialsError;
    expect(error).toBeInstanceOf(CredentialsError);
    expect(error.reason).toBe(hint);
  });

  it("los hints que solo tiene save_mp_credentials no valen acá", async () => {
    const { db } = fakeRpc({ rotate_mp_tokens: rejection("account_already_linked") });
    const error = (await rotateSellerCredentials(db, input).catch((e: unknown) => e)) as CredentialsError;
    expect(error.reason).toBe("unavailable");
  });
});
