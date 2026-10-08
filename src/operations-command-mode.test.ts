import { beforeEach, describe, expect, it, vi } from "vitest";
const { from } = vi.hoisted(() => ({ from: vi.fn() }));
vi.mock("./supabase", () => ({ supabase: { from } }));
import { syncSupabaseOperationsState } from "./operations-supabase";
import type { WorkOrder } from "./CMMSApp";
import { buildDefaultMasterData } from "./master-data";
const order: WorkOrder = { id: "WO-A", type: "CM", title: "ทดสอบ", assetId: "A", assetName: "A", site: "SITE-001", priority: "ปกติ", status: "รอมอบหมาย", assignee: "", due: "2026-10-07", created: "2026-10-06", progress: 0 };
describe("command-mode synchronization", () => {
  beforeEach(() => from.mockReset());
  it("never inserts, updates or deletes work orders through legacy autosync", async () => {
    await syncSupabaseOperationsState({ workOrders: [order, { ...order, id: "deleted" }], alerts: [] }, { workOrders: [{ ...order, version: 2 }, { ...order, id: "new" }], alerts: [] }, "admin", [], true);
    expect(from).not.toHaveBeenCalled();
  });
  it("keeps legacy-mode creation available while the gate is disabled", async () => {
    const insert = vi.fn().mockResolvedValue({ error: null });
    from.mockReturnValue({ insert });
    await syncSupabaseOperationsState({ workOrders: [], alerts: [] }, { workOrders: [order], alerts: [] }, "admin", buildDefaultMasterData().jobsites, false);
    expect(from).toHaveBeenCalledWith("work_orders");
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ id: "WO-A", created_by: "admin" }));
  });
});
