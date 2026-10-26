import { describe, expect, it } from "vitest";
import { fakeSupabase } from "@/test/fake-supabase";
import { getTutorHistory, listAuditLog, toAuditEntry } from "./audit";

const NOW = new Date("2026-10-26T15:00:00Z");
const row = (overrides: Record<string, unknown> = {}) => ({
  id: 7,
  actor_kind: "administracion",
  actor_name: "Ana Admin",
  action: "rechazar",
  target_type: "docente",
  target_id: "d1",
  reason: "Falta el respaldo",
  details: { from: "pendiente", to: "rechazado", tutor_name: "Martín Gómez" },
  created_at: "2026-10-26T12:04:00Z",
  ...overrides,
});

describe("toAuditEntry", () => {
  it("traduce una decisión sobre un perfil", () => {
    expect(toAuditEntry(row(), NOW)).toMatchObject({
      id: "7",
      label: "Rechazó el perfil",
      actor: "Ana Admin",
      reason: "Falta el respaldo",
      target: "Martín Gómez",
      when: "lunes 26 de octubre, 09:04",
      ago: "hoy",
    });
  });

  it("sin nombre, dice quién fue por su tipo", () => {
    expect(toAuditEntry(row({ actor_kind: "sistema", actor_name: null }), NOW)?.actor).toBe("Sistema");
    expect(toAuditEntry(row({ actor_kind: "docente", actor_name: " ", action: "reenviar" }), NOW)).toMatchObject({
      actor: "El docente",
      label: "Reenvió el perfil a revisión",
    });
  });

  it("una clase cancelada muestra quiénes y cuándo", () => {
    const entry = toAuditEntry(
      row({
        action: "cancelar_clase",
        target_type: "reserva",
        details: { student_name: "Lucía Pérez", tutor_name: "Martín Gómez", starts_at: "2026-10-28T21:00:00Z" },
      }),
      NOW,
    );
    expect(entry?.label).toBe("Canceló una clase");
    expect(entry?.target).toBe("Lucía Pérez con Martín Gómez · miércoles 28 de octubre, 18:00");
  });

  it("un cambio de rol dice de qué a qué", () => {
    const entry = toAuditEntry(
      row({ action: "cambiar_rol", target_type: "cuenta", details: { from: "alumno", to: "administrador", account_name: "Tomás" } }),
      NOW,
    );
    expect(entry).toMatchObject({ target: "Tomás", change: "de alumno a administración" });
  });

  it("una fila ilegible se descarta; una acción desconocida se muestra tal cual", () => {
    expect(toAuditEntry({ id: 1 }, NOW)).toBeNull();
    expect(toAuditEntry(row({ action: "nueva_accion" }), NOW)?.label).toBe("nueva_accion");
  });
});

describe("consultas", () => {
  it("el registro se pide de lo más nuevo a lo más viejo, con límite", async () => {
    const supabase = fakeSupabase({ tables: { audit_log: { data: [row(), { basura: true }] } } });
    const { entries } = await listAuditLog(supabase.client as never, { limit: 20, now: NOW });
    expect(entries).toHaveLength(1);
    const [query] = supabase.on("audit_log");
    expect(query.calls).toContainEqual(["order", ["created_at", { ascending: false }]]);
    expect(query.calls).toContainEqual(["limit", [20]]);
  });

  it("el historial de un docente filtra por el perfil", async () => {
    const supabase = fakeSupabase({ tables: { audit_log: { data: [row()] } } });
    const { entries } = await getTutorHistory(supabase.client as never, "d1", { now: NOW });
    expect(entries[0].label).toBe("Rechazó el perfil");
    const [query] = supabase.on("audit_log");
    expect(query.calls).toContainEqual(["eq", ["target_type", "docente"]]);
    expect(query.calls).toContainEqual(["eq", ["target_id", "d1"]]);
  });
});
