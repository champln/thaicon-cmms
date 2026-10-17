import { useEffect, useState } from "react";

/** Measures this browser's reachability of the web origin, not database health. */
export default function WebServerStatus() {
  const [status, setStatus] = useState<"checking" | "online" | "offline">("checking");
  useEffect(() => {
    let disposed = false;
    let sequence = 0;
    let active: AbortController | undefined;
    async function check() {
      const request = ++sequence;
      active?.abort();
      if (!navigator.onLine) { setStatus("offline"); return; }
      const controller = new AbortController();
      active = controller;
      const timeout = window.setTimeout(() => controller.abort(), 5000);
      try {
        const response = await fetch(`${import.meta.env.BASE_URL}web-status.json?t=${Date.now()}`, {
          cache: "no-store", signal: controller.signal, credentials: "omit",
        });
        const data = response.ok ? await response.json() : null;
        if (!disposed && request === sequence) setStatus(data?.service === "thaicon-cmms-web" ? "online" : "offline");
      } catch {
        if (!disposed && request === sequence) setStatus("offline");
      } finally { window.clearTimeout(timeout); }
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
  return <div className={`access-security-note access-server-status ${status}`} role="status" aria-live="polite">
    <i aria-hidden="true" />
    <span><strong>{status === "online" ? "เว็บเซิร์ฟเวอร์เชื่อมต่อได้" : status === "offline" ? "เชื่อมต่อเว็บเซิร์ฟเวอร์ไม่ได้" : "กำลังตรวจเว็บเซิร์ฟเวอร์..."}</strong>
      <small>ตรวจทุก 30 วินาที • ไม่รวมสถานะฐานข้อมูล</small></span>
  </div>;
}
