import type { WorkOrder } from "./CMMSApp";

export function validCalendarDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  if (year < 1000 || month < 1 || month > 12 || day < 1) return false;
  return new Date(Date.UTC(year, month - 1, day)).toISOString().slice(0, 10) === value;
}

/** Only explicit instants, never display labels or browser-local date parsing. */
export function instantMillis(value: string | null | undefined): number | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) || !validCalendarDate(value.slice(0, 10))) return null;
  const time = Date.parse(value);
  const hour = Number(value.slice(11, 13)), minute = Number(value.slice(14, 16)), second = Number(value.slice(17, 19));
  return Number.isFinite(time) && hour <= 23 && minute <= 59 && second <= 59 ? time : null;
}

export function bangkokDate(value: string | null | undefined): string | null {
  const time = instantMillis(value);
  if (time == null) return null;
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(time));
  return ["year", "month", "day"].map(type => parts.find(part => part.type === type)?.value).join("-");
}

/** datetime-local input is explicitly labelled Bangkok, independent of browser TZ. */
export function bangkokInputToInstant(value: string): string | null {
  if (!value) return null;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value) || !validCalendarDate(value.slice(0, 10)) || Number(value.slice(11, 13)) > 23 || Number(value.slice(14, 16)) > 59) throw new Error("วันและเวลากำหนดเสร็จไม่ถูกต้อง");
  return new Date(value + ":00+07:00").toISOString();
}

function elapsedMinutes(start: string | null | undefined, end: string | null | undefined) {
  const from = instantMillis(start), to = instantMillis(end);
  return from == null || to == null || to < from ? null : (to - from) / 60_000;
}

export function orderTiming(order: WorkOrder, now: string) {
  const nowMs = instantMillis(now);
  if (nowMs == null) throw new Error("ไม่ทราบเวลาประเมินรายงาน");
  const due = instantMillis(order.dueAt);
  const completed = order.status === "เสร็จสิ้น";
  return {
    dueDate: bangkokDate(order.dueAt),
    unknownDue: due == null,
    dueToday: !completed && due != null && bangkokDate(order.dueAt) === bangkokDate(now),
    overdue: !completed && due != null && due < nowMs,
    // Completion requires its actual timestamp; never infer it from status/progress.
    executionMinutes: elapsedMinutes(order.startedAt, completed ? order.completedAt : now),
    ageMinutes: elapsedMinutes(order.createdAt, completed ? order.completedAt : now),
  };
}
