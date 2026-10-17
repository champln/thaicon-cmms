import { describe, it, expect } from "vitest";
import type { WorkOrder } from "./CMMSApp";
import { technicianTasks } from "./technician-tasks";
const now = "2026-10-09T03:00:00Z";
const order = (id: string, extra: Partial<WorkOrder> = {}) => ({ id, jobsiteId: "s", assigneeId: "u", status: "กำลังดำเนินการ", dueAt: "2026-10-09T05:00:00Z", ...extra } as WorkOrder);
describe("technician tasks", () => {
  it("uses canonical user/site IDs and excludes completed jobs", () => {
    const result = technicianTasks([order("mine"), order("other", { assigneeId: "v" }), order("site", { jobsiteId: "other" }), order("legacy", { assigneeId: null }), order("unknown", { jobsiteId: undefined }), order("done", { status: "เสร็จสิ้น" })], "u", "s", now);
    expect(result.all.map(o => o.id)).toEqual(["mine"]);
    expect(technicianTasks([order("x", { assigneeId: "" })], "", "s", now).all).toEqual([]);
  });
  it("classifies Bangkok today, overdue and review independently", () => {
    const result = technicianTasks([order("late", { dueAt: "2026-10-08T18:00:00Z", status: "รอตรวจรับ" }), order("future"), order("invalid", { dueAt: "วันนี้" }), order("missing", { dueAt: null })], "u", "s", now);
    expect(result.today.map(o => o.id)).toEqual(["late", "future"]);
    expect(result.overdue.map(o => o.id)).toEqual(["late"]);
    expect(result.review.map(o => o.id)).toEqual(["late"]);
    expect(result.undated.map(o => o.id)).toEqual(["invalid", "missing"]);
  });
  it("does not mark exact deadline overdue and sorts earlier dates first", () => {
    const result = technicianTasks([order("future"), order("now", { dueAt: now })], "u", "s", now);
    expect(result.all.map(o => o.id)).toEqual(["now", "future"]);
    expect(result.overdue).toEqual([]);
  });
});
