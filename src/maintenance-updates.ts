import type { SupabaseClient } from "@supabase/supabase-js";
import { watchScopedUpdates, type UpdateCallbacks, type UpdateSource } from "./scoped-updates";
export const maintenanceUpdateSources: readonly UpdateSource[] = [
  { table: "maintenance_plans", event: "INSERT" },
  { table: "maintenance_plans", event: "UPDATE" },
  { table: "plan_events", event: "INSERT" },
  { table: "service_reports", event: "INSERT" },
  { table: "service_reports", event: "UPDATE" },
  { table: "service_report_events", event: "INSERT" },
  { table: "repair_requests", event: "INSERT" },
  { table: "repair_requests", event: "UPDATE" },
  { table: "repair_events", event: "INSERT" },
];
export const alarmUpdateSources: readonly UpdateSource[] = [
  { table: "alarms", event: "INSERT" },
  { table: "alarms", event: "UPDATE" },
  { table: "alarm_events", event: "INSERT" },
];
/** Command cycle/photo changes have a parent/event in the same transaction.
 * Direct owner-only child edits/deletes are outside this command contract.
 */
export function watchMaintenanceUpdates(client: Pick<SupabaseClient, "channel" | "removeChannel">,
  siteId: string, userId: string, callbacks: UpdateCallbacks) {
  return watchScopedUpdates(client, "maintenance", siteId, userId, maintenanceUpdateSources, callbacks);
}
export function watchAlarmUpdates(client: Pick<SupabaseClient, "channel" | "removeChannel">,
  siteId: string, userId: string, callbacks: UpdateCallbacks) {
  return watchScopedUpdates(client, "alarms", siteId, userId, alarmUpdateSources, callbacks);
}
