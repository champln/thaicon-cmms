import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { readScopedLiveSnapshot, type LiveScope } from "./live-snapshot-supabase";
const scope: LiveScope = {siteId:"SITE-001",userId:"actor",role:"admin"};
function fixture() {
  const context = {protocol:1,site_id:scope.siteId,actor_id:scope.userId,actor_role:scope.role,kind:"maintenance",enabled:true};
  const data = {...context,plans:[{id:"P",jobsite_id:scope.siteId,version:1}],cycles:[{id:"C",plan_id:"P"}],
    reports:[{id:"R",jobsite_id:scope.siteId,version:1}],attachments:[{id:"A",service_report_id:"R",storage_path:"SITE-001/R/a"}],
    repairs:[],plan_tombstones:[]};
  const rpc = vi.fn().mockResolvedValueOnce({data,error:null}).mockResolvedValue({data:context,error:null});
  return {context,data,rpc,client:{rpc} as unknown as Pick<SupabaseClient,"rpc">};
}
describe("scoped live snapshot read boundary", () => {
  it("rechecks actual identity/role/site/gates after asynchronous preparation", async () => {
    const t = fixture(), prepare = vi.fn(async s => s.reports), guard = vi.fn();
    expect(await readScopedLiveSnapshot(t.client,scope,"maintenance",prepare,guard)).toEqual(t.data.reports);
    expect(t.rpc.mock.calls.map(([name]) => name)).toEqual(["read_live_snapshot","live_snapshot_context"]);
    expect(t.rpc.mock.calls.every(([,args]) => args.p_site_id === scope.siteId && args.p_kind === "maintenance")).toBe(true);
    expect(guard).toHaveBeenCalledTimes(4);
  });
  it.each(["actor_id","actor_role","site_id","protocol"] as const)("rejects changed initial %s before signing photos", async key => {
    const t = fixture(); Object.assign(t.data,{[key]:key === "protocol" ? 2 : "OTHER"});
    const prepare = vi.fn();
    await expect(readScopedLiveSnapshot(t.client,scope,"maintenance",prepare,()=>{})).rejects.toThrow();
    expect(prepare).not.toHaveBeenCalled();
  });
  it.each(["actor_id","actor_role","enabled"] as const)("rejects %s changed while preparing photos", async key => {
    const t = fixture(); const changed = {...t.context,[key]:key === "enabled" ? false : "user"};
    t.rpc.mockReset().mockResolvedValueOnce({data:t.data,error:null}).mockResolvedValue({data:changed,error:null});
    await expect(readScopedLiveSnapshot(t.client,scope,"maintenance",async ()=>"signed",()=>{})).rejects.toMatchObject({
      kind:key === "enabled" ? "disabled" : "denied",
    });
  });
  it("does not return prepared data after scope revocation", async () => {
    const t = fixture(); t.rpc.mockReset().mockResolvedValueOnce({data:t.data,error:null})
      .mockResolvedValue({data:null,error:{code:"42501"}});
    await expect(readScopedLiveSnapshot(t.client,scope,"maintenance",async ()=>"private",()=>{})).rejects.toMatchObject({kind:"denied"});
  });
  it("does not publish after a caller scope-generation change during preparation", async () => {
    const t = fixture(); let current = true;
    await expect(readScopedLiveSnapshot(t.client,scope,"maintenance",async ()=>{current=false;return "late";},
      ()=>{if(!current)throw Error("left scope");})).rejects.toThrow("left scope");
    expect(t.rpc).toHaveBeenCalledTimes(1);
  });
  it.each(["PGRST202","503"] as const)("never falls back on %s", async code => {
    const t = fixture(); t.rpc.mockReset().mockResolvedValue({data:null,error:{code}});
    const prepare = vi.fn();
    await expect(readScopedLiveSnapshot(t.client,scope,"maintenance",prepare,()=>{})).rejects.toMatchObject({kind:"failed"});
    expect(prepare).not.toHaveBeenCalled(); expect(t.rpc).toHaveBeenCalledTimes(1);
  });
  it("fails without a partial result when a photo cannot be signed", async () => {
    const t = fixture();
    await expect(readScopedLiveSnapshot(t.client,scope,"maintenance",async ()=>{throw Error("Storage unavailable");},()=>{}))
      .rejects.toThrow("Storage unavailable");
    expect(t.rpc).toHaveBeenCalledTimes(1);
  });
  it("rejects orphan/foreign attachment metadata before storage access", async () => {
    const t = fixture(); t.data.attachments[0].storage_path="OTHER/R/a"; const prepare=vi.fn();
    await expect(readScopedLiveSnapshot(t.client,scope,"maintenance",prepare,()=>{})).rejects.toThrow();
    expect(prepare).not.toHaveBeenCalled();
  });
  it("requires complete collections, positive versions and unique scoped IDs", async () => {
    for (const invalid of [
      {...fixture().data,reports:undefined},
      {...fixture().data,plans:[{id:"P",jobsite_id:"OTHER",version:1}]},
      {...fixture().data,plans:[{id:"P",jobsite_id:scope.siteId,version:0}]},
      {...fixture().data,repairs:[{id:"RR",jobsite_id:scope.siteId,version:1},{id:"RR",jobsite_id:scope.siteId,version:2}]},
      {...fixture().data,plan_tombstones:[{id:"P",site_id:scope.siteId,version:2}]},
    ]) {
      const rpc=vi.fn().mockResolvedValue({data:invalid,error:null}),prepare=vi.fn();
      await expect(readScopedLiveSnapshot({rpc} as unknown as SupabaseClient,scope,"maintenance",prepare,()=>{})).rejects.toThrow();
      expect(prepare).not.toHaveBeenCalled();
    }
  });
});
