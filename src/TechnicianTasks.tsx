import { useEffect, useState } from "react";
import type { WorkOrder } from "./CMMSApp";
import { technicianTasks, type TaskGroup } from "./technician-tasks";
import { instantMillis } from "./work-order-timing";
import "./technician-tasks.css";

const groups: { id: TaskGroup; label: string }[] = [
  { id: "all", label: "งานที่ยังไม่เสร็จ" }, { id: "today", label: "กำหนดเสร็จวันนี้" },
  { id: "overdue", label: "เกินกำหนด" }, { id: "review", label: "รอตรวจรับ" }, { id: "undated", label: "ไม่มีกำหนดเสร็จ" },
];
export default function TechnicianTasks({ orders, userId, siteId, onSelect }: {
  orders: WorkOrder[]; userId: string; siteId: string; onSelect: (order: WorkOrder) => void;
}) {
  const [group, setGroup] = useState<TaskGroup>("all");
  const [now, setNow] = useState(() => new Date().toISOString());
  useEffect(() => {
    const refresh = () => setNow(new Date().toISOString());
    const timer = window.setInterval(refresh, 30_000);
    window.addEventListener("focus", refresh);
    return () => { window.clearInterval(timer); window.removeEventListener("focus", refresh); };
  }, []);
  const tasks = technicianTasks(orders, userId, siteId, now);
  return <section className="technician-tasks cmms-panel" aria-label="งานของฉัน">
    <h2>งานของฉัน</h2>
    <p>ใบงานที่มอบหมายให้บัญชีนี้ในไซต์ปัจจุบัน • เวลาไทย</p>
    <div className="technician-task-filters" role="group" aria-label="กรองงานของฉัน">
      {groups.map(item => <button key={item.id} type="button" aria-pressed={group === item.id} onClick={() => setGroup(item.id)}>
        {item.label} <strong>{tasks[item.id].length}</strong>
      </button>)}
    </div>
    <p>งานหนึ่งรายการอาจอยู่หลายกลุ่ม งานรอตรวจรับยังถือว่ายังไม่เสร็จ</p>
    {tasks[group].length === 0 ? <p role="status">ไม่มีงานในกลุ่มนี้</p> : <ul className="technician-task-list">
      {tasks[group].map(order => <li key={order.id}><button type="button" onClick={() => onSelect(order)}>
        <span><strong>{order.id} · {order.title}</strong><span>{order.assetName} · {order.status}</span></span>
        <span>{instantMillis(order.dueAt) === null ? "ไม่มีกำหนดเสร็จที่ยืนยันได้" : "กำหนดเสร็จ " + new Intl.DateTimeFormat("th-TH", { timeZone: "Asia/Bangkok", dateStyle: "medium", timeStyle: "short" }).format(new Date(order.dueAt!))}</span>
      </button></li>)}
    </ul>}
    <p>รายการที่ไม่มีรหัสผู้รับผิดชอบหรือรหัสไซต์จะไม่รวมที่นี่ ให้ผู้ดูแลตรวจการมอบหมายในรายการใบงานด้านล่าง</p>
  </section>;
}
