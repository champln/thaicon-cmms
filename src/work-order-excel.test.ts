import { describe, expect, it } from "vitest";
import { workOrderSheets } from "./work-order-excel";
import type { WorkOrder } from "./CMMSApp";
const order: WorkOrder = { id: "WO-test", site: "Site A", type: "CM", title: "Test", assetId: "A", assetName: "Test", priority: "ปกติ", status: "กำลังดำเนินการ", assignee: "Engineer", due: "2026-10-10", created: "Test", progress: 0, historyStatus: "ready", materials: [
  { id: "M1", name: "ไส้กรอง", quantity: 1.2345, unit: "ชิ้น", recordedBy: "E", recordedAt: "2026-10-06T00:00:00Z", voidedBy: null, voidedAt: null, voidReason: null },
  { id: "M2", name: "ผิด", quantity: 2, unit: "ชิ้น", recordedBy: "E", recordedAt: "2026-10-06T00:00:00Z", voidedBy: "A", voidedAt: "2026-10-06T01:00:00Z", voidReason: "จำนวนผิด" },
] };
describe("work order evidence export", () => {
  it("uses actual timestamps and labels elapsed time separately from labor/SLA", () => {
    const timed = { ...order, status: "เสร็จสิ้น" as const, dueAt: "2026-10-06T03:00:00Z", startedAt: "2026-10-06T01:00:00Z", completedAt: "2026-10-06T02:30:00Z" };
    const rows = new Map(workOrderSheets(timed, true)[0].rows.map(row => [row[0], row[1]]));
    expect(rows.get("กำหนดเสร็จ UTC")).toBe(timed.dueAt);
    expect(rows.get("เวลาผ่านไปตั้งแต่เริ่มถึงปิด/เวลาประเมิน (นาที)")).toBe(90);
    expect(rows.get("ความหมายระยะเวลา")).toContain("ไม่ใช่ชั่วโมงแรงงาน");
    expect(new Map(workOrderSheets(order, true)[0].rows.map(row => [row[0], row[1]])).get("กำหนดเสร็จ UTC")).toBe("ไม่ทราบจากข้อมูลเดิม");
  });
  it("retains numeric precision and void evidence without treating it as actual usage", () => {
    const sheets = workOrderSheets(order, true);
    expect(sheets[2].rows[0][2]).toBe(1.2345);
    expect(sheets[2].rows[1].slice(6)).toEqual(["ยกเลิก (ไม่นับใช้จริง)", "A", "2026-10-06T01:00:00Z", "จำนวนผิด"]);
    expect(sheets.every(s => s.rows.every(r => r.length === s.headers.length))).toBe(true);
  });
  it.each(["loading", "error", undefined])("blocks incomplete evidence %s", historyStatus => {
    expect(() => workOrderSheets({ ...order, historyStatus: historyStatus as WorkOrder["historyStatus"] }, true)).toThrow();
  });
});
