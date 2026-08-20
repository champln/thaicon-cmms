import { describe, expect, it } from "vitest";
import {
  authenticateDemoUser,
  demoUsers,
  getJobsitesForUser,
  getUserById,
  jobsites,
} from "./access";

describe("demo authentication", () => {
  it("authenticates each configured demo account", () => {
    for (const user of demoUsers) {
      expect(authenticateDemoUser(user.username, user.password)?.id).toBe(user.id);
    }
  });

  it("normalizes username casing and surrounding whitespace", () => {
    const admin = authenticateDemoUser("  ADMIN  ", "demo123");
    expect(admin?.role).toBe("admin");
  });

  it("rejects invalid credentials", () => {
    expect(authenticateDemoUser("admin", "wrong-password")).toBeNull();
    expect(authenticateDemoUser("unknown", "demo123")).toBeNull();
  });

  it("restores only known users by id", () => {
    expect(getUserById("USR-ENG-001")?.username).toBe("engineer");
    expect(getUserById("missing-user")).toBeNull();
  });
});

describe("Jobsite access", () => {
  it("keeps every assignment tied to a known Jobsite", () => {
    const knownJobsiteIds = new Set(jobsites.map((site) => site.id));
    for (const user of demoUsers) {
      for (const jobsiteId of user.jobsiteIds) {
        expect(knownJobsiteIds.has(jobsiteId)).toBe(true);
      }
    }
  });

  it("gives admin access to every demo Jobsite", () => {
    const admin = demoUsers.find((user) => user.role === "admin");
    expect(admin).toBeDefined();
    expect(getJobsitesForUser(admin!)).toHaveLength(jobsites.length);
  });

  it("limits engineer and viewer to their explicit assignments", () => {
    const engineer = demoUsers.find((user) => user.role === "engineer");
    const viewer = demoUsers.find((user) => user.role === "user");

    expect(getJobsitesForUser(engineer!).map((site) => site.id)).toEqual([
      "SITE-001",
      "SITE-002",
    ]);
    expect(getJobsitesForUser(viewer!).map((site) => site.id)).toEqual([
      "SITE-001",
    ]);
  });
});

