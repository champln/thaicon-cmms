import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { buildDemoMaintenanceState } from "./maintenance";
import { createReportCommandRepository, createReportSaveOperation, reportPayload } from "./service-report-command-supabase";
const report = { ...buildDemoMaintenanceState().serviceReports[0], version: 1, id: "SR-A", attachments: [] };
function setup(data: unknown, error: unknown = null) {
  const rpc = vi.fn().mockResolvedValue({ data, error });
  return { rpc, repository: createReportCommandRepository({ rpc } as unknown as Pick<SupabaseClient, "rpc" | "storage">) };
}
describe("service report commands", () => {
  it("never includes client attribution in save payload", () => {
    const payload = reportPayload(report);
    expect(payload).not.toHaveProperty("created_by"); expect(payload).not.toHaveProperty("approved_by");
    expect(payload).not.toHaveProperty("version"); expect(payload).not.toHaveProperty("status");
  });
  it("keeps exact retry identity and rejects wrong acknowledgement", async () => {
    const response = { event_no: 1, replayed: false, report: { id: report.id, jobsite_id: report.jobsiteId, version: 2, status: "draft" } };
    const { rpc, repository } = setup(response);
    const key = "10000000-0000-4000-8000-000000000001";
    await repository.save(report, 1, key, false); await repository.save(report, 1, key, false);
    expect(rpc.mock.calls[0]).toEqual(rpc.mock.calls[1]);
    await expect(setup({ ...response, report: { ...response.report, jobsite_id: "OTHER" } }).repository.save(report, 1, key, false)).rejects.toMatchObject({ kind: "failed" });
  });
  it.each([["40001", "conflict"], ["42501", "denied"], ["23503", "invalid"], ["503", "failed"]])("maps %s without exposing raw database diagnostics", async (code, kind) => {
    await expect(setup(null, { code, message: "secret diagnostic" }).repository.save(report, 1, "10000000-0000-4000-8000-000000000001", false)).rejects.toMatchObject({ kind });
  });
  it("does not treat unknown readiness as disabled", async () => {
    await expect(setup(false).repository.ready()).resolves.toBe(false);
    await expect(setup(null, { code: "PGRST202" }).repository.ready()).resolves.toBe(false);
    await expect(setup(null).repository.ready()).rejects.toMatchObject({ kind: "failed" });
  });
  it("preserves create/upload/save phases on lost final response and freezes original data", async () => {
    const attachment = { id: "20000000-0000-4000-8000-000000000001", name: "proof.png", type: "image/png", dataUrl: "data:image/png;base64,AA==" };
    const source = { ...report, attachments: [attachment] };
    const repository = createReportCommandRepository(null);
    repository.save = vi.fn().mockResolvedValueOnce({ id: "new", version: 1, replayed: false }).mockRejectedValueOnce(Error("Lost acknowledgement")).mockResolvedValueOnce({ id: "new", version: 2, replayed: true });
    repository.upload = vi.fn().mockImplementation(async (_id, _site, value) => ({ ...value, storagePath: "fixed-path", fileSize: 1 }));
    const operation = createReportSaveOperation(source, true, true, repository);
    source.workPerformed = "Changed after request";
    await expect(operation.run()).rejects.toThrow("Lost acknowledgement");
    await expect(operation.run()).resolves.toMatchObject({ version: 2, replayed: true });
    const saves = vi.mocked(repository.save).mock.calls;
    expect(saves).toHaveLength(3); expect(saves[1]).toEqual(saves[2]);
    expect(saves[1][0].workPerformed).toBe(report.workPerformed);
    expect(saves[0][0].attachments).toEqual([]);
    expect(saves[1][2]).not.toBe(saves[0][2]);
    expect(repository.upload).toHaveBeenCalledTimes(2); // second call reuses stored path, no upload bytes
    await operation.run(); expect(repository.save).toHaveBeenCalledTimes(3);
  });
  it("retries uncertain initial creation with original key before advancing", async () => {
    const repository = createReportCommandRepository(null);
    repository.save = vi.fn().mockRejectedValueOnce(Error("Lost create response")).mockResolvedValueOnce({ id: "new", version: 1, replayed: true });
    const operation = createReportSaveOperation(report, false, true, repository);
    await expect(operation.run()).rejects.toThrow(); await operation.run();
    const calls = vi.mocked(repository.save).mock.calls; expect(calls[0]).toEqual(calls[1]);
  });
  it("refuses submission without photos before creating a draft", async () => {
    const repository = createReportCommandRepository(null); repository.save = vi.fn();
    await expect(createReportSaveOperation(report, true, true, repository).run()).rejects.toMatchObject({ kind: "invalid" });
    expect(repository.save).not.toHaveBeenCalled();
  });
  it("stops subsequent phases after scope/unmount changes during upload", async () => {
    let active = true;
    const repository = createReportCommandRepository(null);
    repository.save = vi.fn().mockResolvedValue({ id: "new", version: 1, replayed: false });
    repository.upload = vi.fn().mockImplementation(async (_id, _site, attachment) => { active = false; return attachment; });
    const operation = createReportSaveOperation({ ...report, attachments: [{ id: "20000000-0000-4000-8000-000000000001", name: "proof.png", type: "image/png", dataUrl: "data:image/png;base64,AA==" }] }, true, true, repository, () => { if (!active) throw Error("Scope changed"); });
    await expect(operation.run()).rejects.toThrow("Scope changed");
    expect(repository.save).toHaveBeenCalledTimes(1);
  });
});
