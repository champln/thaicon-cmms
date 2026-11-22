import type { DemoContractRecord } from './contract-demo-store';
import type { buildDemoContractSummary, contractMonthlyTotals } from './contract-demo-summary';
import type { RepairRequest, ServiceReport } from './maintenance';
import { demoEvidenceWork, type DemoCleaningEvidence } from './contract-demo-evidence';

export type DeliveryInput = {
  siteName: string;
  contract: DemoContractRecord;
  period: string;
  filters: { month: string; building: string; type: string; kind: string };
  monthly: ReturnType<typeof contractMonthlyTotals>;
  detail: ReturnType<typeof buildDemoContractSummary>['rows'];
  reports: ServiceReport[];
  repairs: RepairRequest[];
  evidence: DemoCleaningEvidence[];
  excluded: number;
  online?: boolean;
};

export function snapshotDelivery({contract,reports,repairs,evidence,...input}: DeliveryInput) {
  const period = input.period.trim();
  if (!period || period.length > 80) throw new Error('ระบุชื่องวดไม่เกิน 80 ตัวอักษร');
  const ids = input.detail.flatMap(row=>row.reportIds);
  if (new Set(ids).size !== ids.length || ids.length !== input.detail.reduce((total,row)=>total+row.actual,0) ||
      ids.length !== input.monthly.reduce((total,row)=>total+row.actual,0)) throw new Error('ยอดและรายงานต้นทางไม่ตรงกัน');
  const byId = new Map(reports.filter(report=>report.jobsiteId===contract.site).map(report=>[report.id,report]));
  const linked = new Map(evidence.filter(row=>row.siteId===contract.site && row.contractId===contract.id).map(row=>[row.reportId,row]));
  const selectedIds = new Set(ids);
  const sources = ids.map(id=>{
    const report = byId.get(id);
    const entry=linked.get(id);
    if (!report || !entry || !demoEvidenceWork(entry,report)?.countable) throw new Error('ยืนยันรายงานต้นทางที่ตรวจรับแล้วไม่ครบ');
    if (report.attachments.some(photo=>!/^data:image\/(?:png|jpeg|webp|svg\+xml)[;,]/i.test(photo.dataUrl) &&
      !(input.online && photo.storagePath && /^https?:\/\//.test(photo.dataUrl)))) {
      throw new Error('เก็บรูปต้นทางในฉบับส่งมอบไม่ครบ');
    }
    return {report,acceptedBy:entry.acceptance!.by,acceptedAt:entry.acceptance!.at,receiptType:entry.receiptType ?? 'simulation'};
  });
  const related = repairs.filter(row=>{
    const report = row.serviceReportId && byId.get(row.serviceReportId);
    return row.jobsiteId===contract.site && report && selectedIds.has(report.id) && row.assetId===report.assetId;
  });
  return structuredClone({...input,period,site:contract.site,contractId:contract.id,contractName:contract.definition.name,
    contractVersion:contract.version,startDate:contract.definition.starts_on,endDate:contract.definition.ends_on,
    sources,repairs:related,id:crypto.randomUUID(),issuedAt:new Date().toISOString()});
}

export type DeliverySnapshot = ReturnType<typeof snapshotDelivery>;
export type DeliveryIssue = DeliverySnapshot & {revision:number};

function openArchive(): Promise<IDBDatabase> {
  return new Promise((resolve,reject)=>{
    const request = indexedDB.open('thaicon-demo-contract-deliveries',1);
    request.onupgradeneeded = ()=>{
      const store=request.result.createObjectStore('issues',{keyPath:'id'});
      store.createIndex('site','site');
      store.createIndex('contractRevision',['site','contractId','revision'],{unique:true});
    };
    request.onsuccess=()=>resolve(request.result);
    request.onerror=()=>reject(request.error);
  });
}

export async function issueDelivery(snapshot: DeliverySnapshot): Promise<DeliveryIssue> {
  if (snapshot.online) throw new Error('ฉบับออนไลน์ใช้เฉพาะในหน้าที่เปิดอยู่');
  const db=await openArchive();
  try {
    return await new Promise((resolve,reject)=>{
      const transaction=db.transaction('issues','readwrite');
      const store=transaction.objectStore('issues');
      const {site,contractId}=snapshot;
      const range=IDBKeyRange.bound([site,contractId,0],[site,contractId,Number.MAX_SAFE_INTEGER]);
      const latest=store.index('contractRevision').openKeyCursor(range,'prev');
      let issue: DeliveryIssue;
      latest.onsuccess=()=>{
        const key=latest.result?.key as [string,string,number] | undefined;
        issue={...snapshot,revision:(key?.[2] ?? 0)+1};
        store.add(issue);
      };
      transaction.oncomplete=()=>resolve(issue);
      transaction.onabort=()=>reject(transaction.error ?? new Error('บันทึกฉบับส่งมอบไม่สำเร็จ'));
    });
  } finally { db.close(); }
}

export async function readDeliveryArchive(site: string): Promise<DeliveryIssue[]> {
  const db=await openArchive();
  try {
    return await new Promise((resolve,reject)=>{
      const request=db.transaction('issues').objectStore('issues').index('site').getAll(site);
      request.onsuccess=()=>resolve((request.result as DeliveryIssue[]).sort((a,b)=>b.issuedAt.localeCompare(a.issuedAt)||b.revision-a.revision));
      request.onerror=()=>reject(request.error);
    });
  } finally { db.close(); }
}
