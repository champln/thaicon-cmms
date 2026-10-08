import { afterEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { watchWorkOrderUpdates } from "./work-order-updates";
function setup(refresh = vi.fn().mockResolvedValue(undefined)) {
  vi.useFakeTimers();
  const events: Array<() => void> = [];
  let status: (state: string) => void = () => {};
  let system: (payload: { extension: string; status: string }) => void = () => {};
  const channel = { on: vi.fn(), subscribe: vi.fn() };
  channel.on.mockImplementation((kind, _filter, callback) => { if (kind === "system") system = callback; else events.push(callback); return channel; });
  channel.subscribe.mockImplementation(callback => { status = callback; return channel; });
  const removeChannel = vi.fn().mockResolvedValue("ok");
  const client = { channel: vi.fn().mockReturnValue(channel), removeChannel };
  const callbacks = { refresh, connection: vi.fn(), failure: vi.fn() };
  const stop = watchWorkOrderUpdates(client as unknown as Pick<SupabaseClient, "channel" | "removeChannel">, "SITE-001", "tester", callbacks);
  return { channel, events, status: (state: string) => status(state), system: (status: string) => system({ extension: "postgres_changes", status }), callbacks, stop, removeChannel };
}
afterEach(() => vi.useRealTimers());
describe("work-order update invalidation", () => {
  it("scopes every subscription and coalesces a burst into one authoritative read", async () => {
    const t = setup();
    expect(t.channel.on.mock.calls.filter(([kind]) => kind === "postgres_changes").every(([, filter]) => filter.filter === "jobsite_id=eq.SITE-001")).toBe(true);
    t.events.forEach(event => event());
    await vi.advanceTimersByTimeAsync(250);
    expect(t.callbacks.refresh).toHaveBeenCalledTimes(1);
    t.stop();
  });
  it("catches up after reconnect and polls even when disconnected", async () => {
    const t = setup();
    t.status("CHANNEL_ERROR");
    expect(t.callbacks.connection).toHaveBeenLastCalledWith("degraded");
    await vi.advanceTimersByTimeAsync(30250);
    expect(t.callbacks.refresh).toHaveBeenCalledTimes(1);
    t.status("SUBSCRIBED");
    await vi.advanceTimersByTimeAsync(250);
    expect(t.callbacks.refresh).toHaveBeenCalledTimes(2);
    t.stop();
  });
  it("waits for actual Postgres readiness and reads again to recover missed initial events", async () => {
    const t = setup(); t.status("SUBSCRIBED");
    expect(t.callbacks.connection).toHaveBeenLastCalledWith("connecting");
    await vi.advanceTimersByTimeAsync(250);
    t.system("ok"); await vi.advanceTimersByTimeAsync(250);
    expect(t.callbacks.connection).toHaveBeenLastCalledWith("connected");
    expect(t.callbacks.refresh).toHaveBeenCalledTimes(2);
    t.system("error"); expect(t.callbacks.connection).toHaveBeenLastCalledWith("degraded");
    t.stop(); t.system("ok");
    expect(t.callbacks.connection).toHaveBeenLastCalledWith("degraded");
  });
  it("serializes reads and runs one follow-up if events arrive during a read", async () => {
    let complete: () => void = () => {};
    const refresh = vi.fn().mockImplementationOnce(() => new Promise<void>(resolve => { complete = resolve; })).mockResolvedValue(undefined);
    const t = setup(refresh);
    t.events[0](); await vi.advanceTimersByTimeAsync(250);
    t.events[1](); await vi.advanceTimersByTimeAsync(250);
    expect(refresh).toHaveBeenCalledTimes(1);
    complete(); await vi.advanceTimersByTimeAsync(250);
    expect(refresh).toHaveBeenCalledTimes(2);
    t.stop();
  });
  it("removes the channel and prevents late events, status or polling after cleanup", async () => {
    const t = setup(); t.events[0](); t.stop();
    t.callbacks.connection.mockClear(); t.events[1](); t.status("SUBSCRIBED");
    await vi.advanceTimersByTimeAsync(60000);
    expect(t.callbacks.refresh).not.toHaveBeenCalled();
    expect(t.callbacks.connection).not.toHaveBeenCalled();
    expect(t.removeChannel).toHaveBeenCalledWith(t.channel);
  });
  it("surfaces failed refresh without losing the next refresh opportunity", async () => {
    const t = setup(vi.fn().mockRejectedValueOnce(new Error("network")).mockResolvedValue(undefined));
    t.events[0](); await vi.advanceTimersByTimeAsync(250);
    expect(t.callbacks.failure).toHaveBeenCalledTimes(1);
    t.events[0](); await vi.advanceTimersByTimeAsync(250);
    expect(t.callbacks.refresh).toHaveBeenCalledTimes(2);
    t.stop();
  });
});
