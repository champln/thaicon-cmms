import type { WorkOrder } from "./CMMSApp";
import { instantMillis } from "./work-order-timing";
export type WorkNotice = { id: string; orderId: string; title: string; kind: "assigned" | "due-soon" | "overdue" | "review"; read: boolean };
export const noticeLabels: Record<WorkNotice["kind"], string> = { assigned: "งานที่ได้รับมอบหมาย", "due-soon": "ครบกำหนดภายใน 24 ชั่วโมง", overdue: "งานเกินกำหนด", review: "งานรอตรวจรับ" };
export function demoWorkNotices(orders: WorkOrder[], actorId: string, role: string, siteId: string, now: string): WorkNotice[] {
  if (!actorId || !["admin","engineer"].includes(role)) return [];
  const time = instantMillis(now);
  if (time === null) return [];
  const result: WorkNotice[] = [];
  for (const order of orders) {
    if (order.jobsiteId !== siteId || order.status === "เสร็จสิ้น" || (role !== "admin" && order.assigneeId !== actorId)) continue;
    const add = (kind: WorkNotice["kind"], token: string) => result.push({ id: JSON.stringify([order.id,kind,token]), orderId: order.id, title: order.title, kind, read: false });
    if (order.assigneeId === actorId) add("assigned", order.assignedAt ?? String(order.version ?? 1));
    const due = instantMillis(order.dueAt);
    if (due !== null && due < time) add("overdue", String(due));
    else if (due !== null && due <= time + 86400000) add("due-soon", String(due));
    if (role === "admin" && order.status === "รอตรวจรับ") add("review", String(order.events?.filter(e => e.command === "submit").at(-1)?.version ?? order.version ?? 1));
  }
  return result;
}
export function noticeStorageKey(actorId: string, role: string, siteId: string) {
  return "thaicon-notice-reads-demo-v1:" + JSON.stringify([actorId,role,siteId]);
}
