import { useEffect, useRef, useState } from 'react';
import { issueDelivery, readDeliveryArchive, snapshotDelivery, type DeliveryInput, type DeliveryIssue } from './demo-contract-delivery';

export default function DemoContractDelivery({site,canIssue,input}: {
  site: string; canIssue: boolean; input: Omit<DeliveryInput,'period'> | null;
}) {
  const current=useRef(false);
  const lock=useRef(false);
  const [issues,setIssues]=useState<DeliveryIssue[]>([]);
  const [selected,setSelected]=useState('');
  const [period,setPeriod]=useState('');
  const [busy,setBusy]=useState(false);
  const [loading,setLoading]=useState(true);
  const [loadError,setLoadError]=useState(false);
  const [attempt,setAttempt]=useState(0);
  const [feedback,setFeedback]=useState<{error:boolean;text:string}>();
  useEffect(()=>{
    current.current=true;
    return ()=>{current.current=false;};
  },[]);
  useEffect(()=>{
    let subscribed=true;
    setLoading(true);
    setLoadError(false);
    readDeliveryArchive(site).then(rows=>{
      if(subscribed) setIssues(rows);
    },()=>{
      if(subscribed) {setLoadError(true);setIssues([]);}
    }).finally(()=>{
      if(subscribed) setLoading(false);
    });
    return ()=>{subscribed=false;};
  },[site,attempt]);

  async function run(action:()=>Promise<string>) {
    if(lock.current) return;
    lock.current=true;
    setBusy(true);
    setFeedback(undefined);
    try {
      const text=await action();
      if(current.current) setFeedback({error:false,text});
    } catch(error) {
      if(current.current) setFeedback({error:true,text:error instanceof Error ? error.message : 'ดำเนินการกับฉบับส่งมอบไม่สำเร็จ'});
    } finally {
      lock.current=false;
      if(current.current) setBusy(false);
    }
  }
  const issue=issues.find(item=>item.id===selected) ?? issues[0];

  return <section className="contract-delivery" aria-label="ฉบับส่งมอบ">
    <h4>ฉบับส่งมอบ</h4>
    {canIssue && input && <form className="contract-grid" onSubmit={event=>{
      event.preventDefault();
      void run(async()=>{
        const created=await issueDelivery(snapshotDelivery({...input,period}));
        if(current.current) {
          setIssues(rows=>[created,...rows]);
          setSelected(created.id);
          setPeriod('');
        }
        return `บันทึกฉบับที่ ${created.revision} แล้ว`;
      });
    }}>
      <label>ชื่อหรือเลขงวด<input value={period} onChange={event=>setPeriod(event.target.value)} maxLength={80} required disabled={busy} /></label>
      <button type="submit" className="maint-button primary contract-start" disabled={loading||loadError||busy||!period.trim()}>ออกฉบับตามตัวกรอง</button>
    </form>}
    <p>ฉบับและรูปเก็บในเบราว์เซอร์นี้ ควรดาวน์โหลดไฟล์ไว้หากต้องการเก็บนอกเครื่อง</p>
    {loading && <p role="status">กำลังเปิดฉบับที่บันทึก…</p>}
    {loadError && <p role="alert">เปิดฉบับที่บันทึกไม่ได้ <button type="button" className="maint-button secondary" onClick={()=>setAttempt(n=>n+1)}>ลองใหม่</button></p>}
    {!loading && !loadError && !issue && <p>ยังไม่มีฉบับส่งมอบ</p>}
    {issue && <div className="contract-grid">
      <label>ฉบับที่บันทึก<select aria-label="ฉบับที่บันทึก" value={issue.id} onChange={event=>setSelected(event.target.value)} disabled={busy||loading}>
        {issues.map(item=><option key={item.id} value={item.id}>{item.contractName} · {item.period} · ฉบับที่ {item.revision}</option>)}
      </select></label>
      {(['pdf','xlsx'] as const).map(format=><button key={format} type="button" className="maint-button secondary contract-start" disabled={busy||loading} onClick={()=>void run(async()=>{
        const {downloadDelivery}=await import('./demo-contract-delivery-files');
        await downloadDelivery(issue,format,()=>{
          if(!current.current) throw new Error('เปลี่ยนหน้าหรือไซต์แล้ว');
        });
        return format==='pdf' ? 'ดาวน์โหลด PDF แล้ว' : 'ดาวน์โหลด Excel แล้ว';
      })}>{format==='pdf' ? 'ดาวน์โหลด PDF ฉบับส่งมอบ' : 'ดาวน์โหลด Excel ฉบับส่งมอบ'}</button>)}
    </div>}
    {busy && <p role="status">กำลังเตรียมฉบับส่งมอบ…</p>}
    {feedback && <p role={feedback.error?'alert':'status'}>{feedback.text}</p>}
  </section>;
}
