import type { UserRole } from "./access";
import { uatScenarios20261004 } from "./uat-catalog-20261004";

export const UAT_VERSION = "2026-10-06";
export const UAT_VERSIONS = ["2026-10-04", UAT_VERSION] as const;
export const resultLabels = { PASS: "ผ่าน", FAIL: "ไม่ผ่าน", BLOCKED: "ทดสอบไม่ได้", NOT_RUN: "ยังไม่ทดสอบ" } as const;
export type UatResult = Exclude<keyof typeof resultLabels, "NOT_RUN">;
export type UatScenario = {
  id: string; title: string; roles: UserRole[]; prerequisite: string;
  steps: string[]; expected: string; onlineOnly?: boolean;
};
const all: UserRole[] = ["admin", "engineer", "user"];
const admin: UserRole[] = ["admin"];
const workers: UserRole[] = ["admin", "engineer"];
const scenario = (id: string, title: string, roles: UserRole[], prerequisite: string, steps: string[], expected: string, onlineOnly = false): UatScenario => ({ id, title, roles, prerequisite, steps, expected, onlineOnly });

// Freeze the earlier catalog/results; new runs use the updated workflow only.
export const uatScenarios: UatScenario[] = [
  ...uatScenarios20261004.map(item => item.id === "ROLE-01" ? { ...item, expected: "ไม่แสดงไซต์นอกสิทธิ์; Engineer เปิดใบงานและ Service Report ได้ ไม่มอบหมายหรือตรวจรับใบงานเอง และไม่มีเมนู Alarm" } : item),
  scenario("WO-05", "มอบหมายและปฏิบัติงาน", workers, "Demo หรือ UAT ที่เปิดขั้นตอนใบงานใหม่; Admin และ Engineer ทดสอบร่วมกัน", ["Admin สร้างใบงานและมอบหมายให้ Engineer ของไซต์", "Engineer เริ่มงาน เพิ่มบันทึกและส่งตรวจรับ", "รีเฟรชแล้วตรวจสถานะ ชื่อผู้ทำและเวลาจริง"], "มีผู้รับผิดชอบและประวัติจริง Engineer ที่ไม่ได้รับมอบหมายทำรายการไม่ได้"),
  scenario("WO-06", "ส่งกลับและตรวจรับใบงาน", admin, "ใบงาน WO-05 รอตรวจรับ", ["ส่งกลับพร้อมเหตุผล แล้วให้ Engineer แก้ไขและส่งใหม่", "Admin ตรวจรับและปิดงาน แล้วรีเฟรช"], "ประวัติส่งกลับยังอยู่ ใบงานปิดแล้วเปลี่ยนสถานะหรือวัสดุไม่ได้; Service Report เป็นการอนุมัติแยก"),
  scenario("MAT-01", "บันทึกวัสดุที่ใช้จริง", workers, "ใบงานกำลังดำเนินการที่ได้รับมอบหมาย", ["บันทึกวัสดุทดสอบ 1.25 ชิ้น", "ลองจำนวน 0 และทศนิยมเกิน 4 ตำแหน่ง", "รีเฟรชตรวจรายการและประวัติ"], "รายการถูกต้องคงอยู่ จำนวนผิดไม่ถูกบันทึก ไม่ใช่ระบบตัดสต็อก"),
  scenario("MAT-02", "แก้รายการวัสดุโดยยกเลิก", workers, "มีวัสดุจาก MAT-01; ใช้ผู้บันทึกเดิมหรือ Admin", ["ระบุเหตุผลแล้วยกเลิกรายการ", "บันทึกรายการใหม่ที่ถูกต้อง", "รีเฟรชตรวจทั้งสองรายการ"], "รายการเดิมและเหตุผลไม่ถูกลบ แยกรายการยกเลิกกับรายการใช้งานได้"),
  scenario("XLS-01", "Excel ตรงกับหน้าจอและตัวกรอง", all, "มีรายงานทดสอบหลายสถานะ; Engineer ส่งออก Service Report รายใบ ส่วน Admin/User ตรวจรายงานสรุป", ["ส่งออก Excel แล้วเปิดไฟล์ ตรวจภาษาไทยและจำนวน", "Admin/User กรองเดือนหรือแผนแล้วส่งออกอีกครั้ง", "เทียบ Actual กับรายการอนุมัติในไฟล์"], "ขอบเขตและตัวเลขตรงหน้าจอ Actual ไม่รวมร่างหรือส่งกลับ ข้อความขึ้นต้น = ยังเป็นข้อความ ไม่ใช่สูตร"),
  scenario("SYNC-02", "ติดตามใบงานข้ามหน้าจอและชนกัน", workers, "UAT แยกพร้อมสองบัญชีจริง ขั้นตอนใบงานใหม่และ Realtime เปิดแล้ว", ["เครื่อง A เปิดรายละเอียดและเริ่มกรอกบันทึก", "เครื่อง B แก้ใบงานเดียวกัน แล้วตรวจ A โดยไม่รีเฟรช", "A ลองบันทึกจากรุ่นเดิมและโหลดข้อมูลล่าสุด"], "A เห็นการเปลี่ยนแปลงหรือโหมดเชื่อมต่อขัดข้อง ระบบปฏิเสธรุ่นเก่า และไม่ล้างข้อความที่กำลังกรอก", true),
];

