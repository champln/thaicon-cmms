import { describe,expect,it,vi } from "vitest";
import type {SupabaseClient} from "@supabase/supabase-js";
import {prepareLiveMaintenance} from "./live-maintenance-loader";
describe("atomic snapshot preparation",()=>{
  it("keeps actual cycles/zero targets and every private attachment with bounded concurrent signing",async()=>{
    let active=0,peak=0;
    const sign=vi.fn(async(path:string)=>{active++;peak=Math.max(peak,active);await Promise.resolve();active--;return {data:{signedUrl:"signed:"+path},error:null};});
    const client={storage:{from:vi.fn(()=>({createSignedUrl:sign}))}} as unknown as SupabaseClient;
    const result=await prepareLiveMaintenance(client,{
      plans:[{id:"P",jobsite_id:"SITE-001",version:1}],cycles:[{id:"C",plan_id:"P",sequence:1,label:"Actual",start_month:1,end_month:1,target:0}],
      reports:[{id:"R",jobsite_id:"SITE-001",version:2}],repairs:[],
      attachments:Array.from({length:11},(_,i)=>({id:"PHOTO-"+i,service_report_id:"R",storage_path:"SITE-001/R/"+i,file_name:"Photo "+i,content_type:"image/png",file_size:100})),
      plan_tombstones:[{id:"DELETED",site_id:"SITE-001",version:2}],
    });
    expect(result.state.plans[0].cycles?.[0].target).toBe(0);
    expect(result.state.serviceReports[0].attachments).toHaveLength(11);
    expect(peak).toBeLessThanOrEqual(8);expect(sign).toHaveBeenCalledTimes(11);
    expect(result.tombstones).toEqual([{id:"DELETED",siteId:"SITE-001",version:2}]);
  });
  it("fails the entire preparation rather than silently dropping an unavailable private photo",async()=>{
    const client={storage:{from:()=>({createSignedUrl:async()=>({data:null,error:{message:"403"}})})}} as unknown as SupabaseClient;
    await expect(prepareLiveMaintenance(client,{plans:[],cycles:[],reports:[{id:"R"}],repairs:[],
      attachments:[{id:"A",storage_path:"SITE-001/R/A",service_report_id:"R"}],plan_tombstones:[]})).rejects.toThrow("Private photo");
  });
});
