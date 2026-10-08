import { useEffect, useRef, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { readScopedLiveSnapshot, LiveSnapshotError, type LiveScope, type LiveKind, type RawLiveSnapshot } from "./live-snapshot-supabase";
import { watchMaintenanceUpdates, watchAlarmUpdates } from "./maintenance-updates";
import type { UpdateConnection } from "./scoped-updates";
export function useSiteLiveUpdates<T>(client: SupabaseClient|null, enabled:boolean, kind:LiveKind,
  scope:LiveScope, prepare:(snapshot:RawLiveSnapshot)=>Promise<T>, apply:(result:T)=>void) {
  const callbacks=useRef({prepare,apply});callbacks.current={prepare,apply};
  const generation=useRef(0);
  const [attempt,setAttempt]=useState(0);
  const [deniedKey,setDeniedKey]=useState("");
  const [status,setStatus]=useState<{ready:boolean;connection:UpdateConnection;error:"denied"|"disabled"|"failed"|null}>({
    ready:false,connection:"connecting",error:null,
  });
  const key=`${scope.userId}:${scope.role}:${scope.siteId}`;
  const scopeNow=useRef({key,enabled});scopeNow.current={key,enabled};
  const [verifiedKey,setVerifiedKey]=useState("");
  useEffect(()=>{
    const mine=++generation.current;
    if(!client || !enabled) return;
    let stopped=false;
    const guard=()=>{if(stopped || mine!==generation.current || scopeNow.current.key!==key || !scopeNow.current.enabled)throw new Error("Live scope changed");};
    setVerifiedKey("");
    setStatus({ready:false,connection:"connecting",error:null});
    const refresh=async()=>{
      try {
        const result=await readScopedLiveSnapshot(client,scope,kind,s=>callbacks.current.prepare(s),guard);
        guard();callbacks.current.apply(result);setVerifiedKey(key);setDeniedKey("");
        setStatus(s=>({...s,ready:true,error:null}));
      } catch(error) {
        if(!stopped && mine===generation.current && error instanceof LiveSnapshotError && error.kind==="denied")setDeniedKey(key);
        if(!stopped && mine===generation.current) setStatus(s=>({...s,ready:false,
          error:error instanceof LiveSnapshotError ? error.kind : "failed"}));
        throw error;
      }
    };
    const stop=(kind==="maintenance"?watchMaintenanceUpdates:watchAlarmUpdates)(client,scope.siteId,scope.userId,{
      refresh,connection:connection=>{if(!stopped)setStatus(s=>({...s,connection}));},
      failure:()=>{ /* Read failure is distinct from channel connectivity. */ },
    });
    return ()=>{stopped=true;generation.current++;stop();};
    // Callback changes on same-scope renders must not unsubscribe or reset
    // pending operations; scope/key/gate changes do invalidate in-flight reads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[client,enabled,kind,key,attempt]);
  return {...status,enabled,denied:deniedKey===key,blocked:enabled&&(!status.ready || verifiedKey!==key),retry:()=>setAttempt(a=>a+1)};
}
