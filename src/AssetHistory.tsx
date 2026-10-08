import type { WorkOrder } from "./CMMSApp";
import type { MaintenanceState, RepairStatus, ReportStatus } from "./maintenance";
import type { ManagedAsset } from "./master-data";
import { assetHistory } from "./asset-history";
import AssetHistoryExport from "./AssetHistoryExport";

const reportLabels: Record<ReportStatus, string> = { draft: "ฉบับร่าง", submitted: "รออนุมัติ", approved: "อนุมัติแล้ว", rejected: "ส่งกลับแก้ไข" };
const repairLabels: Record<RepairStatus, string> = { draft: "ฉบับร่าง", open: "เปิดงาน", in_progress: "กำลังดำเนินการ", resolved: "แก้ไขแล้ว", cancelled: "ยกเลิก" };

export default function AssetHistory({ asset, siteName, orders, maintenance, loading, error, onSelectOrder, scopeKey, mode }: { asset: ManagedAsset; siteName: string; orders: WorkOrder[]; maintenance: MaintenanceState; loading: boolean; error: boolean; onSelectOrder: (order: WorkOrder) => void; scopeKey: string; mode: "online" | "demo" }) {
  const history = assetHistory(asset, siteName, orders, maintenance);
  if (loading) return <p role="status">กำลังโหลดประวัติเครื่องจักร…</p>;
  if (error) return <p role="alert">โหลดประวัติไม่ครบ กรุณาเปิดหน้าใหม่เพื่อลองอีกครั้ง</p>;
  return <div className="cmms-drawer-section"><h3>ประวัติเครื่องจักร</h3>
    <AssetHistoryExport asset={asset} siteName={siteName} orders={orders} maintenance={maintenance} scopeKey={scopeKey} mode={mode} />
    <h4>ใบงาน ({history.workOrders.length})</h4><p>เปิดใบงานเพื่อดูประวัติกิจกรรมและวัสดุที่ใช้ รวมรายการยกเลิกและเหตุผล</p><div className="cmms-timeline">{history.workOrders.map((item) => <p key={item.id}><i /><span><strong>{item.id} • {item.title}</strong><small>{item.created} • {item.status}</small><button className="cmms-secondary-button" type="button" onClick={() => onSelectOrder(item)}>เปิดใบงาน {item.id}</button></span></p>)}</div>{!history.workOrders.length && <p>ยังไม่มีใบงาน</p>}
    <h4>Service Report ({history.serviceReports.length})</h4><div className="cmms-timeline">{history.serviceReports.map((item) => <p key={item.id}><i /><span><strong>{item.id} • {item.workPerformed}</strong><small>{item.serviceDate} • {reportLabels[item.status]}</small></span></p>)}</div>{!history.serviceReports.length && <p>ยังไม่มีรายงานบริการ</p>}
    <h4>ใบแจ้งซ่อม ({history.repairRequests.length})</h4><div className="cmms-timeline">{history.repairRequests.map((item) => <p key={item.id}><i /><span><strong>{item.id} • {item.title}</strong><small>{item.requestedDate} • {repairLabels[item.status]}</small></span></p>)}</div>{!history.repairRequests.length && <p>ยังไม่มีใบแจ้งซ่อม</p>}
  </div>;
}
