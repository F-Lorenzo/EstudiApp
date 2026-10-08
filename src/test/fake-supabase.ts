import { vi } from "vitest";

/**
 * Un cliente de Supabase simulado para probar las acciones del servidor sin red ni base.
 *
 * - `from(tabla)` devuelve una consulta encadenable: cualquier método (`select`, `eq`, `update`...)
 *   devuelve la misma consulta, y al esperarla (`await`) resuelve con el resultado configurado.
 *   Todas las llamadas quedan registradas para poder comprobar QUÉ se le pidió a la base.
 * - `rpc(nombre, args)` resuelve con el resultado configurado para esa función.
 */
type Result = { data?: unknown; error?: unknown };
export type RecordedCall = [method: string, args: unknown[]];

export function chain(result: Result = { data: null, error: null }) {
  const calls: RecordedCall[] = [];
  const proxy: unknown = new Proxy(
    {},
    {
      get(_target, property) {
        if (property === "then") {
          return (resolve: (value: Result) => unknown, reject: (reason: unknown) => unknown) =>
            Promise.resolve({ data: null, error: null, ...result }).then(resolve, reject);
        }
        if (property === "calls") return calls;
        return (...args: unknown[]) => {
          calls.push([String(property), args]);
          return proxy;
        };
      },
    },
  );
  return proxy as Record<string, (...args: unknown[]) => unknown> & { calls: RecordedCall[] };
}

type Config = {
  user?: { id: string; email?: string } | null;
  /** Resultado de cada tabla; si no está configurada, devuelve `{ data: null, error: null }`. */
  tables?: Record<string, Result>;
  /** Resultado de cada función `rpc`. */
  rpc?: Record<string, Result>;
  signIn?: Result;
};

export function fakeSupabase(config: Config = {}) {
  const queries: { table: string; query: ReturnType<typeof chain> }[] = [];
  const client = {
    auth: {
      getUser: vi.fn(async () => ({ data: { user: config.user ?? null }, error: null })),
      signInWithPassword: vi.fn(async () => config.signIn ?? { data: { user: config.user }, error: null }),
    },
    from: vi.fn((table: string) => {
      const query = chain(config.tables?.[table]);
      queries.push({ table, query });
      return query;
    }),
    rpc: vi.fn(async (name: string) => ({ data: null, error: null, ...config.rpc?.[name] })),
  };
  return {
    client,
    /** Consultas hechas sobre una tabla, en orden. */
    on: (table: string) => queries.filter((q) => q.table === table).map((q) => q.query),
  };
}

/** `redirect()` de Next lanza un error especial; las pruebas lo atrapan para leer el destino. */
export class RedirectSignal extends Error {
  constructor(public readonly url: string) {
    super(`NEXT_REDIRECT ${url}`);
  }
}

export async function catchRedirect(run: () => Promise<unknown>) {
  try {
    await run();
  } catch (error) {
    if (error instanceof RedirectSignal) return error.url;
    throw error;
  }
  return null;
}
