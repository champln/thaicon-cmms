import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "./supabase";
import type { RepairRequest } from "./maintenance";
export class RepairCommandError extends Error {
  constructor(public readonly kind: "conflict" | "denied" | "invalid" | "failed", message: string) { super(message); }
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function error(code?: string) {
  const kind = code === "40001" ? "conflict" : code === "42501" ? "denied" : ["22023","23503","23505","22007","22008","22P02"].includes(code ?? "") ? "invalid" : "failed";
  return new RepairCommandError(kind, kind === "conflict" ? "ใบแจ้งซ่อมถูกแก้ไขแล้ว กรุณาตรวจฉบับล่าสุด" : kind === "denied" ? "ไม่มีสิทธิ์บันทึกใบแจ้งซ่อมหรือระบบยังไม่เปิดใช้" : kind === "invalid" ? "กรุณาตรวจข้อมูล วันที่ และเครื่องจักร ใบที่อ้างอิงรายงานต้องคงเครื่องจักรและรายงานเดิม" : "ยังยืนยันผลไม่ได้ กรุณาลองคำขอเดิมอีกครั้ง");
}
export function repairPayload(r: RepairRequest) {
  return { asset_id: r.assetId, requested_date: r.requestedDate, title: r.title, description: r.description,
    priority: r.priority, status: r.status, reported_by: r.reportedBy, resolution: r.resolution, service_report_id: r.serviceReportId };
}
export function createRepairCommandRepository(client: Pick<SupabaseClient,"rpc"> | null = supabase) {
  const requireClient = () => { if (!client) throw error(); return client; };
  return {
    async ready(): Promise<boolean> {
      const {data,error: e} = await requireClient().rpc("repair_commands_ready");
      if (["PGRST202","42883"].includes(e?.code ?? "")) return false;
      if (e || typeof data !== "boolean") throw error(e?.code);
      return data;
    },
    async save(r: RepairRequest, version: number, requestId: string) {
      if (!uuid.test(requestId) || !Number.isSafeInteger(version) || version < 0) throw error("22023");
      const { data, error: e } = await requireClient().rpc("save_repair_command", { p_repair_id: r.id, p_site_id: r.jobsiteId, p_expected_version: version, p_request_id: requestId, p_data: repairPayload(r) });
      if (e) throw error(e.code);
      if (data?.repair?.id !== r.id || data.repair.jobsite_id !== r.jobsiteId || data.repair.version !== version + 1 ||
        data.repair.status !== r.status || data.repair.asset_id !== r.assetId || data.repair.service_report_id !== r.serviceReportId ||
        !Number.isSafeInteger(data.event_no) || data.event_no < 1 || typeof data.replayed !== "boolean") throw error();
      return { id: r.id, version: data.repair.version as number };
    },
  };
}
export function createRepairSaveOperation(r: RepairRequest, isNew: boolean, repository = createRepairCommandRepository(), assertCurrent = () => {}) {
  const snapshot = structuredClone(r); if (isNew) snapshot.id = `RR-${crypto.randomUUID()}`;
  const key = crypto.randomUUID(), version = isNew ? 0 : snapshot.version;
  let ack: {id: string; version: number} | null = null, busy = false;
  return { id: snapshot.id, async run() {
    assertCurrent(); if (busy || version === undefined) throw error(version === undefined ? "22023" : undefined);
    if (ack) return ack;
    busy = true;
    try { ack = await repository.save(snapshot, version, key); assertCurrent(); return ack; }
    finally { busy = false; }
  } };
}
