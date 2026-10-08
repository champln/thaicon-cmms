import { describe, expect, it } from "vitest";
import { buildDemoMaintenanceState, type MaintenanceState } from "./maintenance";
import { buildPmPerformanceReport, pmPerformancePdfSections } from "./pm-performance-report";

const demo = buildDemoMaintenanceState();
const plan = { ...demo.plans[0], id: "P1", jobsiteId: "SITE-A", year: 2026, annualTarget: 999,
  cycles: [{ id: "C1", planId: "P1", sequence: 1, label: "ต.ค. - ธ.ค.", startMonth: 10, endMonth: 12, target: 10 },
    { id: "C2", planId: "P1", sequence: 2, label: "รอบศูนย์", startMonth: 1, endMonth: 3, target: 0 }] };
const report = { ...demo.serviceReports[0], id: "R1", jobsiteId: "SITE-A", planId: "P1", cycleId: "C1", serviceDate: "2026-10-06", quantity: 3, status: "approved" as const };
const state: MaintenanceState = { plans: [plan], serviceReports: [report], repairRequests: [] };
const input = { siteId: "SITE-A", siteName: "ทดสอบ", state, filters: { year: 2026, month: "all", planId: "all", cycleId: "all" }, mode: "online" as const, verified: true, evaluatedAt: "2026-10-06T10:00:00Z" };
const build = (changes: Partial<typeof input> = {}) => buildPmPerformanceReport({ ...input, ...changes });

describe("PM unified verified report", () => {
  it("uses persisted targets, approved-only Actual and identical PDF/XLSX facts", () => {
    const sourceReport = { ...report };
    const result = build({ state: { ...state, serviceReports: [sourceReport, { ...report, id: "R2", quantity: 4, status: "submitted" }] } });
    expect(result.target).toBe(10); // Not annualTarget 999
    expect(result.actual).toBe(3);
    expect(result.progress).toBe(30);
    expect(result.pending).toBe(1);
    expect(result.monthly[9]).toBe(3);
    expect(result.sheets[0].rows).toContainEqual(["Actual", 3]);
    expect(pmPerformancePdfSections(result)).toContainEqual({ label: "Actual", value: "3" });
    expect(Object.isFrozen(result.sheets[0].rows)).toBe(true);
    sourceReport.workPerformed = "=LITERAL";
    expect(result.sheets[2].rows[0][13]).not.toBe("=LITERAL");
  });
  it("retains Actual on zero target without fake 0 percent", () => {
    const result = build({ state: { ...state, serviceReports: [{ ...report, cycleId: "C2" }] }, filters: { ...input.filters, cycleId: "C2" } });
    expect(result.actual).toBe(3);
    expect(result.progress).toBeNull();
    expect(result.cycleRows[0].progress).toBeNull();
    expect(result.sheets[0].rows).toContainEqual(["ความคืบหน้า %", "ไม่ประเมิน"]);
  });
  it("never divides monthly actual by full-cycle target or invents monthly remaining", () => {
    const result = build({ filters: { ...input.filters, month: "10" } });
    expect(result.target).toBe(10);
    expect(result.actual).toBe(3);
    expect(result.progress).toBeNull();
    expect(result.cycleRows[0].remaining).toBeNull();
  });
  it("keeps crossed-year approved actual, chart only calendar year; dates not guessed", () => {
    const result = build({ state: { ...state, serviceReports: [report,
      { ...report, id: "R2", serviceDate: "2027-10-01", quantity: 2 },
      { ...report, id: "R3", serviceDate: "6 ต.ค. 69", quantity: 1 }] } });
    expect(result.actual).toBe(6);
    expect(result.outsideCalendar).toBe(1);
    expect(result.unknownDates).toBe(1);
    expect(result.monthly.reduce((a, b) => a + b, 0)).toBe(3);
  });
  it("chart respects cycle selection even when another cycle has actual", () => {
    const result = build({ filters: { ...input.filters, cycleId: "C1" }, state: { ...state, serviceReports: [report, { ...report, id: "R2", cycleId: "C2", quantity: 99 }] } });
    expect(result.monthly[9]).toBe(3);
  });
  it("filters canonical site, not name; never exports foreign reports", () => {
    const result = build({ state: { ...state, serviceReports: [report, { ...report, id: "FOREIGN", jobsiteId: "OTHER", quantity: 99 }] } });
    expect(result.actual).toBe(3);
    expect(result.sheets[2].rows).toHaveLength(1);
  });
  it("fails closed for unknown completeness, missing online cycles, duplicates or dangling reports", () => {
    expect(() => build({ verified: false })).toThrow("ยืนยัน");
    expect(() => build({ state: { ...state, plans: [{ ...plan, cycles: undefined }] } })).toThrow("รอบงานจริง");
    expect(() => build({ state: { ...state, serviceReports: [report, report] } })).toThrow("ซ้ำ");
    expect(() => build({ state: { ...state, serviceReports: [{ ...report, cycleId: "MISSING" }] } })).toThrow("อ้างอิง");
    expect(() => build({ state: { ...state, plans: [{ ...plan, cycles: [{ ...plan.cycles[0], planId: "OTHER" }] }] } })).toThrow("รอบงาน");
  });
  it("rejects stale selected filters instead of silently substituting another plan or cycle", () => {
    expect(() => build({ filters: { ...input.filters, planId: "MISSING" } })).toThrow("เลือกใหม่");
    expect(() => build({ filters: { ...input.filters, cycleId: "MISSING" } })).toThrow("เลือกใหม่");
    expect(() => build({ filters: { ...input.filters, month: "13" } })).toThrow("ตัวกรอง");
  });
  it("allows empty confirmed scope without claiming zero-percent completion", () => {
    const result = build({ state: { plans: [], serviceReports: [], repairRequests: [] } });
    expect(result.target).toBe(0);
    expect(result.progress).toBeNull();
  });
  it("supports wrapped cycles and rejects negative/non-integer/unsafe totals", () => {
    const wrapped = { ...plan, cycles: [{ ...plan.cycles[0], startMonth: 12, endMonth: 2 }] };
    expect(build({ state: { ...state, plans: [wrapped] }, filters: { ...input.filters, month: "1" } }).target).toBe(10);
    for (const quantity of [-1, 1.1, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
      expect(() => build({ state: { ...state, serviceReports: [{ ...report, quantity }] } })).toThrow("จำนวน");
    }
    expect(() => build({ state: { ...state, serviceReports: [{ ...report, quantity: Number.MAX_SAFE_INTEGER }, { ...report, id: "R2", quantity: 1 }] } })).toThrow("ยอดรวม");
  });
});
