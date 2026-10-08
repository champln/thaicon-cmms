import { describe, expect, it } from "vitest";
import { DEMO_OPERATIONS_KEY, loadDemoOperations, saveDemoOperations } from "./operations-demo";
import type { OperationsState } from "./operations-supabase";

const empty: OperationsState = { workOrders: [], alerts: [] };
function storage() {
  const values = new Map<string, string>();
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
}
const example: OperationsState = {
  workOrders: [{ id: "WO-TEST", title: "ทดสอบ", type: "PM", assetId: "A-1", assetName: "เครื่อง 1", site: "ไซต์ 1", priority: "ปกติ", status: "รอมอบหมาย", assignee: "", due: "2026-09-22", created: "2026-09-21", progress: 0 }],
  alerts: [{ id: "AL-1", title: "อุณหภูมิสูง", detail: "ทดสอบ", level: "warning", assetId: "A-1", site: "ไซต์ 1", time: "10:00", value: "30", acknowledged: false }],
};

describe("Demo operations persistence", () => {
  it("restores created orders after a fresh load and preserves alarm acknowledgement", () => {
    const store = storage();
    const created = { ...example, alerts: [{ ...example.alerts[0], acknowledged: true }] };
    expect(saveDemoOperations(created, store)).toBe(true);
    expect(loadDemoOperations(empty, store)).toEqual(created);
  });
  it("keeps all sites when loading so changing site does not erase another site's orders", () => {
    const store = storage();
    const data = { ...example, workOrders: [...example.workOrders, { ...example.workOrders[0], id: "WO-2", site: "ไซต์ 2" }] };
    saveDemoOperations(data, store);
    const loaded = loadDemoOperations(empty, store);
    expect(loaded.workOrders.filter((item) => item.site === "ไซต์ 1")).toHaveLength(1);
    expect(loaded.workOrders.filter((item) => item.site === "ไซต์ 2")).toHaveLength(1);
  });
  it("does not resurrect deleted records from defaults", () => {
    const store = storage(); saveDemoOperations(empty, store);
    expect(loadDemoOperations(example, store)).toEqual(empty);
  });
  it.each(["invalid json", "null", '{"workOrders":[{}],"alerts":[]}', JSON.stringify({ ...example, workOrders: [{ ...example.workOrders[0], status: "wrong" }] })])("falls back safely for invalid storage: %s", (raw) => {
    const store = storage(); store.setItem(DEMO_OPERATIONS_KEY, raw);
    expect(loadDemoOperations(example, store)).toEqual(example);
  });
  it("reports blocked/quota-exceeded storage without throwing", () => {
    const store = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("quota"); } };
    expect(loadDemoOperations(example, store)).toEqual(example);
    expect(saveDemoOperations(example, store)).toBe(false);
  });
  it.each([{ events: "broken" }, { materials: [{ name: "partial" }] }, { version: -1 }])("preserves corrupt optional evidence rather than overwriting it: %j", extra => {
    const store=storage(); const raw=JSON.stringify({...example,workOrders:[{...example.workOrders[0],...extra}]});
    store.setItem(DEMO_OPERATIONS_KEY,raw);
    expect(loadDemoOperations(example,store)).toEqual(example);
    expect(saveDemoOperations(example,store)).toBe(false);
    expect(store.getItem(DEMO_OPERATIONS_KEY)).toBe(raw);
  });
  it("writes only its Demo-specific key", () => {
    const store = storage(); store.setItem("supabase-session", "untouched");
    saveDemoOperations(example, store);
    expect(store.getItem("supabase-session")).toBe("untouched");
  });
});
