import type { UserRole } from "./access";
import type { AssetHealth, ManagedAsset, ManagedJobsite } from "./master-data";
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

export async function saveSupabaseJobsite(site: ManagedJobsite) {
  const { error } = await requireClient().from("jobsites").upsert({ id: site.id, name: site.name, province: site.province, site_type: site.type, is_active: site.active });
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
