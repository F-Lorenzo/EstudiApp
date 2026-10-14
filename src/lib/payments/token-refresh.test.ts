import { describe, expect, it, vi } from "vitest";
import { chain } from "@/test/fake-supabase";
import { fakeRpc, type RpcHandler } from "@/test/payments-kit";
import type { OAuthTokens } from "./mercadopago/client";
import { MercadoPagoError } from "./mercadopago/errors";
import { decryptToken, encryptToken, tokenAad } from "./token-crypto";
import { refreshExpiringTokens, TokenRefreshError, type TokenRefreshDeps } from "./token-refresh";

const KEY = Buffer.alloc(32, 3);
const NOW = new Date("2026-10-11T15:00:00.000Z");
const DAY = 86_400_000;
const inDays = (days: number) => new Date(NOW.getTime() + days * DAY).toISOString();

const NEW_ACCESS = "APP_USR-acceso-NUEVO";
const NEW_REFRESH = "TG-renovacion-NUEVA";

function row(tutorId: string, { expires = inDays(10), mpUserId = `mp-${tutorId}`, refresh = `refresh-viejo-${tutorId}`, key = KEY } = {}) {
  return {
    tutor_id: tutorId,
    mp_user_id: mpUserId,
    refresh_token: encryptToken(refresh, key, tokenAad(tutorId, "refresh")),
    expires_at: expires,
  };
}

const newTokens = (mpUserId: string, overrides: Partial<OAuthTokens> = {}): OAuthTokens => ({
  accessToken: NEW_ACCESS,
  refreshToken: NEW_REFRESH,
  mpUserId,
  publicKey: null,
  liveMode: null,
  expiresAt: new Date(NOW.getTime() + 180 * DAY),
  ...overrides,
});

const http = (status: number, retryable = status >= 500 || status === 429 || status === 408) =>
  new MercadoPagoError(`Mercado Pago respondió ${status}`, { kind: "http", status, retryable });

type Row = ReturnType<typeof row>;

function setup({
  upcoming = [],
  expired = [],
  refresh,
  rpc = {},
  selectError,
}: {
  upcoming?: Row[];
  expired?: Row[];
  refresh?: (token: string, row: Row) => Promise<OAuthTokens> | OAuthTokens;
  rpc?: Record<string, RpcHandler>;
  selectError?: boolean;
}) {
  const upcomingQuery = chain(selectError ? { data: null, error: { message: "falló" } } : { data: upcoming });
  const expiredQuery = chain({ data: expired });
  const pending = [upcomingQuery, expiredQuery];
  const kit = fakeRpc(rpc);
  const from = vi.fn(() => pending.shift() ?? chain({ data: [] }));
  const all = [...upcoming, ...expired];
  const refreshAccessToken = vi.fn(async (token: string) => {
    const owner = all.find((candidate) => candidate.refresh_token && token.endsWith(candidate.tutor_id));
    if (!refresh || !owner) throw new Error("refreshAccessToken sin configurar");
    return refresh(token, owner);
  });
  const deps: TokenRefreshDeps = {
    db: { from, rpc: kit.db.rpc } as unknown as TokenRefreshDeps["db"],
    client: { refreshAccessToken },
    key: KEY,
    now: NOW,
  };
  return { deps, from, refreshAccessToken, rpcCalls: kit.of, upcomingQuery, expiredQuery };
}

const ok = (_token: string, owner: Row) => newTokens(owner.mp_user_id);

