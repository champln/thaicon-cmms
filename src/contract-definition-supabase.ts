import type { SupabaseClient } from '@supabase/supabase-js';
import { contractMonths } from './contract-report';
import { validCalendarDate } from './work-order-timing';

export type ContractDefinition = {
 name: string; starts_on: string; ends_on: string;
 groups: Array<{id: string; name: string; building: string; asset_type: 'AHU'|'FCU'|'SPT'; major_frequency: number; minor_frequency: number}>;
 targets: Array<{group_id: string; month_start: string; cleaning_kind: 'major'|'minor'; target: number}>;
 members?: Array<{group_id: string; asset_id: string}>;
};
export type ContractSummary = Pick<ContractDefinition,'name'|'starts_on'|'ends_on'> & {id:string};
export class ContractDefinitionError extends Error {
 constructor(public kind: 'unavailable'|'conflict'|'denied'|'invalid') {super({unavailable:'ยังยืนยันผลบันทึกสัญญาไม่ได้',conflict:'สัญญามีการเปลี่ยนแปลง กรุณาตรวจฉบับล่าสุด',denied:'ไม่มีสิทธิ์หรือยังไม่เปิดใช้สัญญา',invalid:'ข้อมูลสัญญาไม่ถูกต้อง'}[kind]);}
}
const fail=(code?:string)=>new ContractDefinitionError(code==='40001'?'conflict':code==='42501'?'denied':['22023','23503','23505','23514','23502','22P02','22007','22008'].includes(code??'')?'invalid':'unavailable');
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function validateContractDefinition(d:ContractDefinition) {
 const months=contractMonths({id:'validate',siteId:'validate',name:d.name,startDate:d.starts_on,endDate:d.ends_on});
 const integer=(n:number)=>Number.isSafeInteger(n)&&n>=0&&n<=2147483647;
 if(!d.name.trim()||d.name.length>200||d.groups.length>500||d.targets.length>120000)throw fail('22023');
 const ids=new Set<string>(),targets=new Set<string>();
 for(const g of d.groups){if(!uuid.test(g.id)||ids.has(g.id)||!g.name.trim()||g.name.length>200||!g.building.trim()||g.building.length>100||!['AHU','FCU','SPT'].includes(g.asset_type)||!integer(g.major_frequency)||!integer(g.minor_frequency))throw fail('22023');ids.add(g.id);}
 for(const t of d.targets){const key=JSON.stringify([t.group_id,t.month_start,t.cleaning_kind]);if(!ids.has(t.group_id)||targets.has(key)||!/^\d{4}-\d{2}-01$/.test(t.month_start)||!months.includes(t.month_start.slice(0,7))||!['major','minor'].includes(t.cleaning_kind)||!integer(t.target))throw fail('22023');targets.add(key);}
 const members = d.members === undefined ? [] : d.members;
 if (!Array.isArray(members) || members.length > 10000) throw fail('22023');
 const assigned = new Set<string>();
 for (const member of members) {
  if (!member || !ids.has(member.group_id) || typeof member.asset_id !== 'string' ||
      !member.asset_id.trim() || assigned.has(member.asset_id)) throw fail('22023');
  assigned.add(member.asset_id);
 }
}
export function createContractDefinitionRepository(client: Pick<SupabaseClient,'rpc'>) {
 return {
  async ready() {
   const {data,error}=await client.rpc('contract_reporting_ready');
   if(['PGRST202','42883'].includes(error?.code??''))return false;
   if(error||typeof data!=='boolean')throw fail(error?.code);return data;
  },
  async list(site:string): Promise<ContractSummary[]> {
   const {data,error}=await client.rpc('list_contract_definitions',{p_site:site});
   if(error)throw fail(error.code);
   if(!Array.isArray(data)||data.some(row=>row?.site_id!==site||!uuid.test(row.id)||typeof row.name!=='string'||!validCalendarDate(row.starts_on)||!validCalendarDate(row.ends_on)||row.starts_on>row.ends_on)||new Set(data.map(row=>row.id)).size!==data.length)throw fail();
   return data.map(({id,name,starts_on,ends_on})=>({id,name,starts_on,ends_on}));
  },
  async read(id:string,site:string,minVersion=1) {
   const {data,error}=await client.rpc('read_contract_definition',{p_id:id,p_site:site});
   if(error)throw fail(error.code);
   const c=data?.contract;
   if(!c||c.id!==id||c.jobsite_id!==site||!Number.isSafeInteger(c.version)||c.version<minVersion||!Array.isArray(data.groups)||!Array.isArray(data.targets)||data.groups.some((g:{contract_id:string;jobsite_id:string})=>g.contract_id!==id||g.jobsite_id!==site)||data.targets.some((t:{contract_id:string;jobsite_id:string})=>t.contract_id!==id||t.jobsite_id!==site))throw fail();
   try {
    const groups = (data.groups as ContractDefinition['groups']).map(({id,name,building,asset_type,major_frequency,minor_frequency})=>({id,name,building,asset_type,major_frequency,minor_frequency}));
    const targets = (data.targets as ContractDefinition['targets']).map(({group_id,month_start,cleaning_kind,target})=>({group_id,month_start,cleaning_kind,target}));
    if (data.members !== undefined && (!Array.isArray(data.members) ||
        data.members.some((member: {contract_id:string;jobsite_id:string})=>member?.contract_id!==id||member.jobsite_id!==site))) throw fail();
    const members = (data.members as ContractDefinition['members'])?.map(({group_id,asset_id})=>({group_id,asset_id}));
    const definition:ContractDefinition={name:c.name,starts_on:c.starts_on,ends_on:c.ends_on,groups,targets,...(members && {members})};
    validateContractDefinition(definition);
    return {id,site,version:c.version as number,definition};
   } catch { throw fail(); }
  },
  async save(id:string,site:string,version:number,key:string,definition:ContractDefinition) {
   validateContractDefinition(definition);
   if(!uuid.test(id)||!uuid.test(key)||!site||!Number.isSafeInteger(version)||version<0)throw fail('22023');
   const {data,error}=await client.rpc('save_contract_definition',{p_id:id,p_site:site,p_expected_version:version,p_request_id:key,p_definition:definition});
   if(error)throw fail(error.code);
   if(data?.id!==id||data.site_id!==site||data.version!==version+1||typeof data.replayed!=='boolean')throw fail();
   return data.version as number;
  },
 };
}

/** Keep this operation across uncertain failures; retries reuse one frozen payload
 * and key. After acknowledgement only the authoritative read is retried. */
export function createContractDefinitionOperation(repository:Pick<ReturnType<typeof createContractDefinitionRepository>,'read'|'save'>,id:string,site:string,version:number,definition:ContractDefinition,assertCurrent=()=>{}) {
 const payload=structuredClone(definition),key=crypto.randomUUID();let acknowledged:number|undefined,busy=false;
 return {async run(){assertCurrent();if(busy)throw fail();busy=true;try{
  if(acknowledged===undefined){acknowledged=await repository.save(id,site,version,key,payload);assertCurrent();}
  const result=await repository.read(id,site,acknowledged);assertCurrent();return result;
 }finally{busy=false;}}};
}
