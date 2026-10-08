import { useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import { createUatRepository, type OnlineUatRun } from "./uat-supabase";
import { ResultForm } from "./UatWorkspace";
import { UAT_VERSION, latestObservation, resultLabels, scenariosFor, summarizeRun } from "./uat";
import type { UatObservation, UatScenario, UatResult, UatScope } from "./uat";
type Pending = { kind: "run"; input: { id: string; tester: string; release: string } } | { kind: "observation"; runId: string; input: UatObservation };

export default function CentralUatWorkspace({ scope }: { scope: UatScope }) {
  const repository = useMemo(() => createUatRepository(), []);
  const [runs,setRuns] = useState<OnlineUatRun[]>([]);
  const [runId,setRunId] = useState("");
  const [busy,setBusy] = useState(true);
  const [loaded,setLoaded] = useState(false);
  const [error,setError] = useState("");
  const [notice,setNotice] = useState("");
  const [tester,setTester] = useState("");
  const [release,setRelease] = useState("");
  const [confirmed,setConfirmed] = useState(false);
  const [query,setQuery] = useState("");
  const [filter,setFilter] = useState("ALL");
  const [pending,setPending] = useState<Pending | null>(null);
  const [acknowledged,setAcknowledged] = useState<{ id: string; scenarioId: string } | null>(null);
  const alive = useRef(true);
  const operation = useRef(false);
  useEffect(() => {
    alive.current=true; let cancelled=false;
    void repository.loadOwnRuns(scope).then(values => {
      if (cancelled) return;
      setRuns(values); setRunId(values.at(-1)?.id ?? ""); setLoaded(true);
    }).catch(() => { if (!cancelled) setError("โหลดผล UAT ไม่สำเร็จ กรุณาตรวจ session และลองโหลดใหม่"); }).finally(()=> { if (!cancelled) setBusy(false); });
    return () => { cancelled=true; alive.current=false; };
  }, [repository,scope.userId,scope.role,scope.siteId,scope.mode]);
  const run=runs.find(value=>value.id===runId);
  const scenarios=scenariosFor(scope.role,run?.scenarioVersion ?? UAT_VERSION);
  const counts=run && summarizeRun(run);
  const visible=scenarios.filter(item=>`${item.id} ${item.title} ${item.steps.join(" ")}`.toLowerCase().includes(query.trim().toLowerCase()) && (filter==="ALL" || run && (latestObservation(run,item.id)?.result ?? "NOT_RUN")===filter));
  async function send(request: Pending): Promise<boolean> {
    if (operation.current) return false;
    operation.current=true; setBusy(true); setPending(request); setError(""); setNotice("");
    try {
      if (request.kind==="run") {
        const value=await repository.createRun(scope,request.input);
        if (!alive.current) return false;
        setRuns(values=>values.some(r=>r.id===value.id) ? values : [...values,value]); setRunId(value.id);
      } else {
        const value=await repository.appendObservation(scope,request.runId,request.input);
        if (!alive.current) return false;
        setRuns(values=>values.map(r=>r.id===request.runId ? {...r,observations:r.observations.some(o=>o.id===value.id) ? r.observations : [...r.observations,value].sort((a,b)=>a.eventNo-b.eventNo)} : r));
        setAcknowledged({ id: value.id, scenarioId: value.scenarioId });
      }
      setPending(null); setNotice("เซิร์ฟเวอร์ยืนยันการบันทึกแล้ว ผลก่อนหน้ายังอยู่"); return true;
    } catch {
      if (alive.current) setError("ยังยืนยันการบันทึกไม่ได้ เก็บคำขอเดิมไว้แล้ว ลองรายการเดิมอีกครั้งหรือโหลดผลล่าสุด ห้ามเปลี่ยนบัญชีหรือไซต์ระหว่างรอ");
      return false;
    } finally { operation.current=false; if (alive.current) setBusy(false); }
  }
  async function refresh() {
    if (operation.current) return;
    operation.current=true; setBusy(true); setError("");
    try {
      const values=await repository.loadOwnRuns(scope);
      if (!alive.current) return;
      setRuns(values); setLoaded(true); if (!runId) setRunId(values.at(-1)?.id ?? "");
      const resolved=pending && (pending.kind==="run" ? values.some(r=>r.id===pending.input.id) : values.some(r=>r.id===pending.runId && r.observations.some(o=>o.id===pending.input.id)));
      if (resolved) { if (pending?.kind === "observation") setAcknowledged({ id: pending.input.id, scenarioId: pending.input.scenarioId }); setPending(null); setNotice("พบรายการเดิมในฐาน UAT แล้ว ไม่สร้างรายการซ้ำ"); }
      else setNotice(pending ? "ยังไม่พบรายการเดิม โปรดลองคำขอเดิมซ้ำเพื่อยืนยันผล" : "โหลดผลล่าสุดแล้ว");
    } catch { if (alive.current) setError("โหลดผล UAT ไม่สำเร็จ ข้อมูลเดิมและคำขอที่ยังไม่ยืนยันยังอยู่"); }
    finally { operation.current=false; if (alive.current) setBusy(false); }
  }
  function create(event: FormEvent) {
    event.preventDefault(); if (!loaded || busy || pending || !confirmed || !tester.trim() || !release.trim()) return;
    void send({kind:"run",input:{id:crypto.randomUUID(),tester:tester.trim(),release:release.trim()}});
  }
  function save(item: UatScenario,result: UatResult,actual: string,evidence: string) {
    if (!run || busy || pending || !loaded) return Promise.resolve(false);
    return send({kind:"observation",runId:run.id,input:{id:crypto.randomUUID(),scenarioId:item.id,result,actual,evidence,at:new Date().toISOString()}});
  }
  function exportResults() {
    const payload={exportedAt:new Date().toISOString(),storage:"supabase-own-runs",scope,runs,scenarioCatalogs:Object.fromEntries([...new Set(runs.map(r=>r.scenarioVersion))].map(version=>[version,scenariosFor(scope.role,version)]))};
    const url=URL.createObjectURL(new Blob([JSON.stringify(payload,null,2)],{type:"application/json;charset=utf-8"}));
    const link=document.createElement("a"); link.href=url; link.download=`thaicon-uat-central-${scope.siteId}.json`; document.body.append(link); link.click(); link.remove(); setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  return <section className="uat-workspace" aria-label="ทดสอบระบบ UAT ฐานกลาง" aria-busy={busy}>
    <header className="uat-intro"><p>ชุดทดสอบ {run?.scenarioVersion ?? UAT_VERSION} · {scope.siteId}</p><h2>ผล UAT ฐานกลาง</h2></header>
    <aside className="uat-warning"><strong>ฐานนี้เปิดใช้ UAT แล้ว — ใช้เฉพาะข้อมูลทดสอบ</strong><p>แสดงเฉพาะรอบของบัญชี บทบาทและไซต์นี้ ไม่ส่งผล Demo หรือไฟล์ผลเก่าเข้าฐานกลางเอง การบันทึกไม่ใช่การลงนามตรวจรับ ช่องหลักฐานยังเป็นข้อความอ้างอิง ไม่อัปโหลดไฟล์</p></aside>
    {busy && <p role="status">กำลังติดต่อฐาน UAT…</p>}{error && <p role="alert">{error}</p>}<p role="status">{notice}</p>
    <div className="uat-tools"><button type="button" disabled={busy} onClick={()=>void refresh()}>โหลดผล UAT ล่าสุด</button>{pending && <button type="button" disabled={busy} onClick={()=>void send(pending)}>ลองรายการเดิมอีกครั้ง</button>}<button type="button" disabled={!loaded || busy || !runs.length} onClick={exportResults}>ส่งออกผลฐานกลางของฉัน (JSON)</button></div>
    <details className="uat-setup" open={!run}><summary>เริ่มรอบทดสอบใหม่</summary><form onSubmit={create}><fieldset disabled={!loaded || busy || !!pending} className="uat-result-fields">
      <label>ชื่อผู้ทดสอบจริง<input required maxLength={120} value={tester} onChange={e=>setTester(e.target.value)} /></label>
      <label>รุ่นระบบที่ทดสอบ / Commit<input required maxLength={120} value={release} onChange={e=>setRelease(e.target.value)} /></label>
      <label className="uat-confirm"><input type="checkbox" required checked={confirmed} onChange={e=>setConfirmed(e.target.checked)} />ฉันใช้ฐาน UAT ที่ยืนยันแล้วและข้อมูลทดสอบ ไม่ใช่ Production</label>
      <button type="submit">เริ่มรอบใหม่เข้าฐาน UAT</button>
    </fieldset></form></details>
    <div className="uat-tools"><label>รอบที่กำลังดู<select value={runId} disabled={busy || !!pending} onChange={e=>setRunId(e.target.value)}><option value="">เลือกรอบ</option>{runs.map(r=><option key={r.id} value={r.id}>{r.tester} · {r.release} · {r.scenarioVersion}</option>)}</select></label></div>
    {run && counts && <><div className="uat-progress"><strong>{run.tester} · {run.release}</strong><p>{Object.entries(counts).map(([key,value])=>`${resultLabels[key as keyof typeof resultLabels]} ${value}`).join(" · ")}</p><p>เวลาบันทึกผลและลำดับหลักฐานมาจากเซิร์ฟเวอร์</p></div>
      <div className="uat-tools"><label>ค้นหาเคส<input type="search" value={query} onChange={e=>setQuery(e.target.value)} /></label><label>กรองผล<select value={filter} onChange={e=>setFilter(e.target.value)}><option value="ALL">ทั้งหมด</option>{Object.entries(resultLabels).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label></div>
      <p>แสดง {visible.length} จาก {scenarios.length} เคส · กดบันทึกก่อนกรองหรือสลับรอบเพื่อไม่เสียข้อความที่ยังไม่ได้บันทึก</p>
      <div className="uat-cases">{visible.map(item=><ResultForm key={`${run.id}:${item.id}:${acknowledged?.scenarioId === item.id ? acknowledged.id : ""}`} item={item} run={run} onSave={save} central locked={busy || !!pending} />)}</div>
    </>}
  </section>;
}