describe("refreshExpiringTokens · qué credenciales revisa", () => {
  it("pide primero las que vencen dentro de la ventana (30 días), de la más urgente a la menos, y después las ya vencidas", async () => {
    const { deps, from, upcomingQuery, expiredQuery } = setup({});

    await refreshExpiringTokens({ ...deps, limit: 10 });

    expect(from).toHaveBeenCalledTimes(2);
    expect(from).toHaveBeenNthCalledWith(1, "mp_credentials");
    expect(from).toHaveBeenNthCalledWith(2, "mp_credentials");
    expect(upcomingQuery.calls).toEqual([
      ["select", ["tutor_id, mp_user_id, refresh_token, expires_at"]],
      ["gt", ["expires_at", NOW.toISOString()]],
      ["lte", ["expires_at", inDays(30)]],
      ["order", ["expires_at", { ascending: true }]],
      ["limit", [10]],
    ]);
    expect(expiredQuery.calls).toEqual([
      ["select", ["tutor_id, mp_user_id, refresh_token, expires_at"]],
      ["lte", ["expires_at", NOW.toISOString()]],
      ["order", ["expires_at", { ascending: false }]],
      ["limit", [10]],
    ]);
  });

  it("respeta la ventana y el límite que se le pasan, y no mira las vencidas si el límite ya se llenó", async () => {
    const { deps, from, upcomingQuery } = setup({ upcoming: [row("t1"), row("t2")], refresh: ok });

    const report = await refreshExpiringTokens({ ...deps, windowDays: 7, limit: 2 });

    expect(upcomingQuery.calls).toContainEqual(["lte", ["expires_at", inDays(7)]]);
    expect(from).toHaveBeenCalledTimes(1);
    expect(report).toMatchObject({ checked: 2, renewed: 2 });
  });

  it("a las vencidas les deja el cupo que sobra del límite", async () => {
    const { deps, expiredQuery } = setup({ upcoming: [row("t1")], refresh: ok });

    await refreshExpiringTokens({ ...deps, limit: 5 });

    expect(expiredQuery.calls).toContainEqual(["limit", [4]]);
  });

  it("sin nada para renovar devuelve un informe vacío y no llama a Mercado Pago", async () => {
    const { deps, refreshAccessToken } = setup({});
    expect(await refreshExpiringTokens(deps)).toEqual({ checked: 0, renewed: 0, failed: [] });
    expect(refreshAccessToken).not.toHaveBeenCalled();
  });

  it("si no puede leer las credenciales, lanza un error sin detalles", async () => {
    const { deps } = setup({ selectError: true });
    const error = await refreshExpiringTokens(deps).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(TokenRefreshError);
    expect((error as Error).message).not.toContain("falló");
  });

  it("si las filas no tienen la forma esperada, lanza en vez de seguir a ciegas", async () => {
    const { deps, from } = setup({});
    from.mockReturnValueOnce(chain({ data: [{ tutor_id: "t1" }] }));
    await expect(refreshExpiringTokens(deps)).rejects.toBeInstanceOf(TokenRefreshError);
  });
});

describe("refreshExpiringTokens · renovar", () => {
  it("renueva con el refresh_token DESCIFRADO y guarda los nuevos cifrados, atados a ese docente", async () => {
    const { deps, refreshAccessToken, rpcCalls } = setup({ upcoming: [row("t1")], refresh: ok });

    const report = await refreshExpiringTokens(deps);

    expect(report).toEqual({ checked: 1, renewed: 1, failed: [] });
    expect(refreshAccessToken).toHaveBeenCalledTimes(1);
    expect(refreshAccessToken).toHaveBeenCalledWith("refresh-viejo-t1");

    const [save] = rpcCalls("rotate_mp_tokens");
    expect(save.args.p_tutor_id).toBe("t1");
    expect(save.args.p_expires_at).toBe(new Date(NOW.getTime() + 180 * DAY).toISOString());
    expect(JSON.stringify(save.args)).not.toContain(NEW_ACCESS);
    expect(JSON.stringify(save.args)).not.toContain(NEW_REFRESH);
    expect(decryptToken(save.args.p_access_token as string, KEY, tokenAad("t1", "access"))).toBe(NEW_ACCESS);
    expect(decryptToken(save.args.p_refresh_token as string, KEY, tokenAad("t1", "refresh"))).toBe(NEW_REFRESH);
  });

  it("renueva a todos, uno por uno", async () => {
    const { deps, refreshAccessToken, rpcCalls } = setup({ upcoming: [row("t1"), row("t2"), row("t3")], refresh: ok });
    const report = await refreshExpiringTokens(deps);
    expect(report.renewed).toBe(3);
    expect(refreshAccessToken.mock.calls.map(([token]) => token)).toEqual(["refresh-viejo-t1", "refresh-viejo-t2", "refresh-viejo-t3"]);
    expect(rpcCalls("rotate_mp_tokens").map((call) => call.args.p_tutor_id)).toEqual(["t1", "t2", "t3"]);
  });

  it("el fallo de un docente no frena a los demás", async () => {
    const { deps, rpcCalls } = setup({
      upcoming: [row("t1"), row("t2"), row("t3")],
      refresh: (_token, owner) => {
        if (owner.tutor_id === "t2") throw http(400);
        return newTokens(owner.mp_user_id);
      },
    });

    const report = await refreshExpiringTokens(deps);

    expect(report).toEqual({
      checked: 3,
      renewed: 2,
      failed: [{ tutorId: "t2", reason: "rechazado_por_mercadopago" }],
    });
    expect(rpcCalls("rotate_mp_tokens").map((call) => call.args.p_tutor_id)).toEqual(["t1", "t3"]);
  });

  it("un error inesperado de Mercado Pago de un docente tampoco frena a los demás", async () => {
    const { deps } = setup({
      upcoming: [row("t1"), row("t2")],
      refresh: (_token, owner) => {
        if (owner.tutor_id === "t1") throw new TypeError("algo raro");
        return newTokens(owner.mp_user_id);
      },
    });
    expect(await refreshExpiringTokens(deps)).toMatchObject({ renewed: 1, failed: [{ tutorId: "t1", reason: "mercadopago_no_disponible" }] });
  });
});

