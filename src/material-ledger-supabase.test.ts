import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { assertMaterialLedgerAccess } from "./material-ledger-supabase";
const scope = { siteId: "S", userId: "U", role: "user" as const };
const orders = [{ id: "WO-A", version: 2 }];
const data = { protocol: 1, site_id: "S", actor_id: "U", actor_role: "user", enabled: true, parent_count: 1 };
function setup(value: unknown = data, error: unknown = null) {
  const rpc = vi.fn().mockResolvedValue({ data: value, error });
  return { rpc, client: { rpc } as unknown as Pick<SupabaseClient, "rpc"> };
}
describe("material-ledger actual scoped authorization", () => {
  it("sends only exact canonical parents/versions, not client actor attribution", async () => {
    const { rpc, client } = setup(), guard = vi.fn();
    await assertMaterialLedgerAccess(client, scope, orders, guard);
    expect(rpc).toHaveBeenCalledWith("material_ledger_context", { p_site_id: "S", p_orders: orders });
    expect(guard).toHaveBeenCalledTimes(2);
  });
  it("rejects stale/missing actual context fields", async () => {
    for (const patch of [{ protocol: 2 }, { actor_id: "other" }, { actor_role: "admin" }, { site_id: "other" }, { enabled: false }, { parent_count: 0 }]) {
      await expect(assertMaterialLedgerAccess(setup({ ...data, ...patch }).client, scope, orders, () => {})).rejects.toThrow();
    }
  });
  it("never falls back on missing RPC, denial, conflict or network failure", async () => {
    for (const code of ["PGRST202", "42501", "40001", "503"]) {
      await expect(assertMaterialLedgerAccess(setup(null, { code }).client, scope, orders, () => {})).rejects.toThrow();
    }
  });
  it("rejects unconfirmed/duplicate parent versions before issuing requests", async () => {
    for (const selection of [[{ id: "A" }], [{ id: "A", version: 0 }], [orders[0], orders[0]]]) {
      const { rpc, client } = setup();
      await expect(assertMaterialLedgerAccess(client, scope, selection, () => {})).rejects.toThrow();
      expect(rpc).not.toHaveBeenCalled();
    }
  });
  it("checks scope after a delayed server reply", async () => {
    const { client } = setup();
    let count = 0;
    await expect(assertMaterialLedgerAccess(client, scope, orders, () => { if (++count === 2) throw new Error("stale"); })).rejects.toThrow("stale");
  });
});
