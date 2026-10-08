import type { SupabaseClient } from "@supabase/supabase-js";
export type UpdateConnection = "connecting" | "connected" | "degraded";
export type UpdateSource = { table: string; event: "INSERT" | "UPDATE" };
export type UpdateCallbacks = {
  refresh: () => Promise<void>;
  connection: (status: UpdateConnection) => void;
  failure: () => void;
};

/** Payloads only invalidate. Readers must recheck identity, scope and versions,
 * including after signing photos. No global DELETE/parentless child streams.
 */
export function watchScopedUpdates(client: Pick<SupabaseClient, "channel" | "removeChannel">,
  name: string, siteId: string, userId: string, sources: readonly UpdateSource[], callbacks: UpdateCallbacks) {
  if (!/^[a-z0-9_-]+$/i.test(siteId) || !/^[a-z0-9_-]+$/i.test(name) ||
    !sources.length || sources.some(s => !/^[a-z0-9_]+$/i.test(s.table) || !["INSERT", "UPDATE"].includes(s.event)))
    throw new Error("Invalid scoped subscription");
  let stopped = false, running = false, dirty = false, postgresReady = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let readinessTimer: ReturnType<typeof setTimeout> | undefined;
  async function flush() {
    timer = undefined;
    if (stopped) return;
    if (running) { dirty = true; return; }
    running = true;
    try { await callbacks.refresh(); }
    catch { if (!stopped) callbacks.failure(); }
    finally {
      running = false;
      if (dirty && !stopped) { dirty = false; schedule(); }
    }
  }
  function schedule() {
    if (stopped || timer !== undefined) return;
    timer = setTimeout(() => { void flush(); }, 250);
  }
  callbacks.connection("connecting");
  let channel = client.channel(`${name}:${userId}:${siteId}`);
  for (const source of sources) channel = channel.on("postgres_changes",
    { event: source.event, schema: "public", table: source.table, filter: `jobsite_id=eq.${siteId}` }, schedule);
  channel.on("system", {}, payload => {
    if (stopped || payload.extension !== "postgres_changes") return;
    if (readinessTimer !== undefined) clearTimeout(readinessTimer);
    postgresReady = payload.status === "ok";
    callbacks.connection(postgresReady ? "connected" : "degraded");
    if (postgresReady) schedule();
  }).subscribe(status => {
    if (stopped) return;
    if (readinessTimer !== undefined) clearTimeout(readinessTimer);
    if (status !== "SUBSCRIBED") postgresReady = false;
    callbacks.connection(status === "SUBSCRIBED" ? postgresReady ? "connected" : "connecting" : "degraded");
    if (status === "SUBSCRIBED") {
      schedule();
      if (!postgresReady) readinessTimer = setTimeout(() => {
        if (!stopped) callbacks.connection("degraded");
      }, 10000);
    }
  });
  const poll = setInterval(schedule, 30000);
  const visible=()=>{if(typeof document!=="undefined" && document.visibilityState==="visible")schedule();};
  if(typeof window!=="undefined"){window.addEventListener("focus",schedule);window.addEventListener("online",schedule);}
  if(typeof document!=="undefined")document.addEventListener("visibilitychange",visible);
  return () => {
    stopped = true;
    if (timer !== undefined) clearTimeout(timer);
    if (readinessTimer !== undefined) clearTimeout(readinessTimer);
    clearInterval(poll);
    if(typeof window!=="undefined"){window.removeEventListener("focus",schedule);window.removeEventListener("online",schedule);}
    if(typeof document!=="undefined")document.removeEventListener("visibilitychange",visible);
    void client.removeChannel(channel).catch(() => { /* Already stopped. */ });
  };
}
