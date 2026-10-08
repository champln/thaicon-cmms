import { useEffect, useMemo, useRef, useState } from "react";
import { buildAssetHistoryReport, assetHistoryPdfSections } from "./asset-history-report";
import type { ManagedAsset } from "./master-data";
import type { WorkOrder } from "./CMMSApp";
import type { MaintenanceState } from "./maintenance";
import { downloadMaintenancePdf } from "./pdf-export";

export default function AssetHistoryExport({ asset, siteName, orders, maintenance, scopeKey, mode }: {
  asset: ManagedAsset; siteName: string; orders: WorkOrder[]; maintenance: MaintenanceState; scopeKey: string; mode: "online" | "demo";
}) {
  const [busy, setBusy] = useState(false), [message, setMessage] = useState("");
  const result = useMemo(() => {
    try { return { report: buildAssetHistoryReport({ asset, siteName, orders, maintenance, mode, verified: true, evaluatedAt: new Date().toISOString() }), error: "" }; }
    catch (error) { return { report: null, error: error instanceof Error ? error.message : "สร้างประวัติไม่ได้" }; }
  }, [asset, siteName, orders, maintenance, mode]);
  const alive = useRef(false), current = useRef({ scopeKey, report: result.report });
  current.current = { scopeKey, report: result.report };
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  async function run(format: "xlsx" | "pdf") {
    const report = result.report, capturedScope = scopeKey;
    if (!report || busy) return;
    const assertCurrent = () => {
      if (!alive.current || current.current.scopeKey !== capturedScope || current.current.report !== report) throw new Error("ข้อมูลหรือขอบเขตประวัติเปลี่ยนแล้ว กรุณาส่งออกใหม่");
    };
    setBusy(true); setMessage("");
    try {
      if (format === "xlsx") {
        const { downloadExcel } = await import("./excel-export");
        await downloadExcel(`Asset-history-${report.assetId}.xlsx`, report.sheets, assertCurrent);
      } else await downloadMaintenancePdf({ filename: `Asset-history-${report.assetId}.pdf`, documentTitle: report.title, documentNumber: report.assetId, subtitle: `${siteName} • ${report.siteId} • UTC ${report.evaluatedAt}`, sections: assetHistoryPdfSections(report), assertCurrent });
      assertCurrent(); setMessage(`ดาวน์โหลด ${format.toUpperCase()} แล้ว`);
    } catch (error) {
      if (alive.current && current.current.scopeKey === capturedScope) setMessage(error instanceof Error ? error.message : "ส่งออกไม่สำเร็จ");
    } finally { if (alive.current && current.current.scopeKey === capturedScope) setBusy(false); }
  }
  return <div className="wo-search-filters cmms-asset-report-export" aria-label="ส่งออกประวัติเครื่องจักร" aria-busy={busy}>
    <button className="cmms-secondary-button" type="button" disabled={busy || !result.report} onClick={() => void run("xlsx")}>ประวัติเครื่องจักร Excel</button>
    <button className="cmms-secondary-button" type="button" disabled={busy || !result.report} onClick={() => void run("pdf")}>ประวัติเครื่องจักร PDF</button>
    {(result.error || message || busy) && <p role={result.error ? "alert" : "status"}>{result.error || (busy ? "กำลังสร้างรายงาน…" : message)}</p>}
  </div>;
}
