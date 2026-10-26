import { describe, expect, it } from "vitest";
import { fakeSupabase } from "@/test/fake-supabase";
import { getAdminMetrics, weekLabel } from "./metrics";

const sample = {
  generated_at: "2026-10-26T15:00:00Z",
  weeks: [{ week_start: "2026-10-19", paid_bookings: 3, classes_given: 2, revenue: "29000.00", commission: "3480.00", refunded: 0 }],
  last_30_days: {
    paid_bookings: 4,
    classes_given: 1,
    revenue: "29000.00",
    commission: "3480.00",
    tutor_amount: "25520.00",
    refunded: "6000.00",
    paid_cancellations: 2,
    tutor_absences: 1,
    expired_holds: 1,
  },
  tutors: { approved: 3, pending: 1, payable: 2, active_30d: 1 },
  students: { total: 10, active_30d: 4 },
  ratings: { count: 5, average: "4.60", count_30d: 0, average_30d: null },
};

describe("getAdminMetrics", () => {
  it("pide las semanas y pasa los montos a número", async () => {
    const supabase = fakeSupabase({ rpc: { admin_metrics: { data: sample } } });
    const { metrics, error } = await getAdminMetrics(supabase.client as never, { weeks: 8 });
    expect(error).toBe(false);
    expect(supabase.client.rpc).toHaveBeenCalledWith("admin_metrics", { p_weeks: 8 });
    expect(metrics?.last_30_days.revenue).toBe(29000);
    expect(metrics?.ratings.average).toBe(4.6);
    expect(metrics?.ratings.average_30d).toBeNull();
  });

  it("si la base falla o devuelve otra cosa, avisa el error", async () => {
    for (const result of [{ error: { message: "x", hint: "not_admin" } }, { data: { weeks: "no" } }]) {
      const { metrics, error } = await getAdminMetrics(fakeSupabase({ rpc: { admin_metrics: result } }).client as never);
      expect(metrics).toBeNull();
      expect(error).toBe(true);
    }
  });
});

describe("weekLabel", () => {
  it("muestra el lunes de la semana", () => {
    expect(weekLabel("2026-10-19")).toMatch(/^19 oct/);
  });
});
