import { useEffect, useMemo, useRef, useState } from "react";
import type { WorkOrder } from "./CMMSApp";
import type { OrderFilters } from "./work-order-filter";
import { buildOrderReport, orderReportPdfSections } from "./work-order-summary-report";
import { downloadMaintenancePdf } from "./pdf-export";

export default function OrderSummaryExport({ orders, filters, siteId, siteName, scopeKey, mode }: {
  orders: WorkOrder[]; filters: OrderFilters; siteId: string; siteName: string; scopeKey: string; mode: "online" | "demo";
}) {
  const [busy, setBusy] = useState(false), [message, setMessage] = useState("");
  const alive = useRef(false), currentScope = useRef(scopeKey);
  currentScope.current = scopeKey;
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const result = useMemo(() => {
    try { return { report: buildOrderReport({ orders, filters, siteId, siteName, mode, verified: true, evaluatedAt: new Date().toISOString() }), error: "" }; }
    catch (error) { return { report: null, error: error instanceof Error ? error.message : "สร้างรายงานไม่ได้" }; }
  }, [orders, filters.query, filters.status, filters.assigneeId, filters.from, filters.to, siteId, siteName, mode]);
  async function exportReport(format: "xlsx" | "pdf") {
    const report = result.report;
    if (!report || busy) return;
    const requestedScope = scopeKey;
    const assertCurrent = () => {
      if (!alive.current || currentScope.current !== requestedScope) throw new Error("ขอบเขตผู้ใช้หรือไซต์เปลี่ยนแล้ว กรุณาสร้างรายงานใหม่");
    };
    setBusy(true); setMessage("");
    try {
      if (format === "xlsx") {
        const { downloadExcel } = await import("./excel-export");
        await downloadExcel(`WO-summary-${siteId}.xlsx`, report.sheets, assertCurrent);
      } else {
        await downloadMaintenancePdf({ filename: `WO-summary-${siteId}.pdf`, documentTitle: report.title, documentNumber: siteId, subtitle: `${siteName} | ประเมิน UTC ${report.evaluatedAt}`, sections: orderReportPdfSections(report), assertCurrent });
      }
      assertCurrent(); setMessage(`ดาวน์โหลด ${format.toUpperCase()} แล้ว`);
    } catch (error) {
      if (alive.current && currentScope.current === requestedScope) setMessage(error instanceof Error ? error.message : "ส่งออกรายงานไม่สำเร็จ");
    } finally {
      if (alive.current && currentScope.current === requestedScope) setBusy(false);
    }
  }
  return <div className="wo-search-filters" aria-label="ส่งออกรายงานใบงานตามตัวกรอง" aria-busy={busy}>
    <p>รายงานใบงาน งานค้าง และระยะเวลา ตามตัวกรอง • เวลาที่ไม่ทราบไม่ถูกนับเป็นศูนย์</p>
    <button className="cmms-secondary-button" type="button" disabled={busy || !result.report} onClick={() => void exportReport("xlsx")}>รายงานใบงาน Excel</button>
    <button className="cmms-secondary-button" type="button" disabled={busy || !result.report} onClick={() => void exportReport("pdf")}>รายงานใบงาน PDF</button>
    {(result.error || message || busy) && <p role={result.error ? "alert" : "status"}>{result.error || (busy ? "กำลังสร้างรายงาน กรุณารอสักครู่..." : message)}</p>}
  </div>;
}