describe("refreshExpiringTokens · fallas", () => {
  it.each([
    [400, "rechazado_por_mercadopago"],
    [401, "rechazado_por_mercadopago"],
    [403, "rechazado_por_mercadopago"],
    [429, "mercadopago_no_disponible"],
    [500, "mercadopago_no_disponible"],
    [503, "mercadopago_no_disponible"],
  ])("Mercado Pago responde %s → %s, sin guardar nada y SIN reintentar", async (status, reason) => {
    const { deps, refreshAccessToken, rpcCalls } = setup({
      upcoming: [row("t1")],
      refresh: () => {
        throw http(status);
      },
    });

    const report = await refreshExpiringTokens(deps);

    expect(report).toEqual({ checked: 1, renewed: 0, failed: [{ tutorId: "t1", reason }] });
    // Un solo pedido: si la respuesta se perdió, reintentar con el refresh_token viejo puede fallar.
    expect(refreshAccessToken).toHaveBeenCalledTimes(1);
    expect(rpcCalls("rotate_mp_tokens")).toHaveLength(0);
  });

  it.each(["network", "timeout"] as const)("una falla de red (%s) se informa como Mercado Pago no disponible", async (kind) => {
    const { deps, refreshAccessToken } = setup({
      upcoming: [row("t1")],
      refresh: () => {
        throw new MercadoPagoError("sin respuesta", { kind, retryable: true });
      },
    });
    expect((await refreshExpiringTokens(deps)).failed).toEqual([{ tutorId: "t1", reason: "mercadopago_no_disponible" }]);
    expect(refreshAccessToken).toHaveBeenCalledTimes(1);
  });

  it("un refresh_token que no se puede descifrar (otra clave) se informa y no se manda a Mercado Pago", async () => {
    const { deps, refreshAccessToken } = setup({
      upcoming: [row("t1", { key: Buffer.alloc(32, 99) }), row("t2")],
      refresh: ok,
    });
    const report = await refreshExpiringTokens(deps);
    expect(report.failed).toEqual([{ tutorId: "t1", reason: "token_ilegible" }]);
    expect(report.renewed).toBe(1);
    expect(refreshAccessToken).toHaveBeenCalledTimes(1);
  });

  it("un token copiado de otro docente no se descifra", async () => {
    const stolen = { ...row("t1"), refresh_token: row("t2").refresh_token };
    const { deps, refreshAccessToken } = setup({ upcoming: [stolen], refresh: ok });
    expect((await refreshExpiringTokens(deps)).failed).toEqual([{ tutorId: "t1", reason: "token_ilegible" }]);
    expect(refreshAccessToken).not.toHaveBeenCalled();
  });

  it("si Mercado Pago devuelve tokens de OTRA cuenta no los guarda", async () => {
    const { deps, rpcCalls } = setup({
      upcoming: [row("t1")],
      refresh: () => newTokens("otra-cuenta"),
    });
    expect((await refreshExpiringTokens(deps)).failed).toEqual([{ tutorId: "t1", reason: "cuenta_distinta" }]);
    expect(rpcCalls("rotate_mp_tokens")).toHaveLength(0);
  });
});

describe("refreshExpiringTokens · tokens ya vencidos", () => {
  it("uno que venció hace poco todavía se intenta renovar, y si Mercado Pago lo acepta queda renovado", async () => {
    const { deps, refreshAccessToken } = setup({ expired: [row("t1", { expires: inDays(-1) })], refresh: ok });
    expect(await refreshExpiringTokens(deps)).toEqual({ checked: 1, renewed: 1, failed: [] });
    expect(refreshAccessToken).toHaveBeenCalledTimes(1);
  });

  it("uno vencido que Mercado Pago rechaza se informa como «requiere_vincular»", async () => {
    const { deps, rpcCalls } = setup({
      expired: [row("t1", { expires: inDays(-2) })],
      refresh: () => {
        throw http(400);
      },
    });
    expect((await refreshExpiringTokens(deps)).failed).toEqual([{ tutorId: "t1", reason: "requiere_vincular" }]);
    expect(rpcCalls("rotate_mp_tokens")).toHaveLength(0);
  });

  it("uno vencido cuando Mercado Pago no responde NO se da por perdido: se reintenta en el próximo barrido", async () => {
    const { deps } = setup({
      expired: [row("t1", { expires: inDays(-2) })],
      refresh: () => {
        throw http(503);
      },
    });
    expect((await refreshExpiringTokens(deps)).failed).toEqual([{ tutorId: "t1", reason: "mercadopago_no_disponible" }]);
  });

  it("uno que venció hace más de una semana se informa como «requiere_vincular» sin gastar un pedido", async () => {
    const { deps, refreshAccessToken } = setup({ expired: [row("t1", { expires: inDays(-8) })], refresh: ok });
    expect(await refreshExpiringTokens(deps)).toEqual({
      checked: 1,
      renewed: 0,
      failed: [{ tutorId: "t1", reason: "requiere_vincular" }],
    });
    expect(refreshAccessToken).not.toHaveBeenCalled();
  });

  it("justo en el borde de la semana todavía se intenta", async () => {
    const { deps, refreshAccessToken } = setup({ expired: [row("t1", { expires: inDays(-7) })], refresh: ok });
    expect((await refreshExpiringTokens(deps)).renewed).toBe(1);
    expect(refreshAccessToken).toHaveBeenCalledTimes(1);
  });
});

