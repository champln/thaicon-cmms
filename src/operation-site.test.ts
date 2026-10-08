import {describe,it,expect,vi} from "vitest";
import {operationSiteId,requireOperationSiteId,operationsForSite} from "./operation-site";
import {assetHistory} from "./asset-history";
import {mapSupabaseWorkOrder,mapSupabaseAlarm,syncSupabaseOperationsState} from "./operations-supabase";
import {workOrderSheets} from "./work-order-excel";
import {buildDefaultMasterData} from "./master-data";
const calls=vi.hoisted(()=>({writes:[] as unknown[],filters:[] as unknown[]}));
vi.mock("./supabase",()=>({supabase:{from:(table:string)=>({
 insert:(payload:unknown)=>{calls.writes.push([table,"insert",payload]);return Promise.resolve({error:null});},
 update:(payload:unknown)=>{calls.writes.push([table,"update",payload]);const query={eq:(key:string,value:string)=>{calls.filters.push([key,value]);return query;},then:(resolve:(v:unknown)=>void)=>resolve({error:null})};return query;},
 delete:()=>{calls.writes.push([table,"delete"]);const query={eq:(key:string,value:string)=>{calls.filters.push([key,value]);return query;},then:(resolve:(v:unknown)=>void)=>resolve({error:null})};return query;}
})}}));
const sites=[{id:"SITE-001",name:"Same"},{id:"SITE-002",name:"Same"}],names=new Map(sites.map(s=>[s.id,s.name]));
const order=(site="SITE-001")=>mapSupabaseWorkOrder({id:"WO-"+site,jobsite_id:site,work_type:"PM",title:"Test",asset_id:"AS-A",priority:"normal",status:"waiting",assignee:"",due_label:"Test",progress:0,created_at:"2026-10-06T00:00:00Z"},names,new Map());
const alarm=(site="SITE-001")=>mapSupabaseAlarm({id:"AL-"+site,jobsite_id:site,asset_id:"AS-A",level:"warning",title:"Test",detail:"Test",display_time:"Test",measured_value:"30",acknowledged:false,occurred_at:"2026-10-06T00:00:00Z"},names);
describe("canonical operation site identity",()=>{
 it("maps IDs and excludes the other site despite duplicate display names",()=>{
  expect(order().jobsiteId).toBe("SITE-001");expect(alarm().jobsiteId).toBe("SITE-001");
  expect(operationsForSite([order(),order("SITE-002")],"SITE-001",sites).map(r=>r.id)).toEqual(["WO-SITE-001"]);
  expect(operationsForSite([alarm(),alarm("SITE-002")],"SITE-001",sites).map(r=>r.id)).toEqual(["AL-SITE-001"]);
 });
 it("renames change only display labels, not identity or asset history",()=>{
  const renamed=[{...sites[0],name:"New name"},sites[1]],scoped=operationsForSite([order(),order("SITE-002")],"SITE-001",renamed);
  expect(scoped[0].site).toBe("New name");expect(scoped[0].jobsiteId).toBe("SITE-001");
  const asset={...buildDefaultMasterData().assets[0],id:"AS-A",jobsiteId:"SITE-001"};
  expect(assetHistory(asset,"Old name",[order(),order("SITE-002")],{plans:[],serviceReports:[],repairRequests:[]}).workOrders).toHaveLength(1);
  expect(workOrderSheets(scoped[0],false)[0].rows).toContainEqual(["รหัสไซต์","SITE-001"]);
 });
 it("ambiguous legacy names or invalid explicit IDs never guess; original object stays unchanged",()=>{
  const legacy={site:"Same"},raw=JSON.stringify(legacy);
  expect(operationSiteId(legacy,sites)).toBeNull();expect(operationsForSite([legacy],"SITE-001",sites)).toEqual([]);
  expect(()=>requireOperationSiteId(legacy,sites)).toThrow();expect(operationSiteId({site:"Same",jobsiteId:"Unknown"},[sites[0]])).toBeNull();
  expect(operationsForSite([legacy],"SITE-001",[sites[0]])[0]).toMatchObject({jobsiteId:"SITE-001"});
  expect(JSON.stringify(legacy)).toBe(raw);
 });
 it("canonical legacy writes use the ID and qualify update/delete by site",async()=>{
  calls.writes.length=0;calls.filters.length=0;
  const a=alarm(),w=order(),managed=sites.map(s=>({...buildDefaultMasterData().jobsites[0],...s}));
  await syncSupabaseOperationsState({workOrders:[w],alerts:[a]},{workOrders:[{...w,title:"Edited"}],alerts:[{...a,acknowledged:true}]},"actor",managed);
  expect(calls.writes).toHaveLength(2);for(const write of calls.writes as [string,string,{jobsite_id:string}][])expect(write[2].jobsite_id).toBe("SITE-001");
  expect(calls.filters.filter((v:any)=>v[0]==="jobsite_id")).toEqual([["jobsite_id","SITE-001"],["jobsite_id","SITE-001"]]);
  await syncSupabaseOperationsState({workOrders:[],alerts:[a]},{workOrders:[],alerts:[]},"actor",managed,true);
  expect(calls.filters.at(-1)).toEqual(["jobsite_id","SITE-001"]);
 });
 it("legacy unique-site history uses runtime-resolved records without rewriting original storage",()=>{
  const asset={...buildDefaultMasterData().assets[0],id:"AS-A",jobsiteId:"SITE-001"},legacy={...order(),jobsiteId:undefined},raw=JSON.stringify(legacy);
  const empty={plans:[],serviceReports:[],repairRequests:[]};
  expect(assetHistory(asset,"Same",operationsForSite([legacy],"SITE-001",[sites[0]]),empty).workOrders).toHaveLength(1);
  expect(assetHistory(asset,"Same",operationsForSite([legacy],"SITE-001",sites),empty).workOrders).toHaveLength(0);
  expect(assetHistory(asset,"Same",operationsForSite([{...legacy,jobsiteId:"Unknown"}],"SITE-001",[sites[0]]),empty).workOrders).toHaveLength(0);
  expect(JSON.stringify(legacy)).toBe(raw);
 });
 it("preflights ambiguity or changing an existing site before any write",async()=>{
  calls.writes.length=0;const managed=sites.map(s=>({...buildDefaultMasterData().jobsites[0],...s})),legacy={...alarm(),jobsiteId:undefined};
  await expect(syncSupabaseOperationsState({workOrders:[],alerts:[]},{workOrders:[order()],alerts:[legacy]},"actor",managed)).rejects.toThrow();
  expect(calls.writes).toEqual([]);
  await expect(syncSupabaseOperationsState({workOrders:[],alerts:[alarm()]},{workOrders:[],alerts:[{...alarm(),jobsiteId:"SITE-002"}]},"actor",managed,true)).rejects.toThrow();
  expect(calls.writes).toEqual([]);
 });
});
