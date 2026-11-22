import {useEffect,useRef,useState} from 'react';
import {snapshotDelivery,type DeliveryInput} from './demo-contract-delivery';
import {supabase} from './supabase';

type Header={id:string;jobsite_id:string;contract_id:string;contract_name:string;period:string;revision:number};
type PendingIssue={
  p_site:string;p_contract:string;p_contract_version:number;p_id:string;p_revision:number;p_period:string;p_pdf:string;p_xlsx:string;
};
const filename = (issue:Header,format:string) => `ThaiCon-UAT-${issue.id}-R${issue.revision}.${format}`;
function base64(blob: Blob) {
  return new Promise<string>((resolve,reject)=>{
    const reader=new FileReader();
    reader.onload=()=>resolve(String(reader.result).split(',')[1]);
    reader.onerror=()=>reject(reader.error);
    reader.readAsDataURL(blob);
  });
}
function showDownload(bytes:string,issue:Header,format:'pdf'|'xlsx') {
  const content=Uint8Array.from(atob(bytes),char=>char.charCodeAt(0));
  const blob=new Blob([content],{type:format==='pdf' ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
  const url=URL.createObjectURL(blob);
  const link=document.createElement('a');
  link.href=url; link.download=filename(issue,format);
  document.body.append(link);
  try {link.click();} finally {link.remove();window.setTimeout(()=>URL.revokeObjectURL(url),1000);}
}

export default function OnlineContractDelivery({site,canIssue,input}:{
  site:string;canIssue:boolean;input:Omit<DeliveryInput,'period'>|null;
}) {
  const mounted=useRef(false);
  const lock=useRef(false);
  const pending=useRef<PendingIssue|null>(null);
  const [retry,setRetry]=useState(false);
  const [busy,setBusy]=useState(false);
  const [issues,setIssues]=useState<Header[]|null>(null);
  const [selected,setSelected]=useState('');
  const [period,setPeriod]=useState('');
  const [attempt,setAttempt]=useState(0);
  const [feedback,setFeedback]=useState<{error:boolean;text:string}>();

  useEffect(()=>{
    mounted.current=true;
    return ()=>{mounted.current=false;};
  },[]);
  useEffect(()=>{
    let current=true;
    setIssues(null);
    setFeedback(undefined);
    supabase?.rpc('list_contract_deliveries',{p_site:site}).then(({data,error})=>{
      if (!current) return;
      if (error || !Array.isArray(data) || data.some(row=>row?.jobsite_id!==site)) {
        setFeedback({error:true,text:'เปิดคลังฉบับส่งมอบไม่ได้'});
      } else setIssues(data);
    });
    return ()=>{current=false;};
  },[site,attempt]);

  async function run(action:()=>Promise<string>) {
    if(lock.current) return;
    lock.current=true;
    setBusy(true);setFeedback(undefined);
    try {
      const text=await action();
      if(mounted.current) setFeedback({error:false,text});
    } catch(error) {
      if(mounted.current) setFeedback({error:true,text:error instanceof Error ? error.message : 'ดำเนินการไม่สำเร็จ'});
    } finally {
      lock.current=false;
      if(mounted.current) {setBusy(false);setRetry(!!pending.current);}
    }
  }
  const guard=()=>{if(!mounted.current) throw new Error('เปลี่ยนหน้าหรือไซต์แล้ว');};
  async function save() {
    if(!supabase || !canIssue) throw new Error('ไม่มีสิทธิ์ออกฉบับ');
    if (!pending.current) {
      if(!input || !issues) throw new Error('ยังไม่มีข้อมูลฉบับส่งมอบ');
      const snapshot=snapshotDelivery({...input,period,online:true});
      const revision=1+Math.max(0,...issues.filter(row=>row.contract_id===snapshot.contractId).map(row=>row.revision));
      const {downloadDelivery}=await import('./demo-contract-delivery-files');
      const files: Partial<Record<'pdf'|'xlsx',Blob>>={};
      for (const format of ['pdf','xlsx'] as const) {
        await downloadDelivery({...snapshot,revision},format,guard,blob=>{files[format]=blob;});
      }
      if(!files.pdf || !files.xlsx || files.pdf.size+files.xlsx.size>8_900_000) throw new Error('ไฟล์ส่งมอบใหญ่เกินโควตา UAT กรุณาลดช่วงที่เลือก');
      const [pdf,xlsx]=await Promise.all([base64(files.pdf),base64(files.xlsx)]);
      pending.current={p_site:site,p_contract:snapshot.contractId,p_contract_version:snapshot.contractVersion,p_id:snapshot.id,
        p_revision:revision,p_period:snapshot.period,p_pdf:pdf,p_xlsx:xlsx};
    }
    guard();
    const {data,error}=await supabase.rpc('issue_contract_delivery',pending.current);
    if(error) {
      if (['40001','42501','22023','P0002'].includes(error.code)) pending.current=null;
      if(error.code==='40001') throw new Error('สัญญาหรือเลขฉบับเปลี่ยน กรุณาโหลดรายงานและคลังอีกครั้ง');
      throw new Error(pending.current ? 'ยังยืนยันการบันทึกไม่ได้ กรุณาลองคำขอเดิม' : 'บันทึกฉบับส่งมอบไม่ได้');
    }
    if(data?.id!==pending.current.p_id || data.jobsite_id!==site) throw new Error('ยังยืนยันฉบับส่งมอบไม่ได้');
    pending.current=null;
    guard();
    setIssues(rows=>[data,...(rows??[]).filter(row=>row.id!==data.id)]);
    setSelected(data.id);
    setPeriod('');
    return `บันทึกฉบับที่ ${data.revision} แล้ว`;
  }
  const issue=issues?.find(row=>row.id===selected) ?? issues?.[0];
  return <section className="contract-delivery" aria-label="ฉบับส่งมอบ">
    <h4>คลังฉบับส่งมอบออนไลน์</h4>
    {canIssue && (input || retry) && <form className="contract-grid" onSubmit={event=>{event.preventDefault();void run(save);}}>
      <label>ชื่อหรือเลขงวด<input value={period} onChange={event=>setPeriod(event.target.value)} disabled={busy||retry} maxLength={80} required={!retry}/></label>
      <button type="submit" className="maint-button primary contract-start" disabled={busy||(!retry&&(!issues||!period.trim()))}>
        {retry?'ลองบันทึกคำขอเดิม':'ออกฉบับตามตัวกรอง'}
      </button>
    </form>}
    {!issues && !feedback && <p role="status">กำลังเปิดคลัง…</p>}
    {!!issues && !issue && <p>ยังไม่มีฉบับส่งมอบ</p>}
    {issue && <div className="contract-grid">
      <label>ฉบับที่บันทึก<select aria-label="ฉบับที่บันทึก" value={issue.id} onChange={event=>setSelected(event.target.value)} disabled={busy}>
        {issues?.map(row=><option key={row.id} value={row.id}>{row.contract_name} · {row.period} · ฉบับที่ {row.revision}</option>)}
      </select></label>
      {(['pdf','xlsx'] as const).map(format=><button key={format} type="button" className="maint-button secondary contract-start" disabled={busy}
        onClick={()=>void run(async()=>{
          const response=await supabase?.rpc('read_contract_delivery_file',{p_site:site,p_id:issue.id,p_format:format});
          if(response?.error || typeof response?.data!=='string') throw new Error('อ่านไฟล์ส่งมอบไม่ได้');
          guard();
          showDownload(response.data,issue,format);
          return format==='pdf' ? 'ดาวน์โหลด PDF แล้ว' : 'ดาวน์โหลด Excel แล้ว';
        })}>{format==='pdf'?'ดาวน์โหลด PDF ฉบับส่งมอบ':'ดาวน์โหลด Excel ฉบับส่งมอบ'}</button>)}
    </div>}
    {busy && <p role="status">กำลังดำเนินการ…</p>}
    {feedback && <p role={feedback.error?'alert':'status'}>{feedback.text}</p>}
    {!retry && <button type="button" className="maint-button secondary" disabled={busy} onClick={()=>setAttempt(value=>value+1)}>โหลดคลังอีกครั้ง</button>}
  </section>;
}
