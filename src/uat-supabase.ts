import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "./supabase";
import { UAT_VERSION, UAT_VERSIONS, scenariosFor } from "./uat";
import type { UatObservation, UatRun, UatScope } from "./uat";

type Client = Pick<SupabaseClient, "auth" | "from" | "rpc">;
type Row = Record<string, unknown>;
export type OnlineUatObservation = UatObservation & { clientAt: string; recordedBy: string; eventNo: number };
export type OnlineUatRun = Omit<UatRun, "observations"> & { observations: OnlineUatObservation[] };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PAGE_SIZE = 200;
const runColumns = "id,jobsite_id,owner_id,tester_role,scenario_version,tester_name,release_label,created_at";
const observationColumns = "id,run_id,event_no,scenario_id,result,actual,evidence,client_at,recorded_at,recorded_by";
function row(value: unknown): Row {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("รูปแบบข้อมูล UAT จากเซิร์ฟเวอร์ไม่ถูกต้อง");
  return value as Row;
}
function text(value: unknown): string {
  if (typeof value !== "string") throw new Error("ข้อมูล UAT ไม่ครบถ้วน");
  return value;
}
function date(value: unknown): string {
  const result = text(value);
  if (!Number.isFinite(Date.parse(result))) throw new Error("เวลา UAT ไม่ถูกต้อง");
  return result;
}
function validText(value: string, maximum: number) { return value.trim().length > 0 && value.length <= maximum; }
function assertUuid(value: string) { if (!UUID.test(value)) throw new Error("รหัส UAT ต้องเป็น UUID"); }
function mapRun(value: unknown, scope: UatScope): OnlineUatRun {
  const data = row(value);
  if (data.owner_id !== scope.userId || data.jobsite_id !== scope.siteId || data.tester_role !== scope.role || !UAT_VERSIONS.includes(data.scenario_version as typeof UAT_VERSIONS[number])) throw new Error("ผล UAT ไม่ตรงกับบัญชี ไซต์ บทบาท หรือรุ่นที่ร้องขอ");
  const id = text(data.id); assertUuid(id);
  return { id, scenarioVersion: text(data.scenario_version), scope: { ...scope }, tester: text(data.tester_name), release: text(data.release_label), createdAt: date(data.created_at), observations: [] };
}
function mapObservation(value: unknown, run: OnlineUatRun): OnlineUatObservation {
  const data = row(value);
  if (data.run_id !== run.id || data.recorded_by !== run.scope.userId || !scenariosFor(run.scope.role, run.scenarioVersion).some(item => item.id === data.scenario_id) || !["PASS","FAIL","BLOCKED"].includes(String(data.result)) || !Number.isSafeInteger(data.event_no) || Number(data.event_no) < 1) throw new Error("ผล UAT หรือเจ้าของรายการไม่ถูกต้อง");
  const id = text(data.id); assertUuid(id);
  return { id, scenarioId: text(data.scenario_id), result: data.result as UatObservation["result"], actual: text(data.actual), evidence: text(data.evidence), at: date(data.recorded_at), clientAt: date(data.client_at), recordedBy: text(data.recorded_by), eventNo: Number(data.event_no) };
}

