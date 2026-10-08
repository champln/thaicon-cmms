import type { WorkOrder } from "./CMMSApp";
import type { ExcelSheet } from "./excel-export";
import { filterWorkOrders, type OrderFilters } from "./work-order-filter";
import { instantMillis, orderTiming, validCalendarDate } from "./work-order-timing";

export type OrderReport = { siteId: string; evaluatedAt: string; title: string; sheets: ExcelSheet[] };
function freeze<T>(value: T): T {
  if (value && typeof value === "object") {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}

/** One immutable model for preview, PDF and XLSX; no joins/material totals here.
 * Caller supplies a complete confirmed selected-site read, not partial evidence.
 */
export function buildOrderReport(input: {
  siteId: string; siteName: string; orders: readonly WorkOrder[]; filters: OrderFilters;
  evaluatedAt: string; mode: "online" | "demo"; verified: boolean;
}): OrderReport {
  if (!input.verified || !input.siteId || instantMillis(input.evaluatedAt) == null) throw new Error("ยังยืนยันข้อมูลรายงานไม่ได้");
  if ((input.filters.from && !validCalendarDate(input.filters.from)) || (input.filters.to && !validCalendarDate(input.filters.to)) || (input.filters.from && input.filters.to && input.filters.from > input.filters.to)) throw new Error("ช่วงวันที่รายงานไม่ถูกต้อง");
  if (input.orders.some(order => order.jobsiteId !== input.siteId) || new Set(input.orders.map(order => order.id)).size !== input.orders.length) throw new Error("ขอบเขตหรือรายการใบงานไม่ถูกต้อง");
  const rows = filterWorkOrders([...input.orders], input.filters);
  const facts = rows.map(order => ({ order, timing: orderTiming(order, input.evaluatedAt) }));
  const open = facts.filter(({ order }) => order.status !== "เสร็จสิ้น");
  const time = (value: string | null | undefined) => instantMillis(value) == null ? "ไม่ทราบ" : value!;
  const sheets: ExcelSheet[] = [
    { name: "สรุปใบงาน", headers: ["รายการ", "ค่า"], rows: [
      ["ไซต์", input.siteName], ["รหัสไซต์", input.siteId], ["ใบงานตามตัวกรอง", rows.length],
      ["ยังไม่ปิดงาน", open.length], ["ปิดงานแล้ว", facts.length - open.length],
      ["งานเปิดครบกำหนดวันนี้ (ไทย)", open.filter(f => f.timing.dueToday).length],
      ["งานเปิดเกินกำหนด", open.filter(f => f.timing.overdue).length],
      ["งานเปิดไม่ทราบวันกำหนด", open.filter(f => f.timing.unknownDue).length],
      ["ใบงานไม่ทราบระยะเวลาตั้งแต่เริ่ม", facts.filter(f => f.timing.executionMinutes == null).length],
      ["ความหมายระยะเวลา", "เวลาผ่านไป รวมรอตรวจรับ ไม่ใช่ชั่วโมงแรงงานหรือผล SLA"],
    ] },
    { name: "รายการใบงาน", headers: ["รหัสไซต์", "เลขใบงาน", "ประเภท", "หัวข้อ", "รหัสเครื่อง", "ชื่อเครื่อง", "สถานะ", "รหัสผู้รับผิดชอบ", "ผู้รับผิดชอบ", "ข้อความกำหนดเสร็จ", "กำหนดเสร็จ UTC", "สร้าง UTC", "เริ่ม UTC", "ปิด UTC", "เกินกำหนด ณ เวลาประเมิน", "อายุใบงาน (นาที)", "เวลาผ่านไปตั้งแต่เริ่ม (นาที)"], rows: facts.map(({ order, timing }) => [
      input.siteId, order.id, order.type, order.title, order.assetId, order.assetName, order.status, order.assigneeId ?? "ไม่ทราบ", order.assignee, order.due,
      time(order.dueAt), time(order.createdAt), time(order.startedAt), time(order.completedAt),
      order.status === "เสร็จสิ้น" ? "ปิดงานแล้ว" : timing.unknownDue ? "ไม่ทราบ" : timing.overdue ? "ใช่" : "ไม่",
      timing.ageMinutes ?? "ไม่ทราบ", timing.executionMinutes ?? "ไม่ทราบ",
    ]) },
    { name: "ขอบเขตรายงาน", headers: ["รายการ", "ค่า"], rows: [
      ["เวลาประเมิน UTC", input.evaluatedAt], ["แหล่งข้อมูล", input.mode === "demo" ? "ข้อมูลจำลองในเบราว์เซอร์" : "ข้อมูลออนไลน์ที่โหลดสำเร็จครบตามสิทธิ์"],
      ["สถานะ", input.filters.status], ["คำค้น", input.filters.query], ["รหัสผู้รับผิดชอบ", input.filters.assigneeId || "ทุกคน"],
      ["วันสร้างเริ่ม (ไทย)", input.filters.from || "ไม่จำกัด"], ["วันสร้างสิ้นสุด (ไทย)", input.filters.to || "ไม่จำกัด"],
      ["เวลา", "Asia/Bangkok; รวมวันเริ่มและวันสิ้นสุด"],
      ["ข้อมูลวันที่เดิม", "ไม่ตีความวันที่จากข้อความ ใบงานไม่ทราบวันสร้างจะไม่รวมเมื่อกรองวันที่"],
      ["ข้อจำกัด", "ภาพข้อมูลที่โหลดสำเร็จ ไม่ใช่ snapshot ฐานข้อมูล ณ transaction เดียว ไม่รวมวัสดุ/รูป/ประวัติคำสั่ง"],
    ] },
  ];
  return freeze({ siteId: input.siteId, evaluatedAt: input.evaluatedAt, title: "รายงานใบงาน งานค้าง และระยะเวลา", sheets });
}

export function orderReportPdfSections(report: OrderReport) {
  return report.sheets.flatMap(sheet => sheet.rows.map((row, index) => ({
    label: sheet.headers.length === 2 ? String(row[0]) : `${sheet.name} #${index + 1}`,
    value: sheet.headers.length === 2 ? String(row[1]) : row.map((value, n) => `${sheet.headers[n]}: ${value}`).join("\n"),
  })));
}
