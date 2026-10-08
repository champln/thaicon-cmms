import type { OperationsState } from "./operations-supabase";

export const DEMO_OPERATIONS_KEY = "thaicon-cmms-demo-operations-v1";
type Store = Pick<Storage, "getItem" | "setItem">;
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const timestamp = (value: unknown) => typeof value === "string" && Number.isFinite(Date.parse(value));
const texts = (row: Record<string, unknown>, names: string[]) => names.every(name => typeof row[name] === "string");
function validEvidence(row: Record<string, unknown>) {
  if (row.createdAt !== undefined && !timestamp(row.createdAt)) return false;
  if (row.version !== undefined && (!Number.isSafeInteger(row.version) || Number(row.version)<1)) return false;
  if (row.assigneeId !== undefined && row.assigneeId !== null && typeof row.assigneeId !== "string") return false;
  if (row.description !== undefined && typeof row.description !== "string") return false;
  if (row.events !== undefined && (!Array.isArray(row.events) || !row.events.every(event => object(event) && texts(event,["id","command","actorName"]) && timestamp(event.at) && (event.note===null || typeof event.note==="string") && Number.isSafeInteger(event.version) && Number(event.version)>0))) return false;
  if (row.materials !== undefined && (!Array.isArray(row.materials) || !row.materials.every(item => object(item) && texts(item,["id","name","unit","recordedBy"]) && timestamp(item.recordedAt) && typeof item.quantity === "number" && Number.isFinite(item.quantity) && item.quantity>0 &&
    ((item.voidedBy===null && item.voidedAt===null && item.voidReason===null) || (typeof item.voidedBy==="string" && timestamp(item.voidedAt) && typeof item.voidReason==="string" && !!item.voidReason.trim()))))) return false;
  return true;
}

function validRecords(value: unknown, kind: "workOrders" | "alerts") {
  if (!Array.isArray(value)) return false;
  const fields = kind === "workOrders"
    ? ["id", "type", "title", "assetId", "assetName", "site", "priority", "status", "assignee", "due", "created"]
    : ["id", "level", "title", "detail", "assetId", "site", "time", "value"];
  return value.every((item: unknown) => {
    if (!item || typeof item !== "object") return false;
    const row = item as Record<string, unknown>;
    if (row.jobsiteId !== undefined && (typeof row.jobsiteId !== "string" || !row.jobsiteId.trim())) return false;
    if (kind==="alerts" && ((row.version!==undefined && (!Number.isSafeInteger(row.version)||Number(row.version)<1)) ||
      (row.acknowledgedBy!==undefined && typeof row.acknowledgedBy!=="string") ||
      (row.acknowledgedAt!==undefined && !timestamp(row.acknowledgedAt)))) return false;
    return fields.every((field) => typeof row[field] === "string") && (kind === "workOrders"
      ? typeof row.progress === "number" && Number.isFinite(row.progress) && row.progress >= 0 && row.progress <= 100
        && ["PM", "CM", "EM"].includes(String(row.type))
        && ["รอมอบหมาย", "กำลังดำเนินการ", "รอตรวจรับ", "เสร็จสิ้น"].includes(String(row.status))
        && ["วิกฤต", "สูง", "ปกติ", "ต่ำ"].includes(String(row.priority)) && validEvidence(row)
      : typeof row.acknowledged === "boolean" && ["critical", "warning", "info"].includes(String(row.level)));
  });
}

export function loadDemoOperations(fallback: OperationsState, store?: Store): OperationsState {
  try {
    const storage = store ?? (typeof window !== "undefined" ? window.localStorage : undefined);
    const raw = storage?.getItem(DEMO_OPERATIONS_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<OperationsState> | null;
    if (parsed && validRecords(parsed.workOrders, "workOrders") && validRecords(parsed.alerts, "alerts")) return parsed as OperationsState;
  } catch { /* Unavailable/corrupt storage must not prevent Demo login. */ }
  return fallback;
}

export function saveDemoOperations(state: OperationsState, store?: Store): boolean {
  try {
    const storage = store ?? (typeof window !== "undefined" ? window.localStorage : undefined);
    if (!storage) return false;
    // Never let automatic initialization overwrite malformed historical data.
    const existing = storage.getItem(DEMO_OPERATIONS_KEY);
    if (existing !== null) {
      const parsed: unknown = JSON.parse(existing);
      if (!object(parsed) || !validRecords(parsed.workOrders,"workOrders") || !validRecords(parsed.alerts,"alerts")) return false;
    }
    if (!validRecords(state.workOrders,"workOrders") || !validRecords(state.alerts,"alerts")) return false;
    storage.setItem(DEMO_OPERATIONS_KEY, JSON.stringify(state));
    return true;
  } catch { return false; }
}
