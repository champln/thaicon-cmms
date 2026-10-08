import {describe,it,expect,vi} from "vitest";
import type {SupabaseClient} from "@supabase/supabase-js";
import {createAlarmCommandRepository,createAlarmAcknowledgeOperation} from "./alarm-command-supabase";
import {syncSupabaseOperationsState} from "./operations-supabase";
const key="10000000-0000-4000-8000-000000000001";
const row={id:"AL-A",jobsite_id:"SITE-001",asset_id:"AS-A",level:"warning",title:"Newest",detail:"Latest sensor reading",measured_value:"31",display_time:"",occurred_at:"2026-10-06T00:00:00Z",acknowledged:true,version:2,acknowledged_by:"actor",acknowledged_at:"2026-10-06T00:01:00Z"};
const repo=(rpc:ReturnType<typeof vi.fn>)=>createAlarmCommandRepository({rpc} as unknown as Pick<SupabaseClient,"rpc"|"from">);
describe("narrow confirmed Alarm acknowledgement",()=>{
 it("sends identity/key only, never cached title/detail/value or supplied actor/time",async()=>{
  const rpc=vi.fn().mockResolvedValue({data:{alarm:row,event_no:1,changed:true,replayed:false}});
  const ack=await repo(rpc).acknowledge("AL-A","SITE-001",key);expect(ack.version).toBe(2);expect(ack.acknowledgedBy).toBe("actor");
  expect(rpc.mock.calls[0][1]).toEqual({p_alarm_id:"AL-A",p_site_id:"SITE-001",p_request_id:key});
 });
 it.each([["42501","denied"],["22023","invalid"],["503","failed"]])("maps %s",async(code,kind)=>{await expect(repo(vi.fn().mockResolvedValue({error:{code}})).acknowledge("AL-A","SITE-001",key)).rejects.toMatchObject({kind});});
 it("missing readiness is old-compatible, unknown cannot fall back",async()=>{
  const r=repo(vi.fn().mockResolvedValueOnce({error:{code:"PGRST202"}}).mockResolvedValueOnce({data:null}).mockResolvedValueOnce({data:false}));
  expect(await r.ready()).toBe(false);await expect(r.ready()).rejects.toMatchObject({kind:"failed"});expect(await r.ready()).toBe(false);
 });
 it.each([{...row,jobsite_id:"OTHER"},{...row,acknowledged_by:null},{...row,acknowledged_at:"not-time"},{...row,version:0},{...row,acknowledged:false}])("rejects incomplete/cross-site acknowledgement proof",async(alarm)=>{
  await expect(repo(vi.fn().mockResolvedValue({data:{alarm,event_no:1,changed:true,replayed:false}})).acknowledge("AL-A","SITE-001",key)).rejects.toMatchObject({kind:"failed"});
 });
 it("keeps one request after lost commit reply and skips RPC after ACK/read failure",async()=>{
  const acknowledge=vi.fn().mockRejectedValueOnce(Error("Reply lost")).mockResolvedValue({id:"AL-A",version:2});
  const read=vi.fn().mockRejectedValueOnce(Error("Read unavailable")).mockResolvedValue({id:"AL-A",version:2,acknowledged:true});
  const op=createAlarmAcknowledgeOperation("AL-A","SITE-001",{acknowledge,read,ready:async()=>true} as unknown as ReturnType<typeof createAlarmCommandRepository>);
  await expect(op.run()).rejects.toThrow("Reply lost");await expect(op.run()).rejects.toThrow("Read unavailable");await op.run();
  expect(acknowledge).toHaveBeenCalledTimes(2);expect(acknowledge.mock.calls[0]).toEqual(acknowledge.mock.calls[1]);expect(read).toHaveBeenCalledTimes(2);
 });
 it("stops phase after changed scope",async()=>{
  let active=true;const acknowledge=vi.fn().mockImplementation(async()=>{active=false;return {id:"AL-A",version:2};}),read=vi.fn();
  const op=createAlarmAcknowledgeOperation("AL-A","SITE-001",{acknowledge,read,ready:async()=>true} as unknown as ReturnType<typeof createAlarmCommandRepository>,()=>{if(!active)throw Error("Scope changed");});
  await expect(op.run()).rejects.toThrow("Scope changed");expect(read).not.toHaveBeenCalled();
 });
 it("commanded alarms never pass through legacy identity/upsert/delete queues",async()=>{
  // No Supabase is configured under unit tests; any accidental legacy write
  // would throw. Empty identities are intentionally unresolvable too.
  const state={workOrders:[],alerts:[{id:"A",site:"ambiguous"}]} as any;
  await expect(syncSupabaseOperationsState(state,{workOrders:[],alerts:[]},"actor",[],true,true)).resolves.toBeUndefined();
 });
 it("gate-OFF old schema PATCH is boolean-only, site-qualified and requires actual receipt, not a fake version",async()=>{
  const update=vi.fn(),eq=vi.fn(),select=vi.fn(),single=vi.fn().mockResolvedValue({data:{...row,version:undefined},error:null});
  const query={update,eq,select,single};update.mockReturnValue(query);eq.mockReturnValue(query);select.mockReturnValue(query);
  const from=vi.fn().mockReturnValue(query),repository=createAlarmCommandRepository({from,rpc:vi.fn()} as unknown as Pick<SupabaseClient,"rpc"|"from">);
  const ack=await repository.legacyAcknowledge("AL-A","SITE-001");
  expect(update).toHaveBeenCalledWith({acknowledged:true});expect(eq.mock.calls).toEqual([["id","AL-A"],["jobsite_id","SITE-001"]]);expect(ack.version).toBeUndefined();
  single.mockResolvedValue({data:{...row,version:undefined,acknowledged_by:null},error:null});
  await expect(repository.legacyAcknowledge("AL-A","SITE-001")).rejects.toMatchObject({kind:"failed"});
 });
});
