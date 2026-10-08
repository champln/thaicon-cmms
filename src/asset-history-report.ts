import type { ManagedAsset } from "./master-data";
import type { WorkOrder } from "./CMMSApp";
import type { MaintenanceState } from "./maintenance";
import type { ExcelSheet } from "./excel-export";
import { assetHistory } from "./asset-history";
import { serviceReportSheet, repairRequestSheet } from "./maintenance-excel";
import { instantMillis } from "./work-order-timing";

function freeze<T>(value: T): T {
  if (value && typeof value === "object") { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}
export function buildAssetHistoryReport(input: {
  asset: ManagedAsset; siteName: string; orders: WorkOrder[]; maintenance: MaintenanceState;
  verified: boolean; mode: "online" | "demo"; evaluatedAt: string;
}) {
  if (!input.verified || !input.asset.id || !input.asset.jobsiteId || instantMillis(input.evaluatedAt) == null) throw new Error("ยังยืนยันประวัติเครื่องจักรครบไม่ได้");
  const history = assetHistory(input.asset, input.siteName, input.orders, input.maintenance);
  for (const rows of [history.workOrders, history.serviceReports, history.repairRequests]) {
    if (rows.some(r => !r.id) || new Set(rows.map(r => r.id)).size !== rows.length) throw new Error("รหัสรายการประวัติซ้ำหรือไม่ถูกต้อง");
  }
  if (history.serviceReports.some(r => !Number.isSafeInteger(r.quantity) || r.quantity < 0)) throw new Error("จำนวนงานในรายงานไม่ถูกต้อง");
  const approvedActual = history.serviceReports.filter(r => r.status === "approved").reduce((sum, r) => sum + r.quantity, 0);
  if (!Number.isSafeInteger(approvedActual)) throw new Error("ยอดงานเกินขอบเขตที่รองรับ");
  const orderIds = new Set(history.workOrders.map(r => r.id)), reportIds = new Set(history.serviceReports.map(r => r.id));
  const references = [
    ...history.serviceReports.map(r => ({ sourceType: "Service Report", sourceId: r.id, targetType: "ใบงาน", targetId: r.workOrderId, found: !!r.workOrderId && orderIds.has(r.workOrderId) })),
    ...history.repairRequests.map(r => ({ sourceType: "ใบแจ้งซ่อม", sourceId: r.id, targetType: "Service Report", targetId: r.serviceReportId, found: !!r.serviceReportId && reportIds.has(r.serviceReportId) })),
  ];
  const unresolved = references.filter(r => r.targetId && !r.found).length;
  const time = (value: string | null | undefined) => instantMillis(value) == null ? "ไม่ทราบ" : value!;
  const sheets: ExcelSheet[] = [
    { name: "สรุปประวัติเครื่อง", headers: ["รายการ", "ค่า"], rows: [
      ["รหัสไซต์", input.asset.jobsiteId], ["ไซต์", input.siteName], ["รหัสเครื่อง", input.asset.id], ["ชื่อเครื่อง", input.asset.name],
      ["ใบงาน", history.workOrders.length], ["Service Report", history.serviceReports.length], ["ใบแจ้งซ่อม", history.repairRequests.length],
      ["จำนวนงานจากรายงานอนุมัติ", approvedActual], ["อ้างอิงที่ไม่พบในประวัติเครื่องนี้", unresolved],
      ["การนับ", "นับเอกสารแต่ละประเภทแยกตามรหัส ไม่รวมจำนวนใบงานกับจำนวนรายงานเป็นยอดงานเดียว; จำนวนงานนับเฉพาะรายงานอนุมัติ"],
    ] },
    { name: "ใบงานของเครื่อง", headers: ["เลขใบงาน", "รหัสไซต์", "รหัสเครื่อง", "ประเภท", "หัวข้อ", "สถานะ", "ผู้รับผิดชอบ", "ข้อความวันสร้างเดิม", "วันสร้าง UTC", "กำหนดเสร็จ UTC", "เริ่ม UTC", "ปิด UTC", "รายละเอียด"], rows: history.workOrders.map(r => [
      r.id, input.asset.jobsiteId, r.assetId, r.type, r.title, r.status, r.assignee, r.created, time(r.createdAt), time(r.dueAt), time(r.startedAt), time(r.completedAt), r.description ?? "",
    ]) },
    serviceReportSheet(history.serviceReports), repairRequestSheet(history.repairRequests),
    { name: "เอกสารเชื่อมโยง", headers: ["ประเภทต้นทาง", "รหัสต้นทาง", "ประเภทอ้างอิง", "รหัสอ้างอิง", "ผลตรวจในชุดข้อมูล"], rows: references.map(r => [
      r.sourceType, r.sourceId, r.targetType, r.targetId ?? "ไม่ระบุ", !r.targetId ? "ไม่ระบุ" : r.found ? "พบในประวัติเครื่องนี้" : "ไม่พบในชุดข้อมูลเครื่องนี้ ไม่เชื่อมข้อมูลแทน",
    ]) },
    { name: "ขอบเขตประวัติ", headers: ["รายการ", "ค่า"], rows: [
      ["เวลาประเมิน UTC", input.evaluatedAt], ["แหล่งข้อมูล", input.mode === "online" ? "ข้อมูลออนไลน์ที่โหลดสำเร็จครบตามสิทธิ์" : "ข้อมูลจำลอง"],
      ["ช่วงข้อมูล", "เอกสารทั้งหมดที่โหลดครบของรหัสเครื่องและรหัสไซต์นี้ ไม่เลือกด้วยชื่อไซต์"],
      ["ข้อมูลวันที่เดิม", "ไม่เดาวันเวลาจากข้อความเดิม; วันสร้าง/เริ่ม/ปิดที่ไม่มี timestamp แสดงไม่ทราบ"],
      ["เอกสารอ้างอิง", "แสดงรหัสตามต้นทาง; ไม่พบในชุดข้อมูลนี้ไม่ได้แปลว่าเอกสารถูกลบหรือไม่มีอยู่ในฐานอื่น"],
      ["ข้อจำกัด", "ภาพชุดข้อมูลหน้าจอ ไม่ใช่ snapshot ฐานข้อมูล transaction เดียว; ไม่รวมประวัติคำสั่ง วัสดุ หรือไฟล์ภาพ ให้เปิดใบงาน/รายงานต้นทาง; ไม่ใช่การรับรอง UAT/SLA"],
    ] },
  ];
  return freeze({ siteId: input.asset.jobsiteId, assetId: input.asset.id, title: "รายงานประวัติซ่อมและบริการรายเครื่อง", evaluatedAt: input.evaluatedAt, sheets });
}
export function assetHistoryPdfSections(report: ReturnType<typeof buildAssetHistoryReport>) {
  return report.sheets.flatMap(sheet => sheet.rows.map((row, index) => ({
    label: sheet.headers.length === 2 ? String(row[0]) : `${sheet.name} #${index + 1}`,
    value: sheet.headers.length === 2 ? String(row[1]) : row.map((value, n) => `${sheet.headers[n]}: ${value}`).join("\n"),
  })));
}
