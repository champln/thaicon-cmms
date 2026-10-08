import { describe, expect, it } from "vitest";
import type { WorkOrder } from "./CMMSApp";
import { buildOrderReport, orderReportPdfSections } from "./work-order-summary-report";
const order: WorkOrder = { id: "WO-A", jobsiteId: "SITE-001", site: "A", type: "CM", title: "=literal", assetId: "A", assetName: "Asset", priority: "ปกติ", status: "กำลังดำเนินการ", assignee: "E", due: "วันนี้", created: "เมื่อวาน", progress: 20 };
const input = { siteId: "SITE-001", siteName: "A", orders: [order], filters: { query: "", status: "ทั้งหมด", from: "", to: "", assigneeId: "" }, evaluatedAt: "2026-10-06T02:00:00Z", verified: true, mode: "online" as const };
describe("immutable scoped work-order summary", () => {
  it("keeps unknown legacy dates separate from overdue zero and preserves literal text", () => {
    const report = buildOrderReport(input), summary = new Map(report.sheets[0].rows.map(row => [row[0], row[1]]));
    expect(summary.get("งานเปิดไม่ทราบวันกำหนด")).toBe(1);
    expect(summary.get("งานเปิดเกินกำหนด")).toBe(0);
    expect(report.sheets[1].rows[0][3]).toBe("=literal");
    expect(report.sheets[1].rows[0].slice(-3)).toEqual(["ไม่ทราบ", "ไม่ทราบ", "ไม่ทราบ"]);
  });
  it("calculates verified timing and excludes completed rows from open/overdue counts", () => {
    const timed = { ...order, dueAt: "2026-10-06T01:00:00Z", startedAt: "2026-10-06T00:00:00Z" };
    const completed = { ...timed, id: "WO-B", status: "เสร็จสิ้น" as const, completedAt: "2026-10-06T01:30:00Z" };
    const report = buildOrderReport({ ...input, orders: [timed, completed] });
    expect(report.sheets[1].rows.map(row => row.at(-1))).toEqual([120, 90]);
    expect(new Map(report.sheets[0].rows.map(row => [row[0], row[1]])).get("งานเปิดเกินกำหนด")).toBe(1);
  });
  it("uses inclusive Bangkok created-date filters without guessing unknown dates", () => {
    const report = buildOrderReport({ ...input, orders: [order, { ...order, id: "WO-B", createdAt: "2026-10-05T17:00:00Z" }], filters: { ...input.filters, from: "2026-10-06", to: "2026-10-06" } });
    expect(report.sheets[1].rows.map(row => row[1])).toEqual(["WO-B"]);
  });
  it("refuses partial/unverified, duplicate, foreign or ambiguous identities", () => {
    expect(() => buildOrderReport({ ...input, verified: false })).toThrow();
    expect(() => buildOrderReport({ ...input, orders: [order, order] })).toThrow();
    expect(() => buildOrderReport({ ...input, orders: [{ ...order, jobsiteId: "SITE-002" }] })).toThrow();
    expect(() => buildOrderReport({ ...input, orders: [{ ...order, jobsiteId: undefined }] })).toThrow();
  });
  it("validates ranges instead of exporting a false empty report", () => {
    expect(() => buildOrderReport({ ...input, filters: { ...input.filters, from: "2026-02-30" } })).toThrow();
    expect(() => buildOrderReport({ ...input, filters: { ...input.filters, from: "2026-10-07", to: "2026-10-06" } })).toThrow();
  });
  it("freezes the export snapshot without mutating source and uses the same PDF rows", () => {
    const report = buildOrderReport(input), before = JSON.stringify(report);
    expect(Object.isFrozen(report.sheets[1].rows[0])).toBe(true);
    const changed = { ...order, title: "new" };
    expect(changed.title).toBe("new");
    expect(JSON.stringify(report)).toBe(before);
    expect(orderReportPdfSections(report).some(section => section.value.includes("หัวข้อ: =literal"))).toBe(true);
    expect(report.sheets.every(sheet => sheet.rows.every(row => row.length === sheet.headers.length))).toBe(true);
  });
});
