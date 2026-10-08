import { reportStatusLabel, repairStatusLabel } from "./maintenance";
import type { ServiceReport, RepairRequest } from "./maintenance";
import type { ExcelSheet } from "./excel-export";

export function serviceReportSheet(reports: ServiceReport[]): ExcelSheet {
  return { name: "Service Reports", headers: ["เลขที่", "ไซต์", "แผน", "รอบ", "ใบงาน", "เครื่องจักร", "ชื่อเครื่อง", "วันที่", "จำนวน", "สถานะ", "นับใน Actual", "ช่าง", "ลูกค้า", "งานที่ทำ", "สิ่งที่พบ", "การดำเนินการ", "ผล", "อนุมัติโดย", "เวลาอนุมัติ", "เหตุผลส่งกลับ"], rows: reports.map(r => [r.id, r.jobsiteId, r.planId, r.cycleId, r.workOrderId ?? "", r.assetId, r.assetName, r.serviceDate, r.quantity, reportStatusLabel(r.status), r.status === "approved" ? r.quantity : 0, r.technicianName, r.customerName, r.workPerformed, r.findings, r.actionTaken, r.result, r.approvedBy ?? "", r.approvedAt ?? "", r.rejectionReason ?? ""]) };
}
export function repairRequestSheet(requests: RepairRequest[]): ExcelSheet {
  return { name: "ใบแจ้งซ่อม", headers: ["เลขที่", "ไซต์", "รายงานต้นทาง", "เครื่องจักร", "ชื่อเครื่อง", "วันที่แจ้ง", "หัวข้อ", "รายละเอียด", "ความสำคัญ", "สถานะ", "ผู้แจ้ง", "ผลการแก้ไข"], rows: requests.map(r => [r.id, r.jobsiteId, r.serviceReportId ?? "", r.assetId, r.assetName, r.requestedDate, r.title, r.description, r.priority, repairStatusLabel(r.status), r.reportedBy, r.resolution]) };
}
export function performanceSheets(input: {
  siteId: string; siteName: string; year: number; month: string; planId: string; cycleId: string;
  target: number; actual: number; progress: number | null; pending: number; reports: ServiceReport[];
  cycles: Array<{ id: string; label: string; planName: string; target: number; actual: number; remaining: number | null; progress: number | null }>;
}): ExcelSheet[] {
  // Defense against callers accidentally including a different site's reports.
  if (input.reports.some(report => report.jobsiteId !== input.siteId)) throw new Error("รายงานต่างไซต์");
  const actual = input.reports.filter(r => r.status === "approved").reduce((sum, r) => sum + r.quantity, 0);
  if (actual !== input.actual) throw new Error("Actual ไม่ตรงกับรายงานต้นทาง");
  return [
    { name: "สรุปและขอบเขต", headers: ["รายการ", "ค่า"], rows: [
      ["ไซต์", `${input.siteId} — ${input.siteName}`], ["ปีแผน ค.ศ.", input.year], ["เดือน", input.month === "all" ? "ทั้งปี" : input.month],
      ["แผน", input.planId === "all" ? "ทุกแผน" : input.planId], ["รอบ", input.cycleId === "all" ? "ทุกรอบ" : input.cycleId],
      ["เป้าหมาย", input.target], ["Actual", input.actual], ["ความคืบหน้า %", input.progress ?? "ไม่ประเมิน"], ["รออนุมัติ", input.pending],
      ["ข้อจำกัดตัวกรองเดือน", "Actual รายเดือนเทียบกับเป้ารอบเต็มไม่ได้ จึงไม่ประเมินความคืบหน้า/คงเหลือเมื่อเลือกเดือน; เป้าหมายศูนย์ไม่คำนวณเปอร์เซ็นต์"],
      ["หลักการนับ", "Actual นับเฉพาะรายงานที่อนุมัติแล้ว; เป้าหมายรวมรอบที่อยู่ในตัวกรอง ไม่เฉลี่ยเป้ารายเดือน"],
      ["ความหมายของปี", "ตัวกรองปีเลือกปีแผน; ยอดรวมอ้างอิงรอบแผนและอาจมีงานข้ามปี ส่วนกราฟในหน้าจอแสดงเฉพาะวันที่ในปีปฏิทินนั้น เดือนเป็นเลขเดือนในรายงาน"],
      ["ขอบเขตข้อมูล", "ข้อมูลที่โหลดสำเร็จในหน้าจอ ณ เวลาดาวน์โหลด ไม่ใช่ฐานข้อมูลแบบ snapshot หรือหลักฐานรับรอง UAT"],
    ] },
    { name: "ผลแยกตามรอบ", headers: ["รหัสรอบ", "แผน", "รอบ", "เป้าหมาย", "Actual", "คงเหลือ", "ความคืบหน้า %"], rows: input.cycles.map(c => [c.id, c.planName, c.label, c.target, c.actual, c.remaining ?? "ไม่ประเมิน", c.progress ?? "ไม่ประเมิน"]) },
    serviceReportSheet(input.reports),
  ];
}
