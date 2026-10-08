import { useEffect, useRef, useState } from "react";
import { downloadMaintenancePdf } from "./pdf-export";
import { buildPmPerformanceReport, pmPerformancePdfSections } from "./pm-performance-report";

export default function PmPerformanceExport({ report, scopeKey, siteName, year }: {
  report: ReturnType<typeof buildPmPerformanceReport> | null; scopeKey: string; siteName: string; year: number;
}) {
  const [busy, setBusy] = useState(false), [message, setMessage] = useState("");
  const alive = useRef(false), currentScope = useRef(scopeKey), currentReport = useRef(report);
  currentScope.current = scopeKey; currentReport.current = report;
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  async function run(format: "xlsx" | "pdf") {
    if (!report || busy) return;
    const capturedScope = scopeKey, captured = report;
    const assertCurrent = () => {
      if (!alive.current || currentScope.current !== capturedScope || currentReport.current !== captured) throw new Error("ข้อมูล ตัวกรอง หรือขอบเขตเปลี่ยนแล้ว กรุณาส่งออกรายงานใหม่");
    };
    setBusy(true); setMessage("");
    try {
      if (format === "xlsx") {
        const { downloadExcel } = await import("./excel-export");
        await downloadExcel(`PM-Performance-${captured.siteId}-${year}.xlsx`, captured.sheets, assertCurrent);
      } else {
        await downloadMaintenancePdf({ filename: `PM-Performance-${captured.siteId}-${year}.pdf`, documentTitle: "รายงานสรุป Plan เทียบ Actual", documentNumber: `${captured.siteId}-${year}`, subtitle: `${siteName} • ปีแผน ${year + 543} • UTC ${captured.evaluatedAt}`, sections: pmPerformancePdfSections(captured), assertCurrent });
      }
      assertCurrent(); setMessage(`ดาวน์โหลด ${format.toUpperCase()} แล้ว`);
    } catch (error) {
      if (alive.current && currentScope.current === capturedScope) setMessage(error instanceof Error ? error.message : "ส่งออกไม่สำเร็จ");
    } finally {
      if (alive.current && currentScope.current === capturedScope) setBusy(false);
    }
  }
  return <div aria-label="ส่งออกรายงาน PM" aria-busy={busy}>
    <div className="maint-detail-actions">
      <button className="maint-button secondary" type="button" disabled={!report || busy} onClick={() => void run("pdf")}>ดาวน์โหลด PDF</button>
      <button className="maint-button secondary" type="button" disabled={!report || busy} onClick={() => void run("xlsx")}>ดาวน์โหลด Excel</button>
    </div>
    {(busy || message) && <p role="status">{busy ? "กำลังสร้างรายงาน…" : message}</p>}
  </div>;
}
