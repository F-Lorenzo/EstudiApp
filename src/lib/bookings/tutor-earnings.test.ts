import { describe, expect, it } from "vitest";
import { fakeSupabase } from "@/test/fake-supabase";
import { earningsTotals, getTutorEarnings, toTutorEarning, type EarningRow } from "./tutor-earnings";

const NOW = new Date("2026-10-26T15:00:00Z");
const pago = (overrides: Record<string, unknown> = {}) => ({
  status: "aprobado",
  amount: "10000.00",
  commission_amount: "1200.00",
  tutor_amount: "8800.00",
  refunded_amount: "0.00",
  ...overrides,
});
const fila = (overrides: Partial<EarningRow> = {}): EarningRow => ({
  id: "b1",
  starts_at: "2026-10-20T21:00:00Z",
  ends_at: "2026-10-20T22:00:00Z",
  status: "completada",
  profiles: { full_name: "Lucía Pérez" },
  payments: pago(),
  refunds: [],
  ...overrides,
});

describe("toTutorEarning", () => {
  it("una clase dada muestra lo que pagó el alumno, la comisión y lo que le queda al docente", () => {
    expect(toTutorEarning(fila(), NOW)).toMatchObject({
      status: "completada",
      studentName: "Lucía Pérez",
      paid: 10000,
      commission: 1200,
      tutorAmount: 8800,
      refunded: 0,
      refund: null,
    });
  });

  it("una confirmada es próxima hasta que termina, y después espera la asistencia", () => {
    expect(toTutorEarning(fila({ status: "confirmada", ends_at: "2026-10-27T22:00:00Z" }), NOW)?.status).toBe("proxima");
    expect(toTutorEarning(fila({ status: "confirmada" }), NOW)?.status).toBe("confirmando");
  });

  it("una cancelada con reembolso hecho muestra lo devuelto y lo que quedó", () => {
    const item = toTutorEarning(
      fila({
        status: "cancelada",
        payments: pago({ refunded_amount: "5000.00", commission_amount: "600.00", tutor_amount: "4400.00" }),
        refunds: [{ amount: "5000.00", percent: 50, status: "aprobado" }],
      }),
      NOW,
    );
    expect(item).toMatchObject({ status: "cancelada", refunded: 5000, tutorAmount: 4400, commission: 600 });
    expect(item?.refund).toEqual({ amount: 5000, percent: 50, state: "hecho" });
  });

  it("una devuelta entera (el pago queda «reembolsado») sigue en la lista, sin nada para el docente", () => {
    const item = toTutorEarning(
      fila({
        status: "cancelada",
        payments: pago({ status: "reembolsado", refunded_amount: "10000.00", commission_amount: "0.00", tutor_amount: "0.00" }),
        refunds: [{ amount: "10000.00", percent: 100, status: "aprobado" }],
      }),
      NOW,
    );
    expect(item).toMatchObject({ status: "cancelada", paid: 10000, commission: 0, tutorAmount: 0, refunded: 10000 });
  });

  it("un reembolso pendiente o fallido figura en curso", () => {
    for (const status of ["pendiente", "fallido"]) {
      const item = toTutorEarning(fila({ status: "cancelada", refunds: [{ amount: 10000, percent: 100, status }] }), NOW);
      expect(item?.refund?.state).toBe("en_curso");
    }
  });

  it("sin pago aprobado no es un cobro", () => {
    expect(toTutorEarning(fila({ payments: null }), NOW)).toBeNull();
    expect(toTutorEarning(fila({ payments: [pago({ status: "pendiente" })] }), NOW)).toBeNull();
    expect(toTutorEarning(fila({ status: "pendiente_pago" }), NOW)).toBeNull();
  });

  it("sin nombre del alumno usa el genérico; un monto raro cuenta como cero", () => {
    const item = toTutorEarning(fila({ profiles: [{ full_name: " " }], payments: pago({ commission_amount: "abc" }) }), NOW);
    expect(item?.studentName).toBe("Estudiante");
    expect(item?.commission).toBe(0);
  });
});

describe("earningsTotals", () => {
  it("suma lo ganado y la comisión de las dadas, lo que viene de las confirmadas y lo devuelto", () => {
    const items = [
      fila(),
      fila({ id: "b2", payments: pago({ amount: 5000, commission_amount: 600.5, tutor_amount: 4399.5 }) }),
      fila({ id: "b3", status: "confirmada", ends_at: "2026-10-27T22:00:00Z" }),
      fila({ id: "b4", status: "cancelada", refunds: [{ amount: 10000, percent: 100, status: "pendiente" }] }),
    ].map((row) => toTutorEarning(row, NOW)!);
    expect(earningsTotals(items)).toEqual({ earned: 13199.5, commission: 1800.5, upcoming: 8800, refunded: 10000 });
  });

  it("sin clases, todo en cero", () => {
    expect(earningsTotals([])).toEqual({ earned: 0, commission: 0, upcoming: 0, refunded: 0 });
  });
});

describe("getTutorEarnings", () => {
  it("lee las reservas del docente con su pago y sus reembolsos, de la más reciente a la más vieja", async () => {
    const supabase = fakeSupabase({ tables: { bookings: { data: [fila(), fila({ id: "b9", payments: null })] } }, rpc: { sync_bookings: { data: 0 } } });
    const { items, totals } = await getTutorEarnings(supabase.client as never, "d1", NOW);
    expect(items.map((item) => item.id)).toEqual(["b1"]);
    expect(totals.earned).toBe(8800);
    const [query] = supabase.on("bookings");
    expect(query.calls).toContainEqual(["eq", ["tutor_id", "d1"]]);
    expect(query.calls).toContainEqual(["order", ["starts_at", { ascending: false }]]);
  });
});
