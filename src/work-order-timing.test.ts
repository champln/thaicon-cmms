import { describe, expect, it } from "vitest";
import { bangkokDate, bangkokInputToInstant, instantMillis, orderTiming, validCalendarDate } from "./work-order-timing";
import type { WorkOrder } from "./CMMSApp";
const order: WorkOrder = { id: "WO-A", site: "A", jobsiteId: "SITE-001", type: "CM", title: "Test", assetId: "A", assetName: "A", priority: "ปกติ", status: "กำลังดำเนินการ", assignee: "Engineer", due: "วันนี้", created: "เมื่อวาน", progress: 50 };
describe("explicit Bangkok work-order timing, no legacy-label inference", () => {
  it("rejects invalid calendar dates and local-time/label strings", () => {
    expect(validCalendarDate("2026-02-29")).toBe(false);
    expect(validCalendarDate("2028-02-29")).toBe(true);
    for (const value of ["วันนี้ 15:00", "2026-10-06", "2026-02-30T10:00:00Z", "2026-10-06T24:00:00Z", "2026-10-06T10:00:00"]) expect(instantMillis(value)).toBeNull();
  });
  it("converts a Thai-labelled input independently of the browser timezone", () => {
    expect(bangkokInputToInstant("2026-10-06T00:00")).toBe("2026-10-05T17:00:00.000Z");
    expect(bangkokInputToInstant("")).toBeNull();
    expect(() => bangkokInputToInstant("2026-02-30T10:00")).toThrow();
    expect(() => bangkokInputToInstant("2026-10-06T24:00")).toThrow();
  });
  it("uses Bangkok midnight boundaries", () => {
    expect(bangkokDate("2026-10-05T16:59:59Z")).toBe("2026-10-05");
    expect(bangkokDate("2026-10-05T17:00:00Z")).toBe("2026-10-06");
  });
  it("does not classify labels or missing timestamps as due today/zero duration", () => {
    expect(orderTiming(order, "2026-10-06T00:00:00Z")).toMatchObject({ unknownDue: true, dueToday: false, overdue: false, executionMinutes: null, ageMinutes: null });
  });
  it("classifies actual due instants and measures elapsed, not labor or SLA", () => {
    const timed = { ...order, dueAt: "2026-10-05T23:00:00Z", startedAt: "2026-10-05T22:00:00Z", createdAt: "2026-10-05T21:00:00Z" };
    expect(orderTiming(timed, "2026-10-06T00:00:00Z")).toMatchObject({ dueToday: true, overdue: true, unknownDue: false, executionMinutes: 120, ageMinutes: 180 });
    expect(orderTiming({ ...timed, status: "เสร็จสิ้น", completedAt: "2026-10-05T23:30:00Z" }, "2026-10-06T00:00:00Z")).toMatchObject({ dueToday: false, overdue: false, executionMinutes: 90, ageMinutes: 150 });
  });
  it("keeps unknown/negative completion timings unknown", () => {
    const completed = { ...order, status: "เสร็จสิ้น" as const, startedAt: "2026-10-06T00:00:00Z" };
    expect(orderTiming(completed, "2026-10-06T01:00:00Z").executionMinutes).toBeNull();
    expect(orderTiming({ ...completed, completedAt: "2026-10-05T23:00:00Z" }, "2026-10-06T01:00:00Z").executionMinutes).toBeNull();
  });
});
