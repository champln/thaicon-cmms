import { useState } from "react";
import type { WorkOrder } from "./CMMSApp";
import { createPlanCycles } from "./maintenance";
import type { MaintenanceState } from "./maintenance";
import { bangkokDate } from "./work-order-timing";
import { calendarEvents, monthGrid, shiftDay } from "./work-calendar";
import type { CalendarEvent } from "./work-calendar";
import "./work-calendar.css";
const thaiDate = (day:string, monthOnly=false) => new Intl.DateTimeFormat("th-TH", { timeZone:"UTC", year:"numeric", month:"long", ...(monthOnly?{}:{day:"numeric" as const}) }).format(new Date(`${day}T00:00:00Z`));
export default function WorkCalendar({site, orders, state, onOrder, onReports, onPlans}: {site:string;orders:WorkOrder[];state:MaintenanceState;onOrder:(o:WorkOrder)=>void;onReports:()=>void;onPlans:()=>void}) {
  const today = bangkokDate(new Date().toISOString())!;
  const [day,setDay] = useState(today);
  const [view,setView] = useState("month");
  const [kind,setKind] = useState("all"),[status,setStatus] = useState("all"),[asset,setAsset] = useState("all");
  const model = calendarEvents(site,orders,state.serviceReports);
  const filtered=model.events.filter(e=>(kind==="all"||kind===e.kind)&&(status==="all"||status===e.status)&&(asset==="all"||asset===e.asset));
  const weekday=(new Date(`${day}T00:00:00Z`).getUTCDay()+6)%7;
  const dates=view==="month"?monthGrid(day.slice(0,7)):view==="week"?Array.from({length:7},(_,i)=>shiftDay(day,i-weekday)):[day];
  const list=filtered.filter(e=>view==="agenda"?e.date.startsWith(day.slice(0,7)):dates.includes(e.date));
  function move(direction:number) {
    if(view==="day"||view==="week")setDay(shiftDay(day,direction*(view==="day"?1:7)));
    else { const d=new Date(`${day.slice(0,7)}-01T00:00:00Z`);d.setUTCMonth(d.getUTCMonth()+direction);setDay(d.toISOString().slice(0,10)); }
  }
  function event(e:CalendarEvent) { return <button className={`calendar-event ${e.kind.toLowerCase()}`} key={e.id} type="button" onClick={()=>e.order?onOrder(e.order):onReports()} title={`${e.title} · ${e.asset} · ${e.status}`}><b>{e.kind} · {e.asset}</b><span>{e.title}</span><small>{e.status}</small></button>; }
  const pm=state.plans.filter(p=>p.jobsiteId===site&&p.year===Number(day.slice(0,4))).flatMap(p=>createPlanCycles(p).filter(c=>c.startMonth<=c.endMonth?Number(day.slice(5,7))>=c.startMonth&&Number(day.slice(5,7))<=c.endMonth:Number(day.slice(5,7))>=c.startMonth||Number(day.slice(5,7))<=c.endMonth).map(c=>({p,c})));
  return <section className="cmms-panel work-calendar" aria-label="ปฏิทินงานซ่อมบำรุง">
    <header><p>วันกำหนดเสร็จใบงานและวันบริการ • เวลาไทย</p><div className="calendar-nav"><button type="button" aria-label="ช่วงก่อนหน้า" onClick={()=>move(-1)}>‹</button><button type="button" onClick={()=>setDay(today)}>วันนี้</button><button type="button" aria-label="ช่วงถัดไป" onClick={()=>move(1)}>›</button></div></header>
    <div className="calendar-toolbar"><h3 aria-live="polite">{thaiDate(day,view==="month"||view==="agenda")}</h3><div role="group" aria-label="มุมมองปฏิทิน">{[["month","เดือน"],["week","สัปดาห์"],["day","วัน"],["agenda","กำหนดการ"]].map(([v,label])=><button type="button" key={v} aria-pressed={view===v} onClick={()=>setView(v)}>{label}</button>)}</div></div>
    <div className="calendar-filters"><label>ประเภท<select aria-label="ประเภท" value={kind} onChange={e=>{setKind(e.target.value);setStatus("all");}}><option value="all">ทั้งหมด</option><option value="WO">ใบงาน (กำหนดเสร็จ)</option><option value="SR">Service Report (วันบริการ)</option></select></label><label>สถานะ<select aria-label="สถานะ" value={status} onChange={e=>setStatus(e.target.value)}><option value="all">ทั้งหมด</option>{[...new Set(model.events.filter(e=>kind==="all"||e.kind===kind).map(e=>e.status))].map(s=><option key={s}>{s}</option>)}</select></label><label>เครื่องจักร<select aria-label="เครื่องจักร" value={asset} onChange={e=>setAsset(e.target.value)}><option value="all">ทั้งหมด</option>{[...new Set(model.events.map(e=>e.asset))].map(s=><option key={s}>{s}</option>)}</select></label><button type="button" onClick={()=>{setKind("all");setStatus("all");setAsset("all");}}>ล้างตัวกรอง</button></div>
    <p className="calendar-count" role="status">{list.length} รายการในช่วงที่เลือก • {model.undated} รายการไม่มีวันที่ จึงไม่ลงปฏิทิน</p>
    {view!=="agenda"&&view!=="day"&&<div className="calendar-grid-wrap"><div className="calendar-grid">{["จ.","อ.","พ.","พฤ.","ศ.","ส.","อา."].map(n=><strong className="calendar-weekday" key={n}>{n}</strong>)}{dates.map(date=>{const items=filtered.filter(e=>e.date===date);return <div className={`calendar-cell ${date===today?"today":""} ${date.slice(0,7)!==day.slice(0,7)?"outside":""}`} key={date}><button className="calendar-date" type="button" aria-label={`ดูวันที่ ${thaiDate(date)}`} onClick={()=>{setDay(date);setView("day");}}>{Number(date.slice(8))}</button>{items.slice(0,3).map(event)}{items.length>3&&<button type="button" onClick={()=>{setDay(date);setView("day");}}>อีก {items.length-3} รายการ</button>}</div>;})}</div></div>}
    <div className={`calendar-agenda ${view==="month"||view==="week"?"mobile-agenda":""}`}>
      {list.length?list.map(e=><article key={e.id}><time dateTime={e.date}>{thaiDate(e.date)}</time>{event(e)}</article>):<p>ไม่มีรายการตามวันที่และตัวกรองที่เลือก</p>}
    </div>
    <details className="calendar-plan-periods"><summary>รอบแผน PM เดือนนี้ ({pm.length}) — ยังไม่ใช่วันนัดรายเครื่อง</summary><p>แสดงตามปีแผนและช่วงเดือน แยกจากตัวกรองใบงานด้านบน ไม่กำหนดวันนัดอัตโนมัติ</p>{pm.map(({p,c})=><p key={`${p.id}:${c.id}`}><strong>{p.name}</strong> · {c.label} · เป้าหมาย {c.target} ครั้ง · {p.status==="active"?"ใช้งาน":p.status==="draft"?"ฉบับร่าง":"เสร็จสิ้น"}</p>)}<button type="button" onClick={onPlans}>เปิดแผน PM</button></details>
  </section>;
}
