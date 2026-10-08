import type { WorkOrder } from "./CMMSApp";
import type { MaintenanceState } from "./maintenance";
import { reportStatusLabel, repairStatusLabel } from "./maintenance";
import type { ExcelSheet } from "./excel-export";
import { serviceReportSheet, repairRequestSheet } from "./maintenance-excel";
import { orderCreatedDate } from "./work-order-filter";
import { instantMillis, validCalendarDate } from "./work-order-timing";

export type HistoryFilters = { query: string; from: string; to: string; assetId: string };
export type HistoryEntry = { kind: string; id: string; assetId: string; date: string | null; title: string; status: string };
function freeze<T>(value: T): T {
  if (value && typeof value === "object") { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}
const dateOnly = (value: string) => validCalendarDate(value) ? value : null;
export function buildSiteHistoryReport(input: {
  siteId: string; siteName: string; orders: readonly WorkOrder[]; maintenance: MaintenanceState;
  filters: HistoryFilters; verified: boolean; mode: "demo" | "online"; evaluatedAt: string;
}) {
  if (!input.verified || !input.siteId || instantMillis(input.evaluatedAt) == null) throw new Error("ยังโหลดประวัติของไซต์ไม่ครบ กรุณาโหลดข้อมูลล่าสุด");
  const f = input.filters;
  if ((f.from && !validCalendarDate(f.from)) || (f.to && !validCalendarDate(f.to)) || (f.from && f.to && f.from > f.to))
    throw new Error("ระบุช่วงวันที่ให้ถูกต้อง วันที่เริ่มต้องไม่เกินวันที่สิ้นสุด");
  const wo = input.orders.filter(r => r.jobsiteId === input.siteId);
  const sr = input.maintenance.serviceReports.filter(r => r.jobsiteId === input.siteId);
  const rr = input.maintenance.repairRequests.filter(r => r.jobsiteId === input.siteId);
  for (const rows of [wo, sr, rr]) {
    if (rows.some(r => !r.id?.trim()) || new Set(rows.map(r => r.id)).size !== rows.length) throw new Error("รหัสเอกสารซ้ำหรือไม่ถูกต้อง");
  }
  if (sr.some(r => !Number.isSafeInteger(r.quantity) || r.quantity < 0)) throw new Error("จำนวนงานในรายงานไม่ถูกต้อง");
  const query = f.query.trim().toLowerCase();
  const accepts = (asset: string, date: string | null, text: string) =>
    (!f.assetId || asset === f.assetId) && (!query || text.toLowerCase().includes(query)) &&
    (!f.from || !!date && date >= f.from) && (!f.to || !!date && date <= f.to);
  const orders = wo.filter(r => accepts(r.assetId, orderCreatedDate(r), `${r.id} ${r.assetId} ${r.assetName} ${r.title} ${r.assignee} ${r.description ?? ""}`));
  const reports = sr.filter(r => accepts(r.assetId, dateOnly(r.serviceDate), `${r.id} ${r.assetId} ${r.assetName} ${r.workOrderId ?? ""} ${r.workPerformed} ${r.findings} ${r.actionTaken} ${r.technicianName}`));
  const repairs = rr.filter(r => accepts(r.assetId, dateOnly(r.requestedDate), `${r.id} ${r.assetId} ${r.assetName} ${r.serviceReportId ?? ""} ${r.title} ${r.description} ${r.resolution}`));
  const orderMap = new Map(wo.map(r => [r.id, r])), reportMap = new Map(sr.map(r => [r.id, r]));
  const selectedWo = new Set(orders.map(r => r.id)), selectedSr = new Set(reports.map(r => r.id));
  function ref<T extends { id: string; assetId: string }>(id: string | null, assetId: string, map: Map<string,T>, selected: Set<string>) {
    const target = id ? map.get(id) : undefined;
    const valid = target && target.assetId === assetId && !!assetId;
    return { target: valid ? target : undefined, state: !id ? "ไม่ระบุ" : !target ? "ไม่พบในข้อมูลไซต์นี้" :
      !valid ? "เครื่องจักรไม่ตรงกัน" : selected.has(id) ? "พบในตัวกรอง" : "พบ นอกตัวกรอง" };
  }
  const references = reports.map(r => {
    const link = ref(r.workOrderId, r.assetId, orderMap, selectedWo);
    return { sourceId: r.id, targetId: r.workOrderId ?? "ไม่ระบุ", state: link.state };
  });
  const chains = repairs.map(r => {
    const report = ref(r.serviceReportId, r.assetId, reportMap, selectedSr);
    const order = report.target ? ref(report.target.workOrderId, r.assetId, orderMap, selectedWo) : undefined;
    return { repairId: r.id, assetId: r.assetId, reportId: r.serviceReportId ?? "ไม่ระบุ", reportState: report.state,
      orderId: report.target?.workOrderId ?? "ไม่ระบุ", orderState: order?.state ?? "ยังตรวจต่อไม่ได้" };
  });
  const actual = reports.filter(r => r.status === "approved").reduce((sum,r) => sum+r.quantity,0);
  if (!Number.isSafeInteger(actual)) throw new Error("จำนวนงานเกินขอบเขตที่รองรับ");
  const entries: HistoryEntry[] = [
    ...orders.map(r => ({ kind: "ใบงาน", id: r.id, assetId: r.assetId, date: orderCreatedDate(r), title: r.title, status: r.status })),
    ...reports.map(r => ({ kind: "Service Report", id: r.id, assetId: r.assetId, date: dateOnly(r.serviceDate), title: r.workPerformed, status: reportStatusLabel(r.status) })),
    ...repairs.map(r => ({ kind: "ใบแจ้งซ่อม", id: r.id, assetId: r.assetId, date: dateOnly(r.requestedDate), title: r.title, status: repairStatusLabel(r.status) })),
  ].sort((a,b) => (b.date ?? "").localeCompare(a.date ?? "") || a.kind.localeCompare(b.kind) || a.id.localeCompare(b.id));
  const unknownDates = wo.filter(r => !orderCreatedDate(r)).length + sr.filter(r => !dateOnly(r.serviceDate)).length + rr.filter(r => !dateOnly(r.requestedDate)).length;
  const sheets: ExcelSheet[] = [
    { name: "สรุปประวัติไซต์", headers: ["รายการ","ค่า"], rows: [
      ["ไซต์",input.siteName],["รหัสไซต์",input.siteId],["ใบงานตามตัวกรอง",orders.length],
      ["Service Report ตามตัวกรอง",reports.length],["ใบแจ้งซ่อมตามตัวกรอง",repairs.length],
      ["จำนวนงานจากรายงานอนุมัติ",actual],["เอกสารไม่ทราบวันที่ในไซต์",unknownDates],
      ["จำนวนใบงานต้นทาง",wo.length],["จำนวน Service Report ต้นทาง",sr.length],["จำนวนใบแจ้งซ่อมต้นทาง",rr.length],
    ] },
    { name: "ประวัติตามวันที่", headers: ["ประเภท","รหัสเอกสาร","รหัสเครื่อง","วันที่","หัวข้อ","สถานะ"],
      rows: entries.map(r => [r.kind,r.id,r.assetId,r.date ?? "ไม่ทราบ",r.title,r.status]) },
    { name: "ใบงาน", headers: ["เลขใบงาน","รหัสไซต์","รหัสเครื่อง","ชื่อเครื่อง","ประเภท","หัวข้อ","สถานะ","ผู้รับผิดชอบ","วันสร้าง (ไทย)","รายละเอียด"],
      rows: orders.map(r => [r.id,input.siteId,r.assetId,r.assetName,r.type,r.title,r.status,r.assignee,orderCreatedDate(r) ?? "ไม่ทราบ",r.description ?? ""]) },
    serviceReportSheet(reports), repairRequestSheet(repairs),
    { name: "Service Report อ้างอิงใบงาน", headers: ["Service Report","ใบงานอ้างอิง","ผลตรวจ"], rows: references.map(r => [r.sourceId,r.targetId,r.state]) },
    { name: "เส้นทางใบแจ้งซ่อม", headers: ["ใบแจ้งซ่อม","รหัสเครื่อง","Service Report","ผลตรวจรายงาน","ใบงาน","ผลตรวจใบงาน"],
      rows: chains.map(r => [r.repairId,r.assetId,r.reportId,r.reportState,r.orderId,r.orderState]) },
    { name: "ขอบเขตประวัติไซต์", headers: ["รายการ","ค่า"], rows: [
      ["เวลาประเมิน UTC",input.evaluatedAt],["แหล่งข้อมูล",input.mode === "online" ? "ข้อมูลออนไลน์ที่โหลดครบตามสิทธิ์" : "ข้อมูลจำลอง"],
      ["คำค้น",f.query],["รหัสเครื่อง",f.assetId || "ทุกเครื่อง"],["ตั้งแต่วันที่",f.from || "ไม่จำกัด"],["ถึงวันที่",f.to || "ไม่จำกัด"],
      ["วันที่", "ใบงานใช้วันสร้างตามเวลาไทย; Service Report ใช้วันให้บริการ; ใบแจ้งซ่อมใช้วันแจ้ง รวมวันเริ่มและสิ้นสุด"],
      ["วันที่ไม่ทราบ", "แสดงเมื่อไม่กรองวันที่ ไม่ตีความจากข้อความวันที่เดิม"],
      ["การเชื่อมโยง", "ตรวจรหัสเอกสารในไซต์และเครื่องเดียวกัน เอกสารอ้างอิงนอกตัวกรองใช้ตรวจเส้นทางแต่ไม่นับเพิ่มในยอดตามตัวกรอง"],
      ["การนับ", "นับเอกสารแต่ละประเภทแยกกัน จำนวนงานนับเฉพาะ Service Report อนุมัติ ไม่เพิ่มยอดจากการเชื่อมเอกสาร"],
      ["ข้อจำกัด", "ภาพข้อมูลที่โหลดสำเร็จ ไม่ใช่ snapshot ฐานข้อมูล transaction เดียว; ไม่พบอ้างอิงไม่ได้ยืนยันว่าเอกสารถูกลบ"],
    ] },
  ];
  return freeze({ title: "ประวัติและเอกสารเชื่อมโยงของไซต์", siteId: input.siteId, evaluatedAt: input.evaluatedAt,
    counts: { orders: orders.length, reports: reports.length, repairs: repairs.length }, unknownDates, entries, references, chains, sheets });
}
export function siteHistoryPdfSections(report: ReturnType<typeof buildSiteHistoryReport>) {
  return report.sheets.flatMap(sheet => sheet.rows.map((row,index) => ({
    label: sheet.headers.length === 2 ? String(row[0]) : `${sheet.name} #${index+1}`,
    value: sheet.headers.length === 2 ? String(row[1]) : row.map((value,n) => `${sheet.headers[n]}: ${value}`).join("\n"),
  })));
}
