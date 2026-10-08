import { useState } from "react";
import type { UserRole } from "./access";
import { roleLabels } from "./access";
import { filterGuideTopics } from "./user-guide";
import type { GuideDestination } from "./user-guide";
import "./user-guide.css";

export default function UserGuide({ role, onlineMode, onNavigate }: { role: UserRole; onlineMode: boolean; onNavigate: (page: GuideDestination) => void }) {
  const [query, setQuery] = useState("");
  const [checked, setChecked] = useState<string[]>([]);
  const [stage, setStage] = useState<"draft" | "submitted" | "approved" | "rejected">("draft");
  const topics = filterGuideTopics(role, query);
  const total = filterGuideTopics(role, "").reduce((sum, topic) => sum + topic.steps.length, 0);
  const toggle = (id: string) => setChecked((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  return <section className="user-guide" aria-label="คู่มือการใช้งานแบบโต้ตอบ">
    <header className="guide-intro"><span>คู่มือสำหรับ {roleLabels[role]}</span><h2>เริ่มจากงานที่คุณต้องการทำ</h2><p>เลือกหัวข้อ อ่านทีละขั้น แล้วติ๊กสิ่งที่ลองทำแล้ว คู่มือนี้ไม่บันทึกหรือเปลี่ยนข้อมูลงานของคุณ</p><strong>{onlineMode ? "คุณอยู่ในระบบออนไลน์ — ปุ่มเปิดหน้าทำงานจะพาไปข้อมูลจริง" : "คุณอยู่ใน Demo — ข้อมูลจำลองในเบราว์เซอร์นี้"}</strong></header>
    <div className="guide-tools"><label>ค้นหาในคู่มือ<input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="เช่น แนบรูป, Serial, ส่งกลับ, PDF" /></label><button type="button" onClick={() => setQuery("")}>ล้างคำค้น</button><button type="button" onClick={() => window.print()}>พิมพ์คู่มือ / บันทึก PDF</button></div>
    <div className="guide-progress"><label htmlFor="guide-progress">ลองทำแล้ว {checked.length} / {total} ขั้นตอน</label><progress id="guide-progress" value={checked.length} max={total} /><p>Checklist จำเฉพาะขณะเปิดหน้านี้ ไม่ใช่ผล UAT และจะเริ่มใหม่เมื่อออกจากคู่มือหรือรีเฟรช</p></div>
    <p role="status">พบ {topics.length} หัวข้อสำหรับบทบาทของคุณ</p>
    {!topics.length && <div className="guide-card"><h3>ไม่พบหัวข้อที่ค้นหา</h3><p>ลองใช้คำสั้นลง เช่น “รูป” หรือ “แผน” หรือล้างคำค้นเพื่อดูทั้งหมด</p></div>}
    <div className="guide-topics">{topics.map((topic, index) => <details className="guide-card" key={topic.id} open={query.trim() ? true : undefined}><summary><span className="guide-number" aria-hidden="true">{String(index + 1).padStart(2, "0")}</span><span><strong>{topic.title}</strong><small>{topic.summary}</small></span></summary><div className="guide-body"><ol>{topic.steps.map((step, i) => { const id = `${topic.id}-${i}`; return <li key={id}><label><input type="checkbox" checked={checked.includes(id)} onChange={() => toggle(id)} /><span>{step}</span></label></li>; })}</ol><p className="guide-expected"><strong>ผลที่ควรเห็น: </strong>{topic.expected}</p>{topic.warning && <p className="guide-warning"><strong>ข้อควรทราบ: </strong>{topic.warning}</p>}{topic.destination && <button className="guide-primary" type="button" onClick={() => onNavigate(topic.destination!)}>เปิดหน้าทำงาน: {topic.destination === "admin" ? "จัดการระบบ" : topic.title}</button>}</div></details>)}</div>
    <section className="guide-card guide-simulator"><h3>ลองเข้าใจสถานะรายงานใน 1 นาที</h3><p>ตัวอย่างสมมติ: ทำ PM จำนวน 5 ครั้ง ลองส่ง อนุมัติ หรือส่งกลับได้ที่นี่ โดยไม่แตะข้อมูลจริง ไม่ว่าคุณมีบทบาทใด</p><div className="guide-state" role="status"><strong>สถานะ: {{draft: "ฉบับร่าง", submitted: "รออนุมัติ", approved: "อนุมัติแล้ว", rejected: "ส่งกลับแก้ไข"}[stage]}</strong><span>จำนวนที่นับเข้า Actual: <b>{stage === "approved" ? 5 : 0}</b> ครั้ง</span></div><div className="guide-sim-actions"><button type="button" disabled={stage !== "draft" && stage !== "rejected"} onClick={() => setStage("submitted")}>จำลองส่งอนุมัติ</button><button type="button" disabled={stage !== "submitted"} onClick={() => setStage("approved")}>จำลอง Admin อนุมัติ</button><button type="button" disabled={stage !== "submitted"} onClick={() => setStage("rejected")}>จำลองส่งกลับแก้ไข</button><button type="button" onClick={() => setStage("draft")}>เริ่มตัวอย่างใหม่</button></div><p>ในงานจริงเฉพาะ Admin อนุมัติได้ หากส่งกลับ ให้แก้ตามเหตุผลและส่งใหม่</p></section>
    <section className="guide-card guide-faq"><h3>ติดปัญหา? ตรวจตามนี้ก่อน</h3>{[
      ["เข้าไม่ได้หรือไม่เห็นไซต์", "ตรวจชื่อผู้ใช้และโหมด Demo/ออนไลน์ ถ้าเป็นบัญชีจริง ให้ Admin ตรวจว่าบัญชีเปิดใช้งานและกำหนดไซต์แล้ว อย่าส่งรหัสผ่านให้ผู้อื่น"],
      ["สร้าง Service Report ไม่ได้", "ไซต์ต้องมีเครื่องจักรและแผนที่ยังไม่เสร็จสิ้น ตรวจว่าบัญชีเป็น Admin หรือ Engineer หากไม่มีข้อมูลให้ Admin เตรียมก่อน"],
      ["แนบรูปหรือส่งอนุมัติไม่ได้", "ตรวจว่ารวมไม่เกิน 4 รูป แต่ละไฟล์ไม่เกิน 2 MB และมีรูปอย่างน้อย 1 รูปก่อนส่ง หากออนไลน์ให้ตรวจการเชื่อมต่อและข้อความผิดพลาด"],
      ["ทำงานแล้วแต่ Actual ยังไม่เพิ่ม", "ตรวจว่ารายงานอนุมัติแล้ว และเลือกไซต์ ปี แผน รอบตรงกัน ฉบับร่างและรออนุมัติยังไม่นับ"],
      ["บันทึกแล้วข้อมูลไม่อยู่หรือมีข้อความผิดพลาด", "อย่ากดซ้ำหลายครั้ง เก็บข้อความผิดพลาดและรหัสรายการ ตรวจโหมดและไซต์ โหมด Demo ไม่ข้ามเบราว์เซอร์ ส่วนออนไลน์ต้องตรวจว่าบันทึกสำเร็จ อย่ารีเฟรชขณะมีฟอร์มที่ยังไม่ได้บันทึก"],
      ["ต้องแจ้งปัญหาให้ผู้ดูแลอย่างไร", "ส่งชื่อเมนู ไซต์ รหัสรายการ ขั้นตอนก่อนพบปัญหา สิ่งที่คาดหวังและภาพหน้าจอ ปิดบังข้อมูลส่วนตัวและห้ามแนบรหัสผ่านหรือ API key"],
    ].map(([q, a]) => <details key={q}><summary>{q}</summary><p>{a}</p></details>)}</section>
    <footer>คู่มือสำหรับฟีเจอร์ในเวอร์ชันพัฒนานี้ • IoT ยังจำลอง • การทดสอบฐานข้อมูลครบวงจรและ UAT ยังไม่เสร็จ</footer>
  </section>;
}
