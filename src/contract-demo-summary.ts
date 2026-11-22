import { buildContractReport, type ContractTarget } from './contract-report';
import { demoEvidenceWork, type DemoCleaningEvidence } from './contract-demo-evidence';
import type { DemoContractRecord } from './contract-demo-store';
import type { ServiceReport } from './maintenance';

const cellKey = ({month,building,assetType,kind}: ContractTarget) => JSON.stringify([month,building,assetType,kind]);

export function buildDemoContractSummary(record: DemoContractRecord, evidence: DemoCleaningEvidence[], reports: ServiceReport[]) {
  const {id,site,definition} = record;
  const groups = new Map(definition.groups.map(group => [group.id,group]));
  const targets = new Map<string,ContractTarget>();
  for (const target of definition.targets) {
    const group = groups.get(target.group_id);
    if (!group) throw new Error('ไม่พบกลุ่มของเป้าหมาย');
    const row = {
      month:target.month_start.slice(0,7),building:group.building.trim(),assetType:group.asset_type,
      kind:target.cleaning_kind,target:target.target,
    };
    const key = cellKey(row);
    row.target += targets.get(key)?.target ?? 0;
    targets.set(key,row);
  }
  const configured = new Set(targets.keys());
  const sources = new Map(reports.filter(report => report.jobsiteId === site).map(report => [report.id,report]));
  const accepted = evidence.filter(row => row.siteId === site && row.contractId === id && row.acceptance);
  const work = accepted.flatMap(row => {
    const item = demoEvidenceWork(row,sources.get(row.reportId));
    if (!item?.countable || item.serviceDate < definition.starts_on || item.serviceDate > definition.ends_on) return [];
    const normalized = {...item,building:item.building.trim()};
    const cell = {...normalized,month:item.serviceDate.slice(0,7),target:0};
    if (!targets.has(cellKey(cell))) targets.set(cellKey(cell),cell);
    return [normalized];
  });
  const report = buildContractReport(
    {id,siteId:site,name:definition.name,startDate:definition.starts_on,endDate:definition.ends_on},
    [...targets.values()],work,true,
  );
  const rows = report.rows.map(row => {
    const hasTarget = configured.has(cellKey(row));
    return {...row,target:hasTarget ? row.target : null,difference:hasTarget ? row.difference : null};
  });
  return {rows,months:report.months,excluded:accepted.length-work.length};
}

export function contractMonthlyTotals(months: readonly string[], rows: ReturnType<typeof buildDemoContractSummary>['rows']) {
  let cumulativeTarget = 0, cumulativeActual = 0, hasCumulativeTarget = false;
  const byMonth = new Map<string, { target: number | null; actual: number; unplanned: number }>();
  for (const row of rows) {
    const total = byMonth.get(row.month) ?? {target:null,actual:0,unplanned:0};
    if (row.target !== null) total.target = (total.target ?? 0) + row.target;
    else total.unplanned += row.actual;
    total.actual += row.actual;
    byMonth.set(row.month,total);
  }
  return months.map(month => {
    const {target,actual,unplanned} = byMonth.get(month) ?? {target:null,actual:0,unplanned:0};
    if (target !== null) { cumulativeTarget += target; hasCumulativeTarget = true; }
    cumulativeActual += actual;
    return {
      month,target,actual,cumulativeTarget:hasCumulativeTarget ? cumulativeTarget : null,cumulativeActual,
      progress: target && !unplanned ? Math.round(actual/target*1000)/10 : null,
    };
  });
}
