import { describe, expect, it, vi } from "vitest";
import { enqueueClassReminders } from "./reminders";

describe("enqueueClassReminders", () => {
  it("llama a la base y devuelve cuántos anotó", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: 4, error: null });
    expect(await enqueueClassReminders({ rpc } as never)).toEqual({ queued: 4 });
    expect(rpc).toHaveBeenCalledWith("enqueue_class_reminders");
  });

  it("una respuesta rara cuenta como cero", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: null });
    expect(await enqueueClassReminders({ rpc } as never)).toEqual({ queued: 0 });
  });

  it("si la base falla, lanza (el mantenimiento lo marca como barrido fallido)", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { message: "function does not exist" } });
    await expect(enqueueClassReminders({ rpc } as never)).rejects.toThrow("No se pudieron anotar los recordatorios");
  });
});
