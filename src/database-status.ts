export type DatabaseStatus = "checking" | "online" | "offline" | "restricted" | "unknown" | "demo";
export function classifyDatabaseProbe(result: { status: number; error: unknown; data: unknown }): DatabaseStatus {
  if (result.status === 401 || result.status === 403) return "restricted";
  // Only the dedicated PostgreSQL probe's exact response confirms reachability.
  // A missing RPC, permission error or unexpected payload is not proof of downtime.
  if (!result.error && result.status >= 200 && result.status < 300 && result.data === true) return "online";
  if (result.status === 0 || result.status >= 500) return "offline";
  return "unknown";
}
