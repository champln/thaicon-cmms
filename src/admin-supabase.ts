import type { UserRole } from "./access";
import { initialsFromName } from "./master-data";
import type { AssetHealth, ManagedAsset, ManagedJobsite, ManagedUser, MasterDataState } from "./master-data";
import { supabase } from "./supabase";

const healthToDb: Record<AssetHealth, "normal" | "watch" | "critical"> = { ปกติ: "normal", เฝ้าระวัง: "watch", วิกฤต: "critical" };
const healthFromDb = { normal: "ปกติ", watch: "เฝ้าระวัง", critical: "วิกฤต" } as const;

function requireClient() {
  if (!supabase) throw new Error("ยังไม่ได้ตั้งค่า Supabase");
  return supabase;
}

export async function loadSupabaseAssets(jobsiteIds: string[]): Promise<ManagedAsset[]> {
  if (!jobsiteIds.length) return [];
  const { data, error } = await requireClient().from("assets").select("id, jobsite_id, name, asset_type, location, health, sensor_summary, last_pm, next_pm, is_active").in("jobsite_id", jobsiteIds).order("name");
  if (error) throw error;
  return (data ?? []).map((row) => ({ id: row.id, jobsiteId: row.jobsite_id, name: row.name, type: row.asset_type, location: row.location, health: healthFromDb[row.health as keyof typeof healthFromDb], sensor: row.sensor_summary, lastPm: row.last_pm ?? "", nextPm: row.next_pm ?? "", active: row.is_active }));
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
  const [{ data: siteRows, error: siteError }, usersResponse] = await Promise.all([
    client.from("jobsites").select("id, name, province, site_type, is_active, pm_compliance").order("id"),
    manageSupabaseUser({ action: "list" }) as Promise<AdminUsersResponse>,
  ]);
  if (siteError) throw siteError;
  const jobsites: ManagedJobsite[] = (siteRows ?? []).map((row) => ({
    id: row.id,
    name: row.name,
    province: row.province,
    type: row.site_type,
    assetCount: 0,
    openWorkOrders: 0,
    pmCompliance: Number(row.pm_compliance ?? 0),
    active: row.is_active,
  }));
  const assets = await loadSupabaseAssets(jobsites.map((site) => site.id));
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

export async function saveSupabaseAsset(asset: ManagedAsset) {
  const { error } = await requireClient().from("assets").upsert({ id: asset.id, jobsite_id: asset.jobsiteId, name: asset.name, asset_type: asset.type, location: asset.location, health: healthToDb[asset.health], sensor_summary: asset.sensor, last_pm: asset.lastPm || null, next_pm: asset.nextPm || null, is_active: asset.active });
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
