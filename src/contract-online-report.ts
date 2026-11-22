import {supabase} from './supabase';
import {createContractDefinitionRepository} from './contract-definition-supabase';
import {contractEvidenceSource, type DemoCleaningEvidence} from './contract-demo-evidence';
import type {ServiceReport} from './maintenance';

export async function loadOnlineContractReport(site:string) {
  if (!supabase) throw new Error('ยังเชื่อมต่อฐานข้อมูลไม่ได้');
  const client=supabase;
  const repository=createContractDefinitionRepository(client);
  if (!await repository.ready()) return null;
  const list=await repository.list(site);
  // Read definitions and evidence with the user's session, never the service role.
  const contracts=[];
  const evidence: OnlineEvidence[]=[];
  for (const item of list) {
    const contract=await repository.read(item.id,site);
    const {data,error}=await client.rpc('read_contract_accepted_evidence',{p_site:site,p_contract:item.id});
    if (error || !Array.isArray(data) || data.some(row=>row?.jobsite_id!==site || row.contract_id!==item.id ||
      !Number.isInteger(row.report_version) || typeof row.report_id!=='string' || !['major','minor'].includes(row.kind))) {
      throw new Error('อ่านหลักฐานตรวจรับตามสัญญาไม่ได้');
    }
    contracts.push(contract);
    evidence.push(...data);
  }
  return {contracts,evidence};
}

type OnlineEvidence = {
  id:string; jobsite_id:string; contract_id:string; contract_version:number; group_id:string; building:string;
  asset_type:string; asset_id:string; report_id:string; report_version:number; service_date:string;
  kind:'major'|'minor'; approved_by:string; approved_at:string; accepted_by:string; accepted_at:string;
  receipt_type?: 'customer'|'uat_simulation';
};

export function mapOnlineContractEvidence(rows:OnlineEvidence[],reports:ServiceReport[]):DemoCleaningEvidence[] {
  const sources=new Map(reports.map(report=>[JSON.stringify([report.jobsiteId,report.id]),report]));
  return rows.map(row=>{
    const report=sources.get(JSON.stringify([row.jobsite_id,row.report_id]));
    const matches=report?.version===row.report_version && report.approvedBy===row.approved_by &&
      !!report.approvedAt && Date.parse(report.approvedAt)===Date.parse(row.approved_at);
    return {
      id:row.id, siteId:row.jobsite_id, contractId:row.contract_id, contractVersion:row.contract_version,
      contractName:'',groupId:row.group_id,groupName:'',building:row.building,assetType:row.asset_type,
      assetId:row.asset_id,reportId:row.report_id,serviceDate:row.service_date,kind:row.kind,
      source:matches ? contractEvidenceSource(report) : '',
      approval:{by:row.approved_by,at:matches ? report.approvedAt! : row.approved_at},
      acceptance:{by:row.accepted_by,at:row.accepted_at},
      receiptType:row.receipt_type==='customer' ? 'customer' : 'simulation',
    };
  });
}
