import { describe, expect, it } from "vitest";
import { buildAssetHistoryReport, assetHistoryPdfSections } from "./asset-history-report";
import { buildDemoMaintenanceState } from "./maintenance";
import { buildDefaultMasterData } from "./master-data";
import type { WorkOrder } from "./CMMSApp";
const demo = buildDemoMaintenanceState(), asset = { ...buildDefaultMasterData().assets[0], id: "A", jobsiteId: "SITE-A" };
const order: WorkOrder = { id: "W", jobsiteId: "SITE-A", site: "Same", type: "CM", title: "=TITLE", assetId: "A", assetName: "Asset", priority: "ปกติ", status: "กำลังดำเนินการ", assignee: "E", due: "วันนี้", created: "เมื่อวาน", progress: 20 };
const report = { ...demo.serviceReports[0], id: "S", jobsiteId: "SITE-A", assetId: "A", workOrderId: "W", status: "approved" as const, quantity: 3 };
const repair = { ...demo.repairRequests[0], id: "R", jobsiteId: "SITE-A", assetId: "A", serviceReportId: "S" };
const input = { asset, siteName: "Same", orders: [order], maintenance: { plans: [], serviceReports: [report], repairRequests: [repair] }, verified: true, mode: "online" as const, evaluatedAt: "2026-10-07T05:00:00Z" };
describe("canonical machine history reports", () => {
  it("counts three source types separately without multiplying one WO by multiple SRs", () => {
    const r = buildAssetHistoryReport({ ...input, maintenance: { ...input.maintenance, serviceReports: [report, { ...report, id: "S2", status: "submitted" }] } });
    expect(r.sheets[0].rows).toContainEqual(["ใบงาน", 1]);
    expect(r.sheets[0].rows).toContainEqual(["Service Report", 2]);
    expect(r.sheets[0].rows).toContainEqual(["จำนวนงานจากรายงานอนุมัติ", 3]);
    expect(r.sheets[1].rows).toHaveLength(1);
    expect(r.sheets[4].rows).toHaveLength(3);
    expect(assetHistoryPdfSections(r)).toContainEqual({ label: "จำนวนงานจากรายงานอนุมัติ", value: "3" });
  });
  it("does not leak same-name site or other-asset records", () => {
    const foreign = { ...report, id: "FOREIGN", jobsiteId: "OTHER", workPerformed: "PRIVATE" };
    const r = buildAssetHistoryReport({ ...input, orders: [order, { ...order, id: "OTHER", assetId: "B" }], maintenance: { ...input.maintenance, serviceReports: [report, foreign] } });
    expect(r.sheets[1].rows).toHaveLength(1);
    expect(JSON.stringify(r)).not.toContain("PRIVATE");
  });
  it("discloses unresolved and missing refs without inventing or attaching another machine's records", () => {
    const r = buildAssetHistoryReport({ ...input, orders: [{ ...order, assetId: "B" }], maintenance: { ...input.maintenance, repairRequests: [repair, { ...repair, id: "R2", serviceReportId: null }] } });
    expect(r.sheets[0].rows).toContainEqual(["อ้างอิงที่ไม่พบในประวัติเครื่องนี้", 1]);
    expect(r.sheets[4].rows[0][4]).toContain("ไม่พบ");
    expect(r.sheets[4].rows[2][4]).toBe("ไม่ระบุ");
  });
  it("does not guess timestamps from legacy words and preserves formula-like text literally", () => {
    const r = buildAssetHistoryReport(input);
    expect(r.sheets[1].rows[0][4]).toBe("=TITLE");
    expect(r.sheets[1].rows[0][8]).toBe("ไม่ทราบ");
    expect(r.sheets[1].rows[0][7]).toBe("เมื่อวาน");
  });
  it("refuses incomplete evidence, duplicates and invalid quantities", () => {
    expect(() => buildAssetHistoryReport({ ...input, verified: false })).toThrow("ยืนยัน");
    expect(() => buildAssetHistoryReport({ ...input, orders: [order, order] })).toThrow("ซ้ำ");
    expect(() => buildAssetHistoryReport({ ...input, maintenance: { ...input.maintenance, serviceReports: [{ ...report, quantity: -1 }] } })).toThrow("จำนวน");
  });
  it("allows identical IDs in different tables, but never uses them as a join key alone", () => {
    const r = buildAssetHistoryReport({ ...input, maintenance: { ...input.maintenance, serviceReports: [{ ...report, id: "W" }] } });
    expect(r.sheets[0].rows).toContainEqual(["Service Report", 1]);
    expect(r.sheets[0].rows).toContainEqual(["ใบงาน", 1]);
  });
  it("freezes output without freezing or changing source data", () => {
    const source = { ...order }, r = buildAssetHistoryReport({ ...input, orders: [source] });
    source.title = "changed";
    expect(r.sheets[1].rows[0][4]).toBe("=TITLE");
    expect(Object.isFrozen(r.sheets[1].rows[0])).toBe(true);
  });
  it("exports explicit verified empty history, not guessed dates or zero-duration facts", () => {
    const r = buildAssetHistoryReport({ ...input, orders: [], maintenance: { plans: [], serviceReports: [], repairRequests: [] } });
    expect(r.sheets[0].rows).toContainEqual(["ใบงาน", 0]);
    expect(r.sheets[1].rows).toHaveLength(0);
  });
});
