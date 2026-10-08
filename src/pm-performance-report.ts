import { createPlanCycles, type MaintenanceState } from "./maintenance";
import { performanceSheets } from "./maintenance-excel";
import { instantMillis, validCalendarDate } from "./work-order-timing";

export type PmReportFilters = { year: number; month: string; planId: string; cycleId: string };
const percentage = (actual: number, target: number, partial: boolean) =>
  partial || target === 0 ? null : Math.round(actual / target * 1000) / 10;
function freeze<T>(value: T): T {
  if (value && typeof value === "object") { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}

/** Approved-only actual. Online targets must come from persisted cycles, never
 * regenerated from annualTarget. Calendar-month actual is NOT a monthly target.
 * Caller must supply a complete verified read; this is not a DB transaction.
 */
export function buildPmPerformanceReport(input: {
  siteId: string; siteName: string; state: MaintenanceState; filters: PmReportFilters;
  mode: "online" | "demo"; verified: boolean; evaluatedAt: string;
}) {
  const { siteId, filters, state } = input;
  if (!input.verified || !siteId || instantMillis(input.evaluatedAt) == null) throw new Error("ยังยืนยันข้อมูลรายงานไม่ได้");
  if (!Number.isInteger(filters.year) || filters.year < 1 || filters.year > 9999 ||
    (filters.month !== "all" && !/^(?:[1-9]|1[0-2])$/.test(filters.month))) throw new Error("ตัวกรองปีหรือเดือนไม่ถูกต้อง");
  const sitePlans = state.plans.filter(p => p.jobsiteId === siteId);
  const siteReports = state.serviceReports.filter(r => r.jobsiteId === siteId);
  if (new Set(sitePlans.map(p => p.id)).size !== sitePlans.length || new Set(siteReports.map(r => r.id)).size !== siteReports.length) throw new Error("รหัสแผนหรือรายงานซ้ำ");
  const plans = sitePlans.filter(p => p.year === filters.year && (filters.planId === "all" || p.id === filters.planId));
  if (filters.planId !== "all" && !plans.length) throw new Error("แผนที่เลือกไม่อยู่ในขอบเขตแล้ว กรุณาเลือกใหม่");
  const cycleOptions = plans.flatMap(plan => {
    if (input.mode === "online" && !Array.isArray(plan.cycles)) throw new Error("ยังไม่มีข้อมูลรอบงานจริง หยุดคำนวณเป้าหมาย");
    return createPlanCycles(plan).map(cycle => ({ ...cycle, planName: plan.name }));
  });
  if (new Set(cycleOptions.map(c => c.id)).size !== cycleOptions.length || cycleOptions.some(c => !plans.some(p => p.id === c.planId) || !Number.isSafeInteger(c.target) || c.target < 0 || !Number.isInteger(c.startMonth) || !Number.isInteger(c.endMonth) || c.startMonth < 1 || c.startMonth > 12 || c.endMonth < 1 || c.endMonth > 12)) throw new Error("ข้อมูลรอบงานไม่ถูกต้อง");
  if (filters.cycleId !== "all" && !cycleOptions.some(c => c.id === filters.cycleId)) throw new Error("รอบที่เลือกไม่อยู่ในขอบเขตแล้ว กรุณาเลือกใหม่");
  const planIds = new Set(plans.map(p => p.id));
  const planReports = siteReports.filter(r => planIds.has(r.planId));
  if (planReports.some(r => !cycleOptions.some(c => c.id === r.cycleId && c.planId === r.planId) || !Number.isSafeInteger(r.quantity) || r.quantity < 0)) throw new Error("รายงานอ้างอิงรอบงานหรือจำนวนไม่ถูกต้อง");
  const cycles = cycleOptions.filter(c => {
    if (filters.cycleId !== "all" && c.id !== filters.cycleId) return false;
    const month = Number(filters.month);
    return filters.month === "all" || (c.startMonth <= c.endMonth ? month >= c.startMonth && month <= c.endMonth : month >= c.startMonth || month <= c.endMonth);
  });
  const cycleIds = new Set(cycles.map(c => c.id));
  const partial = filters.month !== "all";
  const reports = planReports.filter(r => cycleIds.has(r.cycleId) && (!partial || (validCalendarDate(r.serviceDate) && Number(r.serviceDate.slice(5, 7)) === Number(filters.month))));
  const approved = reports.filter(r => r.status === "approved");
  const pending = reports.filter(r => r.status === "submitted").length;
  const target = cycles.reduce((sum, c) => sum + c.target, 0);
  const actual = approved.reduce((sum, r) => sum + r.quantity, 0);
  if (!Number.isSafeInteger(target) || !Number.isSafeInteger(actual)) throw new Error("ยอดรวมเกินขอบเขตจำนวนที่รองรับ");
  const progress = percentage(actual, target, partial);
  const cycleRows = cycles.map(c => {
    const cycleActual = approved.filter(r => r.cycleId === c.id).reduce((sum, r) => sum + r.quantity, 0);
    return { ...c, actual: cycleActual, remaining: partial ? null : Math.max(c.target - cycleActual, 0), progress: percentage(cycleActual, c.target, partial) };
  });
  // Chart follows selected plan/cycle scope, but shows all calendar months.
  const chartReports = planReports.filter(r => r.status === "approved" && (filters.cycleId === "all" || r.cycleId === filters.cycleId) && validCalendarDate(r.serviceDate) && r.serviceDate.startsWith(`${String(filters.year).padStart(4, "0")}-`));
  const monthly = Array.from({ length: 12 }, (_, month) => chartReports.filter(r => Number(r.serviceDate.slice(5, 7)) === month + 1).reduce((sum, r) => sum + r.quantity, 0));
  if (monthly.some(n => !Number.isSafeInteger(n))) throw new Error("ยอดรายเดือนเกินขอบเขตจำนวนที่รองรับ");
  const unknownDates = planReports.filter(r => (filters.cycleId === "all" || r.cycleId === filters.cycleId) && !validCalendarDate(r.serviceDate)).length;
  const outsideCalendar = approved.filter(r => validCalendarDate(r.serviceDate) && !r.serviceDate.startsWith(`${String(filters.year).padStart(4, "0")}-`)).length;
  const sheets = performanceSheets({ siteId, siteName: input.siteName, ...filters, target, actual, progress, pending, reports, cycles: cycleRows });
  sheets.push({ name: "ผลรายเดือนปฏิทิน", headers: ["ปี ค.ศ.", "เดือน", "Actual อนุมัติ"], rows: monthly.map((n, i) => [filters.year, i + 1, n]) });
  sheets[0].rows.push(["เวลาประเมิน UTC", input.evaluatedAt], ["แหล่งข้อมูล", input.mode === "online" ? "ข้อมูลออนไลน์ที่โหลดสำเร็จครบตามสิทธิ์" : "ข้อมูลจำลอง"], ["รายงานไม่ทราบวันที่ในแผน/รอบที่เลือก", unknownDates], ["รายงานอนุมัติข้ามปีในยอดรวม", outsideCalendar]);
  return freeze({ siteId, evaluatedAt: input.evaluatedAt, sheets, target, actual, pending, progress, cycleOptions, cycleRows, monthly, outsideCalendar, unknownDates, partial });
}

export function pmPerformancePdfSections(report: ReturnType<typeof buildPmPerformanceReport>) {
  return report.sheets.flatMap(sheet => sheet.rows.map((row, index) => ({
    label: sheet.headers.length === 2 ? String(row[0]) : `${sheet.name} #${index + 1}`,
    value: sheet.headers.length === 2 ? String(row[1]) : row.map((v, i) => `${sheet.headers[i]}: ${v}`).join("\n"),
  })));
}
