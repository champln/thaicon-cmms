import { useEffect, useMemo, useRef, useState } from "react";
import type { WorkOrder } from "./CMMSApp";
import type { OrderFilters } from "./work-order-filter";
import { filterWorkOrders } from "./work-order-filter";
import { buildOrderReport } from "./work-order-summary-report";
import { buildMaterialLedgerReport, materialLedgerPdfSections } from "./material-ledger-report";
import { loadMaterialLedger } from "./material-ledger-loader";
import { assertMaterialLedgerAccess } from "./material-ledger-supabase";
import { createOrderCommandRepository } from "./work-order-command-supabase";
import { supabase } from "./supabase";
import { downloadMaintenancePdf } from "./pdf-export";
import type { LiveScope } from "./live-snapshot-supabase";

export default function MaterialLedgerExport({ orders, filters, siteName, scope, mode, verified }: {
  orders: WorkOrder[]; filters: OrderFilters; siteName: string; scope: LiveScope; mode: "online" | "demo"; verified: boolean;
}) {
  const [busy, setBusy] = useState(false), [message, setMessage] = useState(""), [failed, setFailed] = useState(false);
  const scopeKey = JSON.stringify([scope.userId, scope.role, scope.siteId, mode]);
  const selection = useMemo(() => {
    try {
      buildOrderReport({ orders, filters, siteId: scope.siteId, siteName, verified, mode, evaluatedAt: new Date().toISOString() });
      return { orders: filterWorkOrders(orders, filters), error: "" };
    } catch (error) { return { orders: null, error: error instanceof Error ? error.message : "ยังยืนยันข้อมูลไม่ได้" }; }
  }, [orders, filters.query, filters.status, filters.assigneeId, filters.from, filters.to, scope.siteId, siteName, verified, mode]);
  const alive = useRef(false), current = useRef({ scopeKey, selection });
  current.current = { scopeKey, selection };
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  async function run(format: "xlsx" | "pdf") {
    if (busy || !selection.orders) return;
    const captured = selection, selected = selection.orders;
    const assertCurrent = () => {
      if (!alive.current || current.current.scopeKey !== scopeKey || current.current.selection !== captured)
        throw new Error("ข้อมูล ตัวกรอง หรือสิทธิ์ไซต์เปลี่ยนแล้ว กรุณาส่งออกใหม่");
    };
    setBusy(true); setFailed(false); setMessage("");
    try {
      const repository = createOrderCommandRepository();
      const batches = mode === "demo" ? selected.map(order => ({ orderId: order.id, materials: order.materials ?? [] })) :
        await loadMaterialLedger({ orderIds: selected.map(order => order.id), readMaterials: id => repository.materials(id), assertCurrent,
          assertAuthorized: async () => {
            if (!supabase) throw new Error("ยังไม่ได้ตั้งค่าระบบออนไลน์");
            await assertMaterialLedgerAccess(supabase, scope, selected, assertCurrent);
          } });
      assertCurrent();
      const report = buildMaterialLedgerReport({ orders, filters, batches, siteId: scope.siteId, siteName, verified, mode, evaluatedAt: new Date().toISOString() });
      if (format === "xlsx") {
        const { downloadExcel } = await import("./excel-export");
        await downloadExcel(`Materials-${scope.siteId}.xlsx`, report.sheets, assertCurrent);
      } else await downloadMaintenancePdf({ filename: `Materials-${scope.siteId}.pdf`, documentTitle: report.title,
        documentNumber: scope.siteId, subtitle: `${siteName} • UTC ${report.evaluatedAt}`, sections: materialLedgerPdfSections(report), assertCurrent });
      assertCurrent(); setMessage(`ดาวน์โหลด ${format.toUpperCase()} แล้ว • ${report.orderCount} ใบงาน / ${report.activeCount} รายการใช้ / ${report.voidCount} รายการยกเลิก`);
    } catch (error) {
      if (alive.current && current.current.scopeKey === scopeKey) { setFailed(true); setMessage(error instanceof Error ? error.message : "ส่งออกรายงานไม่สำเร็จ"); }
    } finally { if (alive.current && current.current.scopeKey === scopeKey) setBusy(false); }
  }
  return <div className="wo-search-filters cmms-asset-report-export" aria-label="ส่งออกรายงานวัสดุตามตัวกรองใบงาน" aria-busy={busy}>
    <p>วัสดุในใบงานตามตัวกรอง • รวมชื่อและหน่วยเดียวกัน แยกรายการยกเลิกพร้อมเหตุผล</p>
    <button type="button" className="cmms-secondary-button" disabled={busy || !selection.orders} onClick={() => void run("xlsx")}>รายงานวัสดุ Excel</button>
    <button type="button" className="cmms-secondary-button" disabled={busy || !selection.orders} onClick={() => void run("pdf")}>รายงานวัสดุ PDF</button>
    {(selection.error || busy || message) && <p role={selection.error || failed ? "alert" : "status"}>{selection.error || (busy ? "กำลังโหลดวัสดุให้ครบทุกใบงานและสร้างรายงาน…" : message)}</p>}
  </div>;
}
