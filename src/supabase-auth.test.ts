import { describe, expect, it } from "vitest";
import { mapSupabaseAccess } from "./supabase-auth";
import type { JobsiteRow, ProfileRow } from "./supabase-auth";

const engineerProfile: ProfileRow = {
  id: "00000000-0000-0000-0000-000000000001",
  username: "engineer.one",
  display_name: "อนุชา วิศวกร",
  role: "engineer",
  title: null,
  is_active: true,
};

describe("Supabase access mapping", () => {
  it("maps profile and accessible Jobsites into the current UI model", () => {
    const rows: JobsiteRow[] = [
      {
        id: "SITE-001",
        name: "โรงพยาบาลกลาง",
        province: "กรุงเทพมหานคร",
        site_type: "โรงพยาบาล",
      },
    ];

    const access = mapSupabaseAccess(engineerProfile, rows);

    expect(access.user).toMatchObject({
      id: engineerProfile.id,
      username: "engineer.one",
      displayName: "อนุชา วิศวกร",
      initials: "อว",
      role: "engineer",
      title: "วิศวกร",
      jobsiteIds: ["SITE-001"],
    });
    expect(access.sites[0]).toMatchObject({
      id: "SITE-001",
      assetCount: 142,
      openWorkOrders: 3,
      pmCompliance: 92,
    });
  });

  it("uses safe zero values for a Jobsite without local dashboard data", () => {
    const rows: JobsiteRow[] = [
      {
        id: "SITE-999",
        name: "ไซต์ใหม่",
        province: "เชียงใหม่",
        site_type: "สำนักงาน",
      },
    ];

    const access = mapSupabaseAccess(
      { ...engineerProfile, display_name: "Somchai", title: "Field Engineer" },
      rows,
    );

    expect(access.user.initials).toBe("S");
    expect(access.user.title).toBe("Field Engineer");
    expect(access.sites[0]).toMatchObject({
      assetCount: 0,
      openWorkOrders: 0,
      pmCompliance: 0,
    });
  });
});
