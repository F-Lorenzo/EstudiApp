import { z } from "zod";

/**
 * Cliente mínimo de la API de Daily.co (https://docs.daily.co/reference/rest-api) para las salas de clase.
 *
 *  - Cada reserva tiene UNA sala privada con un nombre fijo (`roomNameFor`): se crea la primera vez que alguien entra
 *    y las siguientes se reusa. Privada quiere decir que sin un token de reunión no se entra, aunque se conozca la
 *    dirección.
 *  - El token es personal (nombre de quien entra), vale solo dentro del horario de la clase y expulsa al vencer.
 *  - Las clases NO se graban (decisión del 23 de octubre de 2026): ni la sala ni el token habilitan la grabación.
 *
 * La clave (`DAILY_API_KEY`) es solo de servidor. Ningún mensaje de error lleva la clave ni el token.
 */

const API_BASE = "https://api.daily.co/v1";
const DEFAULT_TIMEOUT_MS = 8_000;
// Daily acepta letras, números, `-` y `_`, hasta 128 caracteres.
const ROOM_NAME = /^[A-Za-z0-9_-]{1,128}$/;

export class DailyError extends Error {
  constructor(
    message: string,
    readonly status: number | null = null,
  ) {
    super(message);
    this.name = "DailyError";
  }
}

const roomSchema = z.object({ name: z.string(), url: z.url() });
const tokenSchema = z.object({ token: z.string().min(1) });

export type DailyRoom = z.infer<typeof roomSchema>;

export type DailyClientOptions = {
  apiKey: string;
  fetch?: typeof fetch;
  baseUrl?: string;
  timeoutMs?: number;
};

/** Nombre de la sala de una reserva: siempre el mismo para la misma reserva. */
export function roomNameFor(bookingId: string) {
  return `estudiapp-${bookingId.replace(/[^A-Za-z0-9]/g, "").toLowerCase()}`;
}

const unix = (date: Date) => Math.floor(date.getTime() / 1000);

export class DailyClient {
  private readonly fetchImpl: typeof fetch;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(private readonly options: DailyClientOptions) {
    if (!options.apiKey) throw new DailyError("Falta DAILY_API_KEY.");
    this.fetchImpl = options.fetch ?? ((...args) => fetch(...args));
    this.baseUrl = options.baseUrl ?? API_BASE;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  /**
   * La sala de la clase: la busca y, si no existe, la crea. Se abre (`nbf`) y se cierra (`exp`) con la ventana de
   * la clase; al cerrarse expulsa a quien siga adentro. Como mucho dos personas: alumno y docente.
   */
  async ensureRoom({ name, opensAt, closesAt }: { name: string; opensAt: Date; closesAt: Date }): Promise<DailyRoom> {
    if (!ROOM_NAME.test(name)) throw new DailyError("El nombre de la sala no es válido.");
    const existing = await this.request(`/rooms/${name}`, { method: "GET" }, { allowNotFound: true });
    if (existing !== null) return this.parse(roomSchema, existing);

    const created = await this.request(
      "/rooms",
      {
        method: "POST",
        body: JSON.stringify({
          name,
          privacy: "private",
          properties: {
            nbf: unix(opensAt),
            exp: unix(closesAt),
            eject_at_room_exp: true,
            max_participants: 2,
            enable_chat: true,
            enable_screenshare: true,
            enable_knocking: false,
            enable_prejoin_ui: true,
            lang: "es",
          },
        }),
      },
      // Dos personas entrando a la vez: la segunda puede encontrarse con que la sala ya se creó.
      { allowConflict: true },
    );
    if (created !== null) return this.parse(roomSchema, created);
    return this.parse(roomSchema, await this.request(`/rooms/${name}`, { method: "GET" }));
  }

  /** Token personal para entrar a la sala: vale entre `opensAt` y `closesAt` y expulsa al vencer. */
  async createMeetingToken({
    roomName,
    userName,
    userId,
    isOwner,
    opensAt,
    closesAt,
  }: {
    roomName: string;
    userName: string;
    userId: string;
    /** El docente: puede silenciar o sacar al otro participante si hace falta. */
    isOwner: boolean;
    opensAt: Date;
    closesAt: Date;
  }): Promise<string> {
    const body = await this.request("/meeting-tokens", {
      method: "POST",
      body: JSON.stringify({
        properties: {
          room_name: roomName,
          user_name: userName.slice(0, 100),
          user_id: userId,
          is_owner: isOwner,
          nbf: unix(opensAt),
          exp: unix(closesAt),
          eject_at_token_exp: true,
          lang: "es",
        },
      }),
    });
    return this.parse(tokenSchema, body).token;
  }

  private parse<T>(schema: z.ZodType<T>, body: unknown): T {
    const parsed = schema.safeParse(body);
    if (!parsed.success) throw new DailyError("Daily respondió con un formato inesperado.");
    return parsed.data;
  }

  private async request(
    path: string,
    init: { method: "GET" | "POST"; body?: string },
    { allowNotFound = false, allowConflict = false } = {},
  ): Promise<unknown> {
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        ...init,
        headers: { Authorization: `Bearer ${this.options.apiKey}`, "Content-Type": "application/json", Accept: "application/json" },
        signal: AbortSignal.timeout(this.timeoutMs),
        cache: "no-store",
      });
    } catch {
      throw new DailyError("No pudimos comunicarnos con Daily.");
    }

    if (allowNotFound && response.status === 404) return null;
    const text = await response.text().catch(() => "");
    if (!response.ok) {
      // Daily responde 400 con `info: "... already exists"` cuando la sala ya está creada.
      if (allowConflict && response.status === 400 && /already exists/i.test(text)) return null;
      throw new DailyError(`Daily respondió ${response.status}.`, response.status);
    }
    try {
      return JSON.parse(text);
    } catch {
      throw new DailyError("Daily respondió algo que no se pudo leer.", response.status);
    }
  }
}
