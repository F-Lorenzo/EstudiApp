import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeSupabase } from "@/test/fake-supabase";
import { rateClass } from "./actions";

const revalidatePath = vi.hoisted(() => vi.fn());
const createClient = vi.hoisted(() => vi.fn());
const getViewer = vi.hoisted(() => vi.fn());

vi.mock("next/cache", () => ({ revalidatePath }));
vi.mock("@/lib/supabase/server", () => ({ createClient }));
vi.mock("@/lib/auth/viewer", () => ({ getViewer }));

const BOOKING = "b0000000-0000-4000-8000-000000000001";
const ALUMNO = { id: "a1", name: "Tomás", role: "alumno" };

const form = (fields: Record<string, string>) => {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
};

const completed = {
  id: BOOKING,
  student_id: "a1",
  tutor_id: "d1",
  status: "completada",
  // Terminó hace un rato: dentro de los 30 días.
  ends_at: new Date(Date.now() - 3_600_000).toISOString(),
  ratings: [],
};

beforeEach(() => {
  for (const mock of [revalidatePath, createClient, getViewer]) mock.mockReset();
  getViewer.mockResolvedValue(ALUMNO);
});

describe("rateClass", () => {
  it("sin puntuación no guarda nada y lo dice en el campo", async () => {
    const supabase = fakeSupabase();
    createClient.mockResolvedValue(supabase.client);
    const state = await rateClass(BOOKING, {}, form({ comment: "Hola" }));
    expect(state.fieldErrors?.score).toEqual(["Elegí de 1 a 5 estrellas."]);
    expect(state.values).toEqual({ comment: "Hola" });
    expect(supabase.client.from).not.toHaveBeenCalled();
  });

  it("solo califica un alumno con sesión", async () => {
    getViewer.mockResolvedValueOnce(null);
    expect((await rateClass(BOOKING, {}, form({ score: "5" }))).error).toMatch(/sesión expiró/);
    getViewer.mockResolvedValueOnce({ id: "d1", name: "Docente", role: "docente" });
    expect((await rateClass(BOOKING, {}, form({ score: "5" }))).error).toMatch(/Solo el alumno/);
    expect(createClient).not.toHaveBeenCalled();
  });

  it("guarda y actualiza el historial, la sala y el perfil del docente", async () => {
    const supabase = fakeSupabase({ tables: { bookings: { data: completed } } });
    createClient.mockResolvedValue(supabase.client);
    expect(await rateClass(BOOKING, {}, form({ score: "4", comment: " Muy clara " }))).toEqual({ success: true });
    expect(supabase.on("ratings")[0].calls[0]).toEqual([
      "insert",
      [{ booking_id: BOOKING, student_id: "a1", tutor_id: "d1", score: 4, comment: "Muy clara" }],
    ]);
    expect(revalidatePath).toHaveBeenCalledWith("/alumno/historial");
    expect(revalidatePath).toHaveBeenCalledWith(`/alumno/sala/${BOOKING}`);
    expect(revalidatePath).toHaveBeenCalledWith("/docentes/d1");
  });

  it("si ya la calificó, lo dice", async () => {
    const supabase = fakeSupabase({ tables: { bookings: { data: { ...completed, ratings: [{ score: 3 }] } } } });
    createClient.mockResolvedValue(supabase.client);
    expect((await rateClass(BOOKING, {}, form({ score: "5" }))).error).toBe("Ya calificaste esta clase.");
  });
});
