import { describe, expect, it, vi } from "vitest";
import { readAllPages, readAllSitePages } from "./read-all-pages";

describe("authorized pagination", () => {
  it("bounds/deduplicates scopes and paginates every batch sequentially", async () => {
    const ids = Array.from({ length: 401 }, (_, n) => "SITE-" + n);
    const read = vi.fn(async (batch: string[], start: number, end: number) => ({
      data: Array.from({ length: batch.length }, (_, n) => batch[n]).slice(start, end + 1), error: null,
    }));
    expect(await readAllSitePages([...ids, ids[0]], read)).toEqual(ids);
    expect(read.mock.calls.map(([batch]) => batch.length)).toEqual([200, 200, 200, 200, 1]);
    expect(read.mock.calls.map(([, start]) => start)).toEqual([0, 200, 0, 200, 0]);
  });
  it("rejects all results if a later site batch fails", async () => {
    const ids = Array.from({ length: 201 }, (_, n) => "SITE-" + n);
    const read = vi.fn(async (batch: string[]) => batch[0] === "SITE-200"
      ? { data: null, error: new Error("Later scope failed") }
      : { data: ["confirmed first batch"], error: null });
    await expect(readAllSitePages(ids, read)).rejects.toThrow("Later scope failed");
  });
  it("skips an empty scope without making requests", async () => {
    const read = vi.fn();
    expect(await readAllSitePages([], read)).toEqual([]);
    expect(read).not.toHaveBeenCalled();
  });
  it("loads more than the default 1000-row API cap", async () => {
    const rows = Array.from({ length: 1201 }, (_, id) => ({ id }));
    const read = vi.fn(async (start: number, end: number) => ({ data: rows.slice(start, end + 1), error: null }));
    expect(await readAllPages(read)).toEqual(rows);
    expect(read).toHaveBeenCalledTimes(7);
    expect(read.mock.calls.at(-1)).toEqual([1200, 1399]);
  });
  it("reads one more page when the last full page has exactly the limit", async () => {
    const read = vi.fn().mockResolvedValueOnce({ data: [1, 2], error: null }).mockResolvedValueOnce({ data: [], error: null });
    expect(await readAllPages(read, 2)).toEqual([1, 2]);
    expect(read).toHaveBeenCalledTimes(2);
  });
  it("does not return partial data when a later page fails", async () => {
    const error = new Error("network");
    const read = vi.fn().mockResolvedValueOnce({ data: [1, 2], error: null }).mockResolvedValueOnce({ data: null, error });
    await expect(readAllPages(read, 2)).rejects.toBe(error);
  });
  it("does not treat a missing response as an empty successful query", async () => {
    await expect(readAllPages(async () => ({ data: null, error: null }))).rejects.toThrow("Incomplete");
  });
});
