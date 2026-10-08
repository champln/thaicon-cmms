import { useRef, useState } from "react";
import type { WorkOrder } from "./CMMSApp";
import type { DemoUser } from "./access";
import type { OrderCommandRequest } from "./work-order-command-supabase";
import "./work-order-actions.css";
export type OrderAssignee = { id: string; displayName: string };
export default function WorkOrderActions({ order, user, assignees, onExecute, onRefresh }: {
  order: WorkOrder; user: DemoUser; assignees: OrderAssignee[];
  onExecute: (request: OrderCommandRequest) => Promise<void>; onRefresh: () => Promise<void>;
}) {
  const [assignee, setAssignee] = useState("");
  const [note, setNote] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const retry = useRef<OrderCommandRequest | null>(null);
  const editingVersion = useRef<number | null>(null);
  const canAct = order.historyStatus !== "loading" && order.historyStatus !== "error" && (user.role === "admin" || (user.role === "engineer" && user.id === order.assigneeId));
  const closed = order.status === "เสร็จสิ้น";
  const changed = editingVersion.current !== null && editingVersion.current !== (order.version ?? 1);
  async function send(command: OrderCommandRequest["command"], repeat = false) {
    const request: OrderCommandRequest = repeat && retry.current ? retry.current : {
      orderId: order.id, expectedVersion: editingVersion.current ?? order.version ?? 1, requestId: crypto.randomUUID(), command,
      ...(command === "assign" ? { assigneeId: assignee } : ["note", "return"].includes(command) ? { note } : {}),
    };
    retry.current = request; setPending(true); setError("");
    try { await onExecute(request); retry.current = null; editingVersion.current = null; setNote(""); }
    catch (e) {
      const kind = e && typeof e === "object" && "kind" in e ? e.kind : null;
      if (kind && kind !== "failed") retry.current = null;
      setError(e instanceof Error ? e.message : "บันทึกไม่สำเร็จ");
    } finally { setPending(false); }
  }
  return <section className="wo-actions" aria-label="ดำเนินการใบงาน" aria-busy={pending}>
    {closed ? <p>ใบงานนี้ตรวจรับแล้ว</p> : canAct && <>
      {user.role === "admin" && ["รอมอบหมาย", "กำลังดำเนินการ"].includes(order.status) && <div className="wo-assign">
        <label>ผู้รับผิดชอบ<select value={assignee} onChange={e => { editingVersion.current ??= order.version ?? 1; setAssignee(e.target.value); }} disabled={pending || !!retry.current}>
          <option value="">เลือกผู้รับผิดชอบ</option>{assignees.map(a => <option key={a.id} value={a.id}>{a.displayName}</option>)}
        </select></label><button type="button" className="cmms-primary-button" disabled={!assignee || pending || !!retry.current} onClick={() => void send("assign")}>มอบหมายงาน</button>
      </div>}
      <label>บันทึก / เหตุผลส่งกลับ<textarea value={note} onChange={e => { editingVersion.current ??= order.version ?? 1; setNote(e.target.value); }} rows={3} maxLength={4000} disabled={pending || !!retry.current} /></label>
      <div className="wo-buttons">
        <button type="button" className="cmms-secondary-button" disabled={!note.trim() || pending || !!retry.current} onClick={() => void send("note")}>เพิ่มบันทึก</button>
        {order.status === "รอมอบหมาย" && <button type="button" className="cmms-primary-button" disabled={!order.assigneeId || pending || !!retry.current} onClick={() => void send("start")}>เริ่มงาน</button>}
        {order.status === "กำลังดำเนินการ" && <button type="button" className="cmms-primary-button" disabled={pending || !!retry.current} onClick={() => void send("submit")}>ส่งตรวจรับ</button>}
        {order.status === "รอตรวจรับ" && user.role === "admin" && <>
          <button type="button" className="cmms-secondary-button" disabled={!note.trim() || pending || !!retry.current} onClick={() => void send("return")}>ส่งกลับแก้ไข</button>
          <button type="button" className="cmms-primary-button" disabled={pending || !!retry.current} onClick={() => void send("approve")}>ตรวจรับและปิดงาน</button>
        </>}
      </div>
    </>}
    {pending && <p role="status">กำลังบันทึก…</p>}
    {changed && <p role="status">ใบงานมีการเปลี่ยนแปลงระหว่างกรอก กรุณาโหลดข้อมูลล่าสุดและตรวจอีกครั้ง บันทึกที่กรอกยังอยู่</p>}
    {error && <div role="alert"><p>{error}</p>{retry.current && <button type="button" className="cmms-secondary-button" disabled={pending} onClick={() => void send(retry.current!.command, true)}>ลองคำสั่งเดิมอีกครั้ง</button>}</div>}
    <button type="button" className="cmms-secondary-button" disabled={pending} onClick={() => {
      setPending(true); void onRefresh().then(() => { retry.current = null; editingVersion.current = null; setError(""); }).catch(e => setError(e instanceof Error ? e.message : "โหลดไม่สำเร็จ")).finally(() => setPending(false));
    }}>โหลดข้อมูลล่าสุด</button>
  </section>;
}
