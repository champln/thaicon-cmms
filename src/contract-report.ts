import { validCalendarDate } from './work-order-timing';

export type CleaningKind = 'major' | 'minor';
export type Contract = { id: string; siteId: string; name: string; startDate: string; endDate: string };
export type ContractTarget = { month: string; building: string; assetType: string; kind: CleaningKind; target: number };
export type ContractWork = { id: string; contractId: string; siteId: string; reportId: string; reportVersion: number; assetId: string; building: string; assetType: string; kind: CleaningKind; serviceDate: string; status: 'draft' | 'submitted' | 'approved' | 'rejected'; occurrenceId: string; countable: boolean };

export function contractMonths(contract: Contract): string[] {
  if (!contract.id || !contract.siteId || !validCalendarDate(contract.startDate) || !validCalendarDate(contract.endDate) || contract.startDate > contract.endDate) throw new Error('ช่วงสัญญาไม่ถูกต้อง');
  const months: string[] = [];
  let [year, month] = contract.startDate.split('-').map(Number);
  const end = contract.endDate.slice(0, 7);
  while (true) {
    const key = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}`;
    months.push(key);
    if (key === end) return months;
    if (months.length >= 120) throw new Error('สัญญารองรับไม่เกิน 120 เดือน');
    if (++month > 12) { month = 1; year++; }
  }
}
const key = (r: Pick<ContractTarget, 'month' | 'building' | 'assetType' | 'kind'>) => JSON.stringify([r.month, r.building, r.assetType, r.kind]);
const quantity = (n: number) => { if (!Number.isSafeInteger(n) || n < 0) throw new Error('จำนวนเป้าหมายไม่ถูกต้อง'); return n; };

/** Input is a complete authorized contract read. Never infer individual work
 * from legacy report quantities, current asset locations or missing reads. */
export function buildContractReport(contract: Contract, targets: ContractTarget[], work: ContractWork[], verified: boolean) {
  if (!verified) throw new Error('ยังยืนยันข้อมูลสัญญาไม่ได้');
  const months = contractMonths(contract);
  const cells = new Map<string, ContractTarget & { actual: number; reportIds: string[] }>();
  for (const target of targets) {
    if (!months.includes(target.month) || !target.building.trim() || !target.assetType.trim() || !['major', 'minor'].includes(target.kind) || cells.has(key(target))) throw new Error('เป้าหมายซ้ำหรืออยู่นอกสัญญา');
    cells.set(key(target), { ...target, target: quantity(target.target), actual: 0, reportIds: [] });
  }
  const ids = new Set<string>(), occurrences = new Set<string>();
  for (const row of work) {
    if (!row.id || ids.has(row.id) || row.siteId !== contract.siteId || row.contractId !== contract.id || !row.reportId || !row.assetId || !row.occurrenceId || !Number.isSafeInteger(row.reportVersion) || row.reportVersion < 1 || !['draft','submitted','approved','rejected'].includes(row.status) || !validCalendarDate(row.serviceDate) || row.serviceDate < contract.startDate || row.serviceDate > contract.endDate) throw new Error('รายการผลงานไม่ถูกต้องหรือข้ามสัญญา');
    ids.add(row.id);
    const cell = cells.get(key({ ...row, month: row.serviceDate.slice(0, 7) }));
    if (!cell) throw new Error('ผลงานยังไม่มีกลุ่มเป้าหมาย กรุณาตรวจการจัดกลุ่ม');
    if (row.status !== 'approved' || !row.countable) continue;
    const occurrence = JSON.stringify([row.assetId, row.kind, row.occurrenceId]);
    if (occurrences.has(occurrence)) throw new Error('ผลงานรอบเดียวกันซ้ำ');
    occurrences.add(occurrence);
    cell.actual++;
    cell.reportIds.push(row.reportId);
  }
  const rows = [...cells.values()].sort((a,b) => key(a).localeCompare(key(b))).map(r => Object.freeze({ ...r, reportIds: Object.freeze([...new Set(r.reportIds)]), difference: r.actual - r.target, progress: r.target ? Math.round(r.actual / r.target * 1000) / 10 : null }));
  const target = quantity(rows.reduce((n,r) => n+r.target,0));
  const actual = rows.reduce((n,r) => n+r.actual,0);
  return Object.freeze({ contract: Object.freeze({...contract}), months: Object.freeze(months), rows: Object.freeze(rows), target, actual, progress: target ? Math.round(actual / target * 1000) / 10 : null, uniqueAssets: new Set(work.filter(r=>r.status==='approved' && r.countable).map(r=>r.assetId)).size });
}
