import type { ServiceReport } from './maintenance';
import type { CleaningKind, ContractWork } from './contract-report';
import { validCalendarDate } from './work-order-timing';
import type { DemoContractRecord } from './contract-demo-store';

export type DemoCleaningEvidence = {
  id: string; siteId: string; contractId: string; contractName: string; contractVersion: number;
  groupId: string; groupName: string; building: string; assetType: string;
  assetId: string; reportId: string; serviceDate: string; kind: CleaningKind;
  source: string; approval: { by: string; at: string } | null;
  acceptance: { by: string; at: string } | null;
  receiptType?: 'customer'|'simulation';
};

// Compare the actual evidence fields. Status/timestamps can change in internal
// review without modifying the cleaning evidence.
export function contractEvidenceSource(report: ServiceReport) {
  const {version,planId,cycleId,workOrderId,assetId,assetName,serviceDate,quantity,technicianName,
    customerName,workPerformed,findings,actionTaken,result,attachments,createdAt,createdBy} = report;
  return JSON.stringify([version,planId,cycleId,workOrderId,assetId,assetName,serviceDate,quantity,technicianName,
    customerName,workPerformed,findings,actionTaken,result,attachments.map(a=>[a.id,a.name,a.type,a.storagePath]),createdAt,createdBy]);
}

export function eligibleDemoContracts(site: string, report: ServiceReport, contracts: DemoContractRecord[]) {
  if (report.jobsiteId !== site || report.quantity !== 1 || !validCalendarDate(report.serviceDate)) return [];
  return contracts.filter(contract => contract.site === site &&
    report.serviceDate >= contract.definition.starts_on && report.serviceDate <= contract.definition.ends_on &&
    contract.definition.members?.some(member => member.asset_id === report.assetId));
}

export function addDemoEvidence(rows: DemoCleaningEvidence[], site: string, report: ServiceReport,
  contract: DemoContractRecord, kind: CleaningKind): DemoCleaningEvidence[] {
  if (!eligibleDemoContracts(site,report,[contract]).length || !['major','minor'].includes(kind)) {
    throw new Error('ตรวจเครื่อง จำนวนงาน และวันที่ให้ตรงกับสัญญา');
  }
  const member = contract.definition.members?.find(item => item.asset_id === report.assetId);
  const group = contract.definition.groups.find(item => item.id === member?.group_id);
  if (!group) throw new Error('ไม่พบกลุ่มของเครื่องในสัญญา');
  if (rows.some(row => row.siteId === site && (row.reportId === report.id ||
      (row.contractId === contract.id && row.assetId === report.assetId && row.kind === kind && row.serviceDate === report.serviceDate)))) {
    throw new Error('มีงานล้างประเภทนี้ของเครื่องในวันนี้ หรือเชื่อมรายงานนี้แล้ว');
  }
  return [...rows, {
    id: crypto.randomUUID(), siteId: site, contractId: contract.id, contractName: contract.definition.name,
    contractVersion: contract.version, groupId: group.id, groupName: group.name, building: group.building,
    assetType: group.asset_type, assetId: report.assetId, reportId: report.id, serviceDate: report.serviceDate,
    kind, source: contractEvidenceSource(report), approval: null, acceptance: null,
  }];
}

export function evidenceMatches(row: DemoCleaningEvidence, report: ServiceReport | undefined) {
  return !!report && row.siteId === report.jobsiteId && row.reportId === report.id && row.assetId === report.assetId &&
    row.serviceDate === report.serviceDate && row.source === contractEvidenceSource(report);
}

export function acceptDemoEvidence(row: DemoCleaningEvidence, report: ServiceReport, actorId: string, now: string): DemoCleaningEvidence {
  if (row.acceptance) throw new Error('บันทึกการตรวจรับแล้ว');
  if (!evidenceMatches(row,report) || report.status !== 'approved' || !report.approvedBy || !report.approvedAt) {
    throw new Error('ต้องใช้รายงานฉบับเดิมที่อนุมัติภายในแล้ว');
  }
  return {...row, approval:{by:report.approvedBy,at:report.approvedAt}, acceptance:{by:actorId,at:now}};
}

export function demoEvidenceWork(row: DemoCleaningEvidence, report: ServiceReport | undefined): ContractWork | null {
  if (!report || !evidenceMatches(row,report)) return null;
  const countable = !!row.acceptance && !!row.approval && report.status === 'approved' &&
    row.approval.by === report.approvedBy && row.approval.at === report.approvedAt;
  return {...row,reportVersion:report.version ?? 1,status:report.status,occurrenceId:row.serviceDate,countable};
}
