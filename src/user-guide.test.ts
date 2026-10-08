import { describe, expect, it } from "vitest";
import { filterGuideTopics, guideTopics } from "./user-guide";

describe("role-specific user guide", () => {
  it("documents material ledger for all roles without implying stock/cost tracking", () => {
    for (const role of ["admin", "engineer", "user"] as const) {
      const topic = filterGuideTopics(role, "รายงานวัสดุรวม").find(topic => topic.id === "material-ledger");
      expect(topic?.destination).toBe("work-orders");
      expect(topic?.warning).toContain("ไม่ใช่ยอดสต็อกหรือต้นทุน");
    }
  });
  it("has unique ids and actionable steps for every topic", () => {
    expect(new Set(guideTopics.map((topic) => topic.id)).size).toBe(guideTopics.length);
    expect(guideTopics.every((topic) => topic.steps.length > 0 && topic.expected.length > 0)).toBe(true);
  });
  it("offers engineers reports, assigned work orders and owning repair follow-up", () => {
    expect(filterGuideTopics("engineer", "").every((topic) => !topic.destination || ["service-reports", "work-orders", "repair-requests"].includes(topic.destination))).toBe(true);
    expect(filterGuideTopics("engineer", "").some(topic => topic.id === "assigned-orders")).toBe(true);
  });
  it("does not offer User administrative operations", () => {
    expect(filterGuideTopics("user", "").every((topic) => !topic.destination || ["dashboard", "work-orders", "assets", "pm", "service-reports", "repair-requests", "reports"].includes(topic.destination))).toBe(true);
    expect(filterGuideTopics("user", "").some(topic => topic.id === "read-repairs")).toBe(true);
    expect(filterGuideTopics("user", "").some(topic => topic.id === "repairs")).toBe(false);
  });
  it("searches steps and metadata case-insensitively", () => {
    expect(filterGuideTopics("admin", "serial").map((topic) => topic.id)).toContain("assets");
    expect(filterGuideTopics("engineer", "2 MB").map((topic) => topic.id)).toContain("report");
    expect(filterGuideTopics("user", "ผู้ใช้และสิทธิ์")).toEqual([]);
    expect(filterGuideTopics("admin", "no-match-xyz")).toEqual([]);
  });
});
