import { lazy, Suspense, useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { roleLabels } from "./access";
import { latestObservation, parseArchive, recordObservation, resultLabels, scenariosFor, summarizeRun, UAT_VERSION, uatStorageKey } from "./uat";
import type { UatArchive, UatResult, UatRun, UatScenario, UatScope } from "./uat";
import "./uat.css";
import { createUatRepository } from "./uat-supabase";
const CentralUatWorkspace = lazy(() => import("./CentralUatWorkspace"));

export function ResultForm({ item, run, onSave, central = false, locked = false }: { item: UatScenario; run: UatRun; onSave: (item: UatScenario, result: UatResult, actual: string, evidence: string) => boolean | Promise<boolean>; central?: boolean; locked?: boolean }) {
  const previous = latestObservation(run, item.id);
  const blocked = run.scope.mode === "demo" && item.onlineOnly;
  const [result, setResult] = useState<UatResult>(blocked ? "BLOCKED" : previous?.result ?? "PASS");
  const [actual, setActual] = useState("");
  const [evidence, setEvidence] = useState("");
  const [saved, setSaved] = useState(false);
  const [pending, setPending] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault();
    setPending(true);
    try { if (await onSave(item, result, actual.trim(), evidence.trim())) { setSaved(true); setActual(""); setEvidence(""); } }
    finally { setPending(false); }
  }
  return <details className="uat-case">
    <summary><strong>{item.id} · {item.title}</strong><span>{resultLabels[previous?.result ?? "NOT_RUN"]}</span></summary>
    <div className="uat-case-body">
      <p><strong>เตรียมก่อนทดสอบ:</strong> {item.prerequisite}</p>
      {item.onlineOnly && <p className="uat-warning">ต้องใช้ UAT ออนไลน์แยกและบัญชีทดสอบจริง หากยังไม่พร้อม ให้เลือก “ทดสอบไม่ได้”</p>}
      <ol>{item.steps.map(step => <li key={step}>{step}</li>)}</ol>
      <p className="uat-expected"><strong>ผลที่ควรได้:</strong> {item.expected}</p>
      {previous && <div className="uat-previous"><strong>ผลล่าสุด · {resultLabels[previous.result]}</strong><p>{previous.actual}</p>{previous.evidence && <p>หลักฐาน: {previous.evidence}</p>}<small>{new Date(previous.at).toLocaleString("th-TH")}</small></div>}
      <form onSubmit={submit} onChange={() => setSaved(false)}>
        <fieldset disabled={pending || locked} className="uat-result-fields">
        <label>ผลการทดสอบ<select value={result} onChange={event => setResult(event.target.value as UatResult)}>
          {!blocked && <><option value="PASS">ผ่าน</option><option value="FAIL">ไม่ผ่าน</option></>}
          <option value="BLOCKED">ทดสอบไม่ได้</option>
        </select></label>
        <label>สิ่งที่เกิดขึ้นจริง / เหตุผลที่ทดสอบไม่ได้<textarea required maxLength={4000} rows={3} value={actual} onChange={event => setActual(event.target.value)} placeholder="เช่น รีเฟรชแล้วพบใบงานรหัส… ข้อมูลตรงกับก่อนรีเฟรช" /></label>
        <label>ชื่อไฟล์หลักฐานหรือเลขอ้างอิง (ถ้ามี)<input maxLength={500} value={evidence} onChange={event => setEvidence(event.target.value)} placeholder="เช่น WO-04-ภาพหลังรีเฟรช.png" /></label>
        <p className="uat-hint">ช่องนี้ยังไม่อัปโหลดไฟล์ กรุณาเก็บภาพแยกไว้และไม่ใส่รหัสผ่าน token หรือข้อมูลลูกค้าจริง</p>
        <button type="submit">{pending ? "กำลังบันทึก…" : central ? "บันทึกผลเคสนี้เข้าฐาน UAT" : "บันทึกผลเคสนี้ในเครื่อง"}</button>
        <span role="status">{saved ? " บันทึกแล้ว — ประวัติรอบก่อนยังอยู่" : " ยังไม่บันทึกข้อความที่กรอกจนกว่าจะกดปุ่ม"}</span>
        </fieldset>
      </form>
      {run.observations.filter(value => value.scenarioId === item.id).length > 1 && <details className="uat-history"><summary>ประวัติการทดสอบเคสนี้</summary><ol>{run.observations.filter(value => value.scenarioId === item.id).map(value => <li key={value.id}><strong>{resultLabels[value.result]} · {new Date(value.at).toLocaleString("th-TH")}</strong><p>{value.actual}</p>{value.evidence && <p>หลักฐาน: {value.evidence}</p>}</li>)}</ol></details>}
    </div>
  </details>;
}

