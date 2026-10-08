import { afterEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { watchMaintenanceUpdates, watchAlarmUpdates } from "./maintenance-updates";
import { watchScopedUpdates } from "./scoped-updates";
function setup(kind: "maintenance" | "alarms", refresh = vi.fn().mockResolvedValue(undefined)) {
  vi.useFakeTimers();
  const events: Array<() => void> = [];
  let status: (s: string) => void = () => {};
  let system: (p: { extension: string; status: string }) => void = () => {};
  const channel = { on: vi.fn(), subscribe: vi.fn() };
  channel.on.mockImplementation((k, _f, cb) => { if (k === "system") system = cb; else events.push(cb); return channel; });
  channel.subscribe.mockImplementation(cb => { status = cb; return channel; });
  const client = { channel: vi.fn().mockReturnValue(channel), removeChannel: vi.fn().mockResolvedValue("ok") };
  const callbacks = { refresh, connection: vi.fn(), failure: vi.fn() };
  const stop = (kind === "maintenance" ? watchMaintenanceUpdates : watchAlarmUpdates)(
    client as unknown as Pick<SupabaseClient,"channel"|"removeChannel">, "SITE-001", "reader", callbacks);
  return { events, channel, client, callbacks, stop, status: (s: string) => status(s),
    system: (s: string) => system({ extension: "postgres_changes", status: s }) };
}
afterEach(() => vi.useRealTimers());
describe("scoped maintenance and Alarm invalidation", () => {
  it.each(["maintenance", "alarms"] as const)("scopes %s subscriptions without global children or DELETE", async kind => {
    const t = setup(kind);
    const filters = t.channel.on.mock.calls.filter(([k]) => k === "postgres_changes").map(([, f]) => f);
    expect(filters.every(f => f.schema === "public" && f.filter === "jobsite_id=eq.SITE-001" && f.event !== "DELETE")).toBe(true);
    expect(filters.some(f => ["plan_cycles", "service_report_attachments"].includes(f.table))).toBe(false);
    expect(filters.map(f => f.table)).toContain(kind === "maintenance" ? "plan_events" : "alarm_events");
    t.events.forEach(cb => cb()); await vi.advanceTimersByTimeAsync(250);
    expect(t.callbacks.refresh).toHaveBeenCalledTimes(1); t.stop();
  });
  it("does not call SUBSCRIBED ready; catches up again at Postgres readiness", async () => {
    const t = setup("maintenance"); t.status("SUBSCRIBED");
    expect(t.callbacks.connection).toHaveBeenLastCalledWith("connecting");
    await vi.advanceTimersByTimeAsync(250); t.system("ok"); await vi.advanceTimersByTimeAsync(250);
    expect(t.callbacks.refresh).toHaveBeenCalledTimes(2);
    expect(t.callbacks.connection).toHaveBeenLastCalledWith("connected"); t.stop();
  });
  it("serializes in-flight reads and coalesces events arriving during them", async () => {
    let resolve = () => {};
    const refresh = vi.fn().mockImplementationOnce(() => new Promise<void>(r => { resolve = r; })).mockResolvedValue(undefined);
    const t = setup("maintenance", refresh);
    t.events[0](); await vi.advanceTimersByTimeAsync(250);
    t.events.forEach(cb => cb()); await vi.advanceTimersByTimeAsync(250);
    expect(refresh).toHaveBeenCalledTimes(1); resolve(); await vi.advanceTimersByTimeAsync(250);
    expect(refresh).toHaveBeenCalledTimes(2); t.stop();
  });
  it("polls through disconnection/read errors and resumes after reconnect", async () => {
    const t = setup("alarms", vi.fn().mockRejectedValueOnce(new Error("503")).mockResolvedValue(undefined));
    t.status("CHANNEL_ERROR"); await vi.advanceTimersByTimeAsync(30250);
    expect(t.callbacks.failure).toHaveBeenCalledTimes(1);
    t.status("SUBSCRIBED"); t.system("ok"); await vi.advanceTimersByTimeAsync(250);
    expect(t.callbacks.refresh).toHaveBeenCalledTimes(2); t.stop();
  });
  it("ignores late callbacks and in-flight failure after leaving a scope", async () => {
    let reject: (e: Error) => void = () => {};
    const t = setup("maintenance", vi.fn(() => new Promise<void>((_r, fail) => { reject = fail; })));
    t.events[0](); await vi.advanceTimersByTimeAsync(250); t.stop();
    t.callbacks.connection.mockClear(); t.events[0](); t.status("SUBSCRIBED"); t.system("ok");
    reject(new Error("late")); await vi.advanceTimersByTimeAsync(60000);
    expect(t.callbacks.refresh).toHaveBeenCalledTimes(1);
    expect(t.callbacks.failure).not.toHaveBeenCalled();
    expect(t.callbacks.connection).not.toHaveBeenCalled();
    expect(t.client.removeChannel).toHaveBeenCalledWith(t.channel);
  });
  it("fails a channel with no Postgres readiness after ten seconds", async () => {
    const t = setup("maintenance"); t.status("SUBSCRIBED"); await vi.advanceTimersByTimeAsync(10000);
    expect(t.callbacks.connection).toHaveBeenLastCalledWith("degraded"); t.stop();
  });
  it("rejects malformed filters before creating a channel", () => {
    const client = { channel: vi.fn(), removeChannel: vi.fn() };
    const cb = { refresh: vi.fn(), connection: vi.fn(), failure: vi.fn() };
    expect(() => watchScopedUpdates(client as unknown as SupabaseClient, "test", "SITE,OTHER", "user",
      [{table:"plans",event:"INSERT"}], cb)).toThrow();
    expect(client.channel).not.toHaveBeenCalled();
  });
});
