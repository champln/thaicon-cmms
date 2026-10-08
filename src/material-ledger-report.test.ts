import { describe, expect, it } from "vitest";
import type { WorkOrder } from "./CMMSApp";
import type { OrderMaterial } from "./work-order-materials";
import { buildMaterialLedgerReport, materialLedgerPdfSections } from "./material-ledger-report";

const order: WorkOrder = { id: "WO-A", jobsiteId: "S", site: "Site", type: "CM", title: "Job", assetId: "A", assetName: "Asset", priority: "ปกติ", status: "กำลังดำเนินการ", assignee: "E", due: "วันนี้", created: "เมื่อวาน", progress: 20 };
const material: OrderMaterial = { id: "M-A", name: "=วัสดุ", unit: "ชิ้น", quantity: 0.1, recordedBy: "E", recordedAt: "2026-10-08T00:00:00Z", voidedBy: null, voidedAt: null, voidReason: null };
const input = { siteId: "S", siteName: "Site", orders: [order], filters: { query: "", status: "ทั้งหมด", from: "", to: "", assigneeId: "" }, batches: [{ orderId: order.id, materials: [material] }], verified: true, mode: "online" as const, evaluatedAt: "2026-10-08T03:00:00Z" };
const reportWith = (materials: OrderMaterial[]) => buildMaterialLedgerReport({ ...input, batches: [{ orderId: order.id, materials }] });

describe("complete decimal material ledger", () => {
  it("sums decimal4 exactly, including 0.1 + 0.2 without binary artifacts", () => {
    const report = reportWith([material, { ...material, id: "M-B", quantity: 0.2 }, { ...material, id: "M-C", quantity: 0.0001 }]);
    expect(report.sheets[1].rows).toEqual([["=วัสดุ", "ชิ้น", "0.3001", "0", 3, 0]]);
  });
  it("keeps sums larger than safe integers precise as literal decimal text", () => {
    const materials = Array.from({ length: 1001 }, (_, i) => ({ ...material, id: "M-" + i, quantity: 9999999999.9999 }));
    const report = reportWith(materials);
    expect(report.sheets[1].rows[0][2]).toBe("10009999999999.8999");
    expect(report.activeCount).toBe(1001);
    expect(report.sheets[2].rows.at(-1)?.[3]).toBe("M-1000");
  });
  it("never merges different units, name case, or different stored whitespace", () => {
    const report = reportWith([material, { ...material, id: "B", unit: "กล่อง" }, { ...material, id: "C", name: "=วัสดุ " }, { ...material, id: "D", name: "Bolt" }, { ...material, id: "F", name: "bolt" }]);
    expect(report.sheets[1].rows).toHaveLength(5);
  });
  it("retains void quantity and evidence separately, never subtracting twice", () => {
    const report = reportWith([material, { ...material, id: "B", quantity: 0.2, voidedBy: "Admin", voidedAt: "2026-10-08T01:00:00Z", voidReason: "=บันทึกผิด" }]);
    expect(report.sheets[1].rows[0]).toEqual(["=วัสดุ", "ชิ้น", "0.1", "0.2", 1, 1]);
    expect(report.activeCount).toBe(1);
    expect(report.voidCount).toBe(1);
    expect(report.sheets[3].rows[0].slice(-3)).toEqual(["Admin", "2026-10-08T01:00:00Z", "=บันทึกผิด"]);
  });
  it("requires one child batch even for each verified empty parent", () => {
    expect(() => buildMaterialLedgerReport({ ...input, batches: [] })).toThrow();
    expect(() => buildMaterialLedgerReport({ ...input, batches: [input.batches[0], input.batches[0]] })).toThrow();
    expect(() => buildMaterialLedgerReport({ ...input, batches: [{ ...input.batches[0], orderId: "foreign" }] })).toThrow();
    expect(reportWith([]).activeCount).toBe(0);
    expect(buildMaterialLedgerReport({ ...input, orders: [], batches: [] }).orderCount).toBe(0);
  });
  it("validates parent scope, completeness, duplicate IDs, evaluation time and date range", () => {
    expect(() => buildMaterialLedgerReport({ ...input, verified: false })).toThrow();
    expect(() => buildMaterialLedgerReport({ ...input, orders: [{ ...order, jobsiteId: "foreign" }] })).toThrow();
    expect(() => buildMaterialLedgerReport({ ...input, orders: [order, order] })).toThrow();
    expect(() => buildMaterialLedgerReport({ ...input, evaluatedAt: "2026-10-08" })).toThrow();
    expect(() => buildMaterialLedgerReport({ ...input, filters: { ...input.filters, from: "2026-02-30" } })).toThrow();
  });
  it("uses Bangkok parent creation filters, not material record dates", () => {
    const selected = { ...order, id: "WO-B", createdAt: "2026-10-07T17:00:00Z" };
    const report = buildMaterialLedgerReport({ ...input, orders: [order, selected],
      filters: { ...input.filters, from: "2026-10-08", to: "2026-10-08" }, batches: [{ orderId: selected.id, materials: [{ ...material, recordedAt: "2025-01-01T00:00:00Z" }] }] });
    expect(report.orderCount).toBe(1);
    expect(report.sheets[2].rows[0][1]).toBe("WO-B");
  });
  it("rejects duplicate child IDs within or across parents", () => {
    expect(() => reportWith([material, material])).toThrow();
    expect(() => buildMaterialLedgerReport({ ...input, orders: [order, { ...order, id: "WO-B" }], batches: [input.batches[0], { orderId: "WO-B", materials: [material] }] })).toThrow();
  });
  it("rejects invalid source decimals rather than rounding or using zero", () => {
    for (const quantity of [0, -1, NaN, Infinity, 0.00001, 10000000000]) expect(() => reportWith([{ ...material, quantity }])).toThrow();
  });
  it("rejects missing actors/dates and partial or backwards void evidence", () => {
    for (const patch of [{ recordedBy: "" }, { recordedAt: "วันนี้" }, { voidReason: "reason" }, { voidedAt: "2026-10-08T01:00:00Z" },
      { voidedBy: "E", voidReason: "reason", voidedAt: "2026-10-07T00:00:00Z" }]) expect(() => reportWith([{ ...material, ...patch }])).toThrow();
  });
  it("freezes only the model, preserves literal strings, and uses exact same PDF rows", () => {
    const report = buildMaterialLedgerReport(input);
    expect(Object.isFrozen(report.sheets[1].rows[0])).toBe(true);
    expect(Object.isFrozen(material)).toBe(false);
    expect(report.sheets.every(sheet => sheet.rows.every(row => row.length === sheet.headers.length))).toBe(true);
    expect(materialLedgerPdfSections(report).some(section => section.value.includes("จำนวนที่ยังใช้: 0.1"))).toBe(true);
    expect(report.sheets[2].rows[0][4]).toBe("=วัสดุ");
  });
});
