import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createOrderCommandRepository, type OrderCommandRequest, type OrderCreateRequest } from "./work-order-command-supabase";
const request: OrderCommandRequest = { orderId: "WO-A", expectedVersion: 1, requestId: "10000000-0000-4000-8000-000000000001", command: "note", note: "ตรวจแล้ว" };
const response = { event_no: 1, replayed: false, order: { id: "WO-A", jobsite_id: "SITE-001", status: "waiting", version: 2, assignee_id: null, assignee: "ยังไม่มอบหมาย" } };
function setup(data: unknown = response, error: unknown = null) {
  const rpc = vi.fn().mockResolvedValue({ data, error });
  const client = { rpc } as unknown as Pick<SupabaseClient, "rpc" | "from">;
  return { repository: createOrderCommandRepository(client), rpc };
}
describe("work order command adapter", () => {
  it("preserves material retry identity without supplying attribution", async () => {
    const { repository, rpc } = setup({ ...response, order: { ...response.order, status: "in_progress" } });
    const material = { orderId: "WO-A", expectedVersion: 1, requestId: request.requestId, action: "add" as const, name: "ไส้กรอง", quantity: 1.25, unit: "ชิ้น" };
    await repository.material(material); await repository.material(material);
    expect(rpc.mock.calls[0]).toEqual(rpc.mock.calls[1]);
    expect(rpc.mock.calls[0]).toEqual(["record_work_order_material", {
      p_order_id: "WO-A", p_expected_version: 1, p_request_id: request.requestId, p_action: "add", p_name: "ไส้กรอง", p_quantity: 1.25, p_unit: "ชิ้น", p_material_id: null, p_reason: null,
    }]);
  });
  it("does not send invalid material quantities", async () => {
    const { repository, rpc } = setup();
    await expect(repository.material({ orderId: "WO-A", expectedVersion: 1, requestId: request.requestId, action: "add", name: "Test", quantity: 1.00001, unit: "piece" })).rejects.toMatchObject({ kind: "invalid" });
    expect(rpc).not.toHaveBeenCalled();
  });
  it("rejects an incomplete material response", async () => {
    await expect(setup(null).repository.material({ orderId: "WO-A", expectedVersion: 1, requestId: request.requestId, action: "add", name: "Test", quantity: 1, unit: "piece" })).rejects.toMatchObject({ kind: "failed" });
  });
  const creation: OrderCreateRequest = { orderId: "WO-20000000-0000-4000-8000-000000000001", requestId: "20000000-0000-4000-8000-000000000001", siteId: "SITE-001", assetId: "A-1", title: "งานทดสอบ", workType: "CM", priority: "normal", dueLabel: "2026-10-07", description: "ตรวจหน้างาน" };
  const created = { ...response, order: { ...response.order, id: creation.orderId, version: 1 } };
  it("retries creation with the same identity without sending server attribution", async () => {
    const { repository, rpc } = setup(created);
    await repository.create(creation); await repository.create(creation);
    expect(rpc.mock.calls[0]).toEqual(rpc.mock.calls[1]);
    expect(rpc.mock.calls[0]).toEqual(["create_work_order_command", {
      p_order_id: creation.orderId, p_request_id: creation.requestId, p_site_id: creation.siteId,
      p_asset_id: creation.assetId, p_title: creation.title, p_work_type: "CM", p_priority: "normal",
      p_due_label: creation.dueLabel, p_description: creation.description,
    }]);
  });
  it("accepts an original creation replay after subsequent commands", async () => {
    await expect(setup({ ...created, replayed: true }).repository.create(creation)).resolves.toBeUndefined();
  });
  it("passes an explicit due instant unchanged across exact-key retries", async () => {
    const { repository, rpc } = setup(created);
    const input = { ...creation, dueAt: "2026-10-06T02:00:00.000Z" };
    await repository.create(input); await repository.create(input);
    expect(rpc.mock.calls[0]).toEqual(rpc.mock.calls[1]);
    expect(rpc.mock.calls[0][1].p_due_at).toBe(input.dueAt);
  });
  it("rejects local-time or invalid due instants before issuing commands", async () => {
    const { repository, rpc } = setup(created);
    await expect(repository.create({ ...creation, dueAt: "วันนี้" })).rejects.toMatchObject({ kind: "invalid" });
    expect(rpc).not.toHaveBeenCalled();
  });
  it.each([
    { ...creation, orderId: "WO-" + "-".repeat(36) }, { ...creation, assetId: " " },
    { ...creation, title: "x".repeat(301) }, { ...creation, description: "x".repeat(4001) },
  ])("rejects invalid creation before writing %#", async invalid => {
    const { repository, rpc } = setup(created);
    await expect(repository.create(invalid)).rejects.toMatchObject({ kind: "invalid" });
    expect(rpc).not.toHaveBeenCalled();
  });
  it.each([
    { ...created, replayed: "yes" }, { ...created, order: { ...created.order, jobsite_id: "SITE-OTHER" } },
    { ...created, order: { ...created.order, version: 2 } },
  ])("does not claim creation success from a malformed response %#", async data => {
    await expect(setup(data).repository.create(creation)).rejects.toMatchObject({ kind: "failed" });
  });
  it("keeps older backend compatibility but does not hide other readiness failures", async () => {
    await expect(setup(null, { code: "PGRST202" }).repository.ready()).resolves.toBe(false);
    await expect(setup(null, { code: "42501" }).repository.ready()).rejects.toMatchObject({ kind: "failed" });
  });
  it("preserves retry identity and payload without supplying attribution", async () => {
    const { repository, rpc } = setup();
    await repository.execute(request); await repository.execute(request);
    expect(rpc.mock.calls[0]).toEqual(rpc.mock.calls[1]);
    expect(rpc.mock.calls[0]).toEqual(["apply_work_order_command", {
      p_order_id: "WO-A", p_expected_version: 1, p_request_id: request.requestId,
      p_command: "note", p_assignee_id: null, p_note: "ตรวจแล้ว",
    }]);
  });
  it("accepts original replay snapshot without treating it as current data", async () => {
    const { repository } = setup({ ...response, replayed: true });
    expect((await repository.execute(request)).replayed).toBe(true);
  });
  it.each([
    ["40001", "conflict"], ["42501", "denied"], ["22023", "invalid"], ["503", "failed"],
  ])("maps server error %s for actionable handling", async (code, kind) => {
    const { repository } = setup(null, { code, message: "internal data not shown" });
    await expect(repository.execute(request)).rejects.toMatchObject({ kind });
  });
  it.each([
    { ...request, requestId: "not-uuid" }, { ...request, expectedVersion: 0 },
    { ...request, note: " " }, { ...request, command: "start" as const },
    { ...request, command: "assign" as const, assigneeId: "wrong" },
  ])("rejects invalid commands before requesting a write %#", async invalid => {
    const { repository, rpc } = setup();
    await expect(repository.execute(invalid)).rejects.toMatchObject({ kind: "invalid" });
    expect(rpc).not.toHaveBeenCalled();
  });
  it.each([
    null, { ...response, event_no: 0 }, { ...response, order: { ...response.order, version: 99 } },
    { ...response, order: { ...response.order, id: "OTHER" } }, { ...response, replayed: "yes" },
  ])("does not report incomplete/mismatched response as saved %#", async data => {
    const { repository } = setup(data);
    await expect(repository.execute(request)).rejects.toMatchObject({ kind: "failed" });
  });
  it("distinguishes disabled from readiness failure", async () => {
    await expect(setup(false).repository.ready()).resolves.toBe(false);
    await expect(setup(null, { code: "500" }).repository.ready()).rejects.toMatchObject({ kind: "failed" });
  });
  it("rejects missing client", async () => {
    await expect(createOrderCommandRepository(null).execute(request)).rejects.toMatchObject({ kind: "failed" });
  });
  it("paginates history and rejects failed pages rather than return a partial history", async () => {
    const first = Array.from({ length: 200 }, (_, i) => ({ event_no: i + 1 }));
    const range = vi.fn().mockResolvedValueOnce({ data: first, error: null }).mockResolvedValueOnce({ data: [{ event_no: 201 }], error: null });
    const query = { select: vi.fn(), eq: vi.fn(), order: vi.fn(), range };
    query.select.mockReturnValue(query); query.eq.mockReturnValue(query); query.order.mockReturnValue(query);
    const from = vi.fn().mockReturnValue(query);
    const repository = createOrderCommandRepository({ from } as unknown as Pick<SupabaseClient, "rpc" | "from">);
    expect((await repository.history("WO-A")).length).toBe(201);
    expect(query.eq).toHaveBeenCalledWith("work_order_id", "WO-A");
    expect(range.mock.calls).toEqual([[0, 199], [200, 399]]);
    range.mockResolvedValueOnce({ data: first, error: null }).mockResolvedValueOnce({ data: null, error: { code: "500" } });
    await expect(repository.history("WO-A")).rejects.toMatchObject({ kind: "failed" });
  });
});
