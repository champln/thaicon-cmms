export type AssetTarget = { siteId: string; assetId: string };

export function parseAssetLink(hash: string): AssetTarget | null {
  if (!hash.startsWith("#asset?") || hash.length > 1024) return null;
  const params = new URLSearchParams(hash.slice(7));
  if (params.getAll("site").length !== 1 || params.getAll("id").length !== 1) return null;
  const siteId = params.get("site") ?? "";
  const assetId = params.get("id") ?? "";
  if (![siteId, assetId].every(value => value.trim() === value && value.length > 0 && value.length <= 128 && !/[\u0000-\u001f\u007f]/.test(value))) return null;
  return { siteId, assetId };
}

export function buildAssetLink(pageUrl: string, target: AssetTarget): string {
  const url = new URL(pageUrl);
  if (!["https:", "http:"].includes(url.protocol)) throw new Error("Unsupported URL");
  url.search = "";
  url.hash = "asset?" + new URLSearchParams({ site: target.siteId, id: target.assetId }).toString();
  return url.href;
}
