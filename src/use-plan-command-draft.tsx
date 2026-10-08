import { useEffect, useRef, useState } from "react";
import type { MaintenancePlan } from "./maintenance";
import { createPlanOperation, PlanCommandError, type PlanCommandState, type createPlanCommandRepository } from "./plan-command-supabase";
export type PlanCommands = {
  repository: ReturnType<typeof createPlanCommandRepository>;
  refresh: (id: string, minVersion?: number) => Promise<PlanCommandState>;
  assertCurrent: () => void; onPendingChange: (pending: boolean) => void;
};
export function usePlanCommandDraft(commands: PlanCommands | undefined, plan: MaintenancePlan | null, remove: boolean, onSaved: (id: string) => void) {
  const alive = useRef(true), busy = useRef(false), operation = useRef<ReturnType<typeof createPlanOperation> | null>(null);
  const identity = useRef({ id: plan?.id, version: plan?.version });
  const [pending,setPending] = useState(false), [locked,setLocked] = useState(false), [error,setError] = useState(""), [kind,setKind] = useState("");
  const [latest,setLatest] = useState<PlanCommandState | null>(null);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  function assertCurrent() { if (!alive.current) throw new Error("เปลี่ยนหน้าแล้ว กรุณาตรวจแผนเดิมก่อนทำต่อ"); commands?.assertCurrent(); }
  async function run() {
    if (!commands || !operation.current || busy.current) return;
    busy.current = true; setPending(true); setError("");
    try {
      const ack = await operation.current.run(); assertCurrent();
      const confirmed = await commands.refresh(ack.id,ack.version); assertCurrent();
      if (confirmed.deleted !== remove) throw new PlanCommandError("conflict","แผนเปลี่ยนสถานะแล้ว กรุณาตรวจฉบับล่าสุด");
      commands.onPendingChange(false); operation.current = null; setLocked(false); onSaved(ack.id);
    } catch (e) { if (alive.current) { setError(e instanceof Error ? e.message : "ยังยืนยันผลไม่ได้"); setKind(e instanceof PlanCommandError ? e.kind : "failed"); } }
    finally { busy.current = false; if (alive.current) setPending(false); }
  }
  async function persist(next: MaintenancePlan) {
    if (!commands || !alive.current || busy.current || operation.current) return;
    operation.current = createPlanOperation({...next,id:identity.current.id ?? next.id,version:identity.current.version},!identity.current.id,remove,commands.repository,assertCurrent);
    commands.onPendingChange(true); setLocked(true); setLatest(null); await run();
  }
  function release(current?: MaintenancePlan) {
    if (current) identity.current = { id:current.id,version:current.version };
    operation.current = null; setLocked(false); setError(""); setLatest(null); commands?.onPendingChange(false);
  }
  async function inspect() {
    if (!commands || !operation.current || busy.current) return;
    busy.current = true; setPending(true);
    try { assertCurrent(); const current = await commands.refresh(operation.current.id); assertCurrent(); setLatest(current); }
    catch (e) { if (alive.current) setError(e instanceof Error ? e.message : "ตรวจแผนไม่สำเร็จ"); }
    finally { busy.current = false; if (alive.current) setPending(false); }
  }
  function canClose() {
    if (pending || busy.current) return false;
    if (locked && !window.confirm("ยังยืนยันผลไม่ได้ การปิดจะทำให้คำขอลองซ้ำในเครื่องหาย กรุณาเก็บรหัสแผนและตรวจข้อมูลก่อนสร้างใหม่ ต้องการปิดหรือไม่?")) return false;
    commands?.onPendingChange(false); return true;
  }
  const feedback = commands && <div className="wide" role="status">
    {pending && <p>กำลังบันทึกและตรวจแผนจากเซิร์ฟเวอร์…</p>}
    {locked && <p>รหัส {operation.current?.id} — เก็บร่างและคำขอเดิมไว้ กรุณาอย่าเปลี่ยนหน้า บัญชี หรือไซต์จนตรวจผลได้</p>}
    {error && <div role="alert" className="maint-form-error"><p>{error}</p>
      {kind === "failed" && <button className="maint-button secondary" type="button" disabled={pending} onClick={() => void run()}>ลองคำขอแผนเดิมอีกครั้ง</button>}
      {["conflict","invalid","denied"].includes(kind) && <button className="maint-button secondary" type="button" disabled={pending} onClick={() => void inspect()}>ตรวจแผนล่าสุดโดยเก็บร่าง</button>}
      {!remove && ["invalid","denied"].includes(kind) && !latest?.deleted && <button className="maint-button secondary" type="button" disabled={pending} onClick={() => release()}>กลับไปตรวจแก้ร่างแผน</button>}
      {latest && <details open><summary>ตรวจเทียบแผนล่าสุด</summary><p>เวอร์ชัน {latest.version}</p>{latest.deleted ? <p>เซิร์ฟเวอร์ยืนยันว่าแผนถูกลบแล้ว ปิดหน้าต่างนี้เพื่อกลับไปดูรายการ ไม่สามารถใช้รหัสเดิมสร้างใหม่</p> : <><p>{latest.plan?.name} · {latest.plan?.status}</p><p>ประเภทบริการ {latest.plan?.serviceType}</p><p>ปี {latest.plan?.year} · เป้าหมาย {latest.plan?.annualTarget} · ทุก {latest.plan?.cycleMonths} เดือน · เริ่มเดือน {latest.plan?.startMonth}</p><button className="maint-button secondary" type="button" disabled={pending} onClick={() => { if (latest.plan && window.confirm("ตรวจเทียบแล้ว ต้องการใช้ร่างนี้กับเวอร์ชันล่าสุดหรือไม่?")) release(latest.plan); }}>ใช้เวอร์ชันล่าสุดและทำต่อ</button></>}</details>}
    </div>}
  </div>;
  return {persist,pending,locked,feedback,canClose};
}
