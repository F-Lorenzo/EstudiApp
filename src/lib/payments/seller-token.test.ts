import { randomBytes } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { chain } from "@/test/fake-supabase";
import { SellerTokenError, loadSellerToken } from "./seller-token";
import { encryptToken, tokenAad } from "./token-crypto";

const key = randomBytes(32);
const TUTOR = "d1000000-0000-4000-8000-000000000001";
const NOW = new Date("2026-10-08T12:00:00.000Z");

function dbWith(result: { data?: unknown; error?: unknown }) {
  const query = chain(result);
  return { db: { from: (table: string) => (table === "mp_credentials" ? query : chain()) } as unknown as Pick<SupabaseClient, "from">, query };
}

const row = (overrides: Record<string, unknown> = {}) => ({
  tutor_id: TUTOR,
  access_token: encryptToken("APP_USR-token-real", key, tokenAad(TUTOR, "access")),
  expires_at: "2027-01-01T00:00:00.000Z",
  live_mode: false,
  ...overrides,
});

describe("token de cobro del docente", () => {
  it("busca por la cuenta de Mercado Pago y devuelve el token descifrado", async () => {
    const { db, query } = dbWith({ data: row() });
    await expect(loadSellerToken(db, "111", { key, now: NOW })).resolves.toEqual({
      tutorId: TUTOR,
      accessToken: "APP_USR-token-real",
      liveMode: false,
    });
    expect(query.calls).toContainEqual(["eq", ["mp_user_id", "111"]]);
  });

  it("una cuenta no vinculada es «unknown_seller»", async () => {
    const { db } = dbWith({ data: null });
    await expect(loadSellerToken(db, "111", { key, now: NOW })).rejects.toMatchObject({ reason: "unknown_seller" });
  });

  it("un token vencido es «expired» (hay que renovarlo, no usarlo)", async () => {
    const { db } = dbWith({ data: row({ expires_at: "2026-10-08T12:00:00.000Z" }) });
    await expect(loadSellerToken(db, "111", { key, now: NOW })).rejects.toMatchObject({ reason: "expired" });
  });

  it("si la base falla es «lookup_failed»", async () => {
    const { db } = dbWith({ error: { message: "caída" } });
    await expect(loadSellerToken(db, "111", { key, now: NOW })).rejects.toBeInstanceOf(SellerTokenError);
    await expect(loadSellerToken(db, "111", { key, now: NOW })).rejects.toMatchObject({ reason: "lookup_failed" });
  });

  it("con otra clave de cifrado es «unreadable» y no filtra nada", async () => {
    const { db } = dbWith({ data: row() });
    const error = await loadSellerToken(db, "111", { key: randomBytes(32), now: NOW }).catch((e: unknown) => e);
    expect(error).toMatchObject({ reason: "unreadable" });
    expect(String((error as Error).message)).not.toContain("APP_USR");
  });

  it("un token copiado a la fila de otro docente no se descifra", async () => {
    const { db } = dbWith({ data: row({ tutor_id: "d2000000-0000-4000-8000-000000000002" }) });
    await expect(loadSellerToken(db, "111", { key, now: NOW })).rejects.toMatchObject({ reason: "unreadable" });
  });

  it("un token guardado sin cifrar se rechaza (nunca se usa en claro)", async () => {
    const { db } = dbWith({ data: row({ access_token: "APP_USR-en-claro" }) });
    await expect(loadSellerToken(db, "111", { key, now: NOW })).rejects.toMatchObject({ reason: "unreadable" });
  });
});
