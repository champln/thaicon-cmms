import { useRef, useState } from "react";
import type { DemoUser } from "./access";
import type { WorkOrder } from "./CMMSApp";
import type { MaterialRequest } from "./work-order-materials";

export default function WorkOrderMaterials({ order, user, onRecord, onRefresh }: { order: WorkOrder; user: DemoUser; onRecord: (request: MaterialRequest) => Promise<void>; onRefresh: () => Promise<void> }) {
  const [name, setName] = useState(""); const [quantity, setQuantity] = useState("1"); const [unit, setUnit] = useState(""); const [reason, setReason] = useState("");
  const [pending, setPending] = useState(false); const [error, setError] = useState("");
  const retry = useRef<MaterialRequest | null>(null); const editingVersion = useRef<number | null>(null);
  const editable = order.historyStatus !== "loading" && order.historyStatus !== "error" && order.status === "กำลังดำเนินการ" && (user.role === "admin" || (user.role === "engineer" && order.assigneeId === user.id));
  function edit(change: () => void) { editingVersion.current ??= order.version ?? 1; change(); }
  async function send(materialId?: string, repeat = false) {
    const request: MaterialRequest = repeat && retry.current ? retry.current : {
      orderId: order.id, expectedVersion: editingVersion.current ?? order.version ?? 1, requestId: crypto.randomUUID(),
      ...(materialId ? { action: "void" as const, materialId, reason } : { action: "add" as const, name, quantity: Number(quantity), unit }),
    };
    setPending(true); setError(""); retry.current = request;
    try { await onRecord(request); retry.current = null; editingVersion.current = null; setName(""); setUnit(""); setReason(""); }
    catch (e) {
      if (e && typeof e === "object" && "kind" in e && e.kind !== "failed") retry.current = null;
      setError(e instanceof Error ? e.message : "บันทึกวัสดุไม่สำเร็จ");
    } finally { setPending(false); }
  }
  return <section className="wo-actions" aria-label="อะไหล่และวัสดุที่ใช้" aria-busy={pending}>
    <h3>อะไหล่และวัสดุที่ใช้</h3>
    {(order.materials ?? []).map(m => <article className="wo-material" key={m.id}>
      <strong>{m.name} — {m.quantity} {m.unit}</strong>
      <p>{m.voidedAt ? `ยกเลิก: ${m.voidReason}` : "ใช้งาน"} • {new Date(m.recordedAt).toLocaleString("th-TH")}</p>
      {editable && !m.voidedAt && (user.role === "admin" || m.recordedBy === user.id) && <button type="button" className="cmms-secondary-button" disabled={!reason.trim() || pending || !!retry.current} onClick={() => void send(m.id)}>ยกเลิกรายการ {m.name}</button>}
    </article>)}
    {!order.materials?.length && <p>ยังไม่มีรายการวัสดุที่บันทึก</p>}
    {editable && <fieldset disabled={pending || !!retry.current}>
      <label>ชื่ออะไหล่ / วัสดุ<input value={name} maxLength={200} onChange={e => edit(() => setName(e.target.value))} /></label>
      <div className="wo-assign"><label>จำนวน<input type="number" min="0.0001" step="0.0001" value={quantity} onChange={e => edit(() => setQuantity(e.target.value))} /></label><label>หน่วย<input value={unit} maxLength={32} onChange={e => edit(() => setUnit(e.target.value))} /></label></div>
      <button type="button" className="cmms-primary-button" disabled={!name.trim() || !unit.trim()} onClick={() => void send()}>บันทึกวัสดุ</button>
      <label>เหตุผลยกเลิกรายการ<textarea value={reason} rows={2} maxLength={4000} onChange={e => edit(() => setReason(e.target.value))} /></label>
      <p>กรอกผิดให้ระบุเหตุผล แล้วยกเลิกรายการเดิมก่อนบันทึกใหม่ ประวัติยังคงอยู่</p>
    </fieldset>}
    {editingVersion.current !== null && editingVersion.current !== order.version && <p role="status">ใบงานเปลี่ยนระหว่างกรอก กรุณาโหลดข้อมูลล่าสุด แล้วตรวจอีกครั้ง</p>}
    {pending && <p role="status">กำลังบันทึกวัสดุ…</p>}
    {error && <div role="alert">{error}{retry.current && <button type="button" disabled={pending} className="cmms-secondary-button" onClick={() => void send(undefined, true)}>ลองคำสั่งวัสดุเดิมอีกครั้ง</button>}</div>}
    <button type="button" className="cmms-secondary-button" disabled={pending} onClick={() => {
      setPending(true); void onRefresh().then(() => { retry.current = null; editingVersion.current = null; setError(""); }).catch(e => setError(e instanceof Error ? e.message : "โหลดวัสดุไม่สำเร็จ")).finally(() => setPending(false));
    }}>โหลดรายการวัสดุล่าสุด</button>
  </section>;
}
