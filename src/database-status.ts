export type DatabaseStatus = "checking" | "online" | "offline" | "restricted" | "demo";
export function classifyDatabaseProbe(result: { status: number; error: unknown }): DatabaseStatus {
  if (result.status === 401 || result.status === 403) return "restricted";
  return !result.error && result.status >= 200 && result.status < 300 ? "online" : "offline";
}
