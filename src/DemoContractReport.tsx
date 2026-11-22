import { useEffect, useMemo, useState } from 'react';
import { readDemoContracts, readDemoEvidence } from './contract-demo-store';
import { buildDemoContractSummary, contractMonthlyTotals } from './contract-demo-summary';
import type { RepairRequest, ServiceReport } from './maintenance';
import DemoContractDelivery from './DemoContractDelivery';
import OnlineContractDelivery from './OnlineContractDelivery';
import {loadOnlineContractReport,mapOnlineContractEvidence} from './contract-online-report';
import './contract-workspace.css';

const monthLabel = new Intl.DateTimeFormat('th-TH', {month:'short',year:'numeric',timeZone:'UTC'});
const displayMonth = (month: string) => monthLabel.format(new Date(month+'-01T00:00:00Z'));
const number = (value: number | null) => value === null ? '—' : value.toLocaleString('th-TH');
const assetLabel = (type: string) => type === 'SPT' ? 'Split Type' : type;

export default function DemoContractReport({site,siteName,canIssue,reports,repairs,onOpenReport,online=false}: {
  site: string; siteName: string; canIssue: boolean; reports: ServiceReport[]; repairs: RepairRequest[];
  onOpenReport: (id: string) => void;
  online?: boolean;
}) {
  const [contractId,setContractId] = useState('');
  const [month,setMonth] = useState('');
  const [building,setBuilding] = useState('');
  const [type,setType] = useState('');
  const [kind,setKind] = useState('');
  const [attempt,setAttempt] = useState(0);
  const demo = useMemo(() => {
    if (online) return {contracts:[],evidence:[],error:''};
    try { return {contracts:readDemoContracts(site),evidence:readDemoEvidence(site),error:''}; }
    catch { return {contracts:[],evidence:[],error:'โหลดข้อมูลสัญญาทดลองไม่สำเร็จ'}; }
  },[site,attempt,online]);
  const [remote,setRemote]=useState<Awaited<ReturnType<typeof loadOnlineContractReport>>>();
  const [remoteError,setRemoteError]=useState('');
  useEffect(()=>{
    if (!online) return;
    let current=true;
    setRemote(undefined);
    setRemoteError('');
    loadOnlineContractReport(site).then(data=>{
      if (current) setRemote(data);
    },()=>{
      if (current) setRemoteError('โหลดรายงานสัญญาจากฐานข้อมูลไม่สำเร็จ');
    });
    return ()=>{current=false;};
  },[site,attempt,online]);
  const source=useMemo(()=>online ? {
    contracts:remote?.contracts ?? [],evidence:mapOnlineContractEvidence(remote?.evidence ?? [],reports),error:remoteError,
  } : demo,[online,remote,remoteError,reports,demo]);
  const active = source.contracts.find(contract => contract.id === contractId) ?? source.contracts[0];
  const result = useMemo(() => {
    try { return {data:active ? buildDemoContractSummary(active,source.evidence,reports) : null,error:''}; }
    catch (error) { return {data:null,error:error instanceof Error ? error.message : 'คำนวณรายงานไม่ได้'}; }
  },[active,source.evidence,reports]);
  const rows = result.data?.rows ?? [];
  const buildings = [...new Set(rows.map(row=>row.building))].sort();
  const types = [...new Set(rows.map(row=>row.assetType))].sort();
  const filtered = rows.filter(row => (!building || row.building === building) &&
    (!type || row.assetType === type) && (!kind || row.kind === kind));
  const monthly = contractMonthlyTotals(result.data?.months ?? [],filtered);
  const detail = filtered.filter(row => !month || row.month === month);
  const visibleMonths = monthly.filter(row => !month || row.month === month);
  const Delivery=online ? OnlineContractDelivery : DemoContractDelivery;

  return <section className="maint-panel contract-report" aria-label="รายงานสัญญาบำรุงรักษา">
    <div className="maint-panel-heading"><h3>รายงานสัญญาบำรุงรักษา ({online ? 'UAT' : 'Demo'})</h3>
      <button type="button" className="maint-button secondary" onClick={() => {
        setMonth(''); setBuilding(''); setType(''); setKind(''); setAttempt(value=>value+1);
      }}>โหลดข้อมูลอีกครั้ง</button>
    </div>
    {(source.error || result.error) && <p className="maint-form-error" role="alert">{source.error || result.error}</p>}
    {online && remote===undefined && !remoteError && <p role="status" className="contract-report-note">กำลังโหลดรายงานสัญญา…</p>}
    {online && remote===null && <p className="contract-report-note">ยังไม่เปิดใช้รายงานสัญญา</p>}
    {!active && !source.error && (!online || remote) && <p className="contract-report-note">สร้างสัญญาทดลองและตั้งเป้าหมายจากเมนูแผน PM</p>}
    {active && <div className="maint-report-filters">
      <label>สัญญา<select aria-label="สัญญารายงาน" value={active.id} onChange={event=>{
        setContractId(event.target.value); setMonth(''); setBuilding(''); setType(''); setKind('');
      }}>{source.contracts.map(contract=><option key={contract.id} value={contract.id}>{contract.definition.name}</option>)}</select></label>
      {result.data && <>
        <label>เดือน<select aria-label="เดือนในสัญญา" value={month} onChange={event=>setMonth(event.target.value)}>
          <option value="">ทุกเดือน</option>{result.data.months.map(value=><option key={value} value={value}>{displayMonth(value)}</option>)}
        </select></label>
        <label>อาคาร<select value={building} onChange={event=>setBuilding(event.target.value)}>
          <option value="">ทุกอาคาร</option>{buildings.map(value=><option key={value}>{value}</option>)}
        </select></label>
        <label>ประเภทเครื่อง<select value={type} onChange={event=>setType(event.target.value)}>
          <option value="">ทุกประเภท</option>{types.map(value=><option key={value} value={value}>{assetLabel(value)}</option>)}
        </select></label>
        <label>ประเภทล้าง<select value={kind} onChange={event=>setKind(event.target.value)}>
          <option value="">ทุกประเภท</option><option value="major">ล้างใหญ่</option><option value="minor">ล้างย่อย</option>
        </select></label>
      </>}
    </div>}
    {result.data && <>
      <p className="contract-report-note">ยอดสะสมเริ่มจากเดือนแรกของสัญญาตามตัวกรองอาคารและประเภท เครื่องหมาย — หมายถึงยังไม่ตั้งเป้าหมายหรือคำนวณเปอร์เซ็นต์ไม่ได้</p>
      {result.data.excluded > 0 && <p className="maint-form-error" role="status">เว้น {number(result.data.excluded)} รายการตรวจรับ เพราะต้นทางเปลี่ยน หาไม่พบ หรืออยู่นอกช่วงสัญญาปัจจุบัน</p>}
      <div className="maint-table-wrap" tabIndex={0} role="region" aria-label="สรุปรายเดือนและยอดสะสม">
        <table className="maint-table"><caption>สรุปรายเดือนและยอดสะสม (ครั้ง)</caption>
          <thead><tr><th scope="col">เดือน</th><th scope="col">เป้าหมาย</th><th scope="col">ตรวจรับแล้ว</th><th scope="col">เทียบเป้า</th><th scope="col">เป้าสะสม</th><th scope="col">ตรวจรับสะสม</th></tr></thead>
          <tbody>{visibleMonths.map(row=><tr key={row.month}>
            <th scope="row">{displayMonth(row.month)}</th><td>{number(row.target)}</td><td>{number(row.actual)}</td>
            <td>{row.progress === null ? '—' : number(row.progress)+'%'}</td><td>{number(row.cumulativeTarget)}</td><td>{number(row.cumulativeActual)}</td>
          </tr>)}</tbody>
        </table>
      </div>
      <div className="maint-table-wrap" tabIndex={0} role="region" aria-label="รายละเอียดแยกตามอาคารและประเภทงาน">
        <table className="maint-table"><caption>รายละเอียดแยกตามอาคารและประเภทงาน (ครั้ง)</caption>
          <thead><tr>{['เดือน','อาคาร','ประเภทเครื่อง','ประเภทล้าง','เป้าหมาย','ตรวจรับแล้ว','ผลต่าง','Service Report'].map(label=><th key={label} scope="col">{label}</th>)}</tr></thead>
          <tbody>{detail.length ? detail.map(row=><tr key={JSON.stringify([row.month,row.building,row.assetType,row.kind])}>
            <th scope="row">{displayMonth(row.month)}</th><td>{row.building}</td><td>{assetLabel(row.assetType)}</td>
            <td>{row.kind === 'major' ? 'ล้างใหญ่' : 'ล้างย่อย'}</td><td>{number(row.target)}</td><td>{number(row.actual)}</td><td>{number(row.difference)}</td>
            <td>{row.reportIds.length ? <details><summary>ดูต้นทาง ({row.reportIds.length})</summary>
              <ul className="contract-report-sources">{row.reportIds.map(id=><li key={id}><button type="button" className="maint-link-button" onClick={()=>onOpenReport(id)}>{id}</button></li>)}</ul>
            </details> : '—'}</td>
          </tr>) : <tr><td colSpan={8}>ไม่มีรายละเอียดตรงกับตัวกรอง</td></tr>}</tbody>
        </table>
      </div>
    </>}
    {(!online || remote) && <Delivery site={site} canIssue={canIssue} input={active && result.data ? {
      siteName,contract:active,filters:{month,building,type,kind},monthly:visibleMonths,detail,reports,repairs,
      evidence:source.evidence,excluded:result.data.excluded,online,
    } : null} />}
  </section>;
}
