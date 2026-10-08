import { describe, expect, it } from "vitest";
import { orderStage } from "./work-order-progress";
describe("workflow stage indicator (not physical Actual)", () => {
  it("derives milestones from authoritative status, including returned work", () => {
    expect(["waiting", "in_progress", "review", "completed"].map(status => orderStage(status as Parameters<typeof orderStage>[0]).value)).toEqual([0, 33, 67, 100]);
    expect(orderStage("in_progress").value).toBeLessThan(orderStage("review").value);
  });
});
