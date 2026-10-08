import { describe, expect, it } from "vitest";
import { buildDemoMaintenanceState } from "./maintenance";
import { legacyMaintenanceSlice, mergeConfirmedReport, mergeLegacyMaintenanceBaseline, mergeConfirmedRepair } from "./maintenance-command-mode";
describe("command-owned maintenance snapshots", () => {
  it("never downgrades a newer confirmed report/repair from a late read, but missing scoped rows still fail", () => {
    const current=buildDemoMaintenanceState(),remote=structuredClone(current);
    current.serviceReports[0].version=5;remote.serviceReports[0].version=4;
    current.repairRequests[0].version=5;remote.repairRequests[0].version=4;
    expect(mergeConfirmedReport(current,remote,current.serviceReports[0].id,current.serviceReports[0].jobsiteId,5).report.version).toBe(5);
    expect(mergeConfirmedRepair(current,remote,current.repairRequests[0].id,current.repairRequests[0].jobsiteId,5).repair.version).toBe(5);
    expect(()=>mergeConfirmedReport(current,{...remote,serviceReports:[]},current.serviceReports[0].id,current.serviceReports[0].jobsiteId)).toThrow();
    expect(()=>mergeConfirmedRepair(current,{...remote,repairRequests:[]},current.repairRequests[0].id,current.repairRequests[0].jobsiteId)).toThrow();
    expect(()=>mergeConfirmedReport(current,remote,current.serviceReports[0].id,current.serviceReports[0].jobsiteId,6)).toThrow();
  });
  it("excludes all command repairs and preserves their newer baseline during legacy plan saves", () => {
    const state=buildDemoMaintenanceState(),snapshot=structuredClone(state);snapshot.repairRequests[0].title="Old";
    expect(legacyMaintenanceSlice(state,true,true).repairRequests).toEqual([]);
    expect(mergeLegacyMaintenanceBaseline(state,snapshot,true,true).repairRequests).toBe(state.repairRequests);
  });
  it("merges only the confirmed repair, not unrelated dirty reports/plans", () => {
    const state=buildDemoMaintenanceState(),remote=structuredClone(state);remote.repairRequests[0].version=3;
    state.plans[0].name="Unsaved plan";state.serviceReports[0].workPerformed="Unsaved report";
    const result=mergeConfirmedRepair(state,remote,remote.repairRequests[0].id,remote.repairRequests[0].jobsiteId,3);
    expect(result.state.plans).toBe(state.plans);expect(result.state.serviceReports).toBe(state.serviceReports);
    expect(()=>mergeConfirmedRepair(state,remote,remote.repairRequests[0].id,"OTHER")).toThrow();
    expect(()=>mergeConfirmedRepair(state,remote,remote.repairRequests[0].id,remote.repairRequests[0].jobsiteId,4)).toThrow();
  });
  it("keeps legacy mode unchanged and removes advanced reports/metadata/source repairs from autosync", () => {
    const state = buildDemoMaintenanceState();
    state.repairRequests.push({ ...state.repairRequests[0], id: "linked", serviceReportId: state.serviceReports[0].id });
    expect(legacyMaintenanceSlice(state, false)).toBe(state);
    const legacy = legacyMaintenanceSlice(state, true);
    expect(legacy.serviceReports).toEqual([]); expect(legacy.repairRequests.map(r => r.id)).toEqual(["RR-0001"]);
    expect(legacy.plans).toBe(state.plans);
  });
  it("a late legacy sync cannot replace command-confirmed report baseline", () => {
    const snapshot = buildDemoMaintenanceState(), latest = structuredClone(snapshot);
    latest.serviceReports[0].quantity = 999;
    latest.repairRequests.push({ ...latest.repairRequests[0], id: "server-repair", serviceReportId: latest.serviceReports[0].id });
    const merged = mergeLegacyMaintenanceBaseline(latest, snapshot, true);
    expect(merged.serviceReports[0].quantity).toBe(999); expect(merged.repairRequests.map(r => r.id)).toContain("server-repair");
  });
  it("confirmation merges only target report/source repairs, preserving unrelated dirty plans and repairs", () => {
    const current = buildDemoMaintenanceState(), remote = structuredClone(current);
    current.plans[0].name = "unsaved local plan"; current.repairRequests[0].description = "unsaved local repair";
    remote.serviceReports[0].version = 2; remote.serviceReports[0].quantity = 3;
    remote.repairRequests.push({ ...remote.repairRequests[0], id: "new-repair", serviceReportId: remote.serviceReports[0].id });
    const result = mergeConfirmedReport(current, remote, remote.serviceReports[0].id, "SITE-001");
    expect(result.state.plans[0].name).toBe("unsaved local plan"); expect(result.state.repairRequests.find(r => r.id === "RR-0001")?.description).toBe("unsaved local repair");
    expect(result.report.quantity).toBe(3); expect(result.state.repairRequests.map(r => r.id)).toContain("new-repair");
    expect(() => mergeConfirmedReport(current, remote, remote.serviceReports[0].id, "OTHER")).toThrow();
  });
});
