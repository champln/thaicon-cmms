import type { AlertItem } from "./CMMSApp";
/** No owner-ingestion deletion contract exists yet: absence is not a tombstone. */
export function mergeLiveAlarms(current:AlertItem[],received:AlertItem[],siteId:string) {
  const merged=new Map(current.map(a=>[a.id,a])),ids=new Set<string>();
  for(const row of received) {
    const old=merged.get(row.id);
    if(!row.id || ids.has(row.id) || row.jobsiteId!==siteId || !Number.isSafeInteger(row.version) || (row.version??0)<1 ||
      (old?.jobsiteId && old.jobsiteId!==siteId))throw new Error("Invalid live Alarm scope/version");
    ids.add(row.id);
    if(!old || (old.version??0)<=row.version!)merged.set(row.id,row);
  }
  return [...merged.values()];
}
