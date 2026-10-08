import { describe,expect,it } from "vitest";
import type { AlertItem } from "./CMMSApp";
import {mergeLiveAlarms} from "./live-alarm-state";
const alarm:AlertItem={id:"AL",jobsiteId:"SITE-001",site:"A",assetId:"AS",level:"warning",title:"Current",
  detail:"Latest measurement",time:"Now",value:"33",acknowledged:false,version:3};
describe("monotonic scoped Alarm snapshots",()=>{
  it("does not rewind a newer acknowledgement or measurement",()=>{
    const latest={...alarm,acknowledged:true,version:4,acknowledgedBy:"actual"};
    expect(mergeLiveAlarms([latest],[alarm],"SITE-001")).toEqual([latest]);
  });
  it("upserts new readings without rewriting the input or outside-site data",()=>{
    const old={...alarm,version:2,value:"31"},other={...alarm,id:"OTHER",jobsiteId:"SITE-002"};
    const result=mergeLiveAlarms([old,other],[alarm],"SITE-001");
    expect(result).toEqual([alarm,other]);expect(old.value).toBe("31");
  });
  it("does not infer an owner-ingestion deletion from absence",()=>{
    expect(mergeLiveAlarms([alarm],[],"SITE-001")).toEqual([alarm]);
  });
  it.each(["scope","version","duplicate","collision"] as const)("rejects invalid %s",kind=>{
    const received=kind==="scope"?[{...alarm,jobsiteId:"OTHER"}]:kind==="version"?[{...alarm,version:0}]:
      kind==="duplicate"?[alarm,alarm]:[alarm];
    const current=kind==="collision"?[{...alarm,jobsiteId:"OTHER"}]:[alarm];
    expect(()=>mergeLiveAlarms(current,received,"SITE-001")).toThrow();
  });
});
