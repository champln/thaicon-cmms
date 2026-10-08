import type { WorkOrder } from "./CMMSApp";
import { bangkokDate, validCalendarDate } from "./work-order-timing";
export type OrderFilters = { query: string; status: string; assigneeId: string; from: string; to: string };
export function orderCreatedDate(order: WorkOrder) {
  const at = order.createdAt ?? order.events?.find(event => event.command === "create")?.at;
  return bangkokDate(at);
}
export function filterWorkOrders(orders: WorkOrder[], filters: OrderFilters) {
  const query = filters.query.trim().toLowerCase();
  if ((filters.from && !validCalendarDate(filters.from)) || (filters.to && !validCalendarDate(filters.to))) return [];
  if (filters.from && filters.to && filters.from > filters.to) return [];
  return orders.filter(order => {
    const date = orderCreatedDate(order);
    return (filters.status === "ทั้งหมด" || order.status === filters.status)
      && (!query || `${order.id} ${order.title} ${order.assetId} ${order.assetName} ${order.site} ${order.assignee} ${order.description ?? ""}`.toLowerCase().includes(query))
      && (!filters.assigneeId || order.assigneeId === filters.assigneeId)
      && (!filters.from || !!date && date >= filters.from) && (!filters.to || !!date && date <= filters.to);
  });
}
