import { useEffect, useMemo, useRef, useState } from "react";
import { buildAssetRegisterReport, assetRegisterPdfSections, type AssetFilters } from "./asset-register-report";
import type { ManagedAsset } from "./master-data";
import { downloadMaintenancePdf } from "./pdf-export";

export default function AssetRegisterExport({ assets, filters, siteId, siteName, scopeKey, mode, verified }: {
  assets: ManagedAsset[]; filters: AssetFilters; siteId: string; siteName: string; scopeKey: string; mode: "online" | "demo"; verified: boolean;
}) {
  const [busy, setBusy] = useState(false), [message, setMessage] = useState("");
  const result = useMemo(() => {
    try { return { report: buildAssetRegisterReport({ assets, filters, siteId, siteName, mode, verified, evaluatedAt: new Date().toISOString() }), error: "" }; }
    catch (error) { return { report: null, error: error instanceof Error ? error.message : "สร้างรายงานไม่ได้" }; }
  }, [assets, filters.query, filters.health, siteId, siteName, mode, verified]);
  const alive = useRef(false), current = useRef({ scopeKey, report: result.report });
  current.current = { scopeKey, report: result.report };
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  async function run(format: "xlsx" | "pdf") {
    const report = result.report;
    if (!report || busy) return;
    const capturedScope = scopeKey;
    const assertCurrent = () => {
      if (!alive.current || current.current.scopeKey !== capturedScope || current.current.report !== report) throw new Error("ข้อมูล ตัวกรอง หรือสิทธิ์ไซต์เปลี่ยนแล้ว กรุณาส่งออกใหม่");
    };
    setBusy(true); setMessage("");
    try {
      if (format === "xlsx") {
        const { downloadExcel } = await import("./excel-export");
        await downloadExcel(`Asset-register-${siteId}.xlsx`, report.sheets, assertCurrent);
      } else await downloadMaintenancePdf({ filename: `Asset-register-${siteId}.pdf`, documentTitle: report.title, documentNumber: siteId, subtitle: `${siteName} • UTC ${report.evaluatedAt}`, sections: assetRegisterPdfSections(report), assertCurrent });
      assertCurrent(); setMessage(`ดาวน์โหลด ${format.toUpperCase()} แล้ว`);
    } catch (error) {
      if (alive.current && current.current.scopeKey === capturedScope) setMessage(error instanceof Error ? error.message : "ส่งออกไม่สำเร็จ");
    } finally {
      if (alive.current && current.current.scopeKey === capturedScope) setBusy(false);
    }
  }
  return <div className="wo-search-filters cmms-asset-report-export" aria-label="ส่งออกทะเบียนเครื่องจักร" aria-busy={busy}>
    <p>ทะเบียนเครื่องจักรตามตัวกรอง • เฉพาะเครื่องที่ใช้งาน {result.report ? `• ${result.report.count} เครื่อง` : ""}</p>
    <button type="button" className="cmms-secondary-button" disabled={busy || !result.report} onClick={() => void run("xlsx")}>ทะเบียนเครื่องจักร Excel</button>
    <button type="button" className="cmms-secondary-button" disabled={busy || !result.report} onClick={() => void run("pdf")}>ทะเบียนเครื่องจักร PDF</button>
    {(result.error || busy || message) && <p role={result.error ? "alert" : "status"}>{result.error || (busy ? "กำลังสร้างรายงาน…" : message)}</p>}
  </div>;
}
