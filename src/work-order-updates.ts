import type { SupabaseClient } from "@supabase/supabase-js";
import { watchScopedUpdates, type UpdateCallbacks } from "./scoped-updates";
export type { UpdateConnection as OrderUpdateConnection } from "./scoped-updates";

export function watchWorkOrderUpdates(client: Pick<SupabaseClient, "channel" | "removeChannel">,
  siteId: string, userId: string, callbacks: UpdateCallbacks) {
  return watchScopedUpdates(client, "work-orders", siteId, userId, [
    { table: "work_orders", event: "INSERT" },
    { table: "work_orders", event: "UPDATE" },
    { table: "work_order_events", event: "INSERT" },
  ], callbacks);
}
