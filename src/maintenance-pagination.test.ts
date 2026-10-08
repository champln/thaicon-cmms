import { beforeEach, describe, expect, it, vi } from "vitest";
const { from } = vi.hoisted(() => ({ from: vi.fn() }));
vi.mock("./supabase", () => ({ supabase: { from } }));
import { loadSupabaseMaintenanceState } from "./maintenance-supabase";

describe("maintenance query pagination", () => {
  beforeEach(() => from.mockReset());
  it("loads every authorized report and batches attachment IDs", async () => {
    const reports = Array.from({ length: 1001 }, (_, i) => ({ id: `SR-${i}`, jobsite_id: "SITE-001", quantity: 1, status: "draft" }));
    const scopes: Array<[string, string, string[]]> = [];
    const ranges: Array<[string, number, number]> = [];
    from.mockImplementation((table: string) => {
      const rows = table === "service_reports" ? reports : [];
      const query = {
        select: vi.fn(), in: vi.fn(), order: vi.fn(),
        range: vi.fn(async (start: number, end: number) => { ranges.push([table, start, end]); return { data: rows.slice(start, end + 1), error: null }; }),
      };
      query.select.mockReturnValue(query); query.order.mockReturnValue(query);
      query.in.mockImplementation((field: string, ids: string[]) => { scopes.push([table, field, ids]); return query; });
      return query;
    });
    const result = await loadSupabaseMaintenanceState(["SITE-001"]);
    expect(result.serviceReports).toHaveLength(1001);
    expect(scopes.filter(([table]) => table !== "service_report_attachments").every(([, field, ids]) => field === "jobsite_id" && ids.join() === "SITE-001")).toBe(true);
    const attachments = scopes.filter(([table]) => table === "service_report_attachments");
    expect(attachments.map(([, , ids]) => ids.length)).toEqual([200, 200, 200, 200, 200, 1]);
    expect(ranges).toContainEqual(["service_reports", 1000, 1199]);
  });
  it("does not query a database when no sites are authorized", async () => {
    expect(await loadSupabaseMaintenanceState([])).toEqual({ plans: [], serviceReports: [], repairRequests: [] });
    expect(from).not.toHaveBeenCalled();
  });
});
