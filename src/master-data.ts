import { demoUsers, jobsites } from "./access";
import type { DemoUser, Jobsite } from "./access";

export type AssetHealth = "ปกติ" | "เฝ้าระวัง" | "วิกฤต";

export type ManagedAsset = {
  id: string;
  name: string;
  type: string;
  jobsiteId: string;
  location: string;
  health: AssetHealth;
  lastPm: string;
  nextPm: string;
  sensor: string;
  active: boolean;
};

export type ManagedJobsite = Jobsite & { active: boolean };
export type ManagedUser = DemoUser & { active: boolean; email?: string };

export type MasterDataState = {
  jobsites: ManagedJobsite[];
  users: ManagedUser[];
  assets: ManagedAsset[];
};

const STORAGE_KEY = "thaicon-cmms-master-data-v1";

const defaultAssets: ManagedAsset[] = [
  { id: "AHU-OPD-01", name: "Air Handling Unit — OPD", type: "AHU", jobsiteId: "SITE-002", location: "อาคารผู้ป่วยนอก • ชั้น 2", health: "เฝ้าระวัง", lastPm: "2026-06-28", nextPm: "2026-07-30", sensor: "Online • 24.8°C", active: true },
  { id: "CR-DP-02", name: "Clean Room Differential Pressure", type: "Clean Room", jobsiteId: "SITE-001", location: "ห้องผ่าตัด • OR 2", health: "วิกฤต", lastPm: "2026-07-15", nextPm: "2026-07-28", sensor: "Online • 7.2 Pa", active: true },
  { id: "FREEZER-PH-03", name: "ตู้แช่ยา Pharmacy 03", type: "Medical Freezer", jobsiteId: "SITE-003", location: "ห้องยา • ชั้น 1", health: "ปกติ", lastPm: "2026-07-08", nextPm: "2026-08-08", sensor: "Online • 3.8°C", active: true },
  { id: "AHU-ICU-04", name: "Air Handling Unit — ICU", type: "AHU", jobsiteId: "SITE-005", location: "อาคาร B • ชั้น 7", health: "ปกติ", lastPm: "2026-07-22", nextPm: "2026-08-22", sensor: "Online • 23.1°C", active: true },
  { id: "CTRL-LAB-05", name: "Laboratory Control Panel", type: "Control Panel", jobsiteId: "SITE-004", location: "อาคารปฏิบัติการ • ชั้น 4", health: "เฝ้าระวัง", lastPm: "2026-07-01", nextPm: "2026-08-01", sensor: "Online • 41% load", active: true },
  { id: "EXF-ER-06", name: "Emergency Exhaust Fan", type: "Exhaust", jobsiteId: "SITE-006", location: "ห้องฉุกเฉิน • หลังอาคาร", health: "ปกติ", lastPm: "2026-07-18", nextPm: "2026-10-18", sensor: "Online • Running", active: true },
];

export function buildDefaultMasterData(): MasterDataState {
  return {
    jobsites: jobsites.map((site) => ({ ...site, active: true })),
    users: demoUsers.map((user) => ({ ...user, active: true })),
    assets: defaultAssets.map((asset) => ({ ...asset })),
  };
}

export function normalizeMasterData(value: unknown): MasterDataState {
  const defaults = buildDefaultMasterData();
  if (!value || typeof value !== "object") return defaults;
  const parsed = value as Partial<MasterDataState>;
  if (!Array.isArray(parsed.jobsites) || !Array.isArray(parsed.users) || !Array.isArray(parsed.assets)) return defaults;
  return {
    jobsites: parsed.jobsites.map((site) => ({ ...site, active: site.active !== false })),
    users: parsed.users.map((user) => ({ ...user, active: user.active !== false })),
    assets: parsed.assets.map((asset) => ({ ...asset, active: asset.active !== false })),
  };
}

export function loadMasterData(): MasterDataState {
  if (typeof window === "undefined") return buildDefaultMasterData();
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return stored ? normalizeMasterData(JSON.parse(stored)) : buildDefaultMasterData();
  } catch {
    return buildDefaultMasterData();
  }
}

export function saveMasterData(state: MasterDataState) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

export function authenticateManagedUser(users: ManagedUser[], username: string, password: string) {
  const normalized = username.trim().toLocaleLowerCase("en");
  return users.find((user) => user.active && user.username === normalized && user.password === password) ?? null;
}

export function jobsitesForManagedUser(state: MasterDataState, user: DemoUser) {
  const allowed = new Set(user.jobsiteIds);
  return state.jobsites
    .filter((site) => site.active && (user.role === "admin" || allowed.has(site.id)))
    .map((site) => ({ ...site, assetCount: state.assets.filter((asset) => asset.active && asset.jobsiteId === site.id).length }));
}

export function initialsFromName(displayName: string) {
  const parts = displayName.trim().split(/\s+/).filter(Boolean);
  return parts.slice(0, 2).map((part) => part[0]).join("") || "ผช";
}

export function nextMasterId(prefix: "SITE" | "USR", existingIds: string[] = []) {
  if (prefix === "SITE") {
    const highest = existingIds.reduce((max, id) => {
      const match = /^SITE-(\d+)$/.exec(id);
      return match ? Math.max(max, Number(match[1])) : max;
    }, 0);
    return `SITE-${String(highest + 1).padStart(3, "0")}`;
  }
  return `USR-${Date.now().toString(36).toUpperCase()}`;
}
