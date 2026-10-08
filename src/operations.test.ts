import { describe, expect, it } from "vitest";
import { mapSupabaseAlarm, mapSupabaseWorkOrder } from "./operations-supabase";

const sites = new Map([["SITE-001", "โรงพยาบาลกลาง"]]);
const assets = new Map([["AHU-001", "AHU ห้องผ่าตัด"]]);

describe("Supabase operations mapping", () => {
  it("preserves only real due/start/completion instants, leaving legacy times unknown", () => {
    const row = { id: "WO-T", jobsite_id: "SITE-001", work_type: "CM" as const, title: "Times", asset_id: "AHU-001", priority: "normal" as const, status: "completed" as const, assignee: "Engineer", due_label: "วันนี้", progress: 100, created_at: "2026-10-06T00:00:00Z", due_at: "2026-10-06T01:00:00Z", started_at: "2026-10-06T00:30:00Z", completed_at: "2026-10-06T02:00:00Z" };
    expect(mapSupabaseWorkOrder(row, sites, assets)).toMatchObject({ dueAt: row.due_at, startedAt: row.started_at, completedAt: row.completed_at, assignedAt: null });
    expect(mapSupabaseWorkOrder({ ...row, due_at: undefined, started_at: undefined, completed_at: undefined }, sites, assets)).toMatchObject({ dueAt: null, startedAt: null, completedAt: null });
  });
  it("maps database Work Order status and priority to Thai UI values", () => {
    const order = mapSupabaseWorkOrder({ id: "WO-001", jobsite_id: "SITE-001", work_type: "EM", title: "แรงดันต่ำ", asset_id: "AHU-001", priority: "critical", status: "in_progress", assignee: "ช่างทดสอบ", due_label: "วันนี้ 15:00", progress: 50, created_at: "2026-08-21T03:00:00.000Z" }, sites, assets);
    expect(order).toMatchObject({ site: "โรงพยาบาลกลาง", assetName: "AHU ห้องผ่าตัด", priority: "วิกฤต", status: "กำลังดำเนินการ" });
  });

  it("uses the server display time and acknowledgement state for Alarms", () => {
    const alarm = mapSupabaseAlarm({ id: "ALM-001", jobsite_id: "SITE-001", asset_id: "AHU-001", level: "warning", title: "อุณหภูมิสูง", detail: "สูงกว่าเกณฑ์", display_time: "5 นาทีที่แล้ว", measured_value: "29°C", acknowledged: true, occurred_at: "2026-08-21T03:00:00.000Z" }, sites);
    expect(alarm).toMatchObject({ site: "โรงพยาบาลกลาง", time: "5 นาทีที่แล้ว", value: "29°C", acknowledged: true });
  });
});
