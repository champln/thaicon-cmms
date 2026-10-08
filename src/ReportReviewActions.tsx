import { useEffect, useRef, useState } from "react";
import type { ServiceReport } from "./maintenance";
import type { ReportCommands } from "./use-report-command-draft";
import { ReportCommandError } from "./service-report-command-supabase";
export default function ReportReviewActions({ report, commands, onDone }: { report: ServiceReport; commands: ReportCommands; onDone: (confirmed: boolean) => void }) {
  const alive = useRef(true), busy = useRef(false);
  const request = useRef<{ report: ServiceReport; id: string; command: "approve" | "return"; reason?: string } | null>(null);
  const [pending, setPending] = useState(false), [error, setError] = useState(""), [kind, setKind] = useState("");
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  async function run() {
    if (busy.current || !request.current) return;
    busy.current = true; setPending(true); setError("");
    try {
      commands.assertCurrent(); const r = request.current;
      const acknowledged = await commands.repository.review(r.report, r.id, r.command, r.reason);
      commands.assertCurrent(); if (!alive.current) return;
      await commands.refresh(r.report.id, acknowledged.version); if (!alive.current) return;
      request.current = null; commands.onPendingChange(false); onDone(true);
    } catch (reason) {
      if (alive.current) { setError(reason instanceof Error ? reason.message : "ยังยืนยันผลไม่ได้"); setKind(reason instanceof ReportCommandError ? reason.kind : "failed"); }
    } finally { busy.current = false; if (alive.current) setPending(false); }
  }
  function start(command: "approve" | "return") {
    if (request.current || busy.current) return;
    const reason = command === "return" ? window.prompt("เหตุผลส่งกลับแก้ไข (1–4000 ตัวอักษร)")?.trim() : undefined;
    if (command === "return" && (!reason || reason.length > 4000)) { setError("กรุณาระบุเหตุผล 1–4000 ตัวอักษร"); return; }
    request.current = { report: structuredClone(report), id: crypto.randomUUID(), command, reason };
    commands.onPendingChange(true); void run();
  }
  async function inspect() {
    setPending(true);
    try {
      await commands.refresh(report.id); if (!alive.current) return;
      request.current = null; commands.onPendingChange(false); onDone(false);
    } catch (reason) { if (alive.current) setError(reason instanceof Error ? reason.message : "ตรวจรายงานไม่สำเร็จ"); }
    finally { if (alive.current) setPending(false); }
  }
  return <div><div className="maint-detail-actions"><button className="maint-button danger" type="button" disabled={pending || !!request.current} onClick={() => start("return")}>ส่งกลับแก้ไข</button><button className="maint-button primary" type="button" disabled={pending || !!request.current} onClick={() => start("approve")}>อนุมัติรายงาน</button></div>
    {pending && <p role="status">กำลังรอเซิร์ฟเวอร์ยืนยันผลตรวจ…</p>}
    {error && <div role="alert" className="maint-form-error"><p>{error}</p>{kind === "failed" && <button type="button" disabled={pending} onClick={() => void run()}>ลองคำสั่งตรวจเดิมอีกครั้ง</button>}{["conflict", "invalid", "denied"].includes(kind) && <button type="button" disabled={pending} onClick={() => void inspect()}>ตรวจรายงานล่าสุดก่อนทำต่อ</button>}</div>}
  </div>;
}