export function scenarioCatalog(version: string): UatScenario[] {
  if (version === "2026-10-04") return uatScenarios20261004;
  if (version === UAT_VERSION) return uatScenarios;
  throw new Error("ไม่รองรับชุดทดสอบรุ่นนี้");
}

export type UatScope = { userId: string; role: UserRole; siteId: string; mode: "demo" | "supabase" };
export type UatObservation = { id: string; scenarioId: string; result: UatResult; actual: string; evidence: string; at: string };
export type UatRun = { id: string; scenarioVersion: string; tester: string; release: string; createdAt: string; scope: UatScope; observations: UatObservation[] };
export type UatArchive = { schema: 1; runs: UatRun[] };
export function uatStorageKey(scope: UatScope) {
  return `thaicon-uat-v1:${[scope.mode, scope.userId, scope.role, scope.siteId].map(encodeURIComponent).join(":")}`;
}
export function scenariosFor(role: UserRole, version = UAT_VERSION) { return scenarioCatalog(version).filter(item => item.roles.includes(role)); }
export function latestObservation(run: UatRun, id: string) { return run.observations.filter(item => item.scenarioId === id).at(-1); }
export function summarizeRun(run: UatRun) {
  const counts = { PASS: 0, FAIL: 0, BLOCKED: 0, NOT_RUN: 0 };
  for (const item of scenariosFor(run.scope.role, run.scenarioVersion)) counts[latestObservation(run, item.id)?.result ?? "NOT_RUN"]++;
  return counts;
}
export function recordObservation(run: UatRun, observation: UatObservation): UatRun {
  if (!scenariosFor(run.scope.role, run.scenarioVersion).some(item => item.id === observation.scenarioId)) throw new Error("เคสนี้ไม่อยู่ในชุดทดสอบของบทบาทนี้");
  if (!(observation.result in resultLabels) || observation.result === ("NOT_RUN" as string) || !observation.actual.trim()) throw new Error("ระบุผลที่เกิดขึ้นจริงก่อนบันทึก");
  if (run.scope.mode === "demo" && scenarioCatalog(run.scenarioVersion).find(item => item.id === observation.scenarioId)?.onlineOnly && observation.result !== "BLOCKED") throw new Error("เคสนี้ต้องใช้ UAT ออนไลน์แยก เลือกทดสอบไม่ได้ในโหมด Demo");
  return { ...run, observations: [...run.observations, observation] };
}
const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const isText = (value: unknown): value is string => typeof value === "string";
const isDate = (value: unknown) => isText(value) && Number.isFinite(Date.parse(value));
export function parseArchive(raw: string | null, scope: UatScope): UatArchive {
  if (raw === null) return { schema: 1, runs: [] };
  const value: unknown = JSON.parse(raw);
  if (!isObject(value) || value.schema !== 1 || !Array.isArray(value.runs)) throw new Error("รูปแบบผลทดสอบไม่ถูกต้อง");
  const runIds = new Set<string>();
  for (const run of value.runs) {
    if (!isObject(run) || !isText(run.id) || runIds.has(run.id) || !UAT_VERSIONS.includes(run.scenarioVersion as typeof UAT_VERSIONS[number]) || !isText(run.tester) || !isText(run.release) || !isDate(run.createdAt) || !isObject(run.scope) || !Array.isArray(run.observations)) throw new Error("ข้อมูลรอบทดสอบไม่ถูกต้องหรือเป็นคนละรุ่น");
    runIds.add(run.id);
    if (Object.entries(scope).some(([key, expected]) => (run.scope as Record<string, unknown>)[key] !== expected)) throw new Error("ผลทดสอบไม่ตรงกับบัญชี ไซต์ หรือโหมดนี้");
    const observationIds = new Set<string>();
    for (const item of run.observations) {
      if (!isObject(item) || !isText(item.id) || observationIds.has(item.id) || !isText(item.scenarioId) || !scenariosFor(scope.role, String(run.scenarioVersion)).some(s => s.id === item.scenarioId) || !["PASS", "FAIL", "BLOCKED"].includes(String(item.result)) || !isText(item.actual) || !item.actual.trim() || !isText(item.evidence) || !isDate(item.at)) throw new Error("ข้อมูลผลทดสอบไม่ถูกต้อง");
      if (scope.mode === "demo" && scenarioCatalog(String(run.scenarioVersion)).find(s => s.id === item.scenarioId)?.onlineOnly && item.result !== "BLOCKED") throw new Error("ผลทดสอบออนไลน์ไม่สามารถยืนยันจาก Demo");
      observationIds.add(item.id);
    }
  }
  return value as UatArchive;
}
