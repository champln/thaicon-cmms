// TOR workflow foundation. Not wired to the UI or a database write endpoint yet.
// The same checks must be enforced transactionally on the server before activation.
export type JobStatus = "waiting" | "in_progress" | "review" | "completed";
export type WorkflowActor = {
  id: string;
  role: "admin" | "engineer" | "user";
  active: boolean;
  siteIds: readonly string[];
};
export type WorkflowOrder = {
  id: string;
  siteId: string;
  siteActive: boolean;
  status: JobStatus;
  version: number;
  assigneeId: string | null;
};
export type WorkflowCommand =
  | { kind: "assign"; assignee: WorkflowActor }
  | { kind: "start" }
  | { kind: "submit" }
  | { kind: "approve" }
  | { kind: "return"; reason: string }
  | { kind: "note"; text: string };

function hasSite(actor: WorkflowActor, siteId: string) {
  return actor.active && (actor.role === "admin" || actor.siteIds.includes(siteId));
}

/** Validate one command against an authoritative snapshot; never mutates input.
 * No client timestamps/actor labels are generated here. The future database
 * transaction owns attribution, event creation, version increment and retries.
 */
export function validateWorkOrderCommand(
  order: WorkflowOrder, actor: WorkflowActor, expectedVersion: number, command: WorkflowCommand,
): { status: JobStatus; assigneeId: string | null; note: string | null } {
  if (!order.siteActive || !hasSite(actor, order.siteId) || actor.role === "user") {
    throw new Error("ไม่มีสิทธิ์ดำเนินการใบงานนี้");
  }
  if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1 || expectedVersion !== order.version) {
    throw new Error("ข้อมูลถูกเปลี่ยนแล้ว กรุณาโหลดข้อมูลล่าสุด");
  }
  if (order.status === "completed") throw new Error("ใบงานปิดแล้ว ไม่สามารถแก้ไขได้");
  if (command.kind === "assign") {
    if (actor.role !== "admin" || !["waiting", "in_progress"].includes(order.status)) {
      throw new Error("ไม่สามารถมอบหมายงานในสถานะนี้");
    }
    if (!hasSite(command.assignee, order.siteId) || command.assignee.role === "user") {
      throw new Error("ผู้รับงานไม่มีสิทธิ์ปฏิบัติงานในไซต์นี้");
    }
    return { status: order.status, assigneeId: command.assignee.id, note: null };
  }
  if (actor.role !== "admin" && actor.id !== order.assigneeId) {
    throw new Error("ดำเนินการได้เฉพาะผู้รับผิดชอบใบงาน");
  }
  if (command.kind === "note") {
    const text = command.text.trim();
    if (!text || text.length > 4000) throw new Error("ระบุบันทึก 1–4000 ตัวอักษร");
    return { status: order.status, assigneeId: order.assigneeId, note: text };
  }
  const transitions = {
    start: ["waiting", "in_progress"], submit: ["in_progress", "review"],
    approve: ["review", "completed"], return: ["review", "in_progress"],
  } as const;
  const [from, to] = transitions[command.kind];
  if (order.status !== from || !order.assigneeId) throw new Error("ลำดับสถานะใบงานไม่ถูกต้องหรือยังไม่มอบหมาย");
  if ((command.kind === "approve" || command.kind === "return") && actor.role !== "admin") {
    throw new Error("เฉพาะผู้ดูแลระบบตรวจรับงานได้");
  }
  const reason = command.kind === "return" ? command.reason.trim() : null;
  if (reason !== null && (!reason || reason.length > 4000)) throw new Error("ระบุเหตุผลส่งกลับ 1–4000 ตัวอักษร");
  return { status: to, assigneeId: order.assigneeId, note: reason };
}
