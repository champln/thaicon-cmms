import { describe, expect, it } from "vitest";
import { latestObservation, parseArchive, recordObservation, scenariosFor, summarizeRun, UAT_VERSION, uatScenarios, uatStorageKey } from "./uat";
import type { UatObservation, UatRun, UatScope } from "./uat";

const scope: UatScope = { userId: "tester-1", role: "admin", siteId: "SITE-001", mode: "demo" };
const makeRun = (): UatRun => ({ id: "run-1", scenarioVersion: UAT_VERSION, tester: "Tester", release: "local-test", createdAt: "2026-10-04T00:00:00Z", scope, observations: [] });
const observation: UatObservation = { id: "obs-1", scenarioId: "WO-04", result: "FAIL", actual: "ไม่พบใบงานหลังรีเฟรช", evidence: "WO-04.png", at: "2026-10-04T00:05:00Z" };
const serialize = (run: UatRun) => JSON.stringify({ schema: 1, runs: [run] });

describe("UAT scenario catalog", () => {
  it("contains 38 versioned scenarios without assigning outcomes", () => {
    expect(uatScenarios).toHaveLength(38);
    expect(new Set(uatScenarios.map(value => value.id)).size).toBe(38);
    for (const item of uatScenarios) {
      expect(item.steps.length).toBeGreaterThan(0);
      expect(item.expected).toBeTruthy();
      expect(item.prerequisite).toBeTruthy();
      expect(item.roles.length).toBeGreaterThan(0);
    }
    expect(summarizeRun(makeRun()).NOT_RUN).toBe(scenariosFor("admin").length);
  });
  it("does not direct Engineer or User to admin-only operational scenarios", () => {
    expect(scenariosFor("engineer").some(item => item.id === "SR-02")).toBe(true);
    for (const role of ["engineer", "user"] as const) {
      expect(scenariosFor(role).some(item => ["WO-03", "ALM-01", "ASSET-01", "SEC-02"].includes(item.id))).toBe(false);
      expect(scenariosFor(role).some(item => item.id === "GUIDE-01")).toBe(true);
    }
  });
});

describe("UAT result history and boundaries", () => {
  it("keeps the original catalog and outcomes for an earlier saved run", () => {
    const earlier = { ...makeRun(), scenarioVersion: "2026-10-04" };
    const saved = recordObservation(earlier, observation);
    expect(parseArchive(serialize(saved), scope).runs[0]).toEqual(saved);
    expect(scenariosFor("admin", earlier.scenarioVersion).some(item => item.id === "MAT-01")).toBe(false);
    expect(() => recordObservation(earlier, { ...observation, scenarioId: "MAT-01" })).toThrow();
    expect(scenariosFor("engineer", earlier.scenarioVersion).find(item => item.id === "ROLE-01")?.expected).toContain("ไม่ใช่ใบงาน");
    expect(scenariosFor("engineer").find(item => item.id === "ROLE-01")?.expected).toContain("เปิดใบงาน");
  });
  it("preserves original failure on retest and counts only the latest result", () => {
    const original = recordObservation(makeRun(), observation);
    const retest = recordObservation(original, { ...observation, id: "obs-2", result: "PASS", actual: "พบใบงานเดิม", at: "2026-10-04T01:00:00Z" });
    expect(original.observations).toHaveLength(1);
    expect(retest.observations.map(item => item.result)).toEqual(["FAIL", "PASS"]);
    expect(latestObservation(retest, "WO-04")?.result).toBe("PASS");
    expect(summarizeRun(retest)).toMatchObject({ PASS: 1, FAIL: 0, BLOCKED: 0 });
  });
  it("requires an actual observation and a permitted scenario", () => {
    expect(() => recordObservation(makeRun(), { ...observation, actual: "  " })).toThrow();
    expect(() => recordObservation(makeRun(), { ...observation, scenarioId: "UNKNOWN" })).toThrow();
    expect(() => recordObservation({ ...makeRun(), scope: { ...scope, role: "user" } }, observation)).toThrow();
  });
  it("does not certify online-only scenarios in Demo", () => {
    expect(() => recordObservation(makeRun(), { ...observation, scenarioId: "SEC-01", result: "PASS" })).toThrow();
    expect(recordObservation(makeRun(), { ...observation, scenarioId: "SEC-01", result: "BLOCKED" }).observations[0].result).toBe("BLOCKED");
  });
  it("separates browser keys by account, site, role and mode", () => {
    const keys = [scope, { ...scope, userId: "tester-2" }, { ...scope, siteId: "SITE-002" }, { ...scope, role: "user" as const }, { ...scope, mode: "supabase" as const }].map(uatStorageKey);
    expect(new Set(keys).size).toBe(5);
  });
  it("roundtrips valid archives and keeps empty storage empty", () => {
    const run = recordObservation(makeRun(), observation);
    expect(parseArchive(serialize(run), scope).runs).toEqual([run]);
    expect(parseArchive(null, scope)).toEqual({ schema: 1, runs: [] });
  });
  it("rejects malformed archives instead of silently replacing their contents", () => {
    for (const raw of ["", "null", "{}", '{"schema":2,"runs":[]}', '{"schema":1,"runs":[null]}', serialize({ ...makeRun(), createdAt: "bad date" }), serialize({ ...makeRun(), scenarioVersion: "old" })]) {
      expect(() => parseArchive(raw, scope)).toThrow();
    }
  });
  it("rejects mismatched identity/site/role/mode on loading", () => {
    for (const other of [{ ...scope, userId: "other" }, { ...scope, siteId: "SITE-002" }, { ...scope, role: "user" as const }, { ...scope, mode: "supabase" as const }]) {
      expect(() => parseArchive(serialize(makeRun()), other)).toThrow();
    }
  });
  it("rejects invalid observations and duplicates", () => {
    for (const item of [{ ...observation, result: "UNKNOWN" }, { ...observation, actual: " " }, { ...observation, scenarioId: "UNKNOWN" }, { ...observation, at: "yesterday" }, { ...observation, scenarioId: "SEC-01", result: "PASS" }]) {
      expect(() => parseArchive(JSON.stringify({ schema: 1, runs: [{ ...makeRun(), observations: [item] }] }), scope)).toThrow();
    }
    expect(() => parseArchive(serialize({ ...makeRun(), observations: [observation, observation] }), scope)).toThrow();
    expect(() => parseArchive(JSON.stringify({ schema: 1, runs: [makeRun(), makeRun()] }), scope)).toThrow();
  });
});
