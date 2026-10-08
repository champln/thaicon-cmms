export type OrderMaterial = {
  id: string; name: string; quantity: number; unit: string; recordedBy: string; recordedAt: string;
  voidedBy: string | null; voidedAt: string | null; voidReason: string | null;
};
export type MaterialRequest = {
  orderId: string; expectedVersion: number; requestId: string;
} & ({ action: "add"; name: string; quantity: number; unit: string } | { action: "void"; materialId: string; reason: string });
export function validateMaterialRequest(request: MaterialRequest) {
  if (request.action === "void") {
    if (!request.materialId || !request.reason.trim() || request.reason.trim().length > 4000) throw new Error("ระบุรายการและเหตุผลยกเลิก 1–4000 ตัวอักษร");
    return;
  }
  if (!request.name.trim() || request.name.trim().length > 200 || !request.unit.trim() || request.unit.trim().length > 32 ||
    !Number.isFinite(request.quantity) || request.quantity <= 0 || request.quantity > 9999999999.9999 ||
    Number(request.quantity.toFixed(4)) !== request.quantity) {
    throw new Error("ระบุชื่อวัสดุ หน่วย และจำนวนมากกว่า 0 (ทศนิยมไม่เกิน 4 ตำแหน่ง)");
  }
}
import type { WorkOrder } from "./CMMSApp";
import type { ManagedUser } from "./master-data";
import { applyDemoOrderCommand } from "./work-order-demo";

export function applyDemoMaterial(order: WorkOrder, siteId: string, actor: ManagedUser, request: MaterialRequest, at: string): WorkOrder {
  validateMaterialRequest(request);
  if (order.id !== request.orderId || order.status !== "กำลังดำเนินการ") throw new Error("บันทึกวัสดุได้เฉพาะใบงานที่กำลังดำเนินการ");
  const materials = order.materials ?? [];
  const item = request.action === "void" ? materials.find(m => m.id === request.materialId) : null;
  if (request.action === "void" && (!item || item.voidedAt || (actor.role !== "admin" && item.recordedBy !== actor.id))) throw new Error("ยกเลิกรายการนี้ไม่ได้");
  const note = request.action === "add" ? `ใช้วัสดุ: ${request.name.trim()} — ${request.quantity} ${request.unit.trim()}` : `ยกเลิกวัสดุ: ${item!.name} — ${request.reason.trim()}`;
  // Validate command permissions/version with a short internal marker. Material
  // reason has its own 4000-character contract; its audit prefix must not reduce it.
  const updated = applyDemoOrderCommand(order, siteId, actor, request.expectedVersion, { kind: "note", text: "วัสดุ" }, at);
  updated.materials = request.action === "add" ? [...materials, { id: request.requestId, name: request.name.trim(), quantity: request.quantity, unit: request.unit.trim(), recordedBy: actor.id, recordedAt: at, voidedBy: null, voidedAt: null, voidReason: null }]
    : materials.map(m => m.id === request.materialId ? { ...m, voidedBy: actor.id, voidedAt: at, voidReason: request.reason.trim() } : m);
  updated.events = updated.events?.map((event, i, events) => i === events.length - 1 ? { ...event, note, command: request.action === "add" ? "material" : "void_material" } : event);
  return updated;
}
