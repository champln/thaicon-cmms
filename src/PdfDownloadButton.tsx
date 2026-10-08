import { useState } from "react";

export default function PdfDownloadButton({ download, onToast, label = "ดาวน์โหลด PDF" }: {
  download: () => Promise<void>; onToast: (message: string) => void; label?: string;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  async function run() {
    if (pending) return;
    setPending(true); setError("");
    try { await download(); onToast("ส่งไฟล์ PDF ให้เบราว์เซอร์แล้ว"); }
    catch (reason) {
      const message = reason instanceof Error ? reason.message : "สร้าง PDF ไม่สำเร็จ กรุณาลองอีกครั้ง";
      setError(message); onToast(message);
    } finally { setPending(false); }
  }
  return <div><button className="maint-button secondary" type="button" disabled={pending} onClick={() => void run()}>{pending ? "กำลังสร้าง PDF…" : label}</button>{error && <p role="alert" className="maint-form-error">{error}</p>}</div>;
}
