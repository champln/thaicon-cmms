import { describe, expect, it } from "vitest";
import { applyDemoOrderCommand } from "./work-order-demo";
import { buildDefaultMasterData } from "./master-data";
import { loadDemoOperations, saveDemoOperations } from "./operations-demo";
import type { WorkOrder } from "./CMMSApp";
const master = buildDefaultMasterData();
const [admin, engineer] = master.users;
const order: WorkOrder = { id: "WO-TEST", site: master.jobsites[0].name, type: "PM", title: "Test", assetId: "CR-DP-02", assetName: "Test", priority: "ปกติ", status: "รอมอบหมาย", assignee: "ยังไม่มอบหมาย", due: "2026-10-10", created: "Test", progress: 0 };
describe("demo work-order history", () => {
  it("persists assignment and real generated history across reload without altering the source", () => {
    const assigned = applyDemoOrderCommand(order, "SITE-001", admin, 1, { kind: "assign", assignee: { id: engineer.id, role: engineer.role, active: true, siteIds: engineer.jobsiteIds } }, "2026-10-06T00:00:00Z");
    let raw: string | null = null;
    const storage = { getItem: () => raw, setItem: (_: string, value: string) => { raw = value; } };
    expect(saveDemoOperations({ workOrders: [assigned], alerts: [] }, storage)).toBe(true);
    const loaded = loadDemoOperations({ workOrders: [], alerts: [] }, storage).workOrders[0];
    expect(loaded.assigneeId).toBe(engineer.id);
    expect(loaded.assignedAt).toBe("2026-10-06T00:00:00Z");
    const started = applyDemoOrderCommand(loaded, "SITE-001", engineer, 2, { kind: "start" }, "2026-10-06T00:01:00Z");
    expect(started.status).toBe("กำลังดำเนินการ");
    expect(started.startedAt).toBe("2026-10-06T00:01:00Z");
    expect(started.completedAt).toBeUndefined();
    expect(started.events?.map(e => e.command)).toEqual(["assign", "start"]);
    expect(started.events?.[1].actorName).toBe(engineer.displayName);
    expect(order.events).toBeUndefined();
  });
  it("rejects an old browser snapshot and cross-site actor", () => {
    expect(() => applyDemoOrderCommand({ ...order, version: 2 }, "SITE-001", admin, 1, { kind: "note", text: "stale" }, "2026-10-06T00:00:00Z")).toThrow();
    expect(() => applyDemoOrderCommand(order, "SITE-003", engineer, 1, { kind: "note", text: "test" }, "2026-10-06T00:00:00Z")).toThrow();
  });
});
