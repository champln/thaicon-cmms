import {describe,expect,it} from 'vitest';
import {buildDemoMaintenanceState} from './maintenance';
import {acceptDemoEvidence,addDemoEvidence,demoEvidenceWork} from './contract-demo-evidence';
import type {DemoContractRecord} from './contract-demo-store';
import {buildDemoContractSummary,contractMonthlyTotals} from './contract-demo-summary';

const report = {...buildDemoMaintenanceState().serviceReports[0],quantity:1,status:'submitted' as const};
const contract: DemoContractRecord = {
  id:'C1',site:report.jobsiteId,version:2,
  definition:{name:'ทดลอง',starts_on:'2026-01-01',ends_on:'2026-12-31',
    groups:[{id:'G1',name:'เครื่องอาคาร A',building:'A',asset_type:'AHU',major_frequency:2,minor_frequency:4}],
    targets:[],members:[{asset_id:report.assetId,group_id:'G1'}]},
};
const approved = {...report,status:'approved' as const,approvedBy:'internal',approvedAt:'2026-08-21T09:00:00Z'};
const link = () => addDemoEvidence([],contract.site,report,contract,'major')[0];
const accept = (row=link()) => acceptDemoEvidence(row,approved,'demo-admin','2026-08-21T10:00:00Z');

describe('Demo contract cleaning evidence',()=>{
  it('sums explicit targets for groups in the same building and keeps cumulative totals after filtering months',()=>{
    const second={...contract.definition.groups[0],id:'G2'};
    const targets=[
      {group_id:'G1',month_start:report.serviceDate.slice(0,7)+'-01',cleaning_kind:'major' as const,target:2},
      {group_id:'G2',month_start:report.serviceDate.slice(0,7)+'-01',cleaning_kind:'major' as const,target:3},
    ];
    const input={...contract,definition:{...contract.definition,groups:[...contract.definition.groups,second],targets}};
    const summary=buildDemoContractSummary(input,[accept()],[approved]);
    expect(summary.rows).toHaveLength(1);
    expect(summary.rows[0]).toMatchObject({target:5,actual:1,difference:-4,reportIds:[report.id]});
    const last=contractMonthlyTotals(summary.months,summary.rows).at(-1);
    expect(last).toMatchObject({target:null,actual:0,cumulativeTarget:5,cumulativeActual:1});
  });
  it('shows accepted work without a target and distinguishes it from an explicit zero',()=>{
    const summary=buildDemoContractSummary(contract,[accept()],[approved]);
    expect(summary.rows[0]).toMatchObject({actual:1,target:null,difference:null});
    const totals=contractMonthlyTotals(summary.months,summary.rows);
    expect(totals.find(row=>row.actual===1)).toMatchObject({target:null,progress:null});
    const withZero={...contract,definition:{...contract.definition,targets:[
      {group_id:'G1',month_start:report.serviceDate.slice(0,7)+'-01',cleaning_kind:'major' as const,target:0},
    ]}};
    expect(buildDemoContractSummary(withZero,[accept()],[approved]).rows[0]).toMatchObject({target:0,actual:1,difference:1});
    expect(buildDemoContractSummary(contract,[accept()],[{...approved,workPerformed:'updated'}])).toMatchObject({rows:[],excluded:1});
  });
  it('counts only after simulated acceptance of a separately approved report',()=>{
    const row=link();
    expect(()=>acceptDemoEvidence(row,report,'demo-admin','2026-08-21T10:00:00Z')).toThrow();
    expect(demoEvidenceWork(row,approved)?.countable).toBe(false);
    const accepted=accept(row);
    expect(accepted.approval?.by).toBe('internal');
    expect(accepted.acceptance?.by).toBe('demo-admin');
    expect(demoEvidenceWork(accepted,approved)?.countable).toBe(true);
    expect(demoEvidenceWork(accepted,{...approved,approvedBy:'different'})?.countable).toBe(false);
  });
  it('rejects foreign sites, unassigned assets, quantities and dates outside the contract',()=>{
    for (const change of [{jobsiteId:'S2'},{assetId:'unknown'},{quantity:2},{serviceDate:'2027-01-01'}]) {
      expect(()=>addDemoEvidence([],contract.site,{...report,...change},contract,'major')).toThrow();
    }
  });
  it('blocks duplicate reports and same machine/kind/day while allowing different kinds',()=>{
    const row=link(), another={...report,id:'another'};
    expect(()=>addDemoEvidence([row],contract.site,report,contract,'minor')).toThrow();
    expect(()=>addDemoEvidence([row],contract.site,another,contract,'major')).toThrow();
    expect(addDemoEvidence([row],contract.site,another,contract,'minor')).toHaveLength(2);
  });
  it('preserves group snapshot and withholds edited or missing report evidence',()=>{
    const mutable=structuredClone(contract);
    const [row]=addDemoEvidence([],mutable.site,report,mutable,'major');
    mutable.definition.groups[0].building='B';
    expect(row.building).toBe('A');
    const accepted=accept(row);
    expect(demoEvidenceWork(accepted,{...approved,workPerformed:'changed'})).toBeNull();
    expect(demoEvidenceWork(accepted,undefined)).toBeNull();
  });
});
