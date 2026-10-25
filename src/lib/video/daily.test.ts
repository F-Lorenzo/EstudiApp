import { describe, expect, it, vi } from "vitest";
import { DailyClient, DailyError, roomNameFor } from "./daily";

const KEY = "daily-secreta-123";
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

function setup(steps: Response[]) {
  const queue = [...steps];
  const calls: { url: string; init: RequestInit & { headers: Record<string, string> } }[] = [];
  const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init as RequestInit & { headers: Record<string, string> } });
    const step = queue.shift();
    if (!step) throw new Error("fetch de más");
    return step;
  });
  return { client: new DailyClient({ apiKey: KEY, fetch: fetchMock as unknown as typeof fetch }), calls };
}

const opensAt = new Date("2026-10-24T12:50:00.000Z");
const closesAt = new Date("2026-10-24T14:10:00.000Z");
const room = { name: "estudiapp-b1", url: "https://estudiapp.daily.co/estudiapp-b1", privacy: "private" };

describe("nombre de la sala", () => {
  it("es fijo por reserva y solo usa caracteres que Daily acepta", () => {
    expect(roomNameFor("B0000000-0000-4000-8000-000000000001")).toBe("estudiapp-b0000000000040008000000000000001");
  });
});

describe("la sala de la clase", () => {
  it("si ya existe, la reusa", async () => {
    const { client, calls } = setup([json(room)]);
    await expect(client.ensureRoom({ name: room.name, opensAt, closesAt })).resolves.toEqual({ name: room.name, url: room.url });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(`https://api.daily.co/v1/rooms/${room.name}`);
    expect(calls[0].init.headers.Authorization).toBe(`Bearer ${KEY}`);
  });

  it("si no existe, la crea privada, para dos personas, sin grabación y con la ventana de la clase", async () => {
    const { client, calls } = setup([json({ error: "not-found" }, 404), json(room)]);
    await client.ensureRoom({ name: room.name, opensAt, closesAt });
    expect(calls[1].init.method).toBe("POST");
    const body = JSON.parse(String(calls[1].init.body));
    expect(body).toMatchObject({
      name: room.name,
      privacy: "private",
      properties: { nbf: opensAt.getTime() / 1000, exp: closesAt.getTime() / 1000, eject_at_room_exp: true, max_participants: 2 },
    });
    expect(JSON.stringify(body)).not.toMatch(/record/);
  });

  it("si otra persona la creó al mismo tiempo, la vuelve a buscar", async () => {
    const { client, calls } = setup([json({}, 404), json({ info: "a room named estudiapp-b1 already exists" }, 400), json(room)]);
    await expect(client.ensureRoom({ name: room.name, opensAt, closesAt })).resolves.toMatchObject({ url: room.url });
    expect(calls).toHaveLength(3);
  });

  it("rechaza un nombre inválido sin llamar a Daily", async () => {
    const { client, calls } = setup([]);
    await expect(client.ensureRoom({ name: "../otra", opensAt, closesAt })).rejects.toBeInstanceOf(DailyError);
    expect(calls).toHaveLength(0);
  });

  it("un error no lleva la clave", async () => {
    const { client } = setup([json({ error: "authentication-error" }, 401)]);
    const error = await client.ensureRoom({ name: room.name, opensAt, closesAt }).catch((e: unknown) => e);
    expect(error).toMatchObject({ status: 401 });
    expect(String((error as Error).message)).not.toContain(KEY);
  });
});

describe("el token de la reunión", () => {
  it("es personal, vale en la ventana de la clase y expulsa al vencer; solo el docente es dueño", async () => {
    const { client, calls } = setup([json({ token: "tok-1" })]);
    const token = await client.createMeetingToken({ roomName: room.name, userName: "Sofía", userId: "a1", isOwner: false, opensAt, closesAt });
    expect(token).toBe("tok-1");
    expect(JSON.parse(String(calls[0].init.body)).properties).toMatchObject({
      room_name: room.name,
      user_name: "Sofía",
      user_id: "a1",
      is_owner: false,
      nbf: opensAt.getTime() / 1000,
      exp: closesAt.getTime() / 1000,
      eject_at_token_exp: true,
    });
  });
});

describe("la asistencia de la sala", () => {
  const since = new Date("2026-10-24T12:50:00.000Z");
  const meetings = {
    total_count: 1,
    data: [
      {
        id: "m1",
        room: room.name,
        start_time: 1761310300,
        duration: 3600,
        ongoing: false,
        participants: [{ user_id: "d1", participant_id: "p1", user_name: "María", join_time: 1761310300, duration: 3500 }],
      },
    ],
  };

  it("pide las sesiones de esa sala desde que abrió", async () => {
    const { client, calls } = setup([json(meetings)]);
    const result = await client.listMeetings({ roomName: room.name, since });
    expect(result[0].participants?.[0]).toEqual({ user_id: "d1", join_time: 1761310300, duration: 3500 });
    const url = new URL(calls[0].url);
    expect(url.pathname).toBe("/v1/meetings");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      room: room.name,
      timeframe_start: String(Math.floor(since.getTime() / 1000)),
      limit: "100",
    });
  });

  it("una sala sin sesiones (nadie entró) devuelve una lista vacía", async () => {
    expect(await setup([json({ total_count: 0, data: [] })]).client.listMeetings({ roomName: room.name, since })).toEqual([]);
    expect(await setup([json({ error: "not-found" }, 404)]).client.listMeetings({ roomName: room.name, since })).toEqual([]);
  });

  it("un error de Daily se informa (no se toma como «nadie entró»)", async () => {
    await expect(setup([json({}, 500)]).client.listMeetings({ roomName: room.name, since })).rejects.toBeInstanceOf(DailyError);
    await expect(setup([json({ nada: true })]).client.listMeetings({ roomName: room.name, since })).rejects.toBeInstanceOf(DailyError);
  });
});
