import { describe,it,expect,vi } from "vitest";
import { buildDemoMaintenanceState } from "./maintenance";
import { createPlanCommandRepository, createPlanOperation, planPayload } from "./plan-command-supabase";
import { mapSupabasePlan } from "./maintenance-supabase";
import { legacyMaintenanceSlice,mergeLegacyMaintenanceBaseline,mergeConfirmedPlan } from "./maintenance-command-mode";
import type { SupabaseClient } from "@supabase/supabase-js";
const key="10000000-0000-4000-8000-000000000001";
const fixture=()=>({...buildDemoMaintenanceState().plans[0],version:2});
const response=(p=fixture(),version=3)=>({id:p.id,site_id:p.jobsiteId,version,deleted:false,plan:{id:p.id,jobsite_id:p.jobsiteId,version,...planPayload(p)},cycles:[{id:p.id+"-C01",plan_id:p.id,label:"Historical",sequence:1,target:7,start_month:1,end_month:1}],event_no:1,replayed:false});
const repository=(rpc:ReturnType<typeof vi.fn>)=>createPlanCommandRepository({rpc} as unknown as Pick<SupabaseClient,"rpc">);
describe("plan commands",()=>{
 it("sends business-only fields",()=>{expect(Object.keys(planPayload(fixture())).sort()).toEqual(["name","service_type","plan_year","annual_target","cycle_months","start_month","status"].sort());});
 it("missing gate supports old deployments, unknown readiness blocks",async()=>{
  const repo=repository(vi.fn().mockResolvedValueOnce({error:{code:"PGRST202"}}).mockResolvedValueOnce({data:null}).mockResolvedValueOnce({error:{code:"503"}}).mockResolvedValueOnce({data:false}));
  expect(await repo.ready()).toBe(false);await expect(repo.ready()).rejects.toMatchObject({kind:"failed"});await expect(repo.ready()).rejects.toMatchObject({kind:"failed"});expect(await repo.ready()).toBe(false);
 });
 it.each([["40001","conflict"],["42501","denied"],["22023","invalid"],["503","failed"]])("maps %s",async(code,kind)=>{await expect(repository(vi.fn().mockResolvedValue({error:{code}})).apply(fixture(),2,key)).rejects.toMatchObject({kind});});
 it("reads actual historical cycle targets, not regenerated guesses",async()=>{
  const repo=repository(vi.fn().mockResolvedValue({data:response()}));const ack=await repo.apply(fixture(),2,key);expect(ack.plan?.cycles?.[0].target).toBe(7);
  expect(mapSupabasePlan(response().plan,response().cycles).version).toBe(3);
 });
 it.each(["site","version","cycle","missing"])("rejects bad %s ACK",async(which)=>{
  const data=response();if(which==="site")data.site_id="OTHER";if(which==="version")data.version=2;if(which==="cycle")data.cycles[0].plan_id="OTHER";
  await expect(repository(vi.fn().mockResolvedValue({data:which==="missing"?null:data})).apply(fixture(),2,key)).rejects.toMatchObject({kind:"failed"});
 });
 it("requires a positive scoped tombstone to confirm deletion",async()=>{
  const p=fixture(),rpc=vi.fn().mockResolvedValue({data:{id:p.id,site_id:p.jobsiteId,version:3,deleted:true,plan:null,cycles:[],event_no:1,replayed:false}});
  expect((await repository(rpc).apply(p,2,key,true)).deleted).toBe(true);expect(rpc.mock.calls[0][1].p_data).toEqual({});
  await expect(repository(vi.fn().mockResolvedValue({data:null})).read(p.id,p.jobsiteId)).rejects.toMatchObject({kind:"failed"});
 });
 it("freezes stable values/UUID across lost replies, memoizes ACK",async()=>{
  const p=fixture(),apply=vi.fn().mockRejectedValueOnce(Error("Lost")).mockImplementation(async(p)=>({id:p.id,siteId:p.jobsiteId,version:3,deleted:false,plan:p}));
  const op=createPlanOperation(p,false,false,{apply,ready:async()=>true,read:vi.fn()});p.name="Changed UI";
  await expect(op.run()).rejects.toThrow();await op.run();await op.run();expect(apply).toHaveBeenCalledTimes(2);expect(apply.mock.calls[0]).toEqual(apply.mock.calls[1]);expect(apply.mock.calls[0][0].name).not.toBe("Changed UI");
 });
 it("creates one ID only and guards changed scope",async()=>{
  let active=true;const apply=vi.fn().mockImplementation(async(p)=>({id:p.id,siteId:p.jobsiteId,version:1,deleted:false,plan:p}));
  const op=createPlanOperation(fixture(),true,false,{apply,ready:async()=>true,read:vi.fn()},()=>{if(!active)throw Error("Scope changed");});
  await op.run();active=false;await expect(op.run()).rejects.toThrow("Scope changed");expect(apply.mock.calls[0][1]).toBe(0);expect(op.id).toMatch(/^PLAN-/);expect(apply).toHaveBeenCalledTimes(1);
 });
 it("excludes commanded plans from queued legacy writes and preserves confirmed baseline",()=>{
  const initial=buildDemoMaintenanceState(),stale={...initial,plans:[]};
  expect(legacyMaintenanceSlice(initial,false,false,true).plans).toEqual([]);
  expect(legacyMaintenanceSlice(initial,false,false,true).repairRequests).toBe(initial.repairRequests);
  expect(mergeLegacyMaintenanceBaseline(initial,stale,false,false,true).plans).toBe(initial.plans);
 });
 it("late reads cannot rewind or resurrect a confirmed deletion; unrelated drafts stay",()=>{
  const p=fixture(),initial={...buildDemoMaintenanceState(),plans:[p]},old={id:p.id,siteId:p.jobsiteId,version:2,deleted:false,plan:p};
  const deleted={...old,version:3,deleted:true,plan:null};
  expect(mergeConfirmedPlan(initial,old,deleted,p.jobsiteId).state.plans).toEqual([]);
  const newer={...old,version:4,plan:{...p,version:4,name:"Newest"}};
  expect(mergeConfirmedPlan(initial,old,newer,p.jobsiteId).confirmed.plan?.name).toBe("Newest");
  expect(()=>mergeConfirmedPlan(initial,{...old,siteId:"OTHER"},undefined,p.jobsiteId)).toThrow();
 });
});
