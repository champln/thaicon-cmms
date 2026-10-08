import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { UatObservation, UatScope } from "./uat";
import { UAT_VERSION } from "./uat";
vi.mock("./supabase", () => ({ supabase: null }));
import { createUatRepository } from "./uat-supabase";

const scope: UatScope = { userId: "00000000-0000-4000-8000-000000000001", role: "engineer", siteId: "SITE-901", mode: "supabase" };
const runId = "10000000-0000-4000-8000-000000000001";
const eventId = "20000000-0000-4000-8000-000000000001";
const runRow = { id: runId, jobsite_id: scope.siteId, owner_id: scope.userId, tester_role: scope.role, scenario_version: UAT_VERSION, tester_name: "Tester", release_label: "test", created_at: "2026-10-04T01:00:00Z" };
const observation: UatObservation = { id: eventId, scenarioId: "SR-01", result: "PASS", actual: "Test observation", evidence: "image.png", at: "2026-10-04T00:00:00Z" };
const eventRow = { id: eventId, run_id: runId, scenario_id: "SR-01", result: "PASS", actual: observation.actual, evidence: observation.evidence, client_at: observation.at, recorded_at: "2026-10-04T01:01:00Z", recorded_by: scope.userId, event_no: 1 };
type Response = { data: unknown; error: null | { code: string; message: string } };
let responses: Response[];
const from = vi.fn(); const rpc = vi.fn(); const getUser = vi.fn(); const insert = vi.fn(); const eq = vi.fn(); const order = vi.fn(); const range = vi.fn();
const client = { from, rpc, auth: { getUser } } as unknown as SupabaseClient;
const repository = createUatRepository(client);
const ok = (data: unknown): Response => ({ data, error: null });
const failure = (code: string): Response => ({ data: null, error: { code, message: "rejected" } });
beforeEach(() => {
  vi.clearAllMocks(); responses = [];
  getUser.mockResolvedValue({ data: { user: { id: scope.userId } }, error: null });
  rpc.mockResolvedValue({ data: true, error: null });
  const resolve = async () => { if (!responses.length) throw new Error("Unexpected extra query"); return responses.shift()!; };
  const query = { select: vi.fn(), eq, order, range, insert, single: resolve, then: (done: (response: Response) => unknown) => resolve().then(done) };
  for (const method of [query.select, eq, order, range, insert, from]) method.mockReturnValue(query);
});
describe("UAT Supabase adapter (mocked HTTP boundary, not Auth integration)", () => {
  it("probes disabled or missing gates without uploading anything", async () => {
    expect(await repository.available({ ...scope, mode: "demo" })).toBe(false);
    rpc.mockResolvedValueOnce(ok(false));
    expect(await repository.available(scope)).toBe(false);
    rpc.mockResolvedValueOnce(failure("PGRST202"));
    expect(await repository.available(scope)).toBe(false);
    expect(await repository.available(scope)).toBe(true);
    expect(from).not.toHaveBeenCalled();
  });
  it("does not interpret identity or network errors as a disabled gate", async () => {
    rpc.mockResolvedValueOnce(failure("NETWORK"));
    await expect(repository.available(scope)).rejects.toThrow("ไม่สำเร็จ");
    getUser.mockResolvedValueOnce({ data: { user: { id: "other" } }, error: null });
    await expect(repository.available(scope)).rejects.toThrow("บัญชีเปลี่ยน");
  });
  it("reads earlier runs without reinterpreting them as the current catalog", async () => {
    responses.push(ok([{ ...runRow, scenario_version: "2026-10-04" }]), ok([]), ok([eventRow]), ok([]));
    const runs = await repository.loadOwnRuns(scope);
    expect(runs[0].scenarioVersion).toBe("2026-10-04");
    expect(eq).not.toHaveBeenCalledWith("scenario_version", UAT_VERSION);
  });
  it("does not append a new scenario to an earlier run", async () => {
    responses.push(ok({ ...runRow, scenario_version: "2026-10-04" }));
    await expect(repository.appendObservation(scope, runId, { ...observation, scenarioId: "MAT-01" })).rejects.toThrow("รุ่น");
    expect(insert).not.toHaveBeenCalled();
  });
  it("does not send Demo results or query an unconfigured client", async () => {
    await expect(repository.loadOwnRuns({ ...scope, mode: "demo" })).rejects.toThrow("Demo");
    await expect(createUatRepository(null).loadOwnRuns(scope)).rejects.toThrow("ตั้งค่า");
    expect(getUser).not.toHaveBeenCalled(); expect(from).not.toHaveBeenCalled();
  });
  it("rejects changed identity and disabled environments before touching tables", async () => {
    getUser.mockResolvedValueOnce({ data: { user: { id: "other" } }, error: null });
    await expect(repository.loadOwnRuns(scope)).rejects.toThrow("บัญชีเปลี่ยน");
    rpc.mockResolvedValueOnce(ok(false));
    await expect(repository.loadOwnRuns(scope)).rejects.toThrow("ยังไม่เปิด");
    expect(from).not.toHaveBeenCalled();
  });
  it("propagates authentication and missing-migration errors", async () => {
    getUser.mockResolvedValueOnce({ data: { user: null }, error: { code: "auth-failed" } });
    await expect(repository.loadOwnRuns(scope)).rejects.toMatchObject({ code: "auth-failed" });
    rpc.mockResolvedValueOnce(failure("PGRST202"));
    await expect(repository.loadOwnRuns(scope)).rejects.toMatchObject({ code: "PGRST202" });
    expect(from).not.toHaveBeenCalled();
  });
  it("creates a run without sending owner, role or server timestamps", async () => {
    responses.push(ok(runRow));
    const run = await repository.createRun(scope, { id: runId, tester: " Tester ", release: "test" });
    expect(insert).toHaveBeenCalledWith({ id: runId, jobsite_id: scope.siteId, scenario_version: UAT_VERSION, tester_name: "Tester", release_label: "test" });
    expect(run).toMatchObject({ createdAt: runRow.created_at, scope, observations: [] });
  });
  it("allows same-ID retry only if visible payload matches exactly", async () => {
    responses.push(failure("23505"), ok(runRow));
    await expect(repository.createRun(scope, { id: runId, tester: "Tester", release: "test" })).resolves.toMatchObject({ id: runId });
    responses.push(failure("23505"), ok({ ...runRow, release_label: "different" }));
    await expect(repository.createRun(scope, { id: runId, tester: "Tester", release: "test" })).rejects.toThrow("ห้ามเขียนทับ");
  });
  it("does not silently report success for network or permission errors", async () => {
    for (const code of ["NETWORK", "42501"]) {
      responses.push(failure(code));
      await expect(repository.createRun(scope, { id: runId, tester: "Tester", release: "test" })).rejects.toMatchObject({ code });
    }
  });
  it("appends observations with server attribution and client time kept separately", async () => {
    responses.push(ok(runRow), ok(eventRow));
    const saved = await repository.appendObservation(scope, runId, observation);
    expect(saved).toMatchObject({ at: eventRow.recorded_at, clientAt: observation.at, recordedBy: scope.userId, eventNo: 1 });
    expect(insert).toHaveBeenCalledWith({ id: eventId, run_id: runId, scenario_id: "SR-01", result: "PASS", actual: observation.actual, evidence: "image.png", client_at: observation.at });
  });
  it("retries observations idempotently with equivalent timestamp representation", async () => {
    responses.push(ok(runRow), failure("23505"), ok({ ...eventRow, client_at: "2026-10-04T00:00:00+00:00" }));
    await expect(repository.appendObservation(scope, runId, observation)).resolves.toMatchObject({ id: eventId });
    expect(insert).toHaveBeenCalledTimes(1);
  });
  it("rejects mismatched owner/site/role or invalid server response", async () => {
    for (const mismatch of [{ owner_id: "other" }, { jobsite_id: "SITE-902" }, { tester_role: "admin" }, { scenario_version: "old" }]) {
      responses.push(ok({ ...runRow, ...mismatch }));
      await expect(repository.appendObservation(scope, runId, observation)).rejects.toThrow("ไม่ตรง");
    }
    expect(insert).not.toHaveBeenCalled();
  });
  it("validates scenario, lengths and date before network calls", async () => {
    for (const invalid of [{ ...observation, scenarioId: "WO-03" }, { ...observation, actual: " " }, { ...observation, evidence: "x".repeat(501) }, { ...observation, at: "invalid" }]) {
      await expect(repository.appendObservation(scope, runId, invalid)).rejects.toThrow();
    }
    expect(getUser).not.toHaveBeenCalled();
  });
  it("paginates even when the server returns fewer rows than requested", async () => {
    responses.push(ok([runRow]), ok([]), ok([eventRow]), ok([{ ...eventRow, id: "20000000-0000-4000-8000-000000000002", event_no: 2 }]), ok([]));
    const runs = await repository.loadOwnRuns(scope);
    expect(runs[0].observations).toHaveLength(2);
    expect(range.mock.calls).toEqual([[0,199],[1,200],[0,199],[1,200],[2,201]]);
    expect(eq).toHaveBeenCalledWith("owner_id", scope.userId);
    expect(eq).toHaveBeenCalledWith("jobsite_id", scope.siteId);
    expect(order).toHaveBeenCalledWith("event_no");
  });
  it("does not return partially loaded history as a successful load", async () => {
    responses.push(ok([runRow]), ok([]), ok([eventRow]), failure("42501"));
    await expect(repository.loadOwnRuns(scope)).rejects.toMatchObject({ code: "42501" });
  });
});
