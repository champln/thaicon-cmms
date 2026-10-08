import type { SupabaseClient } from "@supabase/supabase-js";
export type LiveScope = { siteId: string; userId: string; role: "admin" | "engineer" | "user" };
export type LiveKind = "maintenance" | "alarms";
export class LiveSnapshotError extends Error {
  constructor(public readonly kind: "denied" | "disabled" | "failed") { super("Live snapshot not confirmed"); }
}
type Row = Record<string, unknown>;
export type RawLiveSnapshot = Row & {
  plans?: Row[]; cycles?: Row[]; reports?: Row[]; attachments?: Row[]; repairs?: Row[];
  plan_tombstones?: Row[]; alarms?: Row[];
};
function checkContext(data: Row | null, scope: LiveScope, kind: LiveKind) {
  if (!data || data.protocol !== 1 || data.site_id !== scope.siteId || data.kind !== kind)
    throw new LiveSnapshotError("failed");
  if (data.actor_id !== scope.userId || data.actor_role !== scope.role) throw new LiveSnapshotError("denied");
  if (data.enabled !== true) throw new LiveSnapshotError(data.enabled === false ? "disabled" : "failed");
}
function rows(data: Row, key: string): Row[] {
  const value = data[key];
  if (!Array.isArray(value) || value.some(r => !r || typeof r !== "object" || Array.isArray(r)))
    throw new LiveSnapshotError("failed");
  const ids = new Set<string>();
  for (const row of value) {
    if (typeof row.id !== "string" || !row.id || ids.has(row.id)) throw new LiveSnapshotError("failed");
    ids.add(row.id);
  }
  return value;
}
function checkRows(data: Row, scope: LiveScope, kind: LiveKind) {
  const parentKeys = kind === "alarms" ? ["alarms"] : ["plans","reports","repairs"];
  const groups = new Map<string, Row[]>();
  for (const key of parentKeys) {
    const group = rows(data,key); groups.set(key,group);
    if (group.some(r => r.jobsite_id !== scope.siteId || !Number.isSafeInteger(r.version) || Number(r.version) < 1))
      throw new LiveSnapshotError("failed");
  }
  if (kind === "alarms") return;
  const plans = new Set(groups.get("plans")!.map(r => r.id)), reports = new Set(groups.get("reports")!.map(r => r.id));
  if (rows(data,"cycles").some(c => !plans.has(c.plan_id))) throw new LiveSnapshotError("failed");
  if (rows(data,"attachments").some(a => !reports.has(a.service_report_id) || typeof a.storage_path !== "string" ||
    !a.storage_path.startsWith(`${scope.siteId}/${a.service_report_id}/`))) throw new LiveSnapshotError("failed");
  if (rows(data,"plan_tombstones").some(t => t.site_id !== scope.siteId || plans.has(t.id) ||
    !Number.isSafeInteger(t.version) || Number(t.version) < 1)) throw new LiveSnapshotError("failed");
}
/** prepare must only build a result (e.g. sign photos), never dispatch state or
 * write. Identity, actual role, site and gates are rechecked afterwards. Callers
 * must retain a scope-generation guard and merge monotonically at dispatch.
 * Missing RPC/network errors are NOT a fallback to legacy writes or Demo.
 */
export async function readScopedLiveSnapshot<T>(client: Pick<SupabaseClient,"rpc">, scope: LiveScope, kind: LiveKind,
  prepare: (snapshot: RawLiveSnapshot) => Promise<T>, assertCurrent: () => void) {
  assertCurrent();
  const params = { p_site_id: scope.siteId, p_kind: kind };
  const { data, error } = await client.rpc("read_live_snapshot", params);
  assertCurrent();
  if (error) throw new LiveSnapshotError(error.code === "42501" ? "denied" : "failed");
  checkContext(data,scope,kind); checkRows(data,scope,kind);
  const prepared = await prepare(data);
  assertCurrent();
  const final = await client.rpc("live_snapshot_context", params);
  assertCurrent();
  if (final.error) throw new LiveSnapshotError(final.error.code === "42501" ? "denied" : "failed");
  checkContext(final.data,scope,kind);
  return prepared;
}
