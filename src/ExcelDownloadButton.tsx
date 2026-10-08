import { useState } from "react";
import type { ExcelSheet } from "./excel-export";

export default function ExcelDownloadButton({ filename, sheets, onToast }: {
  filename: string; sheets: () => ExcelSheet[]; onToast: (message: string) => void;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  return <div>
    <button className="maint-button secondary" type="button" disabled={pending} aria-busy={pending} onClick={() => {
      setPending(true); setError("");
      void Promise.resolve().then(() => {
        const data = sheets(); // Capture scope before loading the export library.
        return import("./excel-export").then(module => module.downloadExcel(filename, data));
      })
        .then(() => onToast(`ดาวน์โหลด ${filename} แล้ว`))
        .catch(() => setError("สร้าง Excel ไม่สำเร็จ กรุณาลองใหม่"))
        .finally(() => setPending(false));
    }}>{pending ? "กำลังสร้าง Excel…" : "ดาวน์โหลด Excel"}</button>
    {error && <p role="alert">{error}</p>}
  </div>;
}
