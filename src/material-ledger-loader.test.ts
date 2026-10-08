import { describe, expect, it, vi } from "vitest";
import { loadMaterialLedger } from "./material-ledger-loader";
import { readAllPages } from "./read-all-pages";
import type { OrderMaterial } from "./work-order-materials";

const row: OrderMaterial = { id: "A", name: "Bolt", quantity: 1, unit: "ชิ้น", recordedBy: "E", recordedAt: "2026-10-08T00:00:00Z", voidedBy: null, voidedAt: null, voidReason: null };
const defaults = () => ({ orderIds: ["WO-A", "WO-B"], assertCurrent: vi.fn(), assertAuthorized: vi.fn(async () => {}), readMaterials: vi.fn(async (_orderId: string) => [row]) });
describe("complete material ledger loader boundary", () => {
  it("reads serially all 1001 paginated rows and rechecks authorization after reads", async () => {
    const source = Array.from({ length: 1001 }, (_, i) => ({ ...row, id: String(i) }));
    const input = { ...defaults(), orderIds: ["WO-A"], readMaterials: vi.fn(async () => readAllPages(async (start,end) => ({ data: source.slice(start,end + 1), error: null }))) };
    const result = await loadMaterialLedger(input);
    expect(result[0].materials).toHaveLength(1001);
    expect(result[0].materials.at(-1)?.id).toBe("1000");
    expect(input.assertAuthorized).toHaveBeenCalledTimes(2);
    expect(result[0].materials[0]).not.toBe(source[0]);
  });
  it("fails the entire result if a later page or parent read fails", async () => {
    const input = defaults();
    input.readMaterials.mockImplementation(async id => {
      if (id === "WO-A") return [row];
      return readAllPages(async start => start ? { data: null, error: new Error("503") } : { data: Array(200).fill(row), error: null });
    });
    await expect(loadMaterialLedger(input)).rejects.toThrow("503");
  });
  it("never accepts RLS empty results as proof if final authorization is revoked", async () => {
    const input = defaults();
    input.readMaterials.mockResolvedValue([]);
    input.assertAuthorized.mockImplementationOnce(async () => {}).mockImplementationOnce(async () => { throw new Error("denied"); });
    await expect(loadMaterialLedger(input)).rejects.toThrow("denied");
  });
  it("checks actual authorization twice even for no selected parents", async () => {
    const input = { ...defaults(), orderIds: [] };
    expect(await loadMaterialLedger(input)).toEqual([]);
    expect(input.assertAuthorized).toHaveBeenCalledTimes(2);
    expect(input.readMaterials).not.toHaveBeenCalled();
  });
  it("stops dispatch and the next read when the scope changes mid-read", async () => {
    const input = defaults();
    let current = true;
    input.assertCurrent.mockImplementation(() => { if (!current) throw new Error("stale"); });
    input.readMaterials.mockImplementation(async () => { current = false; return [row]; });
    await expect(loadMaterialLedger(input)).rejects.toThrow("stale");
    expect(input.readMaterials).toHaveBeenCalledTimes(1);
  });
  it("rejects duplicate/blank parent IDs before any request", async () => {
    for (const orderIds of [["WO-A", "WO-A"], [""]]) {
      const input = { ...defaults(), orderIds };
      await expect(loadMaterialLedger(input)).rejects.toThrow();
      expect(input.assertAuthorized).not.toHaveBeenCalled();
      expect(input.readMaterials).not.toHaveBeenCalled();
    }
  });
  it("does not make child requests when initial authorization fails", async () => {
    const input = defaults();
    input.assertAuthorized.mockRejectedValue(new Error("denied"));
    await expect(loadMaterialLedger(input)).rejects.toThrow("denied");
    expect(input.readMaterials).not.toHaveBeenCalled();
  });
  it("rejects malformed responses instead of calling them empty materials", async () => {
    const input = defaults();
    input.readMaterials.mockResolvedValue(null as unknown as OrderMaterial[]);
    await expect(loadMaterialLedger(input)).rejects.toThrow("รายการวัสดุไม่สมบูรณ์");
    expect(input.readMaterials).toHaveBeenCalledTimes(1);
  });
  it("captures parent IDs and child values before later async reads mutate sources", async () => {
    const input = defaults(), source = { ...row };
    input.readMaterials.mockImplementation(async id => {
      if (id === "WO-A") { input.orderIds.push("foreign"); return [source]; }
      source.name = "changed";
      return [];
    });
    const result = await loadMaterialLedger(input);
    expect(result.map(batch => batch.orderId)).toEqual(["WO-A", "WO-B"]);
    expect(result[0].materials[0].name).toBe("Bolt");
  });
});
