import { describe, expect, it } from "vitest";
import { classifyDatabaseProbe } from "./database-status";
describe("database reachability classification", () => {
  it("accepts only successful database responses", () => {
    expect(classifyDatabaseProbe({ status: 200, error: null })).toBe("online");
    expect(classifyDatabaseProbe({ status: 200, error: {} })).toBe("offline");
  });
  it("does not confuse denied access with downtime", () => {
    for (const status of [401, 403]) expect(classifyDatabaseProbe({ status, error: {} })).toBe("restricted");
  });
  it("handles network, missing endpoint and server errors", () => {
    for (const status of [0, 404, 500, 503]) expect(classifyDatabaseProbe({ status, error: {} })).toBe("offline");
  });
});
