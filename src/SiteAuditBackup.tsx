import {useEffect,useRef,useState} from 'react';
import {supabase} from './supabase';
import {downloadSiteBackup,prepareSiteBackup} from './site-backup';
import './contract-workspace.css';

type AuditRow={
  event_id:number;jobsite_id:string|null;actor_name:string|null;action:string;
  entity:string;record_id:string|null;changed_fields:string[];occurred_at:string;
};
const actionName:Record<string,string>={
  insert:'เพิ่ม',update:'แก้ไข',delete:'ลบ',move_out:'ย้ายออกจากไซต์',backup_started:'เริ่มสำรอง',backup_prepared:'เตรียมไฟล์สำรองแล้ว',
  deletion_backup_saved:'บันทึกไฟล์สำรองก่อนลบ',site_permanently_deleted:'ลบไซต์ถาวร',
};
const formatTime=new Intl.DateTimeFormat('th-TH',{dateStyle:'short',timeStyle:'medium',timeZone:'Asia/Bangkok'});

export default function SiteAuditBackup({site,siteName}:{site:string;siteName:string}) {
  const mounted=useRef(false);
  const running=useRef(false);
  const [global,setGlobal]=useState(false);
  const [rows,setRows]=useState<AuditRow[]>([]);
  const [loading,setLoading]=useState(true);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [notice,setNotice]=useState('');
  const [digest,setDigest]=useState('');
  const [attempt,setAttempt]=useState(0);
  const [cursor,setCursor]=useState<number>();
  const logSite=global ? null : site;
  useEffect(()=>{
    mounted.current=true;
    return ()=>{mounted.current=false;};
  },[]);
  useEffect(()=>{
    let current=true;
    setLoading(true);
    setRows([]);
    setError('');
    async function load(){
      try {
        const result=await supabase?.rpc('list_site_audit',{p_site:logSite,p_before:cursor??null});
        if(!result || result.error || !Array.isArray(result.data) || result.data.some(row=>row?.jobsite_id!==logSite)) throw new Error('เปิดประวัติการเปลี่ยนแปลงไม่ได้');
        if(current)setRows(result.data);
      } catch {if(current)setError('เปิดประวัติการเปลี่ยนแปลงไม่ได้');}
      finally {if(current)setLoading(false);}
    }
    void load();
    return ()=>{current=false;};
  },[logSite,attempt,cursor]);

  async function backup(){
    if(!supabase || running.current) return;
    running.current=true;
    setBusy(true);setError('');setNotice('');setDigest('');
    try {
      const file=await prepareSiteBackup(supabase,site,()=>{if(!mounted.current)throw new Error('เปลี่ยนหน้าแล้ว');});
      downloadSiteBackup(file.blob,file.filename);
      setNotice('เริ่มดาวน์โหลดไฟล์สำรองแล้ว');
      setDigest(file.sha256);
      setCursor(undefined);
      setAttempt(value=>value+1);
    } catch(reason){
      if(mounted.current)setError(reason instanceof Error ? reason.message : 'สำรองข้อมูลไม่สำเร็จ');
    } finally {
      running.current=false;
      if(mounted.current)setBusy(false);
    }
  }

  async function downloadDeletionBackup(row:AuditRow){
    if(!supabase || !row.record_id || running.current) return;
    running.current=true;
    setBusy(true);setError('');setNotice('');setDigest('');
    try {
      const result=await supabase.rpc('read_site_deletion_backup',{p_backup:row.record_id});
      if(result.error || !result.data?.backup) throw new Error('เปิดไฟล์สำรองก่อนลบไม่ได้');
      if(!mounted.current) return;
      const file=new Blob([JSON.stringify(result.data,null,2)],{type:'application/json'});
      downloadSiteBackup(file,`ThaiCon-Deleted-Site-${row.entity}-${row.record_id}.json`);
      setNotice('เริ่มดาวน์โหลดไฟล์สำรองแล้ว');
    } catch(reason){
      if(mounted.current)setError(reason instanceof Error ? reason.message : 'ดาวน์โหลดไฟล์สำรองไม่สำเร็จ');
    } finally {
      running.current=false;
      if(mounted.current)setBusy(false);
    }
  }
  return <section className="maint-panel contract-report" aria-label="ประวัติและสำรองข้อมูล">
    <div className="maint-panel-heading"><h3>ประวัติและสำรองข้อมูล</h3></div>
    <div className="contract-delivery">
      <div className="contract-grid">
        <label>ขอบเขตประวัติ<select aria-label="ขอบเขตประวัติ" value={global?'global':'site'} onChange={event=>{setGlobal(event.target.value==='global');setCursor(undefined);}}>
          <option value="site">{siteName} · {site}</option><option value="global">การเปลี่ยนแปลงระดับระบบ</option>
        </select></label>
        <button type="button" className="maint-button secondary contract-start" disabled={loading} onClick={()=>{setCursor(undefined);setAttempt(value=>value+1);}}>โหลดประวัติล่าสุด</button>
        <button type="button" className="maint-button primary contract-start" disabled={busy} onClick={()=>void backup()}>ดาวน์โหลดไฟล์สำรองไซต์นี้</button>
      </div>
      {busy && <p role="status">กำลังเตรียมไฟล์สำรอง…</p>}
      {notice && <p role="status">{notice}</p>}
      {digest && <p style={{overflowWrap:'anywhere'}}>SHA-256 {digest}</p>}
      {error && <p role="alert" className="maint-form-error">{error}</p>}
      {loading && <p role="status">กำลังโหลดประวัติ…</p>}
      {!loading && !error && rows.length===0 && <p>ยังไม่มีรายการในขอบเขตนี้</p>}
    </div>
    {!!rows.length && <div className="maint-table-wrap" role="region" aria-label="ตารางประวัติการเปลี่ยนแปลง" tabIndex={0}>
      <table className="maint-table">
        <thead><tr>{['เวลาไทย','ผู้ดำเนินการ','รายการ','ข้อมูล','รหัสอ้างอิง','ช่องที่เปลี่ยน'].map(label=><th key={label} scope="col">{label}</th>)}</tr></thead>
        <tbody>{rows.map(row=><tr key={row.event_id}>
          <td>{formatTime.format(new Date(row.occurred_at))}</td><td>{row.actor_name??'ระบบ'}</td>
          <td>{actionName[row.action]??row.action}</td><td>{row.entity}</td><td>{row.record_id??'—'}</td>
          <td>{row.action==='site_permanently_deleted'
            ? <button type="button" className="maint-button secondary" disabled={busy}
                onClick={()=>void downloadDeletionBackup(row)}>ดาวน์โหลดไฟล์สำรองก่อนลบ</button>
            : row.changed_fields.join(', ')||'—'}</td>
        </tr>)}</tbody>
      </table>
    </div>}
    {rows.length===100 && <div className="contract-delivery"><button type="button" className="maint-button secondary"
      onClick={()=>setCursor(rows[rows.length-1].event_id)}>ดูประวัติก่อนหน้า</button></div>}
  </section>;
}
