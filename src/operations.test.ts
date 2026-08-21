import { describe, expect, it } from "vitest";
import { mapSupabaseAlarm, mapSupabaseWorkOrder } from "./operations-supabase";

const sites = new Map([["SITE-001", "โรงพยาบาลกลาง"]]);
const assets = new Map([["AHU-001", "AHU ห้องผ่าตัด"]]);

describe("Supabase operations mapping", () => {
  it("maps database Work Order status and priority to Thai UI values", () => {
    const order = mapSupabaseWorkOrder({ id: "WO-001", jobsite_id: "SITE-001", work_type: "EM", title: "แรงดันต่ำ", asset_id: "AHU-001", priority: "critical", status: "in_progress", assignee: "ช่างทดสอบ", due_label: "วันนี้ 15:00", progress: 50, created_at: "2026-08-21T03:00:00.000Z" }, sites, assets);
    expect(order).toMatchObject({ site: "โรงพยาบาลกลาง", assetName: "AHU ห้องผ่าตัด", priority: "วิกฤต", status: "กำลังดำเนินการ" });
  });

  it("uses the server display time and acknowledgement state for Alarms", () => {
    const alarm = mapSupabaseAlarm({ id: "ALM-001", jobsite_id: "SITE-001", asset_id: "AHU-001", level: "warning", title: "อุณหภูมิสูง", detail: "สูงกว่าเกณฑ์", display_time: "5 นาทีที่แล้ว", measured_value: "29°C", acknowledged: true, occurred_at: "2026-08-21T03:00:00.000Z" }, sites);
    expect(alarm).toMatchObject({ site: "โรงพยาบาลกลาง", time: "5 นาทีที่แล้ว", value: "29°C", acknowledged: true });
  });
});
