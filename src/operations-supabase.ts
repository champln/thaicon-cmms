import type { AlertItem, WorkOrder } from "./CMMSApp";
import type { ManagedAsset, ManagedJobsite } from "./master-data";
import { supabase } from "./supabase";

export type OperationsState = { workOrders: WorkOrder[]; alerts: AlertItem[] };

const statusToDb: Record<WorkOrder["status"], "waiting" | "in_progress" | "review" | "completed"> = {
  รอมอบหมาย: "waiting",
  กำลังดำเนินการ: "in_progress",
  รอตรวจรับ: "review",
  เสร็จสิ้น: "completed",
};
const statusFromDb = { waiting: "รอมอบหมาย", in_progress: "กำลังดำเนินการ", review: "รอตรวจรับ", completed: "เสร็จสิ้น" } as const;
const priorityToDb: Record<WorkOrder["priority"], "critical" | "high" | "normal" | "low"> = { วิกฤต: "critical", สูง: "high", ปกติ: "normal", ต่ำ: "low" };
const priorityFromDb = { critical: "วิกฤต", high: "สูง", normal: "ปกติ", low: "ต่ำ" } as const;

function client() {
  if (!supabase) throw new Error("ยังไม่ได้ตั้งค่า Supabase");
  return supabase;
}

function formatCreated(value: string) {
  return new Intl.DateTimeFormat("th-TH", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

export type WorkOrderRow = {
  id: string; jobsite_id: string; work_type: WorkOrder["type"]; title: string; asset_id: string;
  priority: keyof typeof priorityFromDb; status: keyof typeof statusFromDb; assignee: string;
  due_label: string; progress: number; created_at: string;
};

export type AlarmRow = {
  id: string; jobsite_id: string; asset_id: string; level: AlertItem["level"]; title: string;
  detail: string; display_time: string; measured_value: string; acknowledged: boolean; occurred_at: string;
};

export function mapSupabaseWorkOrder(row: WorkOrderRow, siteName: Map<string, string>, assetName: Map<string, string>): WorkOrder {
  return { id: row.id, type: row.work_type, title: row.title, assetId: row.asset_id, assetName: assetName.get(row.asset_id) ?? row.asset_id, site: siteName.get(row.jobsite_id) ?? row.jobsite_id, priority: priorityFromDb[row.priority], status: statusFromDb[row.status], assignee: row.assignee, due: row.due_label, created: formatCreated(row.created_at), progress: row.progress };
}

export function mapSupabaseAlarm(row: AlarmRow, siteName: Map<string, string>): AlertItem {
  return { id: row.id, level: row.level, title: row.title, detail: row.detail, assetId: row.asset_id, site: siteName.get(row.jobsite_id) ?? row.jobsite_id, time: row.display_time || formatCreated(row.occurred_at), value: row.measured_value, acknowledged: row.acknowledged };
}

export async function loadSupabaseOperationsState(jobsiteIds: string[], jobsites: ManagedJobsite[], assets: ManagedAsset[]): Promise<OperationsState> {
  if (!jobsiteIds.length) return { workOrders: [], alerts: [] };
  const [ordersResult, alarmsResult] = await Promise.all([
    client().from("work_orders").select("id, jobsite_id, work_type, title, asset_id, priority, status, assignee, due_label, progress, created_at").in("jobsite_id", jobsiteIds).order("created_at", { ascending: false }),
    client().from("alarms").select("id, jobsite_id, asset_id, level, title, detail, display_time, measured_value, acknowledged, occurred_at").in("jobsite_id", jobsiteIds).order("occurred_at", { ascending: false }),
  ]);
  if (ordersResult.error) throw ordersResult.error;
  if (alarmsResult.error) throw alarmsResult.error;
  const siteName = new Map(jobsites.map((site) => [site.id, site.name]));
  const assetName = new Map(assets.map((asset) => [asset.id, asset.name]));
  return {
    workOrders: (ordersResult.data ?? []).map((row) => mapSupabaseWorkOrder(row as WorkOrderRow, siteName, assetName)),
    alerts: (alarmsResult.data ?? []).map((row) => mapSupabaseAlarm(row as AlarmRow, siteName)),
  };
}

function orderPayload(order: WorkOrder, jobsiteId: string) {
  return { jobsite_id: jobsiteId, work_type: order.type, title: order.title, asset_id: order.assetId, priority: priorityToDb[order.priority], status: statusToDb[order.status], assignee: order.assignee, due_label: order.due, progress: order.progress };
}

function alarmPayload(alert: AlertItem, jobsiteId: string) {
  return { jobsite_id: jobsiteId, asset_id: alert.assetId, level: alert.level, title: alert.title, detail: alert.detail, display_time: alert.time, measured_value: alert.value, acknowledged: alert.acknowledged };
}

export async function syncSupabaseOperationsState(previous: OperationsState, next: OperationsState, currentUserId: string, jobsites: ManagedJobsite[]) {
  const siteId = new Map(jobsites.map((site) => [site.name, site.id]));
  const previousOrders = new Map(previous.workOrders.map((item) => [item.id, item]));
  const nextOrders = new Map(next.workOrders.map((item) => [item.id, item]));
  for (const order of next.workOrders) {
    const old = previousOrders.get(order.id);
    const payload = orderPayload(order, siteId.get(order.site) ?? order.site);
    if (!old) {
      const { error } = await client().from("work_orders").insert({ id: order.id, ...payload, created_by: currentUserId });
      if (error) throw error;
    } else if (JSON.stringify(old) !== JSON.stringify(order)) {
      const { error } = await client().from("work_orders").update(payload).eq("id", order.id);
      if (error) throw error;
    }
  }
  for (const order of previous.workOrders) {
    if (!nextOrders.has(order.id)) {
      const { error } = await client().from("work_orders").delete().eq("id", order.id);
      if (error) throw error;
    }
  }

  const previousAlerts = new Map(previous.alerts.map((item) => [item.id, item]));
  const nextAlerts = new Map(next.alerts.map((item) => [item.id, item]));
  for (const alert of next.alerts) {
    const old = previousAlerts.get(alert.id);
    const payload = alarmPayload(alert, siteId.get(alert.site) ?? alert.site);
    if (!old) {
      const { error } = await client().from("alarms").insert({ id: alert.id, ...payload });
      if (error) throw error;
    } else if (JSON.stringify(old) !== JSON.stringify(alert)) {
      const { error } = await client().from("alarms").update(payload).eq("id", alert.id);
      if (error) throw error;
    }
  }
  for (const alert of previous.alerts) {
    if (!nextAlerts.has(alert.id)) {
      const { error } = await client().from("alarms").delete().eq("id", alert.id);
      if (error) throw error;
    }
  }
}
