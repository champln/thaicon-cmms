// Isolated local stack only. Capture CLI output so generated keys never reach logs.
import { spawn } from "node:child_process";
import { mkdir, copyFile, readdir, readFile } from "node:fs/promises";
import path from "node:path";
const target = path.resolve(process.argv[2] ?? "");
const config = await readFile(path.join(target, "supabase/config.toml"), "utf8");
if (!config.includes('project_id = "thaicon-tor-local"') || !config.includes("port = 55681") || !config.includes("enabled = false")) throw new Error("Invalid isolated target");
const migrationDir = path.join(target, "supabase/migrations");
await mkdir(migrationDir, { recursive: true });
for (const file of (await readdir("supabase/migrations")).filter(f => f.endsWith(".sql"))) await copyFile(path.join("supabase/migrations", file), path.join(migrationDir, file));
console.log("Starting isolated thaicon-tor-local on ports 55681/55682; seeds disabled; output/keys suppressed");
const child = spawn("npx.cmd", ["--yes", "supabase@2.119.0", "start", "--workdir", target, "--exclude", "studio,postgres-meta,mailpit,imgproxy,edge-runtime,logflare,vector,supavisor"], { shell: true, stdio: ["ignore", "pipe", "pipe"] });
let captured = "";
for (const stream of [child.stdout, child.stderr]) stream.on("data", chunk => { captured += chunk.toString(); });
const timer = setInterval(() => console.log("Local stack start still running (image pull/health checks); no remote operations"), 30000);
child.on("error", err => { clearInterval(timer); console.error(err.message); process.exitCode = 1; });
child.on("close", code => {
  clearInterval(timer);
  if (code === 0) console.log("PASS: isolated local stack started; generated credentials not logged");
  else {
    // Whitelist diagnostic lines; never echo entire CLI output or JWT/key lines.
    console.error(captured.split(/\r?\n/).filter(line => /error|failed|unhealthy|invalid|unknown|permission/i.test(line) && !/key|secret|token|jwt|password|eyJ/i.test(line)).slice(-12).join("\n"));
    process.exitCode = code ?? 1;
  }
});
