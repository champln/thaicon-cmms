import { describe, expect, it } from "vitest";
import { buildAssetLink, parseAssetLink } from "./asset-link";

describe("asset QR links", () => {
  it("round trips IDs without credentials and preserves hosting base path", () => {
    const link = buildAssetLink("https://example.com/thaicon-cmms/?token=private#home", { siteId: "SITE-001", assetId: "แอร์ / 1" });
    expect(new URL(link).pathname).toBe("/thaicon-cmms/");
    expect(new URL(link).search).toBe("");
    expect(parseAssetLink(new URL(link).hash)).toEqual({ siteId: "SITE-001", assetId: "แอร์ / 1" });
  });
  it("rejects incomplete, ambiguous and invalid targets", () => {
    for (const hash of ["#home", "#asset?id=x", "#asset?site=x&id=", "#asset?site=x&id=y&id=z", "#asset?site=x&id=%00", "#asset?site=x&id=" + "x".repeat(129)]) expect(parseAssetLink(hash)).toBeNull();
  });
  it("does not accept script URLs", () => {
    expect(() => buildAssetLink("javascript:alert(1)", { siteId: "s", assetId: "a" })).toThrow();
  });
});
