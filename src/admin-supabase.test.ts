import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildDefaultMasterData } from "./master-data";

const mock = vi.hoisted(() => ({
  from: vi.fn(), select: vi.fn(), in: vi.fn(), order: vi.fn(), range: vi.fn(), insert: vi.fn(), upsert: vi.fn(),
  response: { data: [] as unknown[], error: null as null | { code: string; message: string } },
}));
vi.mock("./supabase", () => ({ supabase: { from: mock.from } }));
import { createSupabaseLocation, loadSupabaseAssets, loadSupabaseLocations, saveSupabaseAsset } from "./admin-supabase";

beforeEach(() => {
  vi.clearAllMocks();
  mock.response = { data: [], error: null };
  const query = {
    select: mock.select, in: mock.in, order: mock.order, range: mock.range,
    then: (resolve: (value: typeof mock.response) => unknown) => Promise.resolve(mock.response).then(resolve),
  };
  mock.from.mockReturnValue({ ...query, insert: mock.insert, upsert: mock.upsert });
  mock.select.mockReturnValue(query); mock.in.mockReturnValue(query); mock.order.mockReturnValue(query);
  mock.range.mockImplementation(async (start: number, end: number) => ({ ...mock.response, data: mock.response.data.slice(start, end + 1) }));
  mock.insert.mockImplementation(async () => mock.response);
  mock.upsert.mockImplementation(async () => mock.response);
});

const location = { id: "7034073a-1111-4444-8888-123456789abc", jobsiteId: "SITE-001", building: "อาคาร A", floor: "2", room: "201" };

describe("Supabase asset/catalog adapter contract (mocked; not RLS integration)", () => {
  it("skips queries for identities without accessible sites", async () => {
    expect(await loadSupabaseAssets([])).toEqual([]);
    expect(await loadSupabaseLocations([])).toEqual([]);
    expect(mock.from).not.toHaveBeenCalled();
  });

  it("requests only the specified sites and maps metadata including null dates", async () => {
    mock.response.data = [{ id: "ASSET-1", jobsite_id: "SITE-001", name: "AHU", asset_type: "AHU", location: "อาคาร A", health: "watch", sensor_summary: "offline", last_pm: null, next_pm: null, is_active: true, building: "อาคาร A", floor: "2", room: "201", manufacturer: "Maker", model: "M1", serial_number: "S1", location_id: location.id }];
    const result = await loadSupabaseAssets(["SITE-001"]);
    expect(mock.from).toHaveBeenCalledWith("assets");
    expect(mock.in).toHaveBeenCalledWith("jobsite_id", ["SITE-001"]);
    expect(mock.select.mock.calls[0][0]).toContain("serial_number, location_id");
    expect(result[0]).toMatchObject({ jobsiteId: "SITE-001", health: "เฝ้าระวัง", manufacturer: "Maker", model: "M1", serialNumber: "S1", locationId: location.id, building: "อาคาร A", floor: "2", room: "201", lastPm: "", nextPm: "" });
  });

  it("maps catalog rows and scopes the catalog query", async () => {
    mock.response.data = [{ id: location.id, jobsite_id: location.jobsiteId, building: location.building, floor: location.floor, room: location.room }];
    expect(await loadSupabaseLocations(["SITE-001"])).toEqual([location]);
    expect(mock.from).toHaveBeenCalledWith("asset_locations");
    expect(mock.in).toHaveBeenCalledWith("jobsite_id", ["SITE-001"]);
    expect(mock.order.mock.calls.map(([field]) => field)).toEqual(["building", "floor", "room", "id"]);
  });

  it.each([loadSupabaseAssets, loadSupabaseLocations])("loads beyond the REST 1,000-row limit with an ID tie-breaker", async (load) => {
    mock.response.data = Array.from({ length: 1201 }, (_, index) => ({ id: `ROW-${index}`, jobsite_id: "SITE-001", name: "Same name", building: "A", floor: "1", room: "1" }));
    const rows = await load(["SITE-001"]);
    expect(rows).toHaveLength(1201);
    expect(rows.at(-1)?.id).toBe("ROW-1200");
    expect(mock.range).toHaveBeenLastCalledWith(1200, 1399);
    expect(mock.order).toHaveBeenCalledWith("id");
  });

  it.each([loadSupabaseAssets, loadSupabaseLocations])("does not return earlier pages when a later page fails", async (load) => {
    mock.response.data = Array.from({ length: 200 }, (_, index) => ({ id: `ROW-${index}`, jobsite_id: "SITE-001" }));
    mock.range.mockImplementation(async (start: number) => start === 0 ? mock.response : { data: null, error: new Error("Later page failed") });
    await expect(load(["SITE-001"])).rejects.toThrow("Later page failed");
  });

  it("deduplicates and batches a large site scope into bounded URLs", async () => {
    const ids = Array.from({ length: 401 }, (_, index) => `SITE-${index}`);
    await loadSupabaseAssets([...ids, ids[0]]);
    expect(mock.in.mock.calls.map(([, batch]) => batch.length)).toEqual([200, 200, 1]);
    expect(mock.in.mock.calls.flatMap(([, batch]) => batch)).toEqual(ids);
  });

  it.each([loadSupabaseAssets, loadSupabaseLocations])("propagates failed loads instead of silently presenting an empty success", async (load) => {
    mock.response.error = { code: "42501", message: "permission denied" };
    await expect(load(["SITE-001"])).rejects.toEqual(mock.response.error);
  });

  it("inserts catalog rows without upsert/update permissions", async () => {
    await createSupabaseLocation(location);
    expect(mock.insert).toHaveBeenCalledWith({ id: location.id, jobsite_id: "SITE-001", building: "อาคาร A", floor: "2", room: "201" });
    expect(mock.upsert).not.toHaveBeenCalled();
  });

  it("rejects invalid paths before making any request", async () => {
    await expect(createSupabaseLocation({ ...location, floor: "" })).rejects.toThrow("ชั้น");
    expect(mock.from).not.toHaveBeenCalled();
  });

  it.each(["23505", "42501"])("propagates duplicate/denied catalog creation (%s)", async (code) => {
    mock.response.error = { code, message: "database rejected request" };
    await expect(createSupabaseLocation(location)).rejects.toEqual(mock.response.error);
    expect(mock.insert).toHaveBeenCalledTimes(1);
  });

  it("sends metadata and an explicit null when unlinking the location", async () => {
    const asset = { ...buildDefaultMasterData().assets[0], manufacturer: "Maker", model: "M1", serialNumber: "S1", locationId: null };
    await saveSupabaseAsset(asset);
    expect(mock.upsert).toHaveBeenCalledWith(expect.objectContaining({ id: asset.id, jobsite_id: asset.jobsiteId, manufacturer: "Maker", model: "M1", serial_number: "S1", location_id: null }));
  });

  it("propagates a rejected cross-site asset write", async () => {
    mock.response.error = { code: "23503", message: "assets_location_same_site_fk" };
    await expect(saveSupabaseAsset({ ...buildDefaultMasterData().assets[0], locationId: location.id })).rejects.toEqual(mock.response.error);
  });
});
