import type { SupabaseClient } from '@supabase/supabase-js';

type BackupClient = Pick<SupabaseClient,'rpc'|'storage'>;
type Attachment = {path:string;size:number|null;id:string;updated_at:string};
type BackupSnapshot = {id:string;site:string;captured_at:string;tables:Record<string,unknown[]>;attachments:Attachment[]};
const fileBudget = 16_000_000;

const digest = async (bytes:BufferSource) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),
  byte=>byte.toString(16).padStart(2,'0')).join('');
function asBase64(blob:Blob) {
  return new Promise<string>((resolve,reject)=>{
    const reader=new FileReader();
    reader.onload=()=>resolve(String(reader.result).split(',')[1]);
    reader.onerror=()=>reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

export async function prepareSiteBackup(client:BackupClient,site:string,guard:()=>void) {
  guard();
  const {data,error}=await client.rpc('begin_site_backup',{p_site:site});
  if(error) throw new Error(error.code==='22023'?'ข้อมูลเกินขนาดทดสอบหรือมีรูปอ้างอิงที่ไม่พบ':'เตรียมข้อมูลสำรองไม่ได้');
  const snapshot=data as BackupSnapshot;
  if (!snapshot?.id || snapshot.site!==site || !snapshot.tables || !Array.isArray(snapshot.attachments) ||
      snapshot.attachments.some(row=>typeof row.path!=='string'||!row.path.startsWith(site+'/')) ||
      new Set(snapshot.attachments.map(row=>row.path)).size!==snapshot.attachments.length) {
    throw new Error('ชุดข้อมูลสำรองไม่ตรงกับไซต์');
  }
  if(snapshot.attachments.reduce((sum,row)=>sum+(row.size??0),0)>fileBudget) throw new Error('รูปแนบเกินขนาดที่รองรับใน UAT');
  const files=[];
  let total=0;
  for(const row of snapshot.attachments) {
    guard();
    const result=await client.storage.from('service-report-photos').download(row.path);
    if(result.error || !result.data || (row.size!==null && result.data.size!==row.size)) {
      throw new Error('ดาวน์โหลดรูปแนบไม่ครบ กรุณาลองสำรองอีกครั้ง');
    }
    const file=result.data;
    total+=file.size;
    if(total>fileBudget) throw new Error('รูปแนบเกินขนาดที่รองรับใน UAT');
    files.push({...row,content_type:file.type,bytes:file.size,sha256:await digest(await file.arrayBuffer()),base64:await asBase64(file)});
  }
  const bundle={
    format:'thaicon-site-backup-v1',id:snapshot.id,site:snapshot.site,captured_at:snapshot.captured_at,
    tables:snapshot.tables,files,
  };
  const blob=new Blob([JSON.stringify(bundle)],{type:'application/json'});
  const sha256=await digest(await blob.arrayBuffer());
  guard();
  const done=await client.rpc('finish_site_backup',{p_site:site,p_id:snapshot.id,p_sha:sha256,p_bytes:blob.size});
  if(done.error || done.data!==true) throw new Error(done.error?.code==='40001'?
    'รูปแนบมีการเปลี่ยนแปลงระหว่างสำรอง กรุณาเริ่มใหม่':'ยืนยันไฟล์สำรองไม่ได้');
  guard();
  return {blob,sha256,filename:`ThaiCon-Backup-${site}-${snapshot.id}.json`};
}

export function downloadSiteBackup(blob:Blob,filename:string) {
  const url=URL.createObjectURL(blob);
  const link=document.createElement('a');
  link.href=url;link.download=filename;
  document.body.append(link);
  try {link.click();} finally {link.remove();window.setTimeout(()=>URL.revokeObjectURL(url),1000);}
}
