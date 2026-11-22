import { describe, expect, it } from "vitest";
import { classifyDatabaseProbe } from "./database-status";
describe("database reachability classification", () => {
  it("accepts only successful database responses", () => {
    expect(classifyDatabaseProbe({ status: 200, error: null, data: true })).toBe("online");
    expect(classifyDatabaseProbe({ status: 200, error: {}, data: true })).toBe("unknown");
    for (const data of [false, null, undefined, "true", {}, [], [{ id: "SITE-901" }]]) {
      expect(classifyDatabaseProbe({ status: 200, error: null, data })).toBe("unknown");
    }
  });
  it("does not confuse denied access with downtime", () => {
    for (const status of [401, 403]) expect(classifyDatabaseProbe({ status, error: {}, data: null })).toBe("restricted");
  });
  it("handles unreachable network and server errors", () => {
    for (const status of [0, 500, 503]) expect(classifyDatabaseProbe({ status, error: {}, data: null })).toBe("offline");
  });
  it("keeps missing endpoints, throttling and invalid responses unconfirmed", () => {
    for (const status of [204, 400, 404, 429]) expect(classifyDatabaseProbe({ status, error: {}, data: null })).toBe("unknown");
  });
});
