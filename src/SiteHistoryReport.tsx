import { useEffect, useMemo, useRef, useState } from "react";
import type { WorkOrder } from "./CMMSApp";
import type { MaintenanceState } from "./maintenance";
import { buildSiteHistoryReport, siteHistoryPdfSections, type HistoryFilters } from "./site-history-report";
import { downloadMaintenancePdf } from "./pdf-export";

const empty: HistoryFilters = { query: "", from: "", to: "", assetId: "" };
export default function SiteHistoryReport({ orders, maintenance, siteId, siteName, scopeKey, mode, verified }: {
  orders: WorkOrder[]; maintenance: MaintenanceState; siteId: string; siteName: string;
  scopeKey: string; mode: "demo" | "online"; verified: boolean;
}) {
  const [filters, setFilters] = useState(empty), [busy, setBusy] = useState(false), [message, setMessage] = useState("");
  const result = useMemo(() => {
    try { return { report: buildSiteHistoryReport({ orders, maintenance, siteId, siteName, mode, verified, filters, evaluatedAt: new Date().toISOString() }), error: "" }; }
    catch (error) { return { report: null, error: error instanceof Error ? error.message : "สร้างประวัติไม่ได้" }; }
  }, [orders, maintenance, siteId, siteName, mode, verified, filters]);
  const alive = useRef(false), current = useRef({ scopeKey, report: result.report });
  current.current = { scopeKey, report: result.report };
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  async function run(format: "xlsx" | "pdf") {
    const report = result.report;
    if (!report || busy) return;
    const assertCurrent = () => {
      if (!alive.current || current.current.scopeKey !== scopeKey || current.current.report !== report) throw new Error("ข้อมูล ตัวกรอง หรือสิทธิ์ไซต์เปลี่ยนแล้ว กรุณาส่งออกใหม่");
    };
    setBusy(true); setMessage("");
    try {
      if (format === "xlsx") {
        const { downloadExcel } = await import("./excel-export");
        await downloadExcel(`Site-history-${siteId}.xlsx`, report.sheets, assertCurrent);
      } else await downloadMaintenancePdf({ filename: `Site-history-${siteId}.pdf`, documentTitle: report.title,
        documentNumber: siteId, subtitle: `${siteName} • UTC ${report.evaluatedAt}`, sections: siteHistoryPdfSections(report), assertCurrent });
      assertCurrent(); setMessage(`ดาวน์โหลด ${format.toUpperCase()} แล้ว`);
    } catch (error) {
      if (alive.current && current.current.scopeKey === scopeKey) setMessage(error instanceof Error ? error.message : "ส่งออกไม่สำเร็จ");
    } finally { if (alive.current && current.current.scopeKey === scopeKey) setBusy(false); }
  }
  const report = result.report;
  return <section className="cmms-panel cmms-page-panel site-history-report" aria-label="ประวัติและเอกสารเชื่อมโยงของไซต์">
    <div className="wo-search-filters cmms-asset-report-export">
      <h2>ประวัติและเอกสารเชื่อมโยงของไซต์</h2>
      <p>ใบงานใช้วันสร้าง • Service Report ใช้วันให้บริการ • ใบแจ้งซ่อมใช้วันแจ้ง</p>
      <label>ค้นหาเอกสาร<input value={filters.query} onChange={e => setFilters({ ...filters, query: e.target.value })} /></label>
      <label>รหัสเครื่องจักร<input value={filters.assetId} placeholder="ทุกเครื่อง" onChange={e => setFilters({ ...filters, assetId: e.target.value })} /></label>
      <label>ประวัติตั้งแต่วันที่<input type="date" value={filters.from} onChange={e => setFilters({ ...filters, from: e.target.value })} /></label>
      <label>ประวัติถึงวันที่<input type="date" value={filters.to} onChange={e => setFilters({ ...filters, to: e.target.value })} /></label>
      <button type="button" className="cmms-secondary-button" onClick={() => setFilters(empty)}>ล้างตัวกรองประวัติ</button>
      <button type="button" className="cmms-secondary-button" disabled={!report || busy} onClick={() => void run("xlsx")}>ประวัติไซต์ Excel</button>
      <button type="button" className="cmms-secondary-button" disabled={!report || busy} onClick={() => void run("pdf")}>ประวัติไซต์ PDF</button>
      <p role="status" aria-live="polite" aria-busy={busy}>{busy ? "กำลังสร้างรายงานประวัติ…" : message}</p>
      {result.error && <p role="alert">{result.error}</p>}
      {report && <>
        <p role="status">ใบงาน {report.counts.orders} ใบ • Service Report {report.counts.reports} ใบ • ใบแจ้งซ่อม {report.counts.repairs} ใบ</p>
        {report.unknownDates > 0 && <p>เอกสารในไซต์ที่ไม่ทราบวันที่ {report.unknownDates} ใบ จะแสดงเมื่อไม่กรองวันที่</p>}
        <details><summary>ประวัติตามวันที่ ({report.entries.length})</summary>
          {report.entries.length === 0 ? <p>ไม่พบเอกสารตามตัวกรอง</p> : report.entries.map(r => <article key={r.kind + ":" + r.id}>
            <p><strong>{r.kind} {r.id}</strong> • {r.date ?? "ไม่ทราบวันที่"} • เครื่อง {r.assetId}</p><p>{r.title} • {r.status}</p>
          </article>)}
        </details>
        <details><summary>เส้นทางใบแจ้งซ่อม ({report.chains.length})</summary>
          {report.chains.map(r => <article key={r.repairId}>
            <p><strong>{r.repairId}</strong> • เครื่อง {r.assetId}</p>
            <p>Service Report: {r.reportId} — {r.reportState}</p><p>ใบงาน: {r.orderId} — {r.orderState}</p>
          </article>)}
          <p>เอกสารอ้างอิงนอกตัวกรองแสดงเพื่อใช้ตรวจสอบ และไม่นับเพิ่มในยอดข้างต้น</p>
        </details>
        <details><summary>Service Report อ้างอิงใบงาน ({report.references.length})</summary>
          {report.references.map(r => <p key={r.sourceId}>{r.sourceId} → {r.targetId} • {r.state}</p>)}
        </details>
      </>}
    </div>
  </section>;
}
