import type { MaintenanceState, ServiceReport, RepairRequest } from "./maintenance";
import type { PlanCommandState } from "./plan-command-supabase";
/** Only command-owned data is excluded; legacy plans and standalone repairs
 * remain writable. Never pass command snapshots to legacy upsert/delete. */
export function legacyMaintenanceSlice(state: MaintenanceState, advanced: boolean, repairsAdvanced = false, plansAdvanced = false): MaintenanceState {
  return advanced || repairsAdvanced || plansAdvanced ? { plans: plansAdvanced ? [] : state.plans, serviceReports: advanced ? [] : state.serviceReports, repairRequests: repairsAdvanced ? [] : advanced ? state.repairRequests.filter(r => !r.serviceReportId) : state.repairRequests } : state;
}
export function mergeLegacyMaintenanceBaseline(latest: MaintenanceState, snapshot: MaintenanceState, advanced: boolean, repairsAdvanced = false, plansAdvanced = false): MaintenanceState {
  return advanced || repairsAdvanced || plansAdvanced ? { plans: plansAdvanced ? latest.plans : snapshot.plans, serviceReports: advanced ? latest.serviceReports : snapshot.serviceReports, repairRequests: repairsAdvanced ? latest.repairRequests : advanced ? [...latest.repairRequests.filter(r => !!r.serviceReportId), ...snapshot.repairRequests.filter(r => !r.serviceReportId)] : snapshot.repairRequests } : snapshot;
}
/** Tombstones are explicit scoped server evidence, never inferred from an empty REST list. */
export function mergeConfirmedPlan(current: MaintenanceState, received: PlanCommandState, known: PlanCommandState | undefined, siteId: string, minVersion = 1) {
  if (received.siteId !== siteId || !Number.isSafeInteger(received.version) || received.version < minVersion ||
    (received.deleted ? received.plan !== null : !received.plan || received.plan.id !== received.id || received.plan.jobsiteId !== siteId || received.plan.version !== received.version))
    throw new Error("ยังยืนยันแผนจากเซิร์ฟเวอร์ไม่ได้ กรุณาลองคำขอเดิมอีกครั้ง");
  let confirmed = known && known.id === received.id && known.siteId === siteId && known.version > received.version ? known : received;
  const existing = current.plans.find(p => p.id === received.id && p.jobsiteId === siteId);
  if (existing?.version && existing.version > confirmed.version) confirmed = {id:existing.id,siteId,version:existing.version,deleted:false,plan:existing};
  return {confirmed,state:{...current,plans:confirmed.deleted ? current.plans.filter(p => p.id !== received.id) : [confirmed.plan!,...current.plans.filter(p => p.id !== received.id)]}};
}
export function mergeConfirmedReport(current: MaintenanceState, remote: MaintenanceState, id: string, siteId: string, minVersion = 1): { state: MaintenanceState; report: ServiceReport } {
  const received = remote.serviceReports.find(r => r.id === id && r.jobsiteId === siteId);
  if (!received?.version) throw new Error("อ่านรายงานที่บันทึกจากเซิร์ฟเวอร์ไม่ได้ กรุณาตรวจสิทธิ์และลองคำขอเดิมซ้ำ");
  const existing = current.serviceReports.find(r => r.id === id && r.jobsiteId === siteId);
  const report = existing && (existing.version ?? 0) > received.version ? existing : received;
  if ((report.version ?? 0) < minVersion) throw new Error("ยังอ่านรายงานเวอร์ชันที่ยืนยันไม่ได้ กรุณาลองคำขอเดิมอีกครั้ง");
  return { report, state: { ...current,
    serviceReports: [report, ...current.serviceReports.filter(r => r.id !== id)],
    repairRequests: [...remote.repairRequests.filter(r => r.serviceReportId === id && r.jobsiteId === siteId).map(r => {
      const existing = current.repairRequests.find(x => x.id === r.id);
      return existing && (existing.version ?? 0) > (r.version ?? 0) ? existing : r;
    }), ...current.repairRequests.filter(r => r.serviceReportId !== id)],
  } };
}
export function mergeConfirmedRepair(current: MaintenanceState, remote: MaintenanceState, id: string, siteId: string, minVersion = 1): { state: MaintenanceState; repair: RepairRequest } {
  const received = remote.repairRequests.find(r => r.id === id && r.jobsiteId === siteId);
  if (!received?.version) throw new Error("ยังอ่านใบแจ้งซ่อมฉบับที่ยืนยันจากเซิร์ฟเวอร์ไม่ได้ กรุณาลองคำขอเดิมอีกครั้ง");
  const existing = current.repairRequests.find(r => r.id === id && r.jobsiteId === siteId);
  const repair = existing && (existing.version ?? 0) > received.version ? existing : received;
  if ((repair.version ?? 0) < minVersion) throw new Error("ยังอ่านใบแจ้งซ่อมเวอร์ชันที่ยืนยันไม่ได้ กรุณาลองคำขอเดิมอีกครั้ง");
  return { repair, state: { ...current, repairRequests: [repair, ...current.repairRequests.filter(r => r.id !== id)] } };
}
