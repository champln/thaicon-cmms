import type { MaintenanceState } from "./maintenance";
import type { PlanCommandState } from "./plan-command-supabase";
import { mergeConfirmedPlan } from "./maintenance-command-mode";

export type PlanTombstone = { id: string; siteId: string; version: number };
const validVersion = (v: unknown): v is number => Number.isSafeInteger(v) && Number(v) > 0;
function validateRows(rows: Array<{ id: string; jobsiteId: string; version?: number }>, siteId: string) {
  const ids = new Set<string>();
  for (const row of rows) {
    if (!row.id || row.jobsiteId !== siteId || !validVersion(row.version) || ids.has(row.id))
      throw new Error("Invalid live snapshot scope/version");
    ids.add(row.id);
  }
}
function upsertVersioned<T extends { id: string; version?: number }>(current: T[], received: T[]) {
  const merged = new Map(current.map(row => [row.id, row]));
  for (const row of received) {
    const known = merged.get(row.id);
    if (!known || (known.version ?? 0) <= row.version!) merged.set(row.id, row);
  }
  return [...merged.values()];
}

/** Pure, command-mode merge. An absent REST/RPC row never proves deletion.
 * A caller must verify identity/site/gates before and after asynchronous photo
 * signing. This does not mutate editor drafts, operation keys or its inputs.
 * Keep confirmations for the lifetime of the scope; clear only on scope exit.
 */
export function mergeLiveMaintenance(current: MaintenanceState, received: MaintenanceState,
  tombstones: PlanTombstone[], known: ReadonlyMap<string, PlanCommandState>, siteId: string) {
  if (!siteId) throw new Error("Missing live snapshot scope");
  validateRows(received.plans, siteId);
  validateRows(received.serviceReports, siteId);
  validateRows(received.repairRequests, siteId);
  const deletedIds = new Set<string>();
  for (const row of tombstones) {
    if (!row.id || row.siteId !== siteId || !validVersion(row.version) || deletedIds.has(row.id) ||
      received.plans.some(p => p.id === row.id)) throw new Error("Invalid plan deletion evidence");
    deletedIds.add(row.id);
  }
  // Detect accidental cross-scope reuse before changing anything.
  for (const rows of [current.plans, current.serviceReports, current.repairRequests]) {
    const matching = rows === current.plans ? received.plans : rows === current.serviceReports ? received.serviceReports : received.repairRequests;
    if (matching.some(row => rows.some(old => old.id === row.id && old.jobsiteId !== siteId)))
      throw new Error("Live snapshot identity collision");
  }
  const confirmations = new Map(known);
  let state = current;
  for (const id of [...received.plans.map(p => p.id),...tombstones.map(t => t.id)]) {
    const prior = confirmations.get(id);
    if (prior && (prior.id !== id || prior.siteId !== siteId)) throw new Error("Live confirmation scope collision");
  }
  for (const plan of received.plans) {
    const prior = confirmations.get(plan.id);
    if (prior?.deleted) {
      // Also protect a caller holding an older list while the confirmation map
      // has already advanced. Command IDs cannot be reused after deletion.
      state = {...state,plans:state.plans.filter(p => p.id !== plan.id)};
      continue;
    }
    const result = mergeConfirmedPlan(state, { id: plan.id, siteId, version: plan.version!, deleted: false, plan }, prior, siteId);
    state = result.state; confirmations.set(plan.id, result.confirmed);
  }
  for (const tombstone of tombstones) {
    const old = state.plans.find(p => p.id === tombstone.id);
    if (old && old.jobsiteId !== siteId) throw new Error("Live tombstone identity collision");
    const result = mergeConfirmedPlan(state, { ...tombstone, deleted: true, plan: null },
      confirmations.get(tombstone.id), siteId);
    state = result.state; confirmations.set(tombstone.id, result.confirmed);
  }
  return { confirmations, state: { ...state,
    serviceReports: upsertVersioned(current.serviceReports, received.serviceReports),
    repairRequests: upsertVersioned(current.repairRequests, received.repairRequests),
  } };
}