describe("refreshExpiringTokens · guardar lo renovado", () => {
  const unavailable: RpcHandler = () => ({ error: { message: "la base no respondió", hint: null } });

  it("si la base no responde, guardar se prueba una vez más (es idempotente) y se completa", async () => {
    let calls = 0;
    const { deps, refreshAccessToken, rpcCalls } = setup({
      upcoming: [row("t1")],
      refresh: ok,
      rpc: { rotate_mp_tokens: () => (++calls === 1 ? { error: { message: "x", hint: null } } : {}) },
    });
    expect(await refreshExpiringTokens(deps)).toMatchObject({ renewed: 1, failed: [] });
    expect(rpcCalls("rotate_mp_tokens")).toHaveLength(2);
    // Lo que se reintenta es guardar, nunca el canje en Mercado Pago.
    expect(refreshAccessToken).toHaveBeenCalledTimes(1);
  });

  it("si sigue sin responder se informa «guardado_fallido» después de dos intentos", async () => {
    const { deps, refreshAccessToken, rpcCalls } = setup({ upcoming: [row("t1")], refresh: ok, rpc: { rotate_mp_tokens: unavailable } });
    expect((await refreshExpiringTokens(deps)).failed).toEqual([{ tutorId: "t1", reason: "guardado_fallido" }]);
    expect(rpcCalls("rotate_mp_tokens")).toHaveLength(2);
    expect(refreshAccessToken).toHaveBeenCalledTimes(1);
  });

  it("si el docente desvinculó mientras tanto se informa «ya_no_vinculada» y no se reintenta", async () => {
    const { deps, rpcCalls } = setup({
      upcoming: [row("t1")],
      refresh: ok,
      rpc: { rotate_mp_tokens: () => ({ error: { message: "x", hint: "not_linked" } }) },
    });
    expect((await refreshExpiringTokens(deps)).failed).toEqual([{ tutorId: "t1", reason: "ya_no_vinculada" }]);
    expect(rpcCalls("rotate_mp_tokens")).toHaveLength(1);
  });

  it("si la base rechaza los datos (invalid_credentials) no se reintenta: daría lo mismo", async () => {
    const { deps, rpcCalls } = setup({
      upcoming: [row("t1")],
      refresh: ok,
      rpc: { rotate_mp_tokens: () => ({ error: { message: "x", hint: "invalid_credentials" } }) },
    });
    expect((await refreshExpiringTokens(deps)).failed).toEqual([{ tutorId: "t1", reason: "guardado_fallido" }]);
    expect(rpcCalls("rotate_mp_tokens")).toHaveLength(1);
  });
});

describe("refreshExpiringTokens · el informe no filtra secretos", () => {
  it("no incluye tokens, cuentas de Mercado Pago ni textos de error, ni en éxito ni en falla", async () => {
    const { deps } = setup({
      upcoming: [row("t1", { mpUserId: "224438158" }), row("t2", { mpUserId: "999888777" }), row("t3", { key: Buffer.alloc(32, 1) })],
      refresh: (_token, owner) => {
        if (owner.tutor_id === "t2") throw new MercadoPagoError("Mercado Pago respondió 400 (invalid_grant): token TG-secreto", { kind: "http", status: 400, retryable: false });
        return newTokens(owner.mp_user_id);
      },
    });
    const text = JSON.stringify(await refreshExpiringTokens(deps));
    for (const secret of [NEW_ACCESS, NEW_REFRESH, "refresh-viejo", "224438158", "999888777", "invalid_grant", "TG-secreto", "v1."]) {
      expect(text).not.toContain(secret);
    }
  });
});
