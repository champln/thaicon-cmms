import { useEffect, useRef, useState, type ReactNode } from "react";
import type { WorkOrder } from "./CMMSApp";
import { supabase } from "./supabase";
import { useDialogFocus } from "./use-dialog-focus";
import { demoWorkNotices, noticeLabels, noticeStorageKey, type WorkNotice } from "./work-notifications";
import "./work-notifications.css";

function NoticeDialog({ children, onClose }: { children: ReactNode; onClose: () => void }) {
  const ref = useDialogFocus<HTMLDivElement>(onClose);
  return <div className="notice-backdrop" onClick={onClose}><div ref={ref} role="dialog" aria-modal="true" aria-labelledby="notice-heading" tabIndex={-1} className="notice-dialog" onClick={event => event.stopPropagation()}>
    <button type="button" className="cmms-secondary-button" onClick={onClose}>ปิดแจ้งเตือน</button><h2 id="notice-heading">แจ้งเตือนใบงาน</h2>{children}
  </div></div>;
}
export default function WorkNotifications({ actorId, role, siteId, online, verified, orders, onSelect }: {
  actorId: string; role: string; siteId: string; online: boolean; verified: boolean; orders: WorkOrder[]; onSelect: (order: WorkOrder) => void;
}) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<WorkNotice[]>([]);
  const [error, setError] = useState("");
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const mounted = useRef(true);
  const generation = useRef(0);
  const storageKey = noticeStorageKey(actorId,role,siteId);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; generation.current++; }; }, []);
  useEffect(() => {
    let active = true;
    async function refresh() {
      const request = ++generation.current;
      if (!verified) { setItems([]); setReady(false); return; }
      try {
        let next: WorkNotice[];
        if (online) {
          if (!supabase) throw new Error();
          const { data, error: failure } = await supabase.rpc("read_work_notifications", { p_site_id: siteId });
          if (failure || data?.actorId !== actorId || data?.siteId !== siteId || !Array.isArray(data.items)) throw new Error();
          next = data.items;
          if (!next.every(n => typeof n.id === "string" && typeof n.orderId === "string" && typeof n.title === "string" && typeof n.read === "boolean" && Object.hasOwn(noticeLabels,n.kind))) throw new Error();
        } else {
          const raw = JSON.parse(localStorage.getItem(storageKey) ?? "[]");
          if (!Array.isArray(raw) || !raw.every(x => typeof x === "string")) throw new Error();
          const reads = new Set(raw);
          next = demoWorkNotices(orders,actorId,role,siteId,new Date().toISOString()).map(n => ({ ...n, read: reads.has(n.id) }));
        }
        if (active && request === generation.current) { setItems(next); setReady(true); setError(""); }
      } catch {
        if (active && request === generation.current) { setItems([]); setReady(false); setError("โหลดแจ้งเตือนไม่สำเร็จ กรุณาลองใหม่ หากระบบออนไลน์ยังไม่ได้ติดตั้งส่วนแจ้งเตือน ให้ติดต่อผู้ดูแล"); }
      }
    }
    void refresh();
    const timer = window.setInterval(() => void refresh(), 30_000);
    const focus = () => void refresh();
    window.addEventListener("focus",focus);
    window.addEventListener("storage",focus);
    return () => { active = false; generation.current++; window.clearInterval(timer); window.removeEventListener("focus",focus); window.removeEventListener("storage",focus); };
  }, [actorId,role,siteId,online,verified,orders,storageKey,attempt]);
  async function mark(item: WorkNotice) {
    if (busy || !verified || !ready) return;
    setBusy(true);
    try {
      if (online) {
        if (!supabase) throw new Error();
        const { error: failure } = await supabase.rpc("mark_work_notification_read", { p_site_id: siteId, p_notification_id: item.id });
        if (failure) throw new Error();
      } else {
        const raw = JSON.parse(localStorage.getItem(storageKey) ?? "[]");
        if (!Array.isArray(raw) || !raw.every(x => typeof x === "string")) throw new Error();
        localStorage.setItem(storageKey,JSON.stringify([...new Set([...raw,item.id])]));
      }
      if (mounted.current) { setError(""); setAttempt(value => value+1); }
    } catch { if (mounted.current) setError("บันทึกสถานะอ่านแล้วไม่สำเร็จ กรุณาลองใหม่"); }
    finally { if (mounted.current) setBusy(false); }
  }
  const unread = items.filter(n => !n.read).length;
  return <>
    <button className="cmms-notification" type="button" aria-label={ready && verified ? `แจ้งเตือนใบงาน ยังไม่อ่าน ${unread} รายการ` : "แจ้งเตือนใบงาน ยังตรวจสอบไม่ได้"} aria-haspopup="dialog" onClick={() => setOpen(true)}>
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4" /></svg><i>{ready && verified ? unread : "—"}</i>
    </button>
    {open && <NoticeDialog onClose={() => setOpen(false)}>
      <p>เฉพาะไซต์ปัจจุบัน • ตรวจใหม่ทุก 30 วินาทีเมื่อเปิดระบบ</p>
      <p>รายการที่หมดเงื่อนไขจะหายไป ไม่ใช่ประวัติแจ้งเตือนย้อนหลัง</p>
      {!online && <p>Demo: สถานะอ่านแล้วเก็บในเบราว์เซอร์นี้</p>}
      {error && <p role="alert">{error}</p>}
      <button className="cmms-secondary-button" type="button" disabled={busy} onClick={() => setAttempt(value => value+1)}>ตรวจใหม่</button>
      {!verified ? <p role="status">ยังตรวจสอบข้อมูลใบงานหรือสิทธิ์ไม่ได้</p> : !ready ? <p role="status">ยังไม่มีผลการตรวจแจ้งเตือน</p> : items.length === 0 ? <p role="status">ไม่มีแจ้งเตือนใบงานในขณะนี้</p> : <ul>
        {items.map(item => <li key={item.id}>
          <strong>{noticeLabels[item.kind]}</strong><p>{item.orderId} · {item.title}</p><span>{item.read ? "อ่านแล้ว" : "ยังไม่อ่าน"}</span>
          <div className="notice-actions">
            <button className="cmms-secondary-button" type="button" disabled={busy} onClick={() => {
              const order = orders.find(o => o.id === item.orderId && o.jobsiteId === siteId && (role === "admin" || o.assigneeId === actorId));
              if (!order) { setError("ข้อมูลใบงานเปลี่ยนแล้ว กรุณาตรวจใหม่"); return; }
              setOpen(false); onSelect(order);
            }}>เปิดใบงาน</button>
            {!item.read && <button className="cmms-secondary-button" type="button" disabled={busy} onClick={() => void mark(item)}>ทำเครื่องหมายว่าอ่านแล้ว</button>}
          </div>
        </li>)}
      </ul>}
    </NoticeDialog>}
  </>;
}
