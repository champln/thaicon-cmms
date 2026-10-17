import { expect, it } from "vitest";
import { calendarEvents, monthGrid, shiftDay } from "./work-calendar";
import type { WorkOrder } from "./CMMSApp";
import type { ServiceReport } from "./maintenance";
it("uses Bangkok due dates and never parses display labels or foreign sites",()=>{
 const orders=[{id:"1",jobsiteId:"A",dueAt:"2026-10-08T18:00:00Z",status:"รอมอบหมาย"},{id:"2",jobsiteId:"A",due:"วันนี้",dueAt:null},{id:"3",jobsiteId:"B",dueAt:"2026-10-08T18:00:00Z"},{id:"4",dueAt:"2026-10-08T18:00:00Z"}];
 const result=calendarEvents("A",orders as unknown as WorkOrder[],[]); expect(result.events).toHaveLength(1);expect(result.events[0].date).toBe("2026-10-09");expect(result.undated).toBe(1);
});
it("rejects invalid service dates and keeps document types distinct",()=>{
 const reports=[{id:"1",jobsiteId:"A",serviceDate:"2026-02-30",status:"draft"},{id:"2",jobsiteId:"A",serviceDate:"2026-10-09",status:"approved"},{id:"3",jobsiteId:"B",serviceDate:"2026-10-09",status:"approved"}] as ServiceReport[];
 const result=calendarEvents("A",[],reports);expect(result.undated).toBe(1);expect(result.events.map(e=>e.id)).toEqual(["SR:2"]);
});
it("builds Monday-first grids across month and year boundaries",()=>{
 const grid=monthGrid("2026-10");expect(grid).toHaveLength(42);expect(grid[0]).toBe("2026-09-28");expect(shiftDay("2026-12-31",1)).toBe("2027-01-01");expect(monthGrid("2024-02")).toContain("2024-02-29");
});