// Gate-controlled central recorder. No automatic archive uploads.
// Caller must retain generated IDs for retries after a timeout; never regenerate them.
export function createUatRepository(client: Client | null = supabase) {
  async function available(scope: UatScope) {
    if (scope.mode !== "supabase") return false;
    if (!client) throw new Error("ยังไม่ได้ตั้งค่า Supabase UAT");
    assertUuid(scope.userId);
    const identity = await client.auth.getUser();
    if (identity.error || identity.data.user?.id !== scope.userId) throw new Error("บัญชีเปลี่ยนหรือหมดอายุ กรุณาเข้าสู่ระบบใหม่");
    const gate = await client.rpc("uat_results_ready");
    if (gate.error?.code === "PGRST202" || gate.error?.code === "42883") return false;
    if (gate.error) throw new Error("ตรวจฐาน UAT ไม่สำเร็จ กรุณาลองใหม่");
    return gate.data === true;
  }
  async function ready(scope: UatScope) {
    if (scope.mode !== "supabase") throw new Error("ห้ามส่งผล Demo เข้าฐาน UAT ออนไลน์");
    if (!client) throw new Error("ยังไม่ได้ตั้งค่า Supabase UAT");
    assertUuid(scope.userId);
    const { data, error } = await client.auth.getUser();
    if (error) throw error;
    if (data.user?.id !== scope.userId) throw new Error("บัญชีเปลี่ยนแล้ว กรุณาเปิด UAT ใหม่");
    const gate = await client.rpc("uat_results_ready");
    if (gate.error) throw gate.error;
    if (gate.data !== true) throw new Error("ฐานนี้ยังไม่เปิด UAT หรือบัญชีถูกระงับ");
    return client;
  }
  async function insertOnce(db: Client, table: string, columns: string, payload: Row) {
    const inserted = await db.from(table).insert(payload).select(columns).single();
    if (!inserted.error) return row(inserted.data);
    if (inserted.error.code !== "23505") throw inserted.error;
    // Read through RLS: a duplicate ID is success only for the same visible payload.
    const existing = await db.from(table).select(columns).eq("id", payload.id).single();
    if (existing.error) throw existing.error;
    const found = row(existing.data);
    const equal = Object.entries(payload).every(([key, value]) => key === "client_at"
      ? Date.parse(String(found[key])) === Date.parse(String(value))
      : found[key] === value);
    if (!equal) throw new Error("รหัสคำขอนี้ถูกใช้กับข้อมูลอื่นแล้ว ห้ามเขียนทับผลเดิม");
    return found;
  }
  return {
    available,
    async createRun(scope: UatScope, input: { id: string; tester: string; release: string }): Promise<OnlineUatRun> {
      assertUuid(input.id);
      if (!validText(input.tester, 120) || !validText(input.release, 120)) throw new Error("ระบุผู้ทดสอบและรุ่นระบบไม่เกิน 120 ตัวอักษร");
      const db = await ready(scope);
      const value = await insertOnce(db, "uat_runs", runColumns, { id: input.id, jobsite_id: scope.siteId, scenario_version: UAT_VERSION, tester_name: input.tester.trim(), release_label: input.release.trim() });
      return mapRun(value, scope);
    },
    async appendObservation(scope: UatScope, runId: string, input: UatObservation): Promise<OnlineUatObservation> {
      assertUuid(runId); assertUuid(input.id);
      if (!scenariosFor(scope.role).some(item => item.id === input.scenarioId) || !["PASS","FAIL","BLOCKED"].includes(input.result) || !validText(input.actual, 4000) || input.evidence.length > 500) throw new Error("เคส ผล หรือรายละเอียด UAT ไม่ถูกต้อง");
      date(input.at);
      const db = await ready(scope);
      const parent = await db.from("uat_runs").select(runColumns).eq("id", runId).single();
      if (parent.error) throw parent.error;
      const run = mapRun(parent.data, scope);
      if (!scenariosFor(scope.role, run.scenarioVersion).some(item => item.id === input.scenarioId)) throw new Error("เคสนี้ไม่อยู่ในรุ่นของรอบทดสอบ");
      const value = await insertOnce(db, "uat_observations", observationColumns, { id: input.id, run_id: runId, scenario_id: input.scenarioId, result: input.result, actual: input.actual.trim(), evidence: input.evidence.trim(), client_at: input.at });
      return mapObservation(value, run);
    },
    async loadOwnRuns(scope: UatScope): Promise<OnlineUatRun[]> {
      const db = await ready(scope);
      const runs: OnlineUatRun[] = [];
      // Explicit pagination prevents PostgREST's row cap silently dropping history.
      for (let offset = 0; ;) {
        const response = await db.from("uat_runs").select(runColumns).eq("owner_id", scope.userId).eq("jobsite_id", scope.siteId).eq("tester_role", scope.role).order("created_at").order("id").range(offset, offset + PAGE_SIZE - 1);
        if (response.error) throw response.error;
        if (!Array.isArray(response.data)) throw new Error("โหลดรายการรอบ UAT ไม่สำเร็จ");
        runs.push(...response.data.map(value => mapRun(value, scope)));
        if (response.data.length === 0) break;
        offset += response.data.length;
      }
      for (const run of runs) {
        for (let offset = 0; ;) {
          const response = await db.from("uat_observations").select(observationColumns).eq("run_id", run.id).order("event_no").range(offset, offset + PAGE_SIZE - 1);
          if (response.error) throw response.error;
          if (!Array.isArray(response.data)) throw new Error("โหลดประวัติ UAT ไม่สำเร็จ");
          run.observations.push(...response.data.map(value => mapObservation(value, run)));
          if (response.data.length === 0) break;
          offset += response.data.length;
        }
      }
      return runs;
    },
  };
}
