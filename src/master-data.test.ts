import { describe, expect, it } from "vitest";
import {
  authenticateManagedUser,
  buildDefaultMasterData,
  jobsitesForManagedUser,
  nextMasterId,
  normalizeMasterData,
} from "./master-data";

describe("admin master data", () => {
  it("allows active managed users to sign in and rejects inactive users", () => {
    const state = buildDefaultMasterData();
    expect(authenticateManagedUser(state.users, "ADMIN", "demo123")?.role).toBe("admin");
    state.users[0].active = false;
    expect(authenticateManagedUser(state.users, "admin", "demo123")).toBeNull();
  });

  it("returns assigned active Jobsites and recalculates the asset count", () => {
    const state = buildDefaultMasterData();
    const engineer = state.users.find((user) => user.role === "engineer")!;
    state.jobsites.find((site) => site.id === "SITE-002")!.active = false;
    const sites = jobsitesForManagedUser(state, engineer);
    expect(sites.map((site) => site.id)).toEqual(["SITE-001"]);
    expect(sites[0].assetCount).toBe(1);
  });

  it("generates the next Supabase-compatible Jobsite ID", () => {
    expect(nextMasterId("SITE", ["SITE-001", "SITE-009"])).toBe("SITE-010");
  });

  it("restores missing active flags from older browser data", () => {
    const state = buildDefaultMasterData();
    const legacy = JSON.parse(JSON.stringify(state));
    delete legacy.users[0].active;
    delete legacy.jobsites[0].active;
    expect(normalizeMasterData(legacy).users[0].active).toBe(true);
    expect(normalizeMasterData(legacy).jobsites[0].active).toBe(true);
  });
});
