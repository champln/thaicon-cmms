import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "./supabase";
import type { JobStatus } from "./work-order-workflow";
import { readAllPages } from "./read-all-pages";
import { instantMillis } from "./work-order-timing";
import { validateMaterialRequest, type MaterialRequest, type OrderMaterial } from "./work-order-materials";

export type StoredOrder = {
  id: string; jobsite_id: string; status: JobStatus; version: number;
  assignee_id: string | null; assignee: string;
};
export type StoredOrderEvent = {
  event_no: number; work_order_id: string; jobsite_id: string;
  actor_id: string; actor_name: string; command: string;
  before_status: JobStatus; after_status: JobStatus; note: string | null;
  order_version: number; recorded_at: string;
};
export type OrderCommandRequest = {
  orderId: string; expectedVersion: number; requestId: string;
  command: "assign" | "start" | "submit" | "approve" | "return" | "note";
  assigneeId?: string; note?: string;
};
export type OrderCreateRequest = {
  orderId: string; requestId: string; siteId: string; assetId: string; title: string;
  workType: "PM" | "CM" | "EM"; priority: "critical" | "high" | "normal" | "low";
  dueLabel: string; description: string; dueAt?: string | null;
};
export class OrderCommandError extends Error {
  constructor(public readonly kind: "conflict" | "denied" | "invalid" | "failed", message: string) { super(message); }
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const statuses: readonly string[] = ["waiting", "in_progress", "review", "completed"];

export function createOrderCommandRepository(client: Pick<SupabaseClient, "rpc" | "from"> | null = supabase) {
  function requireClient() { if (!client) throw new OrderCommandError("failed", "ยังไม่ได้ตั้งค่าระบบออนไลน์"); return client; }
  return {
    async material(request: MaterialRequest): Promise<void> {
      try { validateMaterialRequest(request); }
      catch (e) { throw new OrderCommandError("invalid", e instanceof Error ? e.message : "ข้อมูลวัสดุไม่ถูกต้อง"); }
      if (!request.orderId || !uuid.test(request.requestId) || !Number.isSafeInteger(request.expectedVersion) || request.expectedVersion < 1 ||
        (request.action === "void" && !uuid.test(request.materialId))) throw new OrderCommandError("invalid", "ข้อมูลคำสั่งวัสดุไม่ถูกต้อง");
      const { data, error } = await requireClient().rpc("record_work_order_material", {
        p_order_id: request.orderId, p_expected_version: request.expectedVersion, p_request_id: request.requestId, p_action: request.action,
        p_name: request.action === "add" ? request.name.trim() : null, p_quantity: request.action === "add" ? request.quantity : null,
        p_unit: request.action === "add" ? request.unit.trim() : null, p_material_id: request.action === "void" ? request.materialId : null,
        p_reason: request.action === "void" ? request.reason.trim() : null,
      });
      if (error) throw new OrderCommandError(error.code === "40001" ? "conflict" : error.code === "42501" ? "denied" : ["22023", "23505"].includes(error.code) ? "invalid" : "failed", "ยังบันทึกวัสดุไม่ได้ กรุณาตรวจข้อมูลล่าสุดก่อนลองคำสั่งเดิมซ้ำ");
      if (data?.order?.id !== request.orderId || data.order.version !== request.expectedVersion + 1 || data.order.status !== "in_progress" ||
        typeof data.replayed !== "boolean" || !Number.isSafeInteger(data.event_no) || data.event_no < 1) throw new OrderCommandError("failed", "ยังยืนยันการบันทึกวัสดุไม่ได้ กรุณาโหลดข้อมูลล่าสุด");
    },
    async materials(orderId: string): Promise<OrderMaterial[]> {
      const query = requireClient().from("work_order_materials").select("id,name,quantity,unit,recorded_by,recorded_at,voided_by,voided_at,void_reason").eq("work_order_id", orderId).order("event_no");
      const rows = await readAllPages((start, end) => query.range(start, end));
      return rows.map(row => ({ id: String(row.id), name: String(row.name), quantity: Number(row.quantity), unit: String(row.unit), recordedBy: String(row.recorded_by), recordedAt: String(row.recorded_at), voidedBy: row.voided_by ? String(row.voided_by) : null, voidedAt: row.voided_at ? String(row.voided_at) : null, voidReason: row.void_reason ? String(row.void_reason) : null }));
    },
    async ready(): Promise<boolean> {
      const { data, error } = await requireClient().rpc("work_order_commands_ready");
      if (error?.code === "PGRST202" || error?.code === "42883") return false;
      if (error) throw new OrderCommandError("failed", "ตรวจสถานะใบงานไม่สำเร็จ");
      return data === true;
    },
    async assignees(siteId: string): Promise<Array<{ id: string; displayName: string }>> {
      const { data, error } = await requireClient().rpc("work_order_assignees", { p_site_id: siteId });
      if (error || !Array.isArray(data)) throw new OrderCommandError("failed", "โหลดผู้รับผิดชอบไม่สำเร็จ");
      return data.map(row => ({ id: String(row.id), displayName: String(row.display_name) }));
    },
    async create(request: OrderCreateRequest): Promise<void> {
      if (!request.orderId.startsWith("WO-") || !uuid.test(request.orderId.slice(3)) || !uuid.test(request.requestId) ||
        !request.siteId.trim() || !request.assetId.trim() || !request.title.trim() || request.title.trim().length > 300 ||
        !request.dueLabel.trim() || request.dueLabel.trim().length > 200 || request.description.length > 4000 ||
        (request.dueAt != null && instantMillis(request.dueAt) == null) ||
        !["PM", "CM", "EM"].includes(request.workType) || !["critical", "high", "normal", "low"].includes(request.priority)) {
        throw new OrderCommandError("invalid", "ระบุชื่อใบงานและกำหนดเสร็จ");
      }
      const { data, error } = await requireClient().rpc("create_work_order_command", {
        p_order_id: request.orderId, p_request_id: request.requestId, p_site_id: request.siteId,
        p_asset_id: request.assetId, p_title: request.title, p_work_type: request.workType,
        p_priority: request.priority, p_due_label: request.dueLabel, p_description: request.description,
        ...(request.dueAt != null ? { p_due_at: request.dueAt } : {}),
      });
      if (error) throw new OrderCommandError(error.code === "42501" ? "denied" : ["22023", "23505"].includes(error.code) ? "invalid" : "failed", "สร้างใบงานไม่สำเร็จ กรุณาตรวจข้อมูลก่อนลองคำสั่งเดิมซ้ำ");
      if (data?.order?.id !== request.orderId || data.order.version !== 1 || data.order.jobsite_id !== request.siteId ||
        data.order.status !== "waiting" || data.order.assignee_id !== null || typeof data.replayed !== "boolean" ||
        !Number.isSafeInteger(data.event_no) || data.event_no < 1) {
        throw new OrderCommandError("failed", "ยังยืนยันการสร้างใบงานไม่ได้ กรุณาตรวจข้อมูลก่อนลองคำสั่งเดิมซ้ำ");
      }
    },
    /** The caller keeps requestId AND payload unchanged for retry after an
     * uncertain network result. Never generate a fresh requestId internally.
     * A replay snapshot may be older than current state: reload after success.
     */
    async execute(request: OrderCommandRequest): Promise<{ eventNo: number; order: StoredOrder; replayed: boolean }> {
      if (!request.orderId.trim() || !uuid.test(request.requestId) || !Number.isSafeInteger(request.expectedVersion) || request.expectedVersion < 1) {
        throw new OrderCommandError("invalid", "ข้อมูลคำสั่งใบงานไม่ถูกต้อง");
      }
      if (request.command === "assign" ? !uuid.test(request.assigneeId ?? "") || request.note !== undefined : request.assigneeId !== undefined) {
        throw new OrderCommandError("invalid", "ข้อมูลผู้รับผิดชอบไม่ถูกต้อง");
      }
      if (["note", "return"].includes(request.command)) {
        if (!request.note?.trim() || request.note.trim().length > 4000) throw new OrderCommandError("invalid", "ระบุบันทึกหรือเหตุผล 1–4000 ตัวอักษร");
      } else if (request.note !== undefined) throw new OrderCommandError("invalid", "คำสั่งนี้ไม่รับบันทึก");
      const { data, error } = await requireClient().rpc("apply_work_order_command", {
        p_order_id: request.orderId, p_expected_version: request.expectedVersion, p_request_id: request.requestId,
        p_command: request.command, p_assignee_id: request.assigneeId ?? null, p_note: request.note?.trim() ?? null,
      });
      if (error) {
        const kind = error.code === "40001" ? "conflict" : error.code === "42501" ? "denied" : error.code === "22023" ? "invalid" : "failed";
        const message = kind === "conflict" ? "ใบงานถูกแก้ไขแล้ว กรุณาโหลดข้อมูลล่าสุด" : kind === "denied" ? "ไม่มีสิทธิ์ดำเนินการหรือระบบยังไม่เปิดใช้" : kind === "invalid" ? "คำสั่งหรือสถานะใบงานไม่ถูกต้อง" : "ยังยืนยันผลการบันทึกไม่ได้ กรุณาตรวจข้อมูลก่อนลองซ้ำ";
        throw new OrderCommandError(kind, message);
      }
      if (!data || !Number.isSafeInteger(data.event_no) || data.event_no < 1 || typeof data.replayed !== "boolean" ||
        data.order?.id !== request.orderId || !statuses.includes(data.order?.status) ||
        !Number.isSafeInteger(data.order?.version) || data.order.version !== request.expectedVersion + 1 ||
        typeof data.order.jobsite_id !== "string" || typeof data.order.assignee !== "string" ||
        !(data.order.assignee_id === null || uuid.test(data.order.assignee_id))) {
        throw new OrderCommandError("failed", "ผลตอบกลับไม่สมบูรณ์ กรุณาโหลดข้อมูลล่าสุดก่อนดำเนินการต่อ");
      }
      return { eventNo: data.event_no, order: data.order as StoredOrder, replayed: data.replayed };
    },
    async history(orderId: string): Promise<StoredOrderEvent[]> {
      if (!orderId.trim()) throw new OrderCommandError("invalid", "ระบุใบงาน");
      const result: StoredOrderEvent[] = [];
      const size = 200;
      for (let offset = 0; ; offset += size) {
        const { data, error } = await requireClient().from("work_order_events")
          .select("event_no,work_order_id,jobsite_id,actor_id,actor_name,command,before_status,after_status,note,order_version,recorded_at")
          .eq("work_order_id", orderId).order("event_no", { ascending: true }).range(offset, offset + size - 1);
        if (error) throw new OrderCommandError("failed", "โหลดประวัติใบงานไม่สำเร็จ");
        result.push(...(data ?? []) as StoredOrderEvent[]);
        if ((data?.length ?? 0) < size) return result;
      }
    },
  };
}
