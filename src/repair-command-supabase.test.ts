import { describe,it,expect,vi } from "vitest";
import { createRepairCommandRepository, createRepairSaveOperation, repairPayload } from "./repair-command-supabase";
import { buildDemoMaintenanceState } from "./maintenance";
import type { SupabaseClient } from "@supabase/supabase-js";
const fixture = () => ({...buildDemoMaintenanceState().repairRequests[0], version: 2});
const key = "10000000-0000-4000-8000-000000000001";
describe("repair commands", () => {
  it("sends business fields only, never actor/version/asset name", () => {
    expect(Object.keys(repairPayload(fixture())).sort()).toEqual(["asset_id","description","priority","reported_by","requested_date","resolution","service_report_id","status","title"].sort());
  });
  it("missing gate is legacy-compatible but unknown readiness blocks", async () => {
    const rpc = vi.fn().mockResolvedValueOnce({error:{code:"PGRST202"}}).mockResolvedValueOnce({error:{code:"503"}}).mockResolvedValueOnce({data:null}).mockResolvedValueOnce({data:false});
    const repo = createRepairCommandRepository({rpc} as unknown as Pick<SupabaseClient,"rpc">);
    expect(await repo.ready()).toBe(false);await expect(repo.ready()).rejects.toMatchObject({kind:"failed"});await expect(repo.ready()).rejects.toMatchObject({kind:"failed"});expect(await repo.ready()).toBe(false);
  });
  it.each([["40001","conflict"],["42501","denied"],["22023","invalid"],["23503","invalid"],["503","failed"]])("maps %s safely",async(code,kind) => {
    const rpc = vi.fn().mockResolvedValue({error:{code,message:"raw server text"}});
    const repo = createRepairCommandRepository({rpc} as unknown as Pick<SupabaseClient,"rpc">);
    await expect(repo.save(fixture(),2,key)).rejects.toMatchObject({kind});
  });
  it("validates ACK scope, identity, version and relationship",async () => {
    const r=fixture();const rpc=vi.fn().mockResolvedValueOnce({data:{repair:{id:r.id,jobsite_id:r.jobsiteId,version:3,status:r.status,asset_id:r.assetId,service_report_id:r.serviceReportId},event_no:1,replayed:false}}).mockResolvedValue({data:{repair:{id:r.id,jobsite_id:"OTHER"},event_no:1,replayed:false}});
    const repo=createRepairCommandRepository({rpc} as unknown as Pick<SupabaseClient,"rpc">);
    expect(await repo.save(r,2,key)).toEqual({id:r.id,version:3});await expect(repo.save(r,2,key)).rejects.toMatchObject({kind:"failed"});
  });
  it("freezes values/key across response loss and memoizes confirmed result",async () => {
    const r=fixture(),save=vi.fn().mockRejectedValueOnce(new Error("Lost reply")).mockImplementation(async(snapshot)=>({id:snapshot.id,version:3}));
    const op=createRepairSaveOperation(r,false,{save,ready:async()=>true});r.title="Changed UI";
    await expect(op.run()).rejects.toThrow();await op.run();await op.run();expect(save).toHaveBeenCalledTimes(2);
    expect(save.mock.calls[0]).toEqual(save.mock.calls[1]);expect(save.mock.calls[0][0].title).not.toBe("Changed UI");
  });
  it("allocates exactly one standalone ID, not another on retry",async () => {
    const save=vi.fn().mockRejectedValueOnce(Error("Lost")).mockImplementation(async(r)=>({id:r.id,version:1}));
    const op=createRepairSaveOperation(fixture(),true,{save,ready:async()=>true});await expect(op.run()).rejects.toThrow();await op.run();expect(save.mock.calls[0]).toEqual(save.mock.calls[1]);expect(save.mock.calls[0][1]).toBe(0);expect(op.id).toMatch(/^RR-/);
  });
  it("stops a subsequent attempt after scope change",async () => {
    let active=true;const save=vi.fn().mockImplementation(async(r)=>{active=false;return{id:r.id,version:3};});const op=createRepairSaveOperation(fixture(),false,{save,ready:async()=>true},()=>{if(!active)throw Error("Scope changed");});
    await expect(op.run()).rejects.toThrow("Scope changed");await expect(op.run()).rejects.toThrow("Scope changed");expect(save).toHaveBeenCalledTimes(1);
  });
});
