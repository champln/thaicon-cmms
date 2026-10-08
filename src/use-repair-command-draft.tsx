import { useEffect, useRef, useState } from "react";
import type { RepairRequest } from "./maintenance";
import { createRepairSaveOperation, RepairCommandError, type createRepairCommandRepository } from "./repair-command-supabase";
export type RepairCommands = {
  repository: ReturnType<typeof createRepairCommandRepository>; refresh: (id: string, minVersion?: number) => Promise<RepairRequest>;
  assertCurrent: () => void; onPendingChange: (pending: boolean) => void;
};
export function useRepairCommandDraft(commands: RepairCommands | undefined, repair: RepairRequest | null, onSaved: (id: string) => void) {
  const alive = useRef(true), busy = useRef(false), operation = useRef<ReturnType<typeof createRepairSaveOperation> | null>(null);
  const identity = useRef({id: repair?.id, version: repair?.version});
  const [pending,setPending] = useState(false), [locked,setLocked] = useState(false), [error,setError] = useState(""), [kind,setKind] = useState("");
  const [latest,setLatest] = useState<RepairRequest | null>(null);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  function assertCurrent() { if (!alive.current) throw new Error("หยุดคำขอเมื่อเปลี่ยนหน้า กรุณาตรวจใบแจ้งซ่อมเดิมก่อนทำต่อ"); commands?.assertCurrent(); }
  async function run() {
    if (!commands || !operation.current || busy.current) return;
    busy.current = true; setPending(true); setError("");
    try {
      const ack = await operation.current.run(); assertCurrent(); await commands.refresh(ack.id,ack.version); assertCurrent();
      commands.onPendingChange(false); operation.current = null; setLocked(false); onSaved(ack.id);
    } catch (e) { if (alive.current) { setError(e instanceof Error ? e.message : "ยังยืนยันผลไม่ได้"); setKind(e instanceof RepairCommandError ? e.kind : "failed"); } }
    finally { busy.current = false; if (alive.current) setPending(false); }
  }
  async function persist(next: RepairRequest) {
    if (!commands || !alive.current || busy.current || operation.current) return;
    operation.current = createRepairSaveOperation({...next,id: identity.current.id ?? next.id,version: identity.current.version},!identity.current.id,commands.repository,assertCurrent);
    commands.onPendingChange(true); setLocked(true); setLatest(null); await run();
  }
  function release(current?: RepairRequest) {
    if (current) identity.current = {id: current.id,version: current.version};
    operation.current = null; setLocked(false); setError(""); setLatest(null); commands?.onPendingChange(false);
  }
  async function inspect() {
    if (!commands || !operation.current || pending) return;
    setPending(true);
    try { assertCurrent(); const current = await commands.refresh(operation.current.id); assertCurrent(); setLatest(current); }
    catch (e) { if (alive.current) setError(e instanceof Error ? e.message : "ตรวจใบแจ้งซ่อมไม่สำเร็จ"); }
    finally { if (alive.current) setPending(false); }
  }
  function canClose() {
    if (pending || busy.current) return false;
    if (locked && !window.confirm("ยังยืนยันผลไม่ได้ การปิดจะทำให้คำขอลองซ้ำในเครื่องหาย กรุณาเก็บรหัสใบแจ้งซ่อมและตรวจข้อมูลก่อนสร้างใหม่ ต้องการปิดหรือไม่?")) return false;
    commands?.onPendingChange(false); return true;
  }
  const feedback = commands && <div className="wide" role="status">
    {pending && <p>กำลังบันทึกและตรวจใบแจ้งซ่อมจากเซิร์ฟเวอร์…</p>}
    {locked && <p>รหัส {operation.current?.id} — เก็บร่างและคำขอเดิมไว้ กรุณาอย่าเปลี่ยนหน้า บัญชี หรือไซต์จนตรวจผลได้</p>}
    {error && <div role="alert" className="maint-form-error"><p>{error}</p>
      {kind === "failed" && <button className="maint-button secondary" type="button" disabled={pending} onClick={() => void run()}>ลองบันทึกใบแจ้งซ่อมคำขอเดิม</button>}
      {kind === "conflict" && <button className="maint-button secondary" type="button" disabled={pending} onClick={() => void inspect()}>ตรวจใบแจ้งซ่อมล่าสุดโดยเก็บร่าง</button>}
      {["denied","invalid"].includes(kind) && <button className="maint-button secondary" type="button" disabled={pending} onClick={() => release()}>กลับไปตรวจแก้ร่างใบแจ้งซ่อม</button>}
      {latest && <><details open><summary>ตรวจเทียบใบแจ้งซ่อมล่าสุด</summary><p>เวอร์ชัน {latest.version} · {latest.status} · {latest.assetId}</p><p>{latest.title}</p><p>{latest.description}</p><p>{latest.resolution}</p></details><button className="maint-button secondary" type="button" disabled={pending} onClick={() => { if (window.confirm("ตรวจเทียบแล้ว ต้องการใช้ร่างนี้บันทึกกับเวอร์ชันล่าสุดหรือไม่?")) release(latest); }}>ใช้เวอร์ชันล่าสุดและแก้ไขใบแจ้งซ่อมต่อ</button></>}
    </div>}
  </div>;
  return {persist,pending,locked,feedback,canClose};
}
