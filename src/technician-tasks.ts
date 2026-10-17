import type { WorkOrder } from "./CMMSApp";
import { instantMillis, orderTiming } from "./work-order-timing";

export type TaskGroup = "all" | "today" | "overdue" | "review" | "undated";
export function technicianTasks(orders: WorkOrder[], userId: string, siteId: string, now: string) {
  const mine = orders.filter(order => !!userId && order.assigneeId === userId && order.jobsiteId === siteId && order.status !== "เสร็จสิ้น");
  const sorted = [...mine].sort((a, b) => (instantMillis(a.dueAt) ?? Infinity) - (instantMillis(b.dueAt) ?? Infinity) || a.id.localeCompare(b.id));
  return {
    all: sorted,
    today: sorted.filter(order => orderTiming(order, now).dueToday),
    overdue: sorted.filter(order => orderTiming(order, now).overdue),
    review: sorted.filter(order => order.status === "รอตรวจรับ"),
    undated: sorted.filter(order => orderTiming(order, now).unknownDue),
  };
}
