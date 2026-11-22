import { useEffect, useState } from "react";
import { supabase } from "./supabase";
import { classifyDatabaseProbe } from "./database-status";
import type { DatabaseStatus as Status } from "./database-status";

export default function DatabaseStatus() {
  const [status, setStatus] = useState<Status>(supabase ? "checking" : "demo");
  useEffect(() => {
    const client = supabase;
    if (!client) return;
    let disposed = false, sequence = 0;
    let active: AbortController | undefined;
    async function check() {
      const request = ++sequence;
      active?.abort();
      if (!navigator.onLine) { setStatus("offline"); return; }
      const controller = new AbortController();
      active = controller;
      const timer = window.setTimeout(() => controller.abort(), 5000);
      try {
        // Executes SELECT true in PostgreSQL, including before login. No table
        // reads, row counts, credentials or elevated role are needed.
        const result = await client!.rpc("database_health").abortSignal(controller.signal);
        if (!disposed && request === sequence) setStatus(classifyDatabaseProbe(result));
      } catch {
        if (!disposed && request === sequence) setStatus("offline");
      } finally { window.clearTimeout(timer); }
    }
    void check();
    const timer = window.setInterval(() => void check(), 30000);
    const refresh = () => { void check(); };
    window.addEventListener("online", refresh);
    window.addEventListener("offline", refresh);
    window.addEventListener("focus", refresh);
    return () => {
      disposed = true; sequence++; active?.abort(); window.clearInterval(timer);
      window.removeEventListener("online", refresh);
      window.removeEventListener("offline", refresh);
      window.removeEventListener("focus", refresh);
    };
  }, []);
  const labels: Record<Status, [string, string]> = {
    demo: ["ไม่ได้เชื่อมฐานข้อมูล", "Demo • ข้อมูลอยู่ในเบราว์เซอร์"],
    checking: ["กำลังตรวจฐานข้อมูล...", "ตรวจการตอบกลับผ่าน Supabase"],
    online: ["ฐานข้อมูลตอบกลับได้", "ตรวจทุก 30 วินาที • ไม่ยืนยันสิทธิ์บันทึก"],
    offline: ["ตรวจการเชื่อมต่อฐานข้อมูลไม่สำเร็จ", "ตรวจเครือข่ายหรือแจ้งผู้ดูแล"],
    restricted: ["ยังยืนยันสถานะฐานข้อมูลไม่ได้", "จุดตรวจไม่อนุญาตให้เข้าถึง • แจ้งผู้ดูแล"],
    unknown: ["ยังยืนยันสถานะฐานข้อมูลไม่ได้", "จุดตรวจยังไม่พร้อม • แจ้งผู้ดูแล"],
  };
  return <div className={`access-security-note access-server-status access-database-status ${status}`} role="status" aria-live="polite">
    <i aria-hidden="true" /><span><strong>{labels[status][0]}</strong><small>{labels[status][1]}</small></span>
  </div>;
}
