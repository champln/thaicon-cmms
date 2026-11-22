import { useState } from 'react';
import type { DemoUser } from './access';
import { demoEvidenceKey as storageKey, readDemoContracts, readDemoEvidence as readEvidence } from './contract-demo-store';
import { acceptDemoEvidence, addDemoEvidence, demoEvidenceWork, eligibleDemoContracts, evidenceMatches, type DemoCleaningEvidence } from './contract-demo-evidence';
import { reportStatusLabel, type ServiceReport } from './maintenance';
import type { CleaningKind } from './contract-report';

const message = (error: unknown) => error instanceof Error ? error.message : 'บันทึกหลักฐานไม่สำเร็จ';

export default function DemoContractEvidencePanel({site, report, actor, stale}: {
  site: string; report: ServiceReport; actor: DemoUser; stale: boolean;
}) {
  const [contractId, setContractId] = useState('');
  const [kind, setKind] = useState<CleaningKind>('major');
  const [feedback, setFeedback] = useState<{error: boolean; text: string}>();
  let contracts, linked;
  try {
    contracts = eligibleDemoContracts(site,report,readDemoContracts(site));
    linked = readEvidence(site).find(row => row.reportId === report.id);
  } catch {
    return <p className="maint-form-error" role="alert">อ่านข้อมูลสัญญาทดลองไม่สำเร็จ</p>;
  }

  const canLink = !stale && (actor.role === 'admin' || (actor.role === 'engineer' && report.createdBy === actor.id));
  const matches = linked && evidenceMatches(linked,report);
  const canAccept = !stale && actor.role === 'admin' && linked && !linked.acceptance && matches && report.status === 'approved';
  const countable = linked && !stale && demoEvidenceWork(linked,report)?.countable;

  function persist(action: 'link' | 'unlink' | 'accept') {
    try {
      if (stale || report.jobsiteId !== site) throw new Error('กรุณาเปิดรายงานฉบับล่าสุด');
      const rows = readEvidence(site);
      const current = rows.find(row => row.reportId === report.id);
      let next: DemoCleaningEvidence[];
      if (action === 'link') {
        const contract = readDemoContracts(site).find(row => row.id === contractId);
        if (!canLink || !contract) throw new Error('เลือกสัญญาก่อนเชื่อมรายงาน');
        next = addDemoEvidence(rows,site,report,contract,kind);
      } else {
        if (!current || current.acceptance) throw new Error('หลักฐานนี้เปลี่ยนไปหรือบันทึกตรวจรับแล้ว');
        if (action === 'accept') {
          if (actor.role !== 'admin') throw new Error('ผู้ดูแลเท่านั้นที่จำลองการตรวจรับได้');
          const accepted = acceptDemoEvidence(current,report,actor.id,new Date().toISOString());
          next = rows.map(row => row.id === current.id ? accepted : row);
        } else {
          if (!canLink) throw new Error('ไม่มีสิทธิ์ยกเลิกการเชื่อม');
          next = rows.filter(row => row.id !== current.id);
        }
      }
      localStorage.setItem(storageKey(site),JSON.stringify(next));
      setFeedback({error:false,text:action === 'accept' ? 'บันทึกผลตรวจรับลูกค้า (จำลอง) แล้ว' : action === 'link' ? 'เชื่อมรายงานกับสัญญาแล้ว' : 'ยกเลิกการเชื่อมแล้ว'});
    } catch (error) {
      setFeedback({error:true,text:message(error)});
    }
  }

  if (!linked && !canLink) return null;
  return <section className="maint-detail-copy" aria-label="งานล้างตามสัญญา">
    <h3>งานล้างตามสัญญา (Demo)</h3>
    <p>อนุมัติภายใน · {reportStatusLabel(report.status)}</p>
    {linked ? <>
      <p>{linked.contractName} · {linked.groupName} · {linked.building} · {linked.assetType}</p>
      <p>{linked.assetId} · {linked.kind === 'major' ? 'ล้างใหญ่' : 'ล้างย่อย'} · {linked.serviceDate} · 1 ครั้ง</p>
      <p>ตรวจรับลูกค้า (จำลอง) · {linked.acceptance ? 'ตรวจรับแล้ว' : 'ยังไม่ตรวจรับ'}</p>
      {linked.acceptance && <p>ผู้บันทึก {linked.acceptance.by} · {new Date(linked.acceptance.at).toLocaleString('th-TH',{timeZone:'Asia/Bangkok'})}</p>}
      {countable && <p>นับเป็นผลงานตามสัญญาทดลอง 1 ครั้ง</p>}
      {(!matches || (linked.acceptance && !countable)) && <p role="alert">ข้อมูลต้นทางเปลี่ยนแล้ว รายการนี้ไม่นับเป็นผลงานตามสัญญา</p>}
      {canAccept && <button type="button" className="maint-button primary" onClick={()=>persist('accept')}>จำลองตรวจรับลูกค้า</button>}
      {canLink && !linked.acceptance && <button type="button" className="maint-button secondary" onClick={()=>persist('unlink')}>ยกเลิกการเชื่อม</button>}
    </> : contracts.length ? <div className="maint-form">
      <label>สัญญา<select aria-label="สัญญา" value={contractId} onChange={event=>setContractId(event.target.value)}>
        <option value="">เลือกสัญญา</option>
        {contracts.map(contract=><option key={contract.id} value={contract.id}>{contract.definition.name}</option>)}
      </select></label>
      <label>ประเภทล้าง<select aria-label="ประเภทล้าง" value={kind} onChange={event=>setKind(event.target.value as CleaningKind)}>
        <option value="major">ล้างใหญ่</option><option value="minor">ล้างย่อย</option>
      </select></label>
      <button type="button" className="maint-button secondary" disabled={!contractId} onClick={()=>persist('link')}>เชื่อมกับสัญญา</button>
    </div> : <p>{report.quantity !== 1 ? 'เชื่อมได้เมื่อรายงานระบุเครื่องเดียวและจำนวน 1 ครั้ง' : 'ไม่พบสัญญาที่ครอบคลุมเครื่องและวันที่ในรายงาน'}</p>}
    {feedback && <p role={feedback.error ? 'alert' : 'status'}>{feedback.text}</p>}
  </section>;
}
