import { describe, expect, it } from "vitest";
import { buildDemoMaintenanceState } from "./maintenance";
import { performanceSheets, serviceReportSheet } from "./maintenance-excel";

describe("Excel report scope and actual", () => {
  const reports = buildDemoMaintenanceState().serviceReports.filter(r => r.jobsiteId === "SITE-001");
  const actual = reports.filter(r => r.status === "approved").reduce((sum, r) => sum + r.quantity, 0);
  const scope = { siteId: "SITE-001", siteName: "ทดสอบ", year: 2026, month: "all", planId: "all", cycleId: "all", target: 100, actual, progress: actual, pending: 0, reports, cycles: [] };
  it("exports literal text and numeric quantities with approved-only Actual", () => {
    const rows = serviceReportSheet(reports).rows;
    expect(rows).toHaveLength(reports.length);
    expect(rows.every(row => row.length === 20)).toBe(true);
    expect(rows.reduce((total, row) => total + Number(row[10]), 0)).toBe(actual);
    expect(performanceSheets(scope)[0].rows).toContainEqual(["Actual", actual]);
  });
  it("rejects mixed-site or inconsistent totals", () => {
    expect(() => performanceSheets({ ...scope, actual: actual + 1 })).toThrow("Actual");
    expect(() => performanceSheets({ ...scope, reports: [{ ...reports[0], jobsiteId: "OTHER" }] })).toThrow("ต่างไซต์");
  });
  it("preserves formula-like customer text as a string for typed writer output", () => {
    const sheet = serviceReportSheet([{ ...reports[0], workPerformed: '=HYPERLINK("https://example.invalid")' }]);
    expect(sheet.rows[0][13]).toBe('=HYPERLINK("https://example.invalid")');
    expect(typeof sheet.rows[0][8]).toBe("number");
  });
});
