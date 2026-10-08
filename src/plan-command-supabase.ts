import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "./supabase";
import { mapSupabasePlan } from "./maintenance-supabase";
import type { MaintenancePlan } from "./maintenance";
export type PlanCommandState = { id: string; siteId: string; version: number; deleted: boolean; plan: MaintenancePlan | null };
export class PlanCommandError extends Error {
  constructor(public readonly kind: "conflict" | "denied" | "invalid" | "failed", message: string) { super(message); }
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function error(code?: string) {
  const kind = code === "40001" ? "conflict" : code === "42501" ? "denied" : ["22023","23503","23505","22P02"].includes(code ?? "") ? "invalid" : "failed";
  return new PlanCommandError(kind, kind === "conflict" ? "แผนถูกแก้ไขแล้ว กรุณาตรวจฉบับล่าสุด" : kind === "denied" ? "ไม่มีสิทธิ์บันทึกแผนหรือระบบยังไม่เปิดใช้" : kind === "invalid" ? "ตรวจข้อมูลแผนและรอบงาน แผนที่มีรายงานแล้วห้ามลบหรือเปลี่ยนช่วงรอบ" : "ยังยืนยันผลแผนไม่ได้ กรุณาลองคำขอเดิมอีกครั้ง");
}
export function planPayload(p: MaintenancePlan) {
  return { name: p.name, service_type: p.serviceType, plan_year: p.year, annual_target: p.annualTarget, cycle_months: p.cycleMonths, start_month: p.startMonth, status: p.status };
}
function state(data: Record<string, unknown> | null, id: string, site: string, minVersion: number): PlanCommandState {
  if (!data || data.id !== id || data.site_id !== site || !Number.isSafeInteger(data.version) || Number(data.version) < minVersion || typeof data.deleted !== "boolean" || !Array.isArray(data.cycles)) throw error();
  if (data.deleted) { if (data.plan !== null || data.cycles.length) throw error(); return {id,siteId:site,version:Number(data.version),deleted:true,plan:null}; }
  const p = data.plan as Record<string, unknown> | null;
  if (!p || p.id !== id || p.jobsite_id !== site || p.version !== data.version || typeof p.name !== "string" || typeof p.service_type !== "string" ||
    !Number.isSafeInteger(p.annual_target) || Number(p.annual_target)<1 || !Number.isSafeInteger(p.plan_year) || ![1,2,3].includes(Number(p.cycle_months)) ||
    !Number.isInteger(p.start_month) || Number(p.start_month)<1 || Number(p.start_month)>12 || !["draft","active","completed"].includes(String(p.status)) ||
    data.cycles.some(c => !c || typeof c.id !== "string" || c.plan_id !== id || typeof c.label !== "string" || !Number.isSafeInteger(c.target) || c.target<0 || !Number.isSafeInteger(c.sequence) || c.sequence<1 || !Number.isInteger(c.start_month) || c.start_month<1 || c.start_month>12 || !Number.isInteger(c.end_month) || c.end_month<1 || c.end_month>12)) throw error();
  return {id,siteId:site,version:Number(data.version),deleted:false,plan:mapSupabasePlan(p,data.cycles)};
}
export function createPlanCommandRepository(client: Pick<SupabaseClient,"rpc"> | null = supabase) {
  const requireClient = () => { if (!client) throw error(); return client; };
  return {
    async ready(): Promise<boolean> {
      const {data,error:e} = await requireClient().rpc("plan_commands_ready");
      if (["PGRST202","42883"].includes(e?.code ?? "")) return false;
      if (e || typeof data !== "boolean") throw error(e?.code); return data;
    },
    async read(id: string, site: string, minVersion = 1) {
      const {data,error:e} = await requireClient().rpc("read_plan_command_state",{p_plan_id:id,p_site_id:site});
      if (e) throw error(e.code); return state(data,id,site,minVersion);
    },
    async apply(p: MaintenancePlan, version: number, key: string, remove = false) {
      if (!uuid.test(key) || !Number.isSafeInteger(version) || version<0 || (remove && version<1)) throw error("22023");
      const {data,error:e} = await requireClient().rpc("apply_plan_command",{p_plan_id:p.id,p_site_id:p.jobsiteId,p_expected_version:version,p_request_id:key,p_data:remove ? {} : planPayload(p),p_delete:remove});
      if (e) throw error(e.code);
      const confirmed = state(data,p.id,p.jobsiteId,version+1);
      if (confirmed.version!==version+1 || confirmed.deleted!==remove || !Number.isSafeInteger(data.event_no) || data.event_no<1 || typeof data.replayed!=="boolean") throw error();
      return confirmed;
    },
  };
}
export function createPlanOperation(p: MaintenancePlan, isNew: boolean, remove: boolean, repository = createPlanCommandRepository(), assertCurrent = () => {}) {
  const snapshot = structuredClone(p); if (isNew) snapshot.id=`PLAN-${crypto.randomUUID()}`;
  const key=crypto.randomUUID(),version=isNew ? 0 : snapshot.version;
  let ack: PlanCommandState | null=null,busy=false;
  return {id:snapshot.id,async run() {
    assertCurrent(); if (busy || version===undefined || (isNew && remove)) throw error("22023"); if (ack) return ack;
    busy=true;try {ack=await repository.apply(snapshot,version,key,remove);assertCurrent();return ack;}finally{busy=false;}
  }};
}
