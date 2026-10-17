import type { WorkOrder } from "./CMMSApp";
import type { ServiceReport } from "./maintenance";
import { bangkokDate, validCalendarDate } from "./work-order-timing";
export type CalendarEvent = { id: string; date: string; title: string; asset: string; status: string; kind: "WO" | "SR"; order?: WorkOrder };
export function calendarEvents(site: string, orders: WorkOrder[], reports: ServiceReport[]) {
  const events: CalendarEvent[] = [];
  let undated = 0;
  for (const order of orders.filter(o => o.jobsiteId === site)) {
    const date = bangkokDate(order.dueAt);
    if (!date) { undated++; continue; }
    events.push({ id: `WO:${order.id}`, date, title: `${order.id} · ${order.title}`, asset: order.assetId, status: order.status, kind: "WO", order });
  }
  for (const report of reports.filter(r => r.jobsiteId === site)) {
    if (!validCalendarDate(report.serviceDate)) { undated++; continue; }
    events.push({ id: `SR:${report.id}`, date: report.serviceDate, title: `${report.id} · ${report.workPerformed}`, asset: report.assetId,
      status: ({ draft: "ฉบับร่าง", submitted: "รออนุมัติ", approved: "อนุมัติแล้ว", rejected: "ส่งกลับแก้ไข" })[report.status], kind: "SR" });
  }
  return { events: events.sort((a,b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id)), undated };
}
export function shiftDay(day: string, offset: number) { const d = new Date(`${day}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + offset); return d.toISOString().slice(0,10); }
export function monthGrid(month: string) {
  const first = `${month}-01`, weekday = (new Date(`${first}T00:00:00Z`).getUTCDay() + 6) % 7;
  return Array.from({length:42}, (_,i) => shiftDay(first, i-weekday));
}
