import { describe, expect, it } from "vitest";
import { assetPayload } from "./admin-supabase";
import { buildDefaultMasterData, locationLabel, normalizeMasterData, resolveAssetLocation, validateLocation } from "./master-data";
import { assetHistory } from "./asset-history";
import { buildDemoMaintenanceState } from "./maintenance";

const location = { id: "loc-1", jobsiteId: "SITE-002", building: "อาคาร A", floor: "ชั้น 2", room: "ห้อง 201" };
const asset = { ...buildDefaultMasterData().assets[0], manufacturer: "Test Maker", model: "M-1", serialNumber: "SN-001", locationId: location.id };

describe("asset metadata and location catalog", () => {
  it("preserves legacy Demo records when no catalog exists", () => {
    const old = buildDefaultMasterData();
    const { locations: _locations, ...legacy } = old;
    const restored = normalizeMasterData(legacy);
    expect(restored.assets).toEqual(old.assets);
    expect(restored.locations).toEqual([]);
  });
  it("maps all metadata to the database and synchronizes the selected location", () => {
    const resolved = resolveAssetLocation(asset, [location]);
    expect(assetPayload(resolved)).toMatchObject({ manufacturer: "Test Maker", model: "M-1", serial_number: "SN-001", location_id: "loc-1", building: "อาคาร A", floor: "ชั้น 2", room: "ห้อง 201", location: locationLabel(location) });
  });
  it("rejects a location from another site or a missing location", () => {
    expect(() => resolveAssetLocation({ ...asset, jobsiteId: "SITE-001" }, [location])).toThrow("ไซต์เดียว");
    expect(() => resolveAssetLocation(asset, [])).toThrow("ไซต์เดียว");
  });
  it("supports manually entered locations and explicitly unlinks location_id", () => {
    expect(assetPayload(resolveAssetLocation({ ...asset, locationId: null, building: "Manual" }, [location]))).toMatchObject({ location_id: null, building: "Manual" });
  });
  it("validates building, floor-before-room and database length limits", () => {
    expect(() => validateLocation(location)).not.toThrow();
    expect(() => validateLocation({ ...location, floor: "" })).toThrow();
    expect(() => validateLocation({ ...location, building: " " })).toThrow();
    expect(() => validateLocation({ ...location, room: "x".repeat(201) })).toThrow();
    expect(() => validateLocation({ ...location, floor: "", room: "" })).not.toThrow();
  });
  it("round trips new Demo metadata and catalog through normalization", () => {
    const state = { ...buildDefaultMasterData(), assets: [asset], locations: [location] };
    expect(normalizeMasterData(JSON.parse(JSON.stringify(state)))).toEqual(state);
  });
  it("does not show reports from another asset/site in history", () => {
    const maintenance = buildDemoMaintenanceState();
    const report = maintenance.serviceReports[0];
    expect(report).toBeDefined();
    const records = { ...maintenance, serviceReports: [{ ...report, id: "right", assetId: asset.id, jobsiteId: asset.jobsiteId }, { ...report, id: "wrong-site", assetId: asset.id, jobsiteId: "SITE-999" }, { ...report, id: "wrong-asset", assetId: "OTHER", jobsiteId: asset.jobsiteId }] };
    expect(assetHistory(asset, "site", [], records).serviceReports.map((item) => item.id)).toEqual(["right"]);
  });
});
