import { useEffect, useRef, useState } from "react";
import type { ServiceReport } from "./maintenance";
import { createReportSaveOperation, ReportCommandError } from "./service-report-command-supabase";
import type { createReportCommandRepository } from "./service-report-command-supabase";
export type ReportCommands = {
  repository: ReturnType<typeof createReportCommandRepository>;
  refresh: (id: string, minVersion?: number) => Promise<ServiceReport>;
  onPendingChange: (active: boolean) => void;
  assertCurrent: () => void;
  isPending: () => boolean;
};

export function useReportCommandDraft(commands: ReportCommands | undefined, report: ServiceReport | null, onSaved: (id: string) => void) {
  const alive = useRef(true), busy = useRef(false);
  const operation = useRef<ReturnType<typeof createReportSaveOperation> | null>(null);
  const identity = useRef({ id: report?.id, version: report?.version });
  const [pending, setPending] = useState(false), [locked, setLocked] = useState(false);
  const [error, setError] = useState(""), [kind, setKind] = useState(""), [latest, setLatest] = useState<ServiceReport | null>(null);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  async function run() {
    if (!commands || !operation.current || busy.current) return false;
    busy.current = true; setPending(true); setError("");
    try {
      const acknowledged = await operation.current.run();
      commands.assertCurrent();
      await commands.refresh(acknowledged.id, acknowledged.version);
      if (!alive.current) return false;
      commands.onPendingChange(false); operation.current = null; setLocked(false); onSaved(acknowledged.id); return true;
    } catch (reason) {
      if (alive.current) {
        setKind(reason instanceof ReportCommandError ? reason.kind : "failed");
        setError(reason instanceof Error ? reason.message : "ยังยืนยันการบันทึกไม่ได้");
      }
      return false;
    } finally { busy.current = false; if (alive.current) setPending(false); }
  }
  async function persist(next: ServiceReport, submit: boolean) {
    if (!commands || !alive.current || busy.current || operation.current) return false;
    const snapshot = { ...next, id: identity.current.id ?? next.id, version: identity.current.version };
    operation.current = createReportSaveOperation(snapshot, submit, !identity.current.id, commands.repository, () => {
      if (!alive.current) throw new Error("หยุดคำขอเนื่องจากเปลี่ยนหน้า กรุณาตรวจรายงานเดิมก่อนทำต่อ");
      commands.assertCurrent();
    });
    setLocked(true); setLatest(null); commands.onPendingChange(true);
    return run();
  }
  function release(id?: string, version?: number) {
    if (!commands || !operation.current) return;
    const context = operation.current.context();
    identity.current = { id: id ?? (context.version ? context.report.id : undefined), version: version ?? context.version };
    operation.current = null; setLocked(false); setError(""); setLatest(null); commands.onPendingChange(false);
  }
  async function inspect() {
    if (!commands || !operation.current || pending) return;
    setPending(true);
    try { const current = await commands.refresh(operation.current.reportId); if (alive.current) setLatest(current); }
    catch (reason) { if (alive.current) setError(reason instanceof Error ? reason.message : "โหลดรายงานล่าสุดไม่สำเร็จ"); }
    finally { if (alive.current) setPending(false); }
  }
  function canClose() {
    if (busy.current || pending) return false;
    if (locked && !window.confirm("ยังไม่ยืนยันผลการบันทึก การปิดจะทำให้คำขอลองซ้ำในเครื่องหาย กรุณาเก็บรหัสรายงานและตรวจข้อมูลก่อนทำรายการใหม่ ต้องการปิดหรือไม่?")) return false;
    commands?.onPendingChange(false); return true;
  }
  const feedback = commands && <div className="wide" role="status">
    {pending && <p>กำลังบันทึกและตรวจข้อมูลจากเซิร์ฟเวอร์…</p>}
    {locked && <p>รหัสรายงาน {operation.current?.reportId} — ข้อมูลและรูปในฟอร์มยังอยู่ หากอัปโหลดค้างอาจมีฉบับร่างบนเซิร์ฟเวอร์ แต่ยังไม่ถือว่าส่งตรวจสำเร็จ กรุณาอย่าเปลี่ยนหน้าหรือบัญชีจนกว่าจะตรวจผล</p>}
    {error && <div role="alert" className="maint-form-error"><p>{error}</p>
      {kind === "failed" && <button className="maint-button secondary" type="button" disabled={pending} onClick={() => void run()}>ลองบันทึกคำขอเดิมอีกครั้ง</button>}
      {kind === "conflict" && <button className="maint-button secondary" type="button" disabled={pending} onClick={() => void inspect()}>ตรวจฉบับล่าสุดโดยเก็บร่างเดิม</button>}
      {["invalid", "denied"].includes(kind) && <button className="maint-button secondary" type="button" disabled={pending} onClick={() => release()}>กลับไปตรวจแก้ร่างเดิม</button>}
      {latest && <><details open><summary>ฉบับล่าสุดสำหรับตรวจเทียบ</summary><p>เวอร์ชัน {latest.version} · สถานะ {latest.status} · {latest.assetId} · วันที่ {latest.serviceDate} · จำนวน {latest.quantity}</p><p>{latest.workPerformed}</p><p>{latest.findings}</p><p>{latest.actionTaken}</p><p>รูป {latest.attachments.map(a => a.name).join(", ") || "ไม่มีรูป"}</p></details>
      {["draft", "rejected"].includes(latest.status) ? <button className="maint-button secondary" type="button" onClick={() => { if (window.confirm("ตรวจเทียบแล้วและต้องการใช้ข้อความ/รูปในร่างนี้บันทึกทับฉบับล่าสุดใช่หรือไม่?")) release(latest.id, latest.version); }}>ใช้เวอร์ชันล่าสุดและแก้ไขร่างต่อ</button> : <p>ฉบับล่าสุดไม่เปิดให้แก้ไข กรุณาเก็บข้อความในฟอร์มก่อนปิด</p>}</>}
    </div>}
  </div>;
  return { persist, locked, pending, feedback, canClose };
}
