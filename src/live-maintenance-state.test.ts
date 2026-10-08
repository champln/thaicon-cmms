import { describe, expect, it } from "vitest";
import { buildDemoMaintenanceState, type MaintenanceState } from "./maintenance";
import { mergeLiveMaintenance } from "./live-maintenance-state";
import type { PlanCommandState } from "./plan-command-supabase";
function fixture() {
  const all = buildDemoMaintenanceState(), site = "SITE-001";
  const state: MaintenanceState = {
    plans: all.plans.filter(r => r.jobsiteId === site).map(r => ({ ...r, version: 1 })),
    serviceReports: all.serviceReports.filter(r => r.jobsiteId === site).map(r => ({ ...r, version: 1 })),
    repairRequests: all.repairRequests.filter(r => r.jobsiteId === site).map(r => ({ ...r, version: 1 })),
  };
  return { state, site, empty: { plans: [], serviceReports: [], repairRequests: [] } satisfies MaintenanceState };
}
describe("monotonic live maintenance merging", () => {
  it("does not overwrite newer command confirmations from a late snapshot", () => {
    const {state,site} = fixture(), remote = structuredClone(state);
    for (const r of [...state.plans,...state.serviceReports,...state.repairRequests]) r.version = 5;
    state.plans[0].name = "Confirmed"; state.serviceReports[0].quantity = 99;
    const result = mergeLiveMaintenance(state,remote,[],new Map(),site);
    expect(result.state.plans.find(p => p.id === state.plans[0].id)?.name).toBe("Confirmed");
    expect(result.state.serviceReports[0].quantity).toBe(99);
    expect(result.state.repairRequests[0].version).toBe(5);
  });
  it("removes only explicit deleted plans and prevents late resurrection", () => {
    const {state,site,empty} = fixture(), before = structuredClone(state), id = state.plans[0].id;
    const deleted = mergeLiveMaintenance(state,empty,[{id,siteId:site,version:2}],new Map(),site);
    expect(deleted.state.plans.some(p => p.id === id)).toBe(false);
    const late = mergeLiveMaintenance(deleted.state,before,[],deleted.confirmations,site);
    expect(late.state.plans.some(p => p.id === id)).toBe(false);
    expect(late.confirmations.get(id)?.deleted).toBe(true);
    expect(mergeLiveMaintenance(before,before,[],deleted.confirmations,site).state.plans.some(p => p.id === id)).toBe(false);
  });
  it("never interprets an empty read as deletion of reports, repairs or plans", () => {
    const {state,site,empty} = fixture();
    const result = mergeLiveMaintenance(state,empty,[],new Map(),site);
    expect(result.state).toEqual(state);
  });
  it("does not mutate input rows, editor snapshots or operation confirmation maps", () => {
    const {state,site} = fixture(), original = structuredClone(state), draft = structuredClone(state.serviceReports[0]);
    draft.workPerformed = "Typed draft";
    const remote = structuredClone(state); remote.serviceReports[0].version = 2; remote.serviceReports[0].quantity = 7;
    const known = new Map<string,PlanCommandState>();
    const result = mergeLiveMaintenance(state,remote,[],known,site);
    expect(result.state.serviceReports[0].quantity).toBe(7);
    expect(state).toEqual(original); expect(known.size).toBe(0); expect(draft.workPerformed).toBe("Typed draft");
  });
  it("keeps actual cycles, zero targets and report attachments from the newer parent version", () => {
    const {state,site} = fixture(), remote = structuredClone(state);
    remote.plans[0].version = 2;
    remote.plans[0].cycles = [{id:"custom",planId:remote.plans[0].id,sequence:1,label:"Actual",startMonth:1,endMonth:1,target:0}];
    remote.serviceReports[0].version = 2;
    remote.serviceReports[0].attachments = [{id:"photo",name:"actual.png",type:"image/png",dataUrl:"signed",storagePath:"actual",fileSize:24}];
    const result = mergeLiveMaintenance(state,remote,[],new Map(),site);
    expect(result.state.plans.find(p => p.id === remote.plans[0].id)?.cycles).toEqual(remote.plans[0].cycles);
    expect(result.state.serviceReports[0].attachments).toEqual(remote.serviceReports[0].attachments);
  });
  it.each(["scope","version","duplicate","tombstone-scope","tombstone-version","contradiction"] as const)(
    "rejects invalid %s without partially changing inputs", kind => {
      const {state,site} = fixture(), original = structuredClone(state), remote = structuredClone(state);
      let tombstones: Array<{id:string;siteId:string;version:number}> = [];
      if (kind === "scope") remote.serviceReports[0].jobsiteId = "OTHER";
      if (kind === "version") remote.repairRequests[0].version = 0;
      if (kind === "duplicate") remote.plans.push(remote.plans[0]);
      if (kind.startsWith("tombstone") || kind === "contradiction") tombstones = [{
        id:remote.plans[0].id,siteId:kind === "tombstone-scope" ? "OTHER" : site,version:kind === "tombstone-version" ? 0 : 2,
      }];
      expect(() => mergeLiveMaintenance(state,remote,tombstones,new Map(),site)).toThrow();
      expect(state).toEqual(original);
    });
  it("does not let a scoped row replace an identically named cross-site identity", () => {
    const {state,site} = fixture(), remote = structuredClone(state);
    state.serviceReports[0].jobsiteId = "OTHER";
    expect(() => mergeLiveMaintenance(state,remote,[],new Map(),site)).toThrow("identity");
  });
  it("rejects a confirmation map accidentally retained from another site", () => {
    const {state,site} = fixture(),id=state.plans[0].id;
    const known=new Map<string,PlanCommandState>([[id,{id,siteId:"OTHER",version:2,deleted:true,plan:null}]]);
    expect(()=>mergeLiveMaintenance(state,state,[],known,site)).toThrow("scope collision");
  });
});
