import type { JobStatus } from "./work-order-workflow";
/** Workflow milestone only; it is not a measured percentage of physical work. */
export function orderStage(status: JobStatus) {
  return { waiting: { value: 0, label: "รอมอบหมาย" }, in_progress: { value: 33, label: "กำลังปฏิบัติงาน" }, review: { value: 67, label: "รอตรวจรับ" }, completed: { value: 100, label: "ตรวจรับแล้ว" } }[status];
}
