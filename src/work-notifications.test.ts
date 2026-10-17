import { describe, it, expect } from "vitest";
import type { WorkOrder } from "./CMMSApp";
import { demoWorkNotices, noticeStorageKey } from "./work-notifications";
const now = "2026-10-09T00:00:00Z";
const order = (extra: Partial<WorkOrder> = {}) => ({ id: "w", title: "test", jobsiteId: "s", assigneeId: "u", assignedAt: "2026-10-08T00:00:00Z", status: "กำลังดำเนินการ", version: 3, dueAt: "2026-10-09T01:00:00Z", ...extra } as WorkOrder);
describe("work notification reminders", () => {
  it("isolates recipient, role and canonical site", () => {
    const rows = [order(),order({ id: "other", assigneeId: "v" }),order({ id: "outside", jobsiteId: "x" }),order({ id: "legacy", jobsiteId: undefined })];
    expect(demoWorkNotices(rows,"u","engineer","s",now).map(n=>n.orderId)).toEqual(["w","w"]);
    expect(demoWorkNotices(rows,"u","user","s",now)).toEqual([]);
  });
  it("does not repeat assignments when unrelated version changes", () => {
    expect(demoWorkNotices([order()],"u","engineer","s",now)[0].id).toBe(demoWorkNotices([order({version:4})],"u","engineer","s",now)[0].id);
    expect(demoWorkNotices([order({assignedAt:now})],"u","engineer","s",now)[0].id).not.toBe(demoWorkNotices([order()],"u","engineer","s",now)[0].id);
  });
  it("separates due-soon and overdue; ignores unknown due and completed", () => {
    expect(demoWorkNotices([order({dueAt:"2026-10-08T23:59:59Z"})],"u","engineer","s",now).map(n=>n.kind)).toEqual(["assigned","overdue"]);
    expect(demoWorkNotices([order({dueAt:"วันนี้"})],"u","engineer","s",now).map(n=>n.kind)).toEqual(["assigned"]);
    expect(demoWorkNotices([order({status:"เสร็จสิ้น"})],"u","engineer","s",now)).toEqual([]);
  });
  it("review reminders go to admin and receipt keys separate sites/users", () => {
    expect(demoWorkNotices([order({status:"รอตรวจรับ"})],"a","admin","s",now).map(n=>n.kind)).toContain("review");
    expect(demoWorkNotices([order({status:"รอตรวจรับ"})],"u","engineer","s",now).map(n=>n.kind)).not.toContain("review");
    expect(new Set([noticeStorageKey("u","engineer","s"),noticeStorageKey("v","engineer","s"),noticeStorageKey("u","engineer","x")]).size).toBe(3);
  });
});
