/** Complete-or-error reads; callers must supply a stable unique ordering.
 * Offset pagination is not an atomic snapshot during concurrent owner edits.
 */
export async function readAllRows<T>(
  read: (start: number, end: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
  size = 200,
): Promise<T[]> {
  if (!Number.isSafeInteger(size) || size < 1) throw new Error("Invalid page size");
  const rows: T[] = [];
  for (let start = 0; ; start += size) {
    const { data, error } = await read(start, start + size - 1);
    if (error) throw error;
    if (!Array.isArray(data)) throw new Error("Incomplete directory page");
    rows.push(...data);
    if (data.length < size) return rows;
  }
}

export async function readAllAuthUsers<T>(
  read: (page: number, perPage: number) => PromiseLike<{ data: { users: T[] } | null; error: unknown }>,
  size = 200,
): Promise<T[]> {
  return readAllRows((start) => {
    return Promise.resolve(read(start / size + 1, size)).then(({ data, error }) => ({
      data: data?.users ?? null, error,
    }));
  }, size);
}

/** Auth list ordering is controlled by GoTrue, not our SQL tie-breaker.
 * Reconcile missing profile identities by exact ID (bounded concurrency).
 * A missing/failed lookup is not an empty email success.
 */
export async function resolveProfileEmails(
  profiles: Array<{ id: string }>,
  users: Array<{ id: string; email?: string }>,
  read: (id: string) => PromiseLike<{ data: { user: { id: string; email?: string } | null }; error: unknown }>,
) {
  const emails = new Map(users.map(user => [user.id, user.email ?? ""]));
  const missing = profiles.filter(profile => !emails.has(profile.id));
  for (let start = 0; start < missing.length; start += 8) {
    await Promise.all(missing.slice(start, start + 8).map(async profile => {
      const { data, error } = await read(profile.id);
      if (error) throw error;
      if (data.user?.id !== profile.id) throw new Error("Incomplete Auth identity");
      emails.set(profile.id, data.user.email ?? "");
    }));
  }
  return emails;
}
