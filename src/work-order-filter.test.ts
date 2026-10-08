import { expect, it } from "vitest";
import type { WorkOrder } from "./CMMSApp";
import { filterWorkOrders, orderCreatedDate } from "./work-order-filter";
const order: WorkOrder = { id: "WO-A", site: "Site A", type: "CM", title: "Filter", assetId: "A", assetName: "Test", priority: "ปกติ", status: "กำลังดำเนินการ", assignee: "Engineer", assigneeId: "E", due: "Test", created: "Test", progress: 0, createdAt: "2026-10-05T18:00:00Z" };
const filters = { query: "", status: "ทั้งหมด", assigneeId: "", from: "", to: "" };
it("uses Bangkok dates, inclusive bounds and genuine assignee IDs", () => {
  expect(orderCreatedDate(order)).toBe("2026-10-06");
  expect(filterWorkOrders([order],{ ...filters, from: "2026-10-06", to: "2026-10-06", assigneeId: "E" })).toEqual([order]);
  expect(filterWorkOrders([order],{ ...filters, assigneeId: "Other" })).toEqual([]);
  expect(filterWorkOrders([order],{ ...filters, from: "2026-10-07", to: "2026-10-06" })).toEqual([]);
});
it("does not invent dates for legacy display-only creation labels", () => {
  const legacy = { ...order, createdAt: undefined, created: "28 ก.ค. 09:12" };
  expect(orderCreatedDate(legacy)).toBeNull();
  expect(filterWorkOrders([legacy],filters)).toHaveLength(1);
  expect(filterWorkOrders([legacy],{ ...filters, from: "2026-01-01" })).toEqual([]);
});
