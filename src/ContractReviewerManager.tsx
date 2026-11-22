import { useEffect, useRef, useState } from 'react';
import { supabase } from './supabase';
import './contract-workspace.css';

type Reviewer = {user_id:string;username:string;display_name:string;assigned:boolean;eligible:boolean};
type Change = {userId:string;grant:boolean;requestId:string;acknowledged:boolean};

async function listReviewers(site:string): Promise<Reviewer[]> {
  const result=await supabase?.rpc('list_contract_reviewers',{p_site:site});
  if(!result || result.error || !Array.isArray(result.data) || result.data.some(row=>
    !row || typeof row.user_id!=='string' || typeof row.username!=='string' || typeof row.display_name!=='string' ||
    typeof row.assigned!=='boolean' || typeof row.eligible!=='boolean') ||
    new Set(result.data.map(row=>row.user_id)).size!==result.data.length) throw new Error('โหลดรายชื่อผู้ตรวจรับไม่สำเร็จ');
  return result.data;
}

export default function ContractReviewerManager({site,siteName}: {site:string;siteName:string}) {
  const [rows,setRows]=useState<Reviewer[]>();
  const [availability,setAvailability]=useState<'loading'|'disabled'|'ready'|'error'>('loading');
  const [attempt,setAttempt]=useState(0);
  const [candidate,setCandidate]=useState('');
  const [busy,setBusy]=useState(false);
  const [retry,setRetry]=useState(false);
  const [feedback,setFeedback]=useState<{error:boolean;text:string}>();
  const mounted=useRef(false);
  const pending=useRef<Change|null>(null);
  const running=useRef(false);
  useEffect(()=>{
    mounted.current=true;
    return ()=>{mounted.current=false;};
  },[]);
  useEffect(()=>{
    let active=true;
    setAvailability('loading');
    setRows(undefined);
    setCandidate('');
    async function load() {
      try {
        const gate=await supabase?.rpc('contract_reporting_ready');
        if (!active) return;
        if(gate?.data===false || ['PGRST202','42883'].includes(gate?.error?.code??'')) {
          setAvailability('disabled');
          return;
        }
        if(gate?.error || gate?.data!==true) throw new Error();
        const latest=await listReviewers(site);
        if(active){setRows(latest);setAvailability('ready');}
      } catch {
        if(active)setAvailability('error');
      }
    }
    void load();
    return ()=>{active=false;};
  },[site,attempt]);

  async function save(change:Change) {
    if(running.current || !supabase) return;
    running.current=true;
    pending.current=change;
    setBusy(true);
    setFeedback(undefined);
    try {
      if(!change.acknowledged) {
        const {data,error}=await supabase.rpc('set_contract_reviewer',{
          p_site:site,p_user:change.userId,p_grant:change.grant,p_request_id:change.requestId,
        });
        if(error || typeof data?.changed!=='boolean' || typeof data?.replayed!=='boolean') {
          if(['22023','42501','P0002'].includes(error?.code??'')) {
            pending.current=null;
            throw new Error('บันทึกสิทธิ์ไม่ได้ กรุณาตรวจสถานะบัญชีและไซต์');
          }
          throw new Error('ยังยืนยันผลไม่ได้ กรุณาลองคำขอเดิม');
        }
        change.acknowledged=true;
      }
      const latest=await listReviewers(site);
      pending.current=null;
      if(!mounted.current) return;
      setRows(latest);
      setCandidate('');
      const hasAssignment=latest.some(row=>row.user_id===change.userId && row.assigned);
      setFeedback({error:false,text:hasAssignment===change.grant ?
        (change.grant?'มอบหมายผู้ตรวจรับแล้ว':'ถอนสิทธิ์ตรวจรับแล้ว') : 'สิทธิ์เปลี่ยนอีกครั้ง รายการนี้แสดงสถานะล่าสุด'});
    } catch(error) {
      if(mounted.current) setFeedback({error:true,text:error instanceof Error ? error.message : 'บันทึกสิทธิ์ไม่สำเร็จ'});
    } finally {
      running.current=false;
      if(mounted.current){setBusy(false);setRetry(!!pending.current);}
    }
  }
  function start(userId:string,grant:boolean) {
    if(!userId || pending.current) return;
    void save({userId,grant,requestId:crypto.randomUUID(),acknowledged:false});
  }

  if(availability==='disabled') return null;
  const assigned=rows?.filter(row=>row.assigned)??[];
  const eligible=rows?.filter(row=>row.eligible&&!row.assigned)??[];
  return <section className="maint-panel contract-workspace" aria-label="จัดการผู้ตรวจรับลูกค้า">
    <div className="maint-panel-heading"><h3>ผู้ตรวจรับลูกค้า</h3></div>
    <div className="contract-delivery">
      <p>{siteName} · {site}</p>
      {availability==='loading' && <p role="status">กำลังโหลดรายชื่อ…</p>}
      {availability==='error' && <p role="alert">โหลดรายชื่อผู้ตรวจรับไม่ได้ <button type="button" className="maint-button secondary" onClick={()=>setAttempt(value=>value+1)}>ลองใหม่</button></p>}
      {availability==='ready' && <>
        <form className="contract-grid" onSubmit={event=>{event.preventDefault();start(candidate,true);}}>
          <label>บัญชีลูกค้าที่ใช้งานได้<select aria-label="บัญชีลูกค้าที่ใช้งานได้" value={candidate} disabled={busy||retry||!eligible.length} onChange={event=>setCandidate(event.target.value)}>
            <option value="">{eligible.length?'เลือกบัญชี User ของไซต์นี้':'ไม่มีบัญชีที่มอบหมายเพิ่มได้'}</option>
            {eligible.map(row=><option key={row.user_id} value={row.user_id}>{row.display_name} · {row.username}</option>)}
          </select></label>
          <button type="submit" className="maint-button primary contract-start" disabled={!candidate||busy||retry}>มอบหมายสิทธิ์ตรวจรับ</button>
        </form>
        {assigned.length===0 ? <p>ยังไม่มีผู้ตรวจรับในไซต์นี้</p> : <ul className="contract-asset-list">
          {assigned.map(row=><li key={row.user_id}>
            <div><strong>{row.display_name}</strong> <small>({row.username})</small>{!row.eligible && <p>บัญชีนี้ตรวจรับไม่ได้ในขณะนี้</p>}</div>
            <button type="button" className="maint-button secondary" aria-label={`ถอนสิทธิ์ตรวจรับ ${row.username}`} disabled={busy||retry}
              onClick={()=>{if(window.confirm(`ถอนสิทธิ์ตรวจรับของ ${row.display_name} ในไซต์นี้หรือไม่?`)) start(row.user_id,false);}}>ถอนสิทธิ์</button>
          </li>)}
        </ul>}
      </>}
      {busy && <p role="status">กำลังยืนยันสิทธิ์…</p>}
      {feedback && <p role={feedback.error?'alert':'status'}>{feedback.text}</p>}
      {retry && !busy && <button type="button" className="maint-button secondary" onClick={()=>{if(pending.current) void save(pending.current);}}>ตรวจผลคำขอเดิม</button>}
    </div>
  </section>;
}
