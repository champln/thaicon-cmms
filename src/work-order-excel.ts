import type { WorkOrder } from "./CMMSApp";
import type { ExcelSheet } from "./excel-export";
import { instantMillis, orderTiming } from "./work-order-timing";

/** Detail export refuses incomplete evidence instead of silently exporting blanks. */
export function workOrderSheets(order: WorkOrder, advanced: boolean): ExcelSheet[] {
  if (advanced && order.historyStatus !== "ready") throw new Error("รอโหลดประวัติและวัสดุให้ครบก่อนส่งออก");
  const evaluatedAt = new Date().toISOString();
  const timing = orderTiming(order, evaluatedAt);
  const knownTime = (value: string | null | undefined) => instantMillis(value) == null ? "ไม่ทราบจากข้อมูลเดิม" : value!;
  return [
    { name: "ใบงาน", headers: ["รายการ", "ค่า"], rows: [
      ["เลขที่", order.id], ["ไซต์", order.site], ["รหัสไซต์", order.jobsiteId ?? "ไม่ระบุในข้อมูลเดิม"], ["เครื่องจักร", order.assetId], ["ชื่อเครื่อง", order.assetName],
      ["ประเภท", order.type], ["หัวข้อ", order.title], ["รายละเอียด", order.description ?? ""],
      ["สถานะ", order.status], ["ผู้รับผิดชอบ", order.assignee], ["กำหนดเสร็จ", order.due], ["สร้างเมื่อ", order.created],
      ["กำหนดเสร็จ UTC", knownTime(order.dueAt)], ["สร้างเมื่อ UTC", knownTime(order.createdAt)],
      ["มอบหมายล่าสุด UTC", knownTime(order.assignedAt)], ["เริ่มงาน UTC", knownTime(order.startedAt)], ["ตรวจรับและปิดงาน UTC", knownTime(order.completedAt)],
      ["ประเมินเวลา ณ UTC", evaluatedAt], ["อายุใบงานถึงปิด/เวลาประเมิน (นาที)", timing.ageMinutes ?? "ไม่ทราบ"],
      ["เวลาผ่านไปตั้งแต่เริ่มถึงปิด/เวลาประเมิน (นาที)", timing.executionMinutes ?? "ไม่ทราบ"],
      ["ความหมายระยะเวลา", "รวมเวลารอตรวจรับ ไม่ใช่ชั่วโมงแรงงานหรือผล SLA"],
      ["รุ่นข้อมูล", order.version ?? 1], ["ขอบเขตประวัติ", advanced ? "ประวัติและวัสดุของใบงานนี้ที่โหลดสำเร็จ" : "ระบบรุ่นเดิมยังไม่เปิดประวัติคำสั่งและวัสดุ"],
    ] },
    { name: "กิจกรรม", headers: ["รหัส", "คำสั่ง", "ผู้ทำรายการ", "เวลา UTC", "บันทึก", "รุ่นใบงาน"], rows: (order.events ?? []).map(e => [e.id, e.command, e.actorName, e.at, e.note ?? "", e.version]) },
    { name: "วัสดุที่ใช้", headers: ["รหัสรายการ", "ชื่อวัสดุ", "จำนวน", "หน่วย", "ผู้บันทึก (รหัส)", "เวลาบันทึก UTC", "สถานะ", "ผู้ยกเลิก (รหัส)", "เวลายกเลิก UTC", "เหตุผล"], rows: (order.materials ?? []).map(m => [m.id, m.name, m.quantity, m.unit, m.recordedBy, m.recordedAt, m.voidedAt ? "ยกเลิก (ไม่นับใช้จริง)" : "ใช้จริง", m.voidedBy ?? "", m.voidedAt ?? "", m.voidReason ?? ""]) },
  ];
}
