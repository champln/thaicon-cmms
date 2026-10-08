import type { SupabaseClient } from "@supabase/supabase-js";
import { mapSupabasePlan, mapSupabaseReport, mapSupabaseRepair } from "./maintenance-supabase";
import type { MaintenanceState, ReportAttachment } from "./maintenance";
import type { RawLiveSnapshot } from "./live-snapshot-supabase";
import type { PlanTombstone } from "./live-maintenance-state";

/** Only called inside readScopedLiveSnapshot preparation, before its final
 * actual-role/site check. No state dispatch or writes during preparation.
 */
export async function prepareLiveMaintenance(client: Pick<SupabaseClient,"storage">, snapshot: RawLiveSnapshot) {
  const attachments = new Map<string, ReportAttachment[]>();
  for (let offset=0;offset<snapshot.attachments!.length;offset+=8) {
    const batch=await Promise.all(snapshot.attachments!.slice(offset,offset+8).map(async row=>{
      const path=String(row.storage_path),signed=await client.storage.from("service-report-photos").createSignedUrl(path,3600);
      if(signed.error || !signed.data?.signedUrl) throw new Error("Private photo unavailable");
      return {report:String(row.service_report_id),attachment:{
        id:String(row.id),name:String(row.file_name),type:String(row.content_type),storagePath:path,
        fileSize:Number(row.file_size),dataUrl:signed.data.signedUrl,
      } satisfies ReportAttachment};
    }));
    for(const item of batch) attachments.set(item.report,[...(attachments.get(item.report)??[]),item.attachment]);
  }
  const state:MaintenanceState={
    plans:snapshot.plans!.map(p=>mapSupabasePlan(p,snapshot.cycles!.filter(c=>c.plan_id===p.id))),
    serviceReports:snapshot.reports!.map(r=>mapSupabaseReport(r,attachments.get(String(r.id))??[])),
    repairRequests:snapshot.repairs!.map(mapSupabaseRepair),
  };
  const tombstones:PlanTombstone[]=snapshot.plan_tombstones!.map(t=>({id:String(t.id),siteId:String(t.site_id),version:Number(t.version)}));
  return {state,tombstones};
}
