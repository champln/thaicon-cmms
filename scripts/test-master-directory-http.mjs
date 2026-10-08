// Actual isolated Edge/Auth HTTP test; bulk synthetic users cannot log in.
// Usage: node scripts/test-master-directory-http.mjs <isolated-dir>
import { spawnSync } from "node:child_process";
import { randomUUID, randomInt } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";
const target = path.resolve(process.argv[2]);
assert.match(await readFile(path.join(target, "supabase/config.toml"), "utf8"), /project_id = "thaicon-tor-local"/);
const status = spawnSync("npx.cmd", ["--yes", "supabase@2.119.0", "status", "--workdir", target, "--output", "json"], { shell: true, encoding: "utf8" });
assert.equal(status.status, 0);
const keys = JSON.parse(status.stdout);
assert.equal(keys.API_URL, "http://127.0.0.1:55681");
const container = "supabase_db_thaicon-tor-local";
assert.equal(spawnSync("docker", ["inspect", container, "--format", "{{.Name}}"], { encoding: "utf8" }).stdout.trim(), "/" + container);
function sql(input) {
  const result = spawnSync("docker", ["exec", "-i", container, "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-Atq"], { input, encoding: "utf8" });
  if (result.status !== 0) throw Error("Isolated fixture failed");
  return result.stdout.trim();
}
const operator = createClient(keys.API_URL, keys.SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const client = createClient(keys.API_URL, keys.ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const suffix = randomUUID().slice(0, 8), email = `directory_admin_${suffix}@example.invalid`, password = randomUUID() + "Aa1!";
try {
  const account = await operator.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { username: "directory_admin_" + suffix } });
  assert.equal(account.error, null);
  const actor = account.data.user.id, siteBase = randomInt(10000000, 80000000);
  sql(`begin;
    update public.profiles set role='admin' where id='${actor}';
    insert into public.jobsites(id,name,province,site_type)
      select 'SITE-'||(${siteBase}+n),'Directory synthetic ${suffix}','Test','Test' from generate_series(0,1000) n;
    insert into auth.users(id,instance_id,aud,role,email,encrypted_password,confirmation_token,recovery_token,email_change_token_new,email_change,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
      select gen_random_uuid(),'00000000-0000-0000-0000-000000000000','authenticated','authenticated',
        'directory_${suffix}_'||n||'@example.invalid','','','','','',now(),'{"provider":"email","providers":["email"]}'::jsonb,
        jsonb_build_object('username','directory_${suffix}_'||n,'display_name','Directory same name ${suffix}'),now(),now()
      from generate_series(0,1000) n;
    insert into public.user_jobsites(user_id,jobsite_id)
      select '${actor}','SITE-'||(${siteBase}+n) from generate_series(0,1000) n;
    commit;`);
  const login = await client.auth.signInWithPassword({ email, password });
  assert.equal(login.error, null);
  const token = login.data.session.access_token;
  const list = async () => fetch(keys.API_URL + "/functions/v1/admin-users", {
    method: "POST", headers: { apikey: keys.ANON_KEY, Authorization: "Bearer " + token, "Content-Type": "application/json" }, body: '{"action":"list"}',
  });
  const response = await list();
  assert.equal(response.status, 200, "Local updated Edge directory must serve successfully");
  const body = await response.json();
  const fixtureProfiles = body.profiles.filter(profile => profile.username.startsWith("directory_" + suffix + "_"));
  assert.equal(fixtureProfiles.length, 1001);
  for (const profile of fixtureProfiles) assert.equal(profile.email, profile.username + "@example.invalid");
  assert.equal(body.assignments.filter(row => row.user_id === actor && Number(row.jobsite_id.slice(5)) >= siteBase && Number(row.jobsite_id.slice(5)) <= siteBase + 1000).length, 1001);
  assert.equal(new Set(body.profiles.map(row => row.id)).size, body.profiles.length);
  assert.equal(new Set(body.assignments.map(row => row.user_id + ":" + row.jobsite_id)).size, body.assignments.length);
  // Same actual JWT, current DB role: not an injected/mocked role.
  sql(`update public.profiles set role='user' where id='${actor}';`);
  assert.equal((await list()).status, 403);
  sql(`update public.profiles set role='engineer' where id='${actor}';`);
  assert.equal((await list()).status, 403);
  sql(`update public.profiles set role='admin',is_active=false where id='${actor}';`);
  assert.equal((await list()).status, 403);
  console.log("PASS: actual local Edge/Auth HTTP 1001 synthetic profiles + matching Auth emails + 1001 assignments, no duplicates; actual User/Engineer/inactive denied. Synthetic fixtures retained, no gates changed.");
} finally {
  await client.auth.signOut();
  client.realtime.disconnect();
  operator.realtime.disconnect();
}
