import type { WorkOrder } from "./CMMSApp";
import type { ManagedUser } from "./master-data";
import { validateWorkOrderCommand, type WorkflowCommand, type JobStatus } from "./work-order-workflow";
import { instantMillis } from "./work-order-timing";
export type OrderHistoryItem = { id: string; command: string; actorName: string; at: string; note: string | null; version: number };
export const orderStatusToDb = { รอมอบหมาย: "waiting", กำลังดำเนินการ: "in_progress", รอตรวจรับ: "review", เสร็จสิ้น: "completed" } as const;
export const orderStatusFromDb: Record<JobStatus, WorkOrder["status"]> = { waiting: "รอมอบหมาย", in_progress: "กำลังดำเนินการ", review: "รอตรวจรับ", completed: "เสร็จสิ้น" };
export function applyDemoOrderCommand(order: WorkOrder, siteId: string, actor: ManagedUser, expectedVersion: number, command: WorkflowCommand, at: string): WorkOrder {
  if (instantMillis(at) == null) throw new Error("เวลาบันทึกคำสั่งไม่ถูกต้อง");
  const result = validateWorkOrderCommand({ id: order.id, siteId, siteActive: true, status: orderStatusToDb[order.status], version: order.version ?? 1, assigneeId: order.assigneeId ?? null },
    { id: actor.id, role: actor.role, active: actor.active, siteIds: actor.jobsiteIds }, expectedVersion, command);
  const version = (order.version ?? 1) + 1;
  return { ...order, version, assigneeId: result.assigneeId,
    assignedAt: command.kind === "assign" ? at : order.assignedAt,
    startedAt: command.kind === "start" ? at : order.startedAt,
    completedAt: command.kind === "approve" ? at : order.completedAt,
    assignee: command.kind === "assign" ? command.assignee.id : order.assignee,
    status: orderStatusFromDb[result.status], progress: result.status === "completed" ? 100 : order.progress,
    events: [...(order.events ?? []), { id: crypto.randomUUID(), command: command.kind, actorName: actor.displayName, at, note: result.note, version }],
  };
}
