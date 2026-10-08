import type { UserRole } from "./access";
import { initialsFromName } from "./master-data";
import type { AssetHealth, AssetLocation, ManagedAsset, ManagedJobsite, ManagedUser, MasterDataState } from "./master-data";
import { validateLocation } from "./master-data";
import { supabase } from "./supabase";
import { readAllPages } from "./read-all-pages";

// Bound the URL as well as the response; repeated site IDs must not duplicate rows.
function siteBatches(ids: string[]) {
  const unique = [...new Set(ids)];
  return Array.from({ length: Math.ceil(unique.length / 200) }, (_, index) => unique.slice(index * 200, (index + 1) * 200));
}

const healthToDb: Record<AssetHealth, "normal" | "watch" | "critical"> = { ปกติ: "normal", เฝ้าระวัง: "watch", วิกฤต: "critical" };
const healthFromDb = { normal: "ปกติ", watch: "เฝ้าระวัง", critical: "วิกฤต" } as const;

function requireClient() {
  if (!supabase) throw new Error("ยังไม่ได้ตั้งค่า Supabase");
  return supabase;
}

export async function loadSupabaseAssets(jobsiteIds: string[]): Promise<ManagedAsset[]> {
  if (!jobsiteIds.length) return [];
  const batches = await Promise.all(siteBatches(jobsiteIds).map((ids) => readAllPages((start, end) => requireClient().from("assets").select("id, jobsite_id, name, asset_type, location, health, sensor_summary, last_pm, next_pm, is_active, building, floor, room, manufacturer, model, serial_number, location_id").in("jobsite_id", ids).order("name").order("id").range(start, end))));
  const data = batches.flat();
  return (data ?? []).map((row) => ({ id: row.id, jobsiteId: row.jobsite_id, name: row.name, type: row.asset_type, location: row.location, health: healthFromDb[row.health as keyof typeof healthFromDb], sensor: row.sensor_summary, lastPm: row.last_pm ?? "", nextPm: row.next_pm ?? "", active: row.is_active, building: row.building, floor: row.floor, room: row.room, manufacturer: row.manufacturer, model: row.model, serialNumber: row.serial_number, locationId: row.location_id }));
}

export async function loadSupabaseLocations(jobsiteIds: string[]): Promise<AssetLocation[]> {
  if (!jobsiteIds.length) return [];
  const batches = await Promise.all(siteBatches(jobsiteIds).map((ids) => readAllPages((start, end) => requireClient().from("asset_locations").select("id, jobsite_id, building, floor, room").in("jobsite_id", ids).order("building").order("floor").order("room").order("id").range(start, end))));
  const data = batches.flat();
  return (data ?? []).map((row) => ({ id: row.id, jobsiteId: row.jobsite_id, building: row.building, floor: row.floor, room: row.room }));
}

export async function createSupabaseLocation(location: AssetLocation) {
  validateLocation(location);
  const { error } = await requireClient().from("asset_locations").insert({ id: location.id, jobsite_id: location.jobsiteId, building: location.building, floor: location.floor, room: location.room });
  if (error) throw error;
}

type AdminProfileRow = {
  id: string;
  username: string;
  display_name: string;
  email: string;
  role: UserRole;
  title: string | null;
  is_active: boolean;
};

type AdminUsersResponse = {
  profiles: AdminProfileRow[];
  assignments: Array<{ user_id: string; jobsite_id: string }>;
};

export async function loadSupabaseAdminMasterData(): Promise<MasterDataState> {
  const client = requireClient();
  const [siteRows, usersResponse] = await Promise.all([
    readAllPages((start, end) => client.from("jobsites").select("id, name, province, site_type, is_active, pm_compliance").order("id").range(start, end)),
    manageSupabaseUser({ action: "list" }) as Promise<AdminUsersResponse>,
  ]);
  const jobsites: ManagedJobsite[] = (siteRows ?? []).map((row) => ({
    id: row.id,
    name: row.name,
    province: row.province,
    type: row.site_type,
    assetCount: null,
    openWorkOrders: null,
    pmCompliance: row.pm_compliance == null ? null : Number(row.pm_compliance),
    active: row.is_active,
  }));
  const [assets, locations] = await Promise.all([loadSupabaseAssets(jobsites.map((site) => site.id)), loadSupabaseLocations(jobsites.map((site) => site.id))]);
  const assignments = new Map<string, string[]>();
  usersResponse.assignments.forEach((row) => assignments.set(row.user_id, [...(assignments.get(row.user_id) ?? []), row.jobsite_id]));
  const users: ManagedUser[] = usersResponse.profiles.map((profile) => ({
    id: profile.id,
    username: profile.username,
    password: "",
    email: profile.email,
    displayName: profile.display_name,
    initials: initialsFromName(profile.display_name),
    role: profile.role,
    title: profile.title?.trim() || profile.role,
    jobsiteIds: assignments.get(profile.id) ?? [],
    active: profile.is_active,
  }));
  return {
    jobsites: jobsites.map((site) => ({ ...site, assetCount: assets.filter((asset) => asset.active && asset.jobsiteId === site.id).length })),
    users,
    assets,
    locations,
  };
}

export async function saveSupabaseJobsite(site: ManagedJobsite) {
  const { error } = await requireClient().from("jobsites").upsert({ id: site.id, name: site.name, province: site.province, site_type: site.type, is_active: site.active, pm_compliance: site.pmCompliance });
  if (error) throw error;
}

export async function deleteSupabaseJobsite(id: string) {
  const { error } = await requireClient().from("jobsites").delete().eq("id", id);
  if (error) throw error;
}

export function assetPayload(asset: ManagedAsset) {
  return { id: asset.id, jobsite_id: asset.jobsiteId, name: asset.name, asset_type: asset.type, location: asset.location, health: healthToDb[asset.health], sensor_summary: asset.sensor, last_pm: asset.lastPm || null, next_pm: asset.nextPm || null, is_active: asset.active, building: asset.building ?? "", floor: asset.floor ?? "", room: asset.room ?? "", manufacturer: asset.manufacturer ?? "", model: asset.model ?? "", serial_number: asset.serialNumber ?? "", location_id: asset.locationId || null };
}

export async function saveSupabaseAsset(asset: ManagedAsset) {
  const { error } = await requireClient().from("assets").upsert(assetPayload(asset));
  if (error) throw error;
}

export async function deleteSupabaseAsset(id: string) {
  const { error } = await requireClient().from("assets").delete().eq("id", id);
  if (error) throw error;
}

export type AdminUserRequest = {
  action: "list" | "create" | "update" | "delete";
  userId?: string;
  email?: string;
  password?: string;
  username?: string;
  displayName?: string;
  role?: UserRole;
  title?: string;
  active?: boolean;
  jobsiteIds?: string[];
};

export async function manageSupabaseUser(request: AdminUserRequest) {
  const { data, error } = await requireClient().functions.invoke("admin-users", { body: request });
  if (error) throw error;
  if (data?.error) throw new Error(String(data.error));
  return data;
}
