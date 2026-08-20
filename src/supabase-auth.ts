import {
  jobsites as demoJobsites,
  roleLabels,
} from "./access";
import type { DemoUser, Jobsite, UserRole } from "./access";
import { supabase } from "./supabase";

export type SupabaseAccess = {
  user: DemoUser;
  sites: Jobsite[];
};

export type ProfileRow = {
  id: string;
  username: string;
  display_name: string;
  role: UserRole;
  title: string | null;
  is_active: boolean;
};

export type JobsiteRow = {
  id: string;
  name: string;
  province: string;
  site_type: string;
};

export class SupabaseAccessError extends Error {
  constructor(public readonly userMessage: string, cause?: unknown) {
    super(userMessage, { cause });
    this.name = "SupabaseAccessError";
  }
}

function requireSupabase() {
  if (!supabase) {
    throw new SupabaseAccessError("ยังไม่ได้ตั้งค่าการเชื่อมต่อ Supabase");
  }
  return supabase;
}

function getInitials(displayName: string) {
  const parts = displayName.trim().split(/\s+/).filter(Boolean);
  return parts.slice(0, 2).map((part) => part.charAt(0)).join("") || "TC";
}

export function mapSupabaseAccess(
  profile: ProfileRow,
  rows: JobsiteRow[],
): SupabaseAccess {
  const sites = rows.map((row) => {
    const demoSite = demoJobsites.find((site) => site.id === row.id);
    return {
      id: row.id,
      name: row.name,
      province: row.province,
      type: row.site_type,
      assetCount: demoSite?.assetCount ?? 0,
      openWorkOrders: demoSite?.openWorkOrders ?? 0,
      pmCompliance: demoSite?.pmCompliance ?? 0,
    } satisfies Jobsite;
  });

  return {
    user: {
      id: profile.id,
      username: profile.username,
      password: "",
      displayName: profile.display_name,
      initials: getInitials(profile.display_name),
      role: profile.role,
      title: profile.title?.trim() || roleLabels[profile.role],
      jobsiteIds: sites.map((site) => site.id),
    },
    sites,
  };
}

export async function loadSupabaseAccess(userId: string): Promise<SupabaseAccess> {
  const client = requireSupabase();
  const { data: profile, error: profileError } = await client
    .from("profiles")
    .select("id, username, display_name, role, title, is_active")
    .eq("id", userId)
    .single<ProfileRow>();

  if (profileError || !profile) {
    throw new SupabaseAccessError("ไม่พบข้อมูลผู้ใช้งานในระบบ", profileError);
  }
  if (!profile.is_active) {
    throw new SupabaseAccessError("บัญชีนี้ถูกระงับการใช้งาน");
  }

  const { data: siteRows, error: siteError } = await client
    .from("jobsites")
    .select("id, name, province, site_type")
    .eq("is_active", true)
    .order("name")
    .returns<JobsiteRow[]>();

  if (siteError) {
    throw new SupabaseAccessError("ไม่สามารถโหลดรายการไซต์ได้", siteError);
  }

  return mapSupabaseAccess(profile, siteRows ?? []);
}

export async function signInWithSupabase(
  email: string,
  password: string,
): Promise<SupabaseAccess> {
  const client = requireSupabase();
  const { data, error } = await client.auth.signInWithPassword({
    email: email.trim().toLocaleLowerCase("en"),
    password,
  });

  if (error || !data.user) {
    throw new SupabaseAccessError("อีเมลหรือรหัสผ่านไม่ถูกต้อง", error);
  }

  try {
    return await loadSupabaseAccess(data.user.id);
  } catch (error) {
    await client.auth.signOut();
    throw error;
  }
}

export async function restoreSupabaseAccess(): Promise<SupabaseAccess | null> {
  const client = requireSupabase();
  const { data, error } = await client.auth.getSession();

  if (error) {
    throw new SupabaseAccessError("ไม่สามารถตรวจสอบสถานะการเข้าสู่ระบบได้", error);
  }
  if (!data.session?.user) return null;

  return loadSupabaseAccess(data.session.user.id);
}

export async function signOutFromSupabase() {
  const client = requireSupabase();
  const { error } = await client.auth.signOut();
  if (error) {
    throw new SupabaseAccessError("ออกจากระบบไม่สำเร็จ", error);
  }
}
