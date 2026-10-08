import {describe,expect,it} from "vitest";
import {buildDemoMaintenanceState} from "./maintenance";
import {reportDetailState} from "./report-detail-state";
describe("confirmed report detail versions",()=>{
  it("read-only viewers see the newly approved fields/version for export",()=>{
    const selected={...buildDemoMaintenanceState().serviceReports[0],version:1,status:"draft" as const,workPerformed:"Old"};
    const latest={...selected,version:2,status:"approved" as const,workPerformed:"Latest"};
    expect(reportDetailState([latest],selected,true)).toEqual({report:latest,latest,stale:false});
    expect(selected.workPerformed).toBe("Old");
  });
  it("staff retain their selected snapshot and explicit stale state without mutating review drafts",()=>{
    const selected={...buildDemoMaintenanceState().serviceReports[0],version:1},latest={...selected,version:2};
    expect(reportDetailState([latest],selected,false)).toEqual({report:selected,latest,stale:true});
  });
  it("never rewinds a newer confirmation or adopts a different site with the same ID",()=>{
    const selected={...buildDemoMaintenanceState().serviceReports[0],version:3};
    expect(reportDetailState([{...selected,version:2}],selected,true).report).toBe(selected);
    expect(reportDetailState([{...selected,version:4,jobsiteId:"OTHER"}],selected,true).report).toBe(selected);
    const refreshed={...selected,attachments:[{id:"A",name:"Photo",type:"image/png",dataUrl:"renewed"}]};
    expect(reportDetailState([refreshed],selected,true).report?.attachments[0].dataUrl).toBe("renewed");
  });
  it("does not infer deletion from a missing row",()=>{
    const selected=buildDemoMaintenanceState().serviceReports[0];
    expect(reportDetailState([],selected,true)).toEqual({report:selected,latest:selected,stale:false});
    expect(reportDetailState([],null,true).report).toBeNull();
  });
});
