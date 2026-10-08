import { beforeEach, describe, expect, it, vi } from "vitest";
import { catchRedirect, fakeSupabase } from "@/test/fake-supabase";
import { reserveSlot } from "./actions";

const revalidatePath = vi.hoisted(() => vi.fn());
const createClient = vi.hoisted(() => vi.fn());

vi.mock("next/cache", () => ({ revalidatePath }));
vi.mock("next/navigation", async () => {
  const { RedirectSignal } = await import("@/test/fake-supabase");
  return {
    redirect: (url: string) => {
      throw new RedirectSignal(url);
    },
  };
});
vi.mock("@/lib/supabase/server", () => ({ createClient }));

const SLOT = "51000000-0000-4000-8000-000000000001";
const BOOKING = "b0000000-0000-4000-8000-000000000001";

beforeEach(() => {
  revalidatePath.mockReset();
  createClient.mockReset();
});

describe("reserveSlot", () => {
  it("rechaza un identificador que no es un UUID sin llamar a la base", async () => {
    const supabase = fakeSupabase();
    createClient.mockResolvedValue(supabase.client);

    const result = await reserveSlot("no-es-un-uuid");

    expect(result).toEqual({ ok: false, error: expect.stringMatching(/ya no existe/) });
    expect(supabase.client.rpc).not.toHaveBeenCalled();
  });

  it("pide la reserva a create_booking y lleva a la pantalla de pago", async () => {
    const supabase = fakeSupabase({ rpc: { create_booking: { data: BOOKING } } });
    createClient.mockResolvedValue(supabase.client);

    const destino = await catchRedirect(() => reserveSlot(SLOT));

    expect(supabase.client.rpc).toHaveBeenCalledWith("create_booking", { p_slot_id: SLOT });
    expect(destino).toBe(`/alumno/reservas/${BOOKING}`);
  });

  it("si el horario ya lo tomó otra persona, lo dice y vuelve a leer la lista", async () => {
    const supabase = fakeSupabase({
      rpc: { create_booking: { error: { hint: "slot_taken", message: "detalle técnico interno" } } },
    });
    createClient.mockResolvedValue(supabase.client);

    const result = await reserveSlot(SLOT);

    expect(result).toEqual({ ok: false, error: expect.stringMatching(/otra persona/) });
    expect(JSON.stringify(result)).not.toContain("detalle técnico interno");
    expect(revalidatePath).toHaveBeenCalledWith("/alumno/reservar/[id]", "page");
  });

  it("el tope de reservas sin pagar no refresca la lista (no cambió nada)", async () => {
    const supabase = fakeSupabase({ rpc: { create_booking: { error: { hint: "too_many_holds" } } } });
    createClient.mockResolvedValue(supabase.client);

    const result = await reserveSlot(SLOT);

    expect(result).toEqual({ ok: false, error: expect.stringMatching(/sin pagar/) });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("un error inesperado de la base no se muestra tal cual", async () => {
    const supabase = fakeSupabase({
      rpc: { create_booking: { error: { code: "XX000", message: 'relation "bookings" exploded' } } },
    });
    createClient.mockResolvedValue(supabase.client);

    const result = await reserveSlot(SLOT);

    expect(result).toEqual({ ok: false, error: "No pudimos completar la operación. Intentá de nuevo." });
  });
});
