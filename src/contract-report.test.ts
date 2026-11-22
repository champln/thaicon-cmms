import { describe, it, expect } from 'vitest';
import { buildContractReport, contractMonths, type ContractWork } from './contract-report';
const contract = {id:'C1',siteId:'S1',name:'ทดสอบ',startDate:'2026-06-01',endDate:'2027-05-31'};
const targets = [{month:'2026-06',building:'A',assetType:'AHU',kind:'major' as const,target:14}];
const row: ContractWork = {id:'L1',contractId:'C1',siteId:'S1',reportId:'SR1',reportVersion:1,assetId:'A1',building:'A',assetType:'AHU',kind:'major',serviceDate:'2026-06-15',status:'approved',occurrenceId:'R1',countable:true};
describe('contract reporting',()=>{
 it('orders actual cross-year months',()=>expect(contractMonths(contract)).toEqual(['2026-06','2026-07','2026-08','2026-09','2026-10','2026-11','2026-12','2027-01','2027-02','2027-03','2027-04','2027-05']));
 it('counts only accepted countable work and retains source references',()=>{const r=buildContractReport(contract,targets,[row,{...row,id:'L2',status:'submitted'},{...row,id:'L3',countable:false}],true);expect(r.actual).toBe(1);expect(r.rows[0].difference).toBe(-13);expect(r.rows[0].reportIds).toEqual(['SR1']);expect(Object.isFrozen(r.rows[0])).toBe(true);});
 it('rejects duplicate work even from another report',()=>expect(()=>buildContractReport(contract,targets,[row,{...row,id:'L2',reportId:'SR2'}],true)).toThrow('ซ้ำ'));
 it('counts separate occurrences but one unique machine',()=>{const r=buildContractReport(contract,targets,[row,{...row,id:'L2',occurrenceId:'R2'}],true);expect(r.actual).toBe(2);expect(r.uniqueAssets).toBe(1);});
 it('rejects cross-site and unverified data',()=>{expect(()=>buildContractReport(contract,targets,[{...row,siteId:'S2'}],true)).toThrow();expect(()=>buildContractReport(contract,targets,[],false)).toThrow();});
 it('rejects unknown groups, duplicate targets and out-of-period work',()=>{expect(()=>buildContractReport(contract,targets,[{...row,building:'B'}],true)).toThrow();expect(()=>buildContractReport(contract,[...targets,...targets],[],true)).toThrow();expect(()=>buildContractReport(contract,targets,[{...row,serviceDate:'2027-06-01'}],true)).toThrow();});
 it('does not invent zero-target percentages',()=>{const r=buildContractReport(contract,[{...targets[0],target:0}],[row],true);expect(r.actual).toBe(1);expect(r.progress).toBeNull();});
 it('rejects invalid dates and unsafe targets',()=>{expect(()=>contractMonths({...contract,startDate:'2026-02-30'})).toThrow();expect(()=>buildContractReport(contract,[{...targets[0],target:1.5}],[],true)).toThrow();});
});
