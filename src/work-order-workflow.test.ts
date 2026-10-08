import { describe, expect, it } from "vitest";
import { validateWorkOrderCommand as check, type WorkflowActor, type WorkflowOrder } from "./work-order-workflow";

const admin: WorkflowActor = { id: "admin", role: "admin", active: true, siteIds: [] };
const engineer: WorkflowActor = { id: "engineer", role: "engineer", active: true, siteIds: ["SITE-001"] };
const order: WorkflowOrder = { id: "WO-1", siteId: "SITE-001", siteActive: true, status: "waiting", version: 1, assigneeId: null };
describe("TOR work order command contract (not server authorization evidence)", () => {
  it("allows admin to assign an active site engineer without mutating the input", () => {
    expect(check(order, admin, 1, { kind: "assign", assignee: engineer }).assigneeId).toBe("engineer");
    expect(order.assigneeId).toBeNull();
  });
  it.each([
    { ...engineer, active: false }, { ...engineer, siteIds: ["SITE-002"] },
    { ...engineer, role: "user" as const },
  ])("rejects an ineligible assignee %#", assignee => {
    expect(() => check(order, admin, 1, { kind: "assign", assignee })).toThrow();
  });
  it.each([0, 2, NaN, 1.5])("rejects invalid or stale version %s", version => {
    expect(() => check(order, admin, version, { kind: "note", text: "test" })).toThrow();
  });
  it.each([
    { ...admin, active: false }, { ...engineer, role: "user" as const },
    { ...engineer, siteIds: [] },
  ])("rejects inactive/viewer/out-of-site actors %#", actor => {
    expect(() => check(order, actor, 1, { kind: "note", text: "test" })).toThrow();
  });
  it("requires assignment before starting", () => {
    expect(() => check(order, admin, 1, { kind: "start" })).toThrow();
  });
  it("allows assigned engineer to start then submit; only admin may approve", () => {
    const assigned = { ...order, assigneeId: engineer.id };
    expect(check(assigned, engineer, 1, { kind: "start" }).status).toBe("in_progress");
    expect(check({ ...assigned, status: "in_progress" }, engineer, 1, { kind: "submit" }).status).toBe("review");
    expect(() => check({ ...assigned, status: "review" }, engineer, 1, { kind: "approve" })).toThrow();
    expect(check({ ...assigned, status: "review" }, admin, 1, { kind: "approve" }).status).toBe("completed");
  });
  it("requires a reason when returning work", () => {
    const review = { ...order, status: "review" as const, assigneeId: engineer.id };
    expect(() => check(review, admin, 1, { kind: "return", reason: " " })).toThrow();
    expect(check(review, admin, 1, { kind: "return", reason: " เติมภาพ " })).toEqual({ status: "in_progress", assigneeId: engineer.id, note: "เติมภาพ" });
  });
  it("blocks another engineer, invalid transitions and closed or inactive-site changes", () => {
    expect(() => check({ ...order, assigneeId: "other" }, engineer, 1, { kind: "start" })).toThrow();
    expect(() => check(order, admin, 1, { kind: "approve" })).toThrow();
    expect(() => check({ ...order, status: "completed" }, admin, 1, { kind: "note", text: "test" })).toThrow();
    expect(() => check({ ...order, siteActive: false }, admin, 1, { kind: "note", text: "test" })).toThrow();
  });
  it("validates note length", () => {
    for (const text of [" ", "x".repeat(4001)]) expect(() => check(order, admin, 1, { kind: "note", text })).toThrow();
  });
});
