import { describe, expect, it } from "vitest";
import { applyDemoMaterial, validateMaterialRequest, type MaterialRequest } from "./work-order-materials";
import { buildDefaultMasterData } from "./master-data";
import type { WorkOrder } from "./CMMSApp";
const master = buildDefaultMasterData(); const [admin, engineer, viewer] = master.users;
const order: WorkOrder = { id: "WO-MAT", site: master.jobsites[0].name, type: "CM", title: "Test", assetId: "CR-DP-02", assetName: "Test", priority: "ปกติ", status: "กำลังดำเนินการ", assignee: engineer.displayName, assigneeId: engineer.id, version: 3, due: "2026-10-10", created: "Test", progress: 0 };
const add: MaterialRequest = { orderId: order.id, expectedVersion: 3, requestId: "30000000-0000-4000-8000-000000000001", action: "add", name: "ไส้กรอง", quantity: 1.25, unit: "ชิ้น" };
describe("actual material usage", () => {
  it.each([0, -1, Infinity, NaN, 1.00001, 1.000000001])("rejects invalid quantity %s instead of rounding evidence", quantity => {
    expect(() => validateMaterialRequest({ ...add, quantity })).toThrow();
  });
  it("records fractional usage then voids with retained evidence and version/history", () => {
    const recorded = applyDemoMaterial(order, "SITE-001", engineer, add, "2026-10-06T00:00:00Z");
    const voided = applyDemoMaterial(recorded, "SITE-001", engineer, { orderId: order.id, expectedVersion: 4, requestId: "30000000-0000-4000-8000-000000000002", action: "void", materialId: add.requestId, reason: "จำนวนผิด" }, "2026-10-06T00:01:00Z");
    expect(voided.version).toBe(5);
    expect(voided.materials).toHaveLength(1);
    expect(voided.materials?.[0]).toMatchObject({ quantity: 1.25, voidReason: "จำนวนผิด", recordedBy: engineer.id, voidedBy: engineer.id });
    expect(voided.events?.map(event => event.command)).toEqual(["material", "void_material"]);
    expect(order.materials).toBeUndefined();
    expect(recorded.materials?.[0].voidedAt).toBeNull();
  });
  it("retains the full 4000-character void reason independently of the audit prefix", () => {
    const recorded = applyDemoMaterial(order, "SITE-001", engineer, add, "2026-10-06T00:00:00Z");
    const reason = "ก".repeat(4000);
    const request: MaterialRequest = { orderId: order.id, expectedVersion: 4, requestId: "30000000-0000-4000-8000-000000000002", action: "void", materialId: add.requestId, reason };
    const voided = applyDemoMaterial(recorded, "SITE-001", engineer, request, "2026-10-06T00:01:00Z");
    expect(voided.materials?.[0].voidReason).toBe(reason);
    expect(voided.events?.at(-1)?.note).toBe(`ยกเลิกวัสดุ: ไส้กรอง — ${reason}`);
    expect(() => applyDemoMaterial(recorded, "SITE-001", engineer, { ...request, reason: reason + "ก" }, "2026-10-06T00:01:00Z")).toThrow();
  });
  it("blocks viewer, wrong assignment, stale version, closed work and cross-site writes", () => {
    for (const [record, actor, site, request] of [
      [order, viewer, "SITE-001", add], [order, { ...engineer, id: "peer" }, "SITE-001", add],
      [order, engineer, "SITE-003", add], [{ ...order, version: 4 }, engineer, "SITE-001", add],
      [{ ...order, status: "เสร็จสิ้น" }, admin, "SITE-001", add],
    ] as const) expect(() => applyDemoMaterial(record, site, actor, request, "2026-10-06T00:00:00Z")).toThrow();
  });
});
