export type SiteIdentity = {id:string;name:string};
export type OperationSite = {jobsiteId?:string;site:string};
/** Names are display-only for current records. Old Demo names resolve ONLY
 * when exactly one known site matches; an invalid explicit ID never falls back. */
export function operationSiteId(record: OperationSite, sites: readonly SiteIdentity[]): string | null {
  if (record.jobsiteId !== undefined) return sites.some(s => s.id === record.jobsiteId) ? record.jobsiteId : null;
  const matches = sites.filter(s => s.id === record.site || s.name === record.site);
  return matches.length === 1 ? matches[0].id : null;
}
export function requireOperationSiteId(record: OperationSite, sites: readonly SiteIdentity[]): string {
  const id=operationSiteId(record,sites);
  if (!id) throw new Error("ยืนยันไซต์ของข้อมูลใบงานหรือ Alarm ไม่ได้ กรุณาตรวจรหัสไซต์ก่อนบันทึก ไม่เลือกไซต์จากชื่อที่ซ้ำกัน");
  return id;
}
export function operationsForSite<T extends OperationSite>(records: readonly T[], id: string, sites: readonly SiteIdentity[]): T[] {
  const site=sites.find(s => s.id===id);
  return site ? records.filter(r => operationSiteId(r,sites)===id).map(r => ({...r,jobsiteId:id,site:site.name})) : [];
}
