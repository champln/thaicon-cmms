import {useEffect,useRef,useState} from 'react';
import type {ServiceReport} from './maintenance';
import {supabase} from './supabase';
import {loadOnlineContractReport} from './contract-online-report';
import {eligibleDemoContracts} from './contract-demo-evidence';

export default function ContractCustomerReview({report,site}: {report:ServiceReport;site:string}) {
  const [options,setOptions]=useState<{id:string;name:string}[]>([]);
  const [selected,setSelected]=useState('');
  const [kind,setKind]=useState<'major'|'minor'>('major');
  const [receipt,setReceipt]=useState<{id:string;accepted_at:string;simulated?:boolean}>();
  const [error,setError]=useState('');
  const [busy,setBusy]=useState(false);
  const mounted=useRef(false);
  useEffect(()=>{
    mounted.current=true;
    let active=true;
    async function load(){
      if (!supabase || report.status!=='approved' || !report.version) return;
      const permission=await supabase.rpc('can_review_contract_customer',{p_site:site});
      if (!active || permission.error || permission.data!==true) return;
      const data=await loadOnlineContractReport(site);
      if (!active || !data) return;
      const existing=data.evidence.find(item=>item.report_id===report.id);
      if (existing) {
        setReceipt({id:existing.id,accepted_at:existing.accepted_at,simulated:existing.receipt_type!=='customer'});
        return;
      }
      const choices=eligibleDemoContracts(site,report,data.contracts).map(item=>({id:item.id,name:item.definition.name}));
      setOptions(choices);
      if(choices.length===1) setSelected(choices[0].id);
    }
    void load().catch(()=>{if(active)setError('เปิดข้อมูลตรวจรับไม่ได้');});
    return ()=>{active=false;mounted.current=false;};
  },[site,report]);
  async function accept(){
    if(busy || !selected || !supabase || !report.version || !window.confirm('ยืนยันตรวจรับงานตามรายงานฉบับนี้หรือไม่?')) return;
    setBusy(true);setError('');
    try {
      const {data,error}=await supabase.rpc('accept_contract_customer',{
        p_site:site,p_contract:selected,p_report:report.id,p_version:report.version,p_kind:kind,
      });
      if(!mounted.current)return;
      if(error || !data?.id) {
        if(error?.code==='42501') {setOptions([]);setSelected('');}
        setError(error?.code==='23505'?'รายงานนี้มีผลตรวจรับแล้ว กรุณาเปิดรายละเอียดใหม่':
          error?.code==='42501'?'ไม่มีสิทธิ์ตรวจรับไซต์นี้':'ยังยืนยันผลตรวจรับไม่ได้ กรุณาตรวจรายงานฉบับล่าสุด');
      } else setReceipt(data);
    } catch {if(mounted.current)setError('ยังยืนยันผลตรวจรับไม่ได้ กรุณาลองคำขอเดิม');}
    finally {if(mounted.current)setBusy(false);}
  }
  if(!options.length && !error && !receipt) return null;
  return <section className="maint-detail-copy" aria-label="ตรวจรับงานตามสัญญา">
    <h3>ตรวจรับงานตามสัญญา</h3>
    <p>อนุมัติภายในแล้ว</p>
    {receipt ? <p role="status">{receipt.simulated?'มีผลตรวจรับจำลอง':'ลูกค้าตรวจรับแล้ว'} · {new Date(receipt.accepted_at).toLocaleString('th-TH',{timeZone:'Asia/Bangkok'})}</p>
    : !!options.length && <div className="maint-form">
      <label>สัญญาที่ตรวจรับ<select aria-label="สัญญาที่ตรวจรับ" value={selected} disabled={busy} onChange={event=>setSelected(event.target.value)}>
        <option value="">เลือกสัญญา</option>{options.map(option=><option key={option.id} value={option.id}>{option.name}</option>)}
      </select></label>
      <label>ประเภทงานที่ตรวจรับ<select value={kind} disabled={busy} onChange={event=>setKind(event.target.value as 'major'|'minor')}>
        <option value="major">ล้างใหญ่</option><option value="minor">ล้างย่อย</option>
      </select></label>
      <button type="button" className="maint-button primary" disabled={busy||!selected} onClick={()=>void accept()}>
        {busy?'กำลังยืนยัน…':'ยืนยันตรวจรับงาน'}
      </button>
    </div>}
    {error && <p role="alert">{error}</p>}
  </section>;
}
