/** Read every authorized page; never return a partial result after a failure.
 * Stable ordering must be supplied by the caller. This is not a DB snapshot:
 * concurrent inserts/deletes still require a refreshed query or export RPC.
 */
export async function readAllPages<T>(read: (start: number, end: number) => PromiseLike<{ data: T[] | null; error: unknown }>, size = 200): Promise<T[]> {
  if (!Number.isSafeInteger(size) || size < 1) throw new Error("Invalid page size");
  const result: T[] = [];
  for (let start = 0; ; start += size) {
    const { data, error } = await read(start, start + size - 1);
    if (error) throw error;
    if (!Array.isArray(data)) throw new Error("Incomplete page response");
    result.push(...data);
    if (data.length < size) return result;
  }
}

/** Bound site-filter URLs and concurrency as well as each response page. */
export async function readAllSitePages<T>(
  siteIds: string[],
  read: (ids: string[], start: number, end: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
): Promise<T[]> {
  const ids = [...new Set(siteIds)], rows: T[] = [];
  for (let offset = 0; offset < ids.length; offset += 200) {
    const batch = ids.slice(offset, offset + 200);
    rows.push(...await readAllPages((start, end) => read(batch, start, end)));
  }
  return rows;
}
