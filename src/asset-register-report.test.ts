import { describe, expect, it } from "vitest";
import { buildDefaultMasterData } from "./master-data";
import { buildAssetRegisterReport, assetRegisterPdfSections, filterRegisteredAssets } from "./asset-register-report";
const a = { ...buildDefaultMasterData().assets[0], jobsiteId: "SITE-A", id: "AC-1", manufacturer: "", model: "=MODEL", serialNumber: "SN-123" };
const input = { assets: [a], filters: { query: "", health: "ทั้งหมด" as const }, siteId: "SITE-A", siteName: "Same Name", verified: true, evaluatedAt: "2026-10-06T04:00:00Z", mode: "online" as const };
describe("verified asset register export", () => {
  it("shares literal metadata and filtered numeric counts across formats", () => {
    const r = buildAssetRegisterReport(input);
    expect(r.count).toBe(1);
    expect(r.sheets[0].rows).toContainEqual(["ยังไม่ระบุผู้ผลิต", 1]);
    expect(r.sheets[1].rows[0][10]).toBe("=MODEL");
    expect(r.sheets[1].rows[0][9]).toBe("ยังไม่ระบุ");
    expect(assetRegisterPdfSections(r).find(x => x.label === "ทะเบียนเครื่องจักร #1")?.value).toContain("รุ่น: =MODEL");
    expect(Object.isFrozen(r.sheets[1].rows)).toBe(true);
  });
  it("searches serial/model/location and preserves shared screen selection", () => {
    for (const query of [" sn-123 ", "=model", a.location, "Same Name"]) {
      expect(filterRegisteredAssets([a], { query, health: "ทั้งหมด" }, input.siteName)).toHaveLength(1);
      expect(buildAssetRegisterReport({ ...input, filters: { query, health: "ทั้งหมด" } }).count).toBe(1);
    }
    expect(buildAssetRegisterReport({ ...input, filters: { query: "missing", health: "ทั้งหมด" } }).count).toBe(0);
  });
  it("never exports a foreign site even when names are identical", () => {
    expect(() => buildAssetRegisterReport({ ...input, assets: [{ ...a, jobsiteId: "OTHER" }] })).toThrow("ขอบเขต");
  });
  it("rejects partial reads, inactive assets, duplicate IDs and invalid time/filter", () => {
    expect(() => buildAssetRegisterReport({ ...input, verified: false })).toThrow("ยืนยัน");
    expect(() => buildAssetRegisterReport({ ...input, assets: [{ ...a, active: false }] })).toThrow("ขอบเขต");
    expect(() => buildAssetRegisterReport({ ...input, assets: [a, a] })).toThrow("ซ้ำ");
    expect(() => buildAssetRegisterReport({ ...input, evaluatedAt: "6 ต.ค." })).toThrow("ยืนยัน");
  });
  it("keeps all 1001 complete rows, including last-page metadata", () => {
    const assets = Array.from({ length: 1001 }, (_, n) => ({ ...a, id: "AC-" + n }));
    const r = buildAssetRegisterReport({ ...input, assets });
    expect(r.sheets[1].rows).toHaveLength(1001);
    expect(r.sheets[1].rows.at(-1)?.[1]).toBe("AC-1000");
  });
  it("counts only filtered health and separates missing metadata from facts", () => {
    const r = buildAssetRegisterReport({ ...input, assets: [a, { ...a, id: "AC-2", health: "ปกติ" }], filters: { query: "", health: "ปกติ" } });
    expect(r.count).toBe(1);
    expect(r.sheets[0].rows).toContainEqual(["เฝ้าระวัง", 0]);
    expect(r.sheets[0].rows).toContainEqual(["ปกติ", 1]);
  });
  it("confirmed empty search exports an explicit zero without copying input references", () => {
    const source = { ...a };
    const r = buildAssetRegisterReport({ ...input, assets: [source] });
    source.model = "changed";
    expect(r.sheets[1].rows[0][10]).toBe("=MODEL");
    expect(buildAssetRegisterReport({ ...input, assets: [] }).count).toBe(0);
  });
});
