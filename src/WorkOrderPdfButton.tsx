import { useState } from "react";
import type { WorkOrder } from "./CMMSApp";
import { workOrderSheets } from "./work-order-excel";
import { downloadMaintenancePdf } from "./pdf-export";

export default function WorkOrderPdfButton({ order, advanced }: { order: WorkOrder; advanced: boolean }) {
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  return <div><button className="maint-button secondary" type="button" disabled={pending} aria-busy={pending} onClick={() => {
    setPending(true); setMessage("");
    void Promise.resolve().then(async () => {
      const sheets = workOrderSheets(order, advanced);
      const sections = sheets[0].rows.map(([label,value]) => ({ label: String(label), value: String(value) }));
      sections.push({ label: "วัสดุที่ใช้", value: sheets[2].rows.length ? sheets[2].rows.map(row => `${row[1]} | ${row[2]} ${row[3]} | ${row[6]}\nผู้บันทึก ${row[4]} | ${row[5]}${row[8] ? `\nยกเลิกโดย ${row[7]} | ${row[8]}\nเหตุผล ${row[9]}` : ""}`).join("\n\n") : "ยังไม่มีรายการ" });
      sections.push({ label: "กิจกรรม", value: sheets[1].rows.length ? sheets[1].rows.map(row => `${row[1]} | ${row[2]} | ${row[3]} | รุ่น ${row[5]}\n${row[4]}`).join("\n\n") : "ยังไม่มีรายการ" });
      await downloadMaintenancePdf({ filename: `${order.id}.pdf`, documentTitle: "ใบงานและวัสดุที่ใช้", documentNumber: order.id, subtitle: order.site, sections });
      setMessage("ดาวน์โหลด PDF แล้ว");
    }).catch(() => setMessage("สร้าง PDF ไม่สำเร็จ รอโหลดประวัติให้ครบหรือลองใหม่")).finally(() => setPending(false));
  }}>{pending ? "กำลังสร้าง PDF…" : "ดาวน์โหลด PDF"}</button>{message && <p role="status">{message}</p>}</div>;
}
