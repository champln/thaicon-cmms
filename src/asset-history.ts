import type { WorkOrder } from "./CMMSApp";
import type { MaintenanceState } from "./maintenance";
import type { ManagedAsset } from "./master-data";

export function assetHistory(asset: ManagedAsset, _siteName: string, orders: WorkOrder[], maintenance: MaintenanceState) {
  return {
    workOrders: orders.filter((item) => item.assetId === asset.id && item.jobsiteId === asset.jobsiteId),
    serviceReports: maintenance.serviceReports.filter((item) => item.assetId === asset.id && item.jobsiteId === asset.jobsiteId).sort((a, b) => b.serviceDate.localeCompare(a.serviceDate)),
    repairRequests: maintenance.repairRequests.filter((item) => item.assetId === asset.id && item.jobsiteId === asset.jobsiteId).sort((a, b) => b.requestedDate.localeCompare(a.requestedDate)),
  };
}
