import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "./supabase";
import type { ServiceReport } from "./maintenance";

type Client = Pick<SupabaseClient, "rpc" | "storage">;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export class ReportCommandError extends Error {
  constructor(public readonly kind: "conflict" | "denied" | "invalid" | "failed", message: string) { super(message); }
}
function commandError(code?: string) {
  const kind = code === "40001" ? "conflict" : code === "42501" ? "denied" : ["22023", "23503", "23505"].includes(code ?? "") ? "invalid" : "failed";
  return new ReportCommandError(kind, kind === "conflict" ? "รายงานมีการเปลี่ยนแปลง กรุณาตรวจข้อมูลล่าสุดก่อนส่งใหม่" : kind === "denied" ? "ไม่มีสิทธิ์แก้ไขรายงานนี้หรือระบบยังไม่เปิดใช้" : kind === "invalid" ? "ข้อมูลรายงาน เครื่องจักร หรือรูปอ้างอิงไม่ตรงกัน กรุณาตรวจสอบก่อนบันทึก" : "ยังยืนยันผลไม่ได้ กรุณาลองคำสั่งเดิมซ้ำ โดยไม่เปลี่ยนข้อมูล");
}
export function reportPayload(report: ServiceReport) {
  return { plan_id: report.planId, cycle_id: report.cycleId, asset_id: report.assetId, work_order_id: report.workOrderId,
    service_date: report.serviceDate, quantity: report.quantity, technician_name: report.technicianName, customer_name: report.customerName,
    work_performed: report.workPerformed, findings: report.findings, action_taken: report.actionTaken, result: report.result,
    attachments: report.attachments.map(a => ({ id: a.id, storage_path: a.storagePath, file_name: a.name, content_type: a.type, file_size: a.fileSize })) };
}
export function createReportCommandRepository(client: Client | null = supabase) {
  const requireClient = () => { if (!client) throw commandError(); return client; };
  async function execute(name: string, args: Record<string, unknown>, id: string, site: string, version: number, status: string) {
    const { data, error } = await requireClient().rpc(name, args);
    if (error) throw commandError(error.code);
    if (data?.report?.id !== id || data.report.jobsite_id !== site || data.report.version !== version || data.report.status !== status ||
      !Number.isSafeInteger(data.event_no) || data.event_no < 1 || typeof data.replayed !== "boolean") throw commandError();
    return { id, version, replayed: data.replayed as boolean };
  }
  return {
    async ready(): Promise<boolean> {
      const { data, error } = await requireClient().rpc("service_report_commands_ready");
      if (["PGRST202", "42883"].includes(error?.code ?? "")) return false;
      if (error || typeof data !== "boolean") throw commandError();
      return data;
    },
    async save(report: ServiceReport, version: number, requestId: string, submit: boolean) {
      if (!uuid.test(requestId) || !Number.isSafeInteger(version) || version < 0 || !report.id || !report.jobsiteId) throw commandError("22023");
      return execute("save_service_report_command", { p_report_id: report.id, p_site_id: report.jobsiteId, p_expected_version: version, p_request_id: requestId, p_data: reportPayload(report), p_submit: submit }, report.id, report.jobsiteId, version + 1, submit ? "submitted" : "draft");
    },
    async review(report: ServiceReport, requestId: string, command: "approve" | "return", reason?: string) {
      if (!uuid.test(requestId) || !Number.isSafeInteger(report.version) || (report.version ?? 0) < 1 ||
        (command === "return" ? !reason?.trim() || reason.trim().length > 4000 : reason !== undefined)) throw commandError("22023");
      return execute("apply_service_report_review", { p_report_id: report.id, p_expected_version: report.version, p_request_id: requestId, p_command: command, p_reason: reason?.trim() ?? null }, report.id, report.jobsiteId, report.version! + 1, command === "approve" ? "approved" : "rejected");
    },
    async upload(reportId: string, siteId: string, attachment: ServiceReport["attachments"][number]) {
      if (attachment.storagePath) return { ...attachment };
      if (!uuid.test(attachment.id) || !attachment.dataUrl.startsWith("data:image/") || !["image/png", "image/jpeg", "image/webp"].includes(attachment.type)) throw commandError("22023");
      const blob = await (await fetch(attachment.dataUrl)).blob();
      if (blob.size < 1 || blob.size > 2_000_000) throw commandError("22023");
      const storagePath = `${siteId}/${reportId}/${attachment.id}`;
      const bucket = requireClient().storage.from("service-report-photos");
      const uploaded = await bucket.upload(storagePath, blob, { contentType: attachment.type, upsert: false });
      if (uploaded.error) {
        // A timeout may have stored the bytes. Never overwrite a conflicting
        // object: exact byte comparison is required before accepting a retry.
        const existing = await bucket.download(storagePath);
        if (existing.error || !existing.data) throw commandError();
        const [actual, expected] = await Promise.all([existing.data.arrayBuffer(), blob.arrayBuffer()]);
        const a = new Uint8Array(actual), b = new Uint8Array(expected);
        if (a.length !== b.length || a.some((byte, index) => byte !== b[index])) throw commandError("22023");
      }
      return { ...attachment, storagePath, fileSize: blob.size };
    },
  };
}

/** One component-owned immutable operation. Retry reuses original report/IDs,
 * completed create/upload phases and exact final payload; no hidden fresh key.
 * State is in memory, not a durable outbox. Do not navigate while unresolved.
 */
export function createReportSaveOperation(report: ServiceReport, submit: boolean, isNew: boolean, repository = createReportCommandRepository(), assertCurrent = () => {}) {
  const snapshot = structuredClone(report);
  if (isNew) snapshot.id = `SR-${crypto.randomUUID()}`;
  const createId = crypto.randomUUID(), saveId = crypto.randomUUID();
  let version = isNew ? 0 : snapshot.version;
  let acknowledged: { id: string; version: number; replayed: boolean } | null = null;
  let running = false;
  return { reportId: snapshot.id, context: () => ({ report: structuredClone(snapshot), version }), async run() {
    assertCurrent();
    if (running) throw commandError();
    if (acknowledged) return acknowledged;
    if (version === undefined || (submit && !snapshot.attachments.length)) throw commandError("22023");
    running = true;
    try {
      if (version === 0) {
        const created = await repository.save({ ...snapshot, attachments: [] }, 0, createId, false);
        assertCurrent();
        version = created.version;
        if (!snapshot.attachments.length && !submit) { acknowledged = created; return created; }
      }
      for (let index = 0; index < snapshot.attachments.length; index++) {
        assertCurrent();
        snapshot.attachments[index] = await repository.upload(snapshot.id, snapshot.jobsiteId, snapshot.attachments[index]);
        assertCurrent();
      }
      acknowledged = await repository.save(snapshot, version, saveId, submit);
      assertCurrent();
      return acknowledged;
    } finally { running = false; }
  } };
}
