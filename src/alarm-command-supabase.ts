import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "./supabase";
import { mapSupabaseAlarm, type AlarmRow } from "./operations-supabase";
export class AlarmCommandError extends Error {
  constructor(public readonly kind:"denied"|"invalid"|"failed",message:string){super(message);}
}
function failure(code?:string){
 return new AlarmCommandError(code==="42501"?"denied":code==="22023"?"invalid":"failed",code==="42501"?"ไม่มีสิทธิ์รับทราบ Alarm หรือระบบยังไม่พร้อม":code==="22023"?"ไม่พบ Alarm หรือคำขอไม่ตรง กรุณาตรวจรายการล่าสุด":"ยังยืนยันการรับทราบไม่ได้ กรุณาลองคำขอเดิมอีกครั้ง");
}
function confirmed(row:AlarmRow | null,id:string,site:string,min=1,legacy=false) {
 if(!row||row.id!==id||row.jobsite_id!==site||(!(legacy&&row.version===undefined)&&(!Number.isSafeInteger(row.version)||Number(row.version)<min))||row.acknowledged!==true||typeof row.acknowledged_by!=="string"||typeof row.acknowledged_at!=="string"||!Number.isFinite(Date.parse(row.acknowledged_at)))throw failure();
 return mapSupabaseAlarm(row,new Map());
}
export function createAlarmCommandRepository(client:Pick<SupabaseClient,"rpc"|"from">|null=supabase){
 const get=()=>{if(!client)throw failure();return client;};
 return {
  async ready(){const {data,error}=await get().rpc("alarm_commands_ready");if(["PGRST202","42883"].includes(error?.code??""))return false;if(error||typeof data!=="boolean")throw failure(error?.code);return data;},
  async acknowledge(id:string,site:string,key:string){
   if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(key))throw failure("22023");
   const {data,error}=await get().rpc("acknowledge_alarm_command",{p_alarm_id:id,p_site_id:site,p_request_id:key});if(error)throw failure(error.code);
   if(!data||!Number.isSafeInteger(data.event_no)||data.event_no<1||typeof data.replayed!=="boolean"||typeof data.changed!=="boolean")throw failure();
   return confirmed(data.alarm,id,site);
  },
  async legacyAcknowledge(id:string,site:string){
   const {data,error}=await get().from("alarms").update({acknowledged:true}).eq("id",id).eq("jobsite_id",site).select("*").single();if(error)throw failure(error.code);return confirmed(data,id,site,1,true);
  },
  async read(id:string,site:string,min:number,legacy=false){
   const {data,error}=await get().from("alarms").select("*").eq("id",id).eq("jobsite_id",site).single();if(error)throw failure(error.code);return confirmed(data,id,site,min,legacy);
  },
 };
}
export function createAlarmAcknowledgeOperation(id:string,site:string,repository=createAlarmCommandRepository(),assertCurrent=()=>{},legacy=false){
 const key=crypto.randomUUID();let ack:Awaited<ReturnType<typeof repository.acknowledge>>|null=null,busy=false;
 return {async run(){assertCurrent();if(busy)throw failure();busy=true;try{ack??=await (legacy?repository.legacyAcknowledge(id,site):repository.acknowledge(id,site,key));assertCurrent();const latest=await repository.read(id,site,ack.version??1,legacy);assertCurrent();return latest;}finally{busy=false;}}};
}
