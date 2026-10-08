import { describe, expect, it } from "vitest";
import type { WorkOrder } from "./CMMSApp";
import { buildDemoMaintenanceState } from "./maintenance";
import { buildSiteHistoryReport, siteHistoryPdfSections } from "./site-history-report";
const demo = buildDemoMaintenanceState();
const wo: WorkOrder = { id: "W", jobsiteId: "S", site: "Same", type: "CM", title: "=literal", assetId: "A", assetName: "Machine", priority: "ปกติ", status: "เสร็จสิ้น", assignee: "E", due: "วันนี้", created: "เมื่อวาน", createdAt: "2026-10-05T17:00:00Z", progress: 100 };
const sr = { ...demo.serviceReports[0], id: "R", jobsiteId: "S", assetId: "A", workOrderId: "W", serviceDate: "2026-10-07", quantity: 3, status: "approved" as const };
const rr = { ...demo.repairRequests[0], id: "Q", jobsiteId: "S", assetId: "A", serviceReportId: "R", requestedDate: "2026-10-08" };
const input = { siteId: "S", siteName: "Same", orders: [wo], maintenance: { plans: [], serviceReports: [sr], repairRequests: [rr] },
  filters: { query: "", from: "", to: "", assetId: "" }, mode: "online" as const, verified: true, evaluatedAt: "2026-10-08T03:00:00Z" };
describe("site history canonical source and reference model", () => {
  it("counts each source separately without multiplication for multiple reports or repairs", () => {
    const report = buildSiteHistoryReport({ ...input, maintenance: { ...input.maintenance, serviceReports: [sr, { ...sr, id: "R2", status: "submitted" }], repairRequests: [rr, { ...rr, id: "Q2" }] } });
    expect(report.counts).toEqual({ orders: 1, reports: 2, repairs: 2 });
    expect(report.sheets[0].rows).toContainEqual(["จำนวนงานจากรายงานอนุมัติ", 3]);
    expect(report.chains[0]).toMatchObject({ reportId: "R", orderId: "W", reportState: "พบในตัวกรอง", orderState: "พบในตัวกรอง" });
  });
  it("retains reference context outside dates without inflating selected source counts", () => {
    const report = buildSiteHistoryReport({ ...input, filters: { ...input.filters, from: "2026-10-08", to: "2026-10-08" } });
    expect(report.counts).toEqual({ orders: 0, reports: 0, repairs: 1 });
    expect(report.chains[0]).toMatchObject({ reportId: "R", orderId: "W", reportState: "พบ นอกตัวกรอง", orderState: "พบ นอกตัวกรอง" });
    expect(report.entries).toHaveLength(1);
  });
  it("uses inclusive Bangkok WO creation dates and never guesses legacy display dates", () => {
    const report = buildSiteHistoryReport({ ...input, orders: [wo, { ...wo, id: "OLD", createdAt: undefined }],
      filters: { ...input.filters, from: "2026-10-06", to: "2026-10-06" } });
    expect(report.entries.map(r => r.id)).toEqual(["W"]);
    expect(report.unknownDates).toBe(1);
  });
  it("does not attach another site's same-ID report or expose its content", () => {
    const report = buildSiteHistoryReport({ ...input, maintenance: { ...input.maintenance, serviceReports: [{ ...sr, jobsiteId: "FOREIGN", workPerformed: "PRIVATE" }] } });
    expect(report.chains[0].reportState).toBe("ไม่พบในข้อมูลไซต์นี้");
    expect(report.chains[0].orderState).toBe("ยังตรวจต่อไม่ได้");
    expect(JSON.stringify(report)).not.toContain("PRIVATE");
  });
  it("stops traversal on machine mismatch, preserving the original reference evidence", () => {
    const report = buildSiteHistoryReport({ ...input, maintenance: { ...input.maintenance, serviceReports: [{ ...sr, assetId: "B" }] } });
    expect(report.chains[0]).toMatchObject({ reportId: "R", reportState: "เครื่องจักรไม่ตรงกัน", orderId: "ไม่ระบุ" });
    expect(report.references[0].state).toBe("เครื่องจักรไม่ตรงกัน");
  });
  it("searches exact asset ID and content; linked targets outside query remain contextual", () => {
    const report = buildSiteHistoryReport({ ...input, filters: { ...input.filters, query: "Q", assetId: "A" } });
    expect(report.counts.repairs).toBe(1);
    expect(report.chains[0].reportState).toBe("พบ นอกตัวกรอง");
    expect(buildSiteHistoryReport({ ...input, filters: { ...input.filters, assetId: "A2" } }).entries).toEqual([]);
  });
  it("distinguishes absent/missing references and allows equal IDs across source types", () => {
    const report = buildSiteHistoryReport({ ...input, maintenance: { ...input.maintenance, serviceReports: [{ ...sr, id: "W", workOrderId: null }], repairRequests: [{ ...rr, serviceReportId: "missing" }] } });
    expect(report.references[0].state).toBe("ไม่ระบุ");
    expect(report.chains[0].reportState).toBe("ไม่พบในข้อมูลไซต์นี้");
    expect(report.counts).toEqual({ orders: 1, reports: 1, repairs: 1 });
  });
  it("rejects invalid date filters, duplicate identities, unverified data and quantities", () => {
    expect(() => buildSiteHistoryReport({ ...input, verified: false })).toThrow();
    expect(() => buildSiteHistoryReport({ ...input, filters: { ...input.filters, from: "2026-02-30" } })).toThrow();
    expect(() => buildSiteHistoryReport({ ...input, filters: { ...input.filters, from: "2027-01-01", to: "2026-01-01" } })).toThrow();
    expect(() => buildSiteHistoryReport({ ...input, orders: [wo, wo] })).toThrow();
    expect(() => buildSiteHistoryReport({ ...input, maintenance: { ...input.maintenance, serviceReports: [{ ...sr, quantity: -1 }] } })).toThrow();
  });
  it("keeps 1001 rows, literal values and shared PDF content; freezes only output", () => {
    const report = buildSiteHistoryReport({ ...input, orders: Array.from({ length: 1001 }, (_,n) => ({ ...wo, id: "W"+n })) });
    expect(report.counts.orders).toBe(1001);
    expect(report.sheets[2].rows.at(-1)?.[0]).toBe("W1000");
    expect(report.sheets[2].rows[0][5]).toBe("=literal");
    expect(siteHistoryPdfSections(report).some(r => r.value.includes("หัวข้อ: =literal"))).toBe(true);
    expect(Object.isFrozen(report.entries)).toBe(true);
    expect(Object.isFrozen(wo)).toBe(false);
    expect(report.sheets.every(s => s.rows.every(row => row.length === s.headers.length))).toBe(true);
  });
});