function BrowserLocalUatWorkspace({ scope }: { scope: UatScope }) {
  const key = uatStorageKey(scope);
  const [initial] = useState(() => {
    let raw: string | null = null;
    try { raw = localStorage.getItem(key); return { raw, archive: parseArchive(raw, scope), error: "" }; }
    catch { return { raw, archive: { schema: 1, runs: [] } as UatArchive, error: "อ่านผลเดิมไม่ได้ จึงหยุดการบันทึกเพื่อไม่เขียนทับข้อมูลเดิม กรุณาเก็บข้อมูลกู้คืนและแจ้งผู้ดูแล" }; }
  });
  const lastRaw = useRef(initial.raw);
  const [archive, setArchive] = useState(initial.archive);
  const [runId, setRunId] = useState(initial.archive.runs.at(-1)?.id ?? "");
  const [error, setError] = useState(initial.error);
  const [notice, setNotice] = useState("");
  const [tester, setTester] = useState("");
  const [release, setRelease] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("ALL");
  const run = archive.runs.find(value => value.id === runId);
  const counts = run && summarizeRun(run);
  const scenarios = scenariosFor(scope.role, run?.scenarioVersion ?? UAT_VERSION);
  const visible = scenarios.filter(item => `${item.id} ${item.title} ${item.prerequisite} ${item.steps.join(" ")}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()) && (filter === "ALL" || (run && (latestObservation(run, item.id)?.result ?? "NOT_RUN") === filter)));

  function persist(next: UatArchive) {
    if (initial.error) return false;
    try {
      if (localStorage.getItem(key) !== lastRaw.current) { setError("มีการเปลี่ยนผลจากแท็บอื่น หยุดบันทึกเพื่อไม่ทับกัน ส่งออกผลที่เปิดอยู่ก่อน แล้วโหลดหน้านี้ใหม่"); return false; }
      const raw = JSON.stringify(next);
      localStorage.setItem(key, raw);
      lastRaw.current = raw;
      setArchive(next); setError("");
      return true;
    } catch { setError("บันทึกในเครื่องไม่สำเร็จ อาจมีพื้นที่ไม่พอหรือเบราว์เซอร์ปิดการจัดเก็บ กรุณาคัดลอกข้อความที่ยังไม่ได้บันทึกไว้ก่อน"); return false; }
  }
  function createRun(event: FormEvent) {
    event.preventDefault();
    if (!tester.trim() || !release.trim() || !confirmed) return;
    const next: UatRun = { id: crypto.randomUUID(), scenarioVersion: UAT_VERSION, tester: tester.trim(), release: release.trim(), createdAt: new Date().toISOString(), scope: { ...scope }, observations: [] };
    if (persist({ schema: 1, runs: [...archive.runs, next] })) { setRunId(next.id); setNotice("เริ่มรอบใหม่แล้ว ผลรอบเดิมยังอยู่ เลือกเคสด้านล่างเพื่อเริ่มทดสอบ"); }
  }
  function save(item: UatScenario, result: UatResult, actual: string, evidence: string) {
    if (!run) return false;
    try {
      const next = recordObservation(run, { id: crypto.randomUUID(), scenarioId: item.id, result, actual, evidence, at: new Date().toISOString() });
      return persist({ schema: 1, runs: archive.runs.map(value => value.id === run.id ? next : value) });
    } catch (reason) { setError(reason instanceof Error ? reason.message : "บันทึกผลไม่สำเร็จ"); return false; }
  }
  function download(raw: string, filename: string) {
    const url = URL.createObjectURL(new Blob([raw], { type: "application/json;charset=utf-8" }));
    const link = document.createElement("a"); link.href = url; link.download = filename;
    document.body.append(link); link.click(); link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function exportResults() {
    const versions = [...new Set(archive.runs.map(item => item.scenarioVersion))];
    const scenarioCatalogs = Object.fromEntries(versions.map(version => [version, scenariosFor(scope.role, version)]));
    download(JSON.stringify({ exportedAt: new Date().toISOString(), sourceOrigin: window.location.origin, storage: "browser-local-only", ...archive, scenarios, scenarioCatalogs }, null, 2), `thaicon-uat-${UAT_VERSION}-${scope.mode}-${scope.role}-${scope.siteId}.json`);
    setNotice("ส่งไฟล์ JSON ที่ดาวน์โหลดพร้อมภาพหลักฐานให้ผู้ประสานงาน ผลนี้ยังไม่ได้ส่งเข้าฐานกลาง");
  }
  return <section className="uat-workspace" aria-label="ทดสอบระบบ UAT">
    <header className="uat-intro"><p>ชุดทดสอบ {run?.scenarioVersion ?? UAT_VERSION} · {roleLabels[scope.role]} · {scope.siteId}</p><h2>ลองทำงานจริงทีละเคส</h2><p>ทำตามขั้นตอน เปรียบเทียบกับผลที่ควรได้ แล้วบันทึกสิ่งที่พบ ไม่มีการตัดสินผลอัตโนมัติ และการบันทึกผลไม่ใช่การลงนามตรวจรับ</p></header>
    <aside className="uat-warning"><strong>ผลบันทึกเฉพาะเบราว์เซอร์นี้ — ยังไม่รวมผลออนไลน์</strong><p>โหมดปัจจุบัน: {scope.mode === "demo" ? "Demo / ข้อมูลจำลอง" : "Supabase / ยังไม่ได้ยืนยันว่าเป็นฐาน UAT"} การเปิดเว็บออนไลน์ไม่ได้ทำให้ผลส่งเข้าฐานกลาง ผลแยกตามบัญชี บทบาท ไซต์ และโหมด กรุณาใช้แท็บเดียวและส่งออกไฟล์ก่อนล้างข้อมูลเบราว์เซอร์</p><p>ใช้ข้อมูลจำลองใน Demo หรือระบบ UAT ที่ผู้ดูแลยืนยันแล้วเท่านั้น ห้ามทดลองสร้าง แก้ไข ระงับบัญชี หรือทดสอบสิทธิ์บน Production</p></aside>
    {error && <div role="alert" className="uat-warning">{error}{initial.error && initial.raw !== null && <p><button onClick={() => download(initial.raw!, "thaicon-uat-recovery.json")}>ดาวน์โหลดข้อมูลเดิมเพื่อกู้คืน</button></p>}</div>}
    <details className="uat-setup" open={!run}><summary>เริ่มรอบทดสอบใหม่</summary><form onSubmit={createRun}>
      <label>ชื่อผู้ทดสอบจริง<input required maxLength={120} value={tester} onChange={event => setTester(event.target.value)} autoComplete="name" /></label>
      <label>รุ่นระบบที่ทดสอบ / Commit<input required maxLength={120} value={release} onChange={event => setRelease(event.target.value)} placeholder="ให้ผู้ประสานงานแจ้งรุ่น เช่น local-unpublished-20261004" /></label>
      <label className="uat-confirm"><input type="checkbox" required checked={confirmed} onChange={event => setConfirmed(event.target.checked)} />ฉันจะใช้ข้อมูลจำลองใน Demo หรือ UAT ที่ผู้ดูแลยืนยันแล้ว ไม่ใช่ Production</label>
      <button disabled={Boolean(initial.error)} type="submit">เริ่มรอบใหม่โดยเก็บผลเดิม</button>
    </form></details>
    <div className="uat-tools"><label>รอบที่กำลังดู<select value={runId} onChange={event => { setRunId(event.target.value); setNotice(""); }} disabled={!archive.runs.length}>
      {!archive.runs.length && <option value="">ยังไม่มีรอบทดสอบ</option>}
      {archive.runs.map(value => <option key={value.id} value={value.id}>{value.tester} · {value.release} · {new Date(value.createdAt).toLocaleString("th-TH")} · {value.id.slice(0, 8)}</option>)}
    </select></label><button onClick={exportResults} disabled={!archive.runs.length}>ส่งออกผลทุกรอบ (JSON)</button></div>
    <p role="status">{notice}</p>
    {run && counts && <>
      <div className="uat-progress"><strong>{run.tester} · {run.release}</strong><p>{Object.entries(counts).map(([status, count]) => `${resultLabels[status as keyof typeof resultLabels]} ${count}`).join(" · ")}</p><label>ดำเนินการแล้ว {scenarios.length - counts.NOT_RUN} / {scenarios.length} เคส (รวมทดสอบไม่ได้)<progress max={scenarios.length} value={scenarios.length - counts.NOT_RUN} /></label><p>สรุปจากผลล่าสุดต่อเคส ไม่ได้นับผลทดสอบซ้ำเป็นเคสเพิ่ม</p></div>
      <div className="uat-tools"><label>ค้นหาเคส<input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="รหัสเคส หรือชื่อหัวข้อ" /></label><label>กรองผล<select value={filter} onChange={event => setFilter(event.target.value)}><option value="ALL">ทั้งหมด</option>{Object.entries(resultLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label></div>
      <p>แสดง {visible.length} จาก {scenarios.length} เคสสำหรับบทบาทนี้ · ช่องผลยังไม่บันทึกเมื่อเปลี่ยนหน้า กรอง หรือสลับรอบ กรุณากดบันทึกแต่ละเคสก่อน</p>
      <div className="uat-cases">{visible.map(item => <ResultForm key={`${run.id}:${item.id}`} item={item} run={run} onSave={save} />)}</div>
      {!visible.length && <p>ไม่พบเคสที่ตรงกับคำค้นหรือผลที่เลือก ลองล้างคำค้นหรือเลือกผลทั้งหมด</p>}
    </>}
  </section>;
}

export default function UatWorkspace({ scope }: { scope: UatScope }) {
  const [state, setState] = useState<"loading" | "central" | "local" | "error">(scope.mode === "demo" ? "local" : "loading");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let cancelled = false;
    if (scope.mode === "demo") { setState("local"); return; }
    setState("loading");
    void createUatRepository().available(scope).then(ready => { if (!cancelled) setState(ready ? "central" : "local"); }).catch(() => { if (!cancelled) setState("error"); });
    return () => { cancelled = true; };
  }, [scope.mode, scope.userId, scope.role, scope.siteId, attempt]);
  if (state === "loading") return <p role="status">กำลังตรวจสถานะฐาน UAT…</p>;
  if (state === "error") return <div role="alert"><p>ตรวจฐาน UAT ไม่สำเร็จ จึงหยุดการบันทึก ไม่เปลี่ยนไปบันทึกในเครื่องเอง</p><button type="button" onClick={() => setAttempt(value => value + 1)}>ลองตรวจฐาน UAT อีกครั้ง</button></div>;
  return state === "central" ? <Suspense fallback={<p role="status">กำลังเปิดผล UAT ฐานกลาง…</p>}><CentralUatWorkspace scope={scope} /></Suspense> : <BrowserLocalUatWorkspace scope={scope} />;
}
