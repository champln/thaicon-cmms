import { describe, expect, it, vi } from "vitest";
import { readAllRows, readAllAuthUsers, resolveProfileEmails } from "../supabase/functions/_shared/read-pages";

describe("Edge directory pagination (pure adapter; not deployed integration)", () => {
  it("reconciles identities omitted by unstable Auth list ordering, not blank emails", async () => {
    const read = vi.fn(async (id: string) => ({ data: { user: { id, email: id + "@example.test" } }, error: null }));
    const emails = await resolveProfileEmails([{ id: "a" }, { id: "b" }], [{ id: "a", email: "a@example.test" }, { id: "a", email: "a@example.test" }], read);
    expect(emails.get("b")).toBe("b@example.test");
    expect(read).toHaveBeenCalledExactlyOnceWith("b");
  });
  it("rejects missing identity reconciliation instead of silently returning empty email", async () => {
    await expect(resolveProfileEmails([{ id: "b" }], [], async () => ({ data: { user: null }, error: null }))).rejects.toThrow("Incomplete Auth");
    await expect(resolveProfileEmails([{ id: "b" }], [], async () => ({ data: { user: null }, error: new Error("Auth unavailable") }))).rejects.toThrow("Auth unavailable");
  });
  it("reads 1,201 rows including the final page", async () => {
    const rows = Array.from({ length: 1201 }, (_, id) => ({ id }));
    const read = vi.fn(async (start: number, end: number) => ({ data: rows.slice(start, end + 1), error: null }));
    expect(await readAllRows(read)).toEqual(rows);
    expect(read).toHaveBeenLastCalledWith(1200, 1399);
  });
  it("reads Auth beyond page one using one-based pages", async () => {
    const users = Array.from({ length: 1201 }, (_, id) => ({ id, email: `user${id}@example.test` }));
    const read = vi.fn(async (page: number, perPage: number) => ({ data: { users: users.slice((page - 1) * perPage, page * perPage) }, error: null }));
    expect(await readAllAuthUsers(read)).toEqual(users);
    expect(read).toHaveBeenLastCalledWith(7, 200);
  });
  it("rejects a later Auth page rather than returning partial email mappings", async () => {
    const read = vi.fn(async (page: number) => page === 1
      ? { data: { users: Array.from({ length: 200 }, (_, id) => ({ id })) }, error: null }
      : { data: null, error: new Error("Auth unavailable") });
    await expect(readAllAuthUsers(read)).rejects.toThrow("Auth unavailable");
  });
  it("rejects malformed successful pages", async () => {
    await expect(readAllRows(async () => ({ data: null, error: null }))).rejects.toThrow("Incomplete");
    await expect(readAllAuthUsers(async () => ({ data: null, error: null }))).rejects.toThrow("Incomplete");
  });
  it("reads an empty final page after an exact-size page", async () => {
    const read = vi.fn(async (start: number) => ({ data: start === 0 ? Array(200).fill("row") : [], error: null }));
    expect(await readAllRows(read)).toHaveLength(200);
    expect(read).toHaveBeenCalledTimes(2);
  });
});
