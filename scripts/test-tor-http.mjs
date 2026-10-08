// Real Auth/JWT/HTTP/Storage/Postgres Changes against isolated Docker ONLY.
// CLI-generated credentials and random passwords remain in memory, never logged.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { checkPdfPhotos } from "./check-pdf-photos.mjs";
import { syntheticPhoto } from "./synthetic-photo.mjs";
const target = path.resolve(process.argv[2] ?? "");
assert.match(await readFile(path.join(target, "supabase/config.toml"), "utf8"), /project_id = "thaicon-tor-local"/);
const container = "supabase_db_thaicon-tor-local";
function docker(args, input) {
  const r = spawnSync("docker", args, { input, maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) {
    const diagnostic = r.stderr.toString().split(/\r?\n/).filter(line => /^pg_restore: error:|^pg_dump: error:|^ERROR:/.test(line)).slice(0,2).map(line => line.replace(/eyJ\S+/g,"[redacted]").slice(0,220)).join("; ");
    throw Error(`Local Docker ${args[0]} failed${diagnostic ? ": " + diagnostic : " (details suppressed)"}`);
  }
  return r.stdout;
}
assert.equal(docker(["inspect", container, "--format", "{{.Name}}"]).toString().trim(), "/" + container);
const status = spawnSync("npx.cmd", ["--yes", "supabase@2.119.0", "status", "--workdir", target, "--output", "json"], { shell: true, encoding: "utf8" });
if (status.status !== 0) throw Error("Isolated stack status failed");
const keys = JSON.parse(status.stdout);
assert.equal(keys.API_URL, "http://127.0.0.1:55681");
assert.ok(keys.ANON_KEY && keys.SERVICE_ROLE_KEY);
const opts = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };
const operator = createClient(keys.API_URL, keys.SERVICE_ROLE_KEY, opts);
const sql = command => docker(["exec", "-i", container, "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-Atq"], command).toString().trim();
// Apply only newly pending local test migrations if this stack started before them.
for (const file of ["202610060007_cycle_zero_targets.sql", "202610060008_storage_scope_recheck.sql", "202610060009_service_report_reviews.sql", "202610060010_service_report_drafts.sql"]) {
  const version = file.split("_")[0];
  if (sql(`select count(*) from supabase_migrations.schema_migrations where version='${version}';`) === "0" || file === "202610060008_storage_scope_recheck.sql") {
    const source = await readFile(new URL("../supabase/migrations/" + file, import.meta.url), "utf8");
    const resetLocalPolicy = file === "202610060008_storage_scope_recheck.sql" ? 'drop policy if exists "service files require active role and site" on storage.objects;' : "";
    sql(`begin; ${resetLocalPolicy} ${source} insert into supabase_migrations.schema_migrations(version,name,statements) values('${version}','local-check',array[]::text[]) on conflict(version) do nothing; commit;`);
  } else if(file==='202610060009_service_report_reviews.sql') {
    // This file is still unpublished. Refresh just its reviewed local function
    // definition after development edits; never do this on a linked project.
    const source=await readFile(new URL('../supabase/migrations/'+file,import.meta.url),'utf8');
    const start=source.indexOf('create function public.apply_service_report_review(');
    const end=source.indexOf('\nrevoke all on function public.apply_service_report_review',start);
    assert.ok(start>=0&&end>start);
    sql('begin;'+source.slice(start,end).replace('create function','create or replace function')+'commit;');
  }
}
const suffix = randomUUID().slice(0, 8);
const accounts = {};
const clients = [];
const channels = [];
function ok(result, label) { if (result.error) throw Error(`${label}: ${result.error.code ?? result.error.status ?? "failed"}`); return result.data; }
async function deny(promise, label, expected = ["42501", "AccessDenied"]) {
  const r = await promise;
  if (r.error) assert.ok(expected.includes(String(r.error.code)), `${label}: wrong error code ${r.error.code ?? "network/unknown"}`);
  else assert.ok(Array.isArray(r.data) && r.data.length === 0, `${label}: unexpectedly permitted`);
}
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const deadline = async predicate => { for (let n=0; n<60; n++) { if (predicate()) return; await wait(250); } throw Error("Realtime delivery timeout"); };
const reportGateBefore=sql('select reviews_enabled from private.service_report_settings where singleton;');
const draftGateBefore=sql('select drafts_enabled from private.service_report_settings where singleton;');
try {
  for (const role of ["admin", "engineer", "user"]) {
    const email = `tor_${role}_${suffix}@example.invalid`, password = randomUUID() + "Aa1!";
    const created = ok(await operator.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { username: `tor_${role}_${suffix}`, display_name: `TOR ${role}` } }), "create local Auth user");
    const client = createClient(keys.API_URL, keys.ANON_KEY, opts); clients.push(client);
    ok(await client.auth.signInWithPassword({ email, password }), "real password login");
    accounts[role] = { id: created.user.id, client };
  }
  const { admin, engineer, user } = accounts;
  sql(`update public.profiles set role='admin' where id='${admin.id}'; update public.profiles set role='engineer' where id='${engineer.id}';
    insert into public.jobsites(id,name,province,site_type) values ('SITE-907','TOR A','Test','Test'),('SITE-908','TOR B','Test','Test') on conflict(id) do nothing;
    insert into public.assets(id,jobsite_id,name,asset_type,location) values('TOR-A','SITE-907','AC A','AC','Test'),('TOR-B','SITE-908','AC B','AC','Test') on conflict(id) do nothing;
    insert into public.user_jobsites(user_id,jobsite_id) values('${engineer.id}','SITE-907'),('${user.id}','SITE-907');
    update private.work_order_settings set enabled=true;`);
  assert.equal(ok(await admin.client.rpc("work_order_commands_ready"), "gate"), true);
  const visible = ok(await user.client.from("jobsites").select("id"), "viewer sites");
  assert.deepEqual(visible.map(r=>r.id), ["SITE-907"]);
  const delivered = { engineer: [], user: [] };
  for (const role of ["engineer", "user"]) {
    let postgresReady = false;
    const channel = accounts[role].client.channel(`tor-${role}-${suffix}`)
      .on("system", {}, payload => {
        if (payload.extension === "postgres_changes" && payload.status === "ok") postgresReady = true;
        console.log(`Local Realtime ${role}: extension=${payload.extension} status=${payload.status}`);
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "work_orders" }, payload => delivered[role].push(payload.new));
    channels.push({ client: accounts[role].client, channel });
    await new Promise((resolve, reject) => { const timer = setTimeout(()=>reject(Error("Realtime subscribe timeout")), 15000); channel.subscribe(state => { if (state === "SUBSCRIBED") { clearTimeout(timer); resolve(); } if (state === "CHANNEL_ERROR") { clearTimeout(timer); reject(Error("Realtime channel error")); } }); });
    await deadline(() => postgresReady);
  }
  await wait(800);
  const oid = "WO-" + randomUUID();
  const create = { p_order_id: oid, p_request_id: randomUUID(), p_site_id: "SITE-907", p_asset_id: "TOR-A", p_title: "HTTP TOR", p_work_type: "CM", p_priority: "normal", p_due_label: "2026-10-10", p_description: "Synthetic local only" };
  ok(await admin.client.rpc("create_work_order_command", create), "create");
  await deadline(()=>delivered.engineer.some(r=>r.id===oid) && delivered.user.some(r=>r.id===oid));
  const foreign = "WO-" + randomUUID();
  ok(await admin.client.rpc("create_work_order_command", { ...create, p_order_id: foreign, p_request_id: randomUUID(), p_site_id: "SITE-908", p_asset_id: "TOR-B" }), "foreign create");
  await wait(1200);
  assert.ok(!delivered.user.some(r=>r.id===foreign) && !delivered.engineer.some(r=>r.id===foreign));
  console.log("PASS: real JWT login, viewer site RLS, two authenticated clients receive Postgres Changes, other-site event hidden");
  const command = (client, version, kind, extra={}) => client.rpc("apply_work_order_command", { p_order_id: oid, p_expected_version: version, p_request_id: randomUUID(), p_command: kind, ...extra });
  await deny(command(user.client, 1, "start"), "viewer command");
  ok(await command(admin.client, 1, "assign", { p_assignee_id: engineer.id }), "assign");
  ok(await command(engineer.client, 2, "start"), "start");
  const material = { p_order_id: oid, p_expected_version: 3, p_request_id: randomUUID(), p_action: "add", p_name: "ไส้กรอง HTTP", p_quantity: 1.2345, p_unit: "ชิ้น" };
  ok(await engineer.client.rpc("record_work_order_material", material), "material");
  const replay = ok(await engineer.client.rpc("record_work_order_material", material), "retry");
  assert.equal(replay.replayed, true);
  await deny(command(engineer.client, 3, "submit"), "stale conflict", ["40001"]);
  await deny(user.client.from("work_orders").update({ title: "Forbidden" }).eq("id",oid).select(), "viewer direct write");
  const receipt = ok(await user.client.from("work_order_materials").select("*").eq("work_order_id",oid), "viewer materials");
  assert.equal(receipt.length,1); assert.equal(Number(receipt[0].quantity),1.2345);
  assert.equal(ok(await user.client.from("work_orders").select("*").eq("id",foreign), "foreign read").length,0);
  ok(await command(engineer.client,4,"submit"), "submit");
  ok(await command(admin.client,5,"approve"), "approve");
  assert.equal(ok(await user.client.from("work_orders").select("version,status").eq("id",oid).single(), "persisted").version,6);
  console.log("PASS: HTTP create/assign/start/material/exact retry/stale conflict/review; viewer reads evidence but cannot write");
  const bucket = "service-report-photos", object = `SITE-907/${suffix}/proof.png`;
  const png = syntheticPhoto;
  const uploaded = await engineer.client.storage.from(bucket).upload(object,png,{ contentType:"image/png" });
  if (uploaded.error) console.log("Local Storage upload diagnostic:", uploaded.error.message.replace(/eyJ\S+/g,"[redacted]").slice(0,300));
  ok(uploaded, "private photo upload");
  await deny(user.client.storage.from(bucket).upload(`SITE-907/${suffix}/viewer.png`,png,{contentType:"image/png"}), "viewer upload");
  await deny(engineer.client.storage.from(bucket).upload(`SITE-908/${suffix}/foreign.png`,png,{contentType:"image/png"}), "foreign upload");
  const signed = ok(await user.client.storage.from(bucket).createSignedUrl(object,60), "viewer signed URL");
  const photo = await fetch(signed.signedUrl); assert.equal(photo.status,200); assert.deepEqual(Buffer.from(await photo.arrayBuffer()),png);
  const publicPhoto = await fetch(`${keys.API_URL}/storage/v1/object/public/${bucket}/${object}`); assert.notEqual(publicPhoto.status,200);
  if(process.argv[3]&&process.argv[4])await checkPdfPhotos(process.argv[3],path.resolve(process.argv[4]),signed.signedUrl);
  const planId=`HTTP-PLAN-${suffix}`, reportId=`HTTP-SR-${suffix}`;
  sql(`insert into public.maintenance_plans(id,jobsite_id,name,service_type,plan_year,annual_target,cycle_months,created_by)
    values('${planId}','SITE-907','HTTP PM','PM',2026,12,1,'${admin.id}');`);
  ok(await engineer.client.from('service_reports').insert({id:reportId,jobsite_id:'SITE-907',plan_id:planId,cycle_id:planId+'-C01',asset_id:'TOR-A',asset_name:'AC A',service_date:'2026-10-06',quantity:2,technician_name:'Tech',customer_name:'Customer',work_performed:'Clean',findings:'',action_taken:'',created_by:engineer.id}),'report draft');
  const proof=`SITE-907/${reportId}/proof.png`;
  ok(await engineer.client.storage.from(bucket).upload(proof,png,{contentType:'image/png'}),'draft report photo');
  ok(await engineer.client.from('service_report_attachments').insert({service_report_id:reportId,storage_path:proof,file_name:'proof.png',content_type:'image/png',file_size:png.length,uploaded_by:engineer.id}),'draft metadata');
  sql('update private.service_report_settings set reviews_enabled=true;');
  const review={p_report_id:reportId,p_expected_version:1,p_request_id:randomUUID(),p_command:'submit'};
  ok(await engineer.client.storage.from(bucket).remove([proof]),'remove exact draft proof to test missing object');
  await deny(engineer.client.rpc('apply_service_report_review',review),'missing report photo submit',['22023']);
  assert.equal(sql(`select version from public.service_reports where id='${reportId}';`),'1');
  ok(await engineer.client.storage.from(bucket).upload(proof,png,{contentType:'image/png'}),'restore exact draft proof before submit');
  ok(await engineer.client.rpc('apply_service_report_review',review),'HTTP submit report');
  await deny(engineer.client.storage.from(bucket).update(proof,png,{contentType:'image/png'}),'submitted photo owner update');
  await deny(engineer.client.storage.from(bucket).remove([proof]),'submitted photo owner remove');
  assert.equal(sql(`select count(*) from storage.objects where bucket_id='${bucket}' and name='${proof}';`),'1');
  await deny(engineer.client.from('service_report_attachments').delete().eq('service_report_id',reportId).select(),'submitted metadata remove');
  await deny(user.client.rpc('apply_service_report_review',{...review,p_expected_version:2,p_request_id:randomUUID(),p_command:'approve'}),'viewer approve report');
  const approve={...review,p_expected_version:2,p_request_id:randomUUID(),p_command:'approve'};
  const approvals=await Promise.all([admin.client.rpc('apply_service_report_review',approve),admin.client.rpc('apply_service_report_review',approve)]);
  assert.equal(approvals.filter(r=>ok(r,'concurrent same review').replayed).length,1);
  await deny(admin.client.rpc('apply_service_report_review',{...approve,p_request_id:randomUUID()}),'second approval version conflict',['40001']);
  await deny(admin.client.from('service_reports').update({quantity:99}).eq('id',reportId).select(),'approved report edit');
  await deny(engineer.client.storage.from(bucket).upload(proof,png,{contentType:'image/png',upsert:true}),'approved photo owner upsert');
  await deny(admin.client.storage.from(bucket).remove([proof]),'approved photo Admin delete');
  assert.equal(sql(`select actual from public.plan_progress where plan_id='${planId}';`),'2');
  const proofUrl=ok(await user.client.storage.from(bucket).createSignedUrl(proof,60),'approved photo viewer URL');
  assert.deepEqual(Buffer.from(await(await fetch(proofUrl.signedUrl)).arrayBuffer()),png);
  sql(`update private.service_report_settings set reviews_enabled=${reportGateBefore==='t'?'true':'false'};`);
  console.log('PASS: real JWT report review/exact concurrent retry/Actual once; submitted and approved Storage bytes+metadata locked, viewer proof retained');
  sql('update private.service_report_settings set reviews_enabled=true,drafts_enabled=true;');
  const atomicId='SR-'+randomUUID();
  const draftData={plan_id:planId,cycle_id:planId+'-C01',asset_id:'TOR-A',work_order_id:null,service_date:'2026-10-06',quantity:3,technician_name:'Tech',customer_name:'Customer',work_performed:'Clean',findings:'Motor noise',action_taken:'Inspect',result:'repair_required',attachments:[]};
  const createDraft={p_report_id:atomicId,p_site_id:'SITE-907',p_expected_version:0,p_request_id:randomUUID(),p_data:draftData,p_submit:false};
  ok(await engineer.client.rpc('save_service_report_command',createDraft),'atomic create draft');
  assert.equal(ok(await engineer.client.rpc('save_service_report_command',createDraft),'create retry').replayed,true);
  const atomicPath=`SITE-907/${atomicId}/proof.png`;
  ok(await engineer.client.storage.from(bucket).upload(atomicPath,png,{contentType:'image/png'}),'staged atomic proof');
  const submitDraft={...createDraft,p_expected_version:1,p_request_id:randomUUID(),p_submit:true,p_data:{...draftData,attachments:[{id:randomUUID(),storage_path:atomicPath,file_name:'proof.png',content_type:'image/png',file_size:png.length}]}};
  await deny(user.client.rpc('save_service_report_command',submitDraft),'viewer atomic save');
  const saved=await Promise.all([engineer.client.rpc('save_service_report_command',submitDraft),engineer.client.rpc('save_service_report_command',submitDraft)]);
  assert.equal(saved.filter(result=>ok(result,'atomic save same retry').replayed).length,1);
  await deny(engineer.client.from('service_reports').update({quantity:99}).eq('id',atomicId).select(),'atomic direct bypass');
  ok(await admin.client.rpc('apply_service_report_review',{p_report_id:atomicId,p_expected_version:2,p_request_id:randomUUID(),p_command:'return',p_reason:'Add detail'}),'atomic return');
  const corrected={...submitDraft,p_expected_version:3,p_request_id:randomUUID(),p_submit:false};
  ok(await engineer.client.rpc('save_service_report_command',corrected),'returned Engineer save with existing photo');
  const resubmitted={...corrected,p_expected_version:4,p_request_id:randomUUID(),p_submit:true};
  ok(await engineer.client.rpc('save_service_report_command',resubmitted),'atomic resubmit');
  ok(await admin.client.rpc('apply_service_report_review',{p_report_id:atomicId,p_expected_version:5,p_request_id:randomUUID(),p_command:'approve'}),'atomic approval');
  assert.equal(sql(`select version from public.service_reports where id='${atomicId}';select count(*) from public.repair_requests where service_report_id='${atomicId}';select actual from public.plan_progress where plan_id='${planId}';`),'6\n1\n5');
  sql(`update private.service_report_settings set reviews_enabled=${reportGateBefore==='t'?'true':'false'},drafts_enabled=${draftGateBefore==='t'?'true':'false'};`);
  console.log('PASS: real JWT atomic draft/create/exact retry/photo metadata+repair draft/save_submit/return/Engineer correction/resubmit/approve; one repair, approved Actual exactly once');
  sql(`delete from public.user_jobsites where user_id='${engineer.id}';`);
  await deny(engineer.client.storage.from(bucket).update(object,png,{contentType:"image/png"}), "revoked owner update");
  sql(`insert into public.user_jobsites(user_id,jobsite_id) values('${engineer.id}','SITE-907'); update public.profiles set is_active=false where id='${engineer.id}';`);
  await deny(engineer.client.storage.from(bucket).update(object,png,{contentType:"image/png"}), "disabled owner update");
  await deny(command(engineer.client,6,"note",{p_note:"Denied"}), "disabled stale JWT command");
  assert.equal(ok(await engineer.client.from("work_orders").select("id").eq("id",oid), "disabled read").length,0);
  console.log("PASS: real private Storage upload/signed download, anonymous/viewer/cross-site denial, revoked/disabled owner's stale JWT blocked");
  // Existing admin Edge workflow: only this newly-created disposable identity
  // is edited/deleted; real Admin/User JWTs exercise function authorization.
  async function edge(client, payload) {
    const session=ok(await client.auth.getSession(),"Edge session").session;
    const response=await fetch(`${keys.API_URL}/functions/v1/admin-users`,{method:"POST",headers:{apikey:keys.ANON_KEY,Authorization:`Bearer ${session.access_token}`,"Content-Type":"application/json"},body:JSON.stringify(payload)});
    return {status:response.status,data:await response.json()};
  }
  const fixtureUsername=`edge_fixture_${suffix}`, fixtureEmail=`${fixtureUsername}@example.invalid`, fixturePassword=randomUUID()+"Aa1!";
  const edgeCreate={action:"create",email:fixtureEmail,password:fixturePassword,username:fixtureUsername,displayName:"Synthetic Edge fixture",role:"user",jobsiteIds:["SITE-907"]};
  assert.equal((await edge(user.client,edgeCreate)).status,403);
  const createdEdge=await edge(admin.client,edgeCreate);assert.equal(createdEdge.status,200);assert.ok(createdEdge.data.userId);
  const fixtureId=createdEdge.data.userId;assert.match(fixtureId,/^[a-f0-9-]{36}$/);
  assert.equal((await edge(admin.client,{action:"update",userId:fixtureId,role:"engineer",jobsiteIds:["SITE-908"]})).status,200);
  const fixtureClient=createClient(keys.API_URL,keys.ANON_KEY,opts);clients.push(fixtureClient);
  ok(await fixtureClient.auth.signInWithPassword({email:fixtureEmail,password:fixturePassword}),"Edge-created fixture login");
  assert.deepEqual(ok(await fixtureClient.from("jobsites").select("id"),"Edge assignment RLS").map(r=>r.id),["SITE-908"]);
  assert.equal((await edge(user.client,{action:"update",userId:fixtureId,role:"admin"})).status,403);
  assert.equal((await edge(admin.client,{action:"update",userId:fixtureId,active:false})).status,200);
  assert.equal(ok(await fixtureClient.from("jobsites").select("id"),"disabled Edge fixture RLS").length,0);
  const usernameDenied=await fetch(`${keys.API_URL}/functions/v1/username-login`,{method:"POST",headers:{apikey:keys.ANON_KEY,"Content-Type":"application/json"},body:JSON.stringify({username:fixtureUsername,password:fixturePassword})});assert.equal(usernameDenied.status,401);
  assert.equal((await edge(admin.client,{action:"delete",userId:fixtureId})).status,200);
  assert.equal(sql(`select count(*) from auth.users where id='${fixtureId}';`),"0");
  console.log("PASS: local Admin Edge create/update/scope change/disable/delete for one fresh fixture; non-admin create/update denied; disabled username login denied; exact fixture deleted");
  // Restore full DB into a distinct disposable database inside this isolated
  // container. Dump (including auth hashes) stays in memory, not a source file.
  const recovery = `tor_restore_${suffix.replaceAll("-", "")}`;
  assert.match(recovery,/^tor_restore_[a-f0-9]{8}$/);
  console.log("Testing in-memory backup and separate recovery database, including ACLs/RLS");
  const dump = docker(["exec",container,"pg_dump","-U","supabase_admin","-d","postgres","-Fc"]);
  sql(`create database ${recovery} template template0;`);
  try {
    // Supabase's postgres role is deliberately not superuser; restoring platform
    // extension settings needs the existing local platform operator role.
    docker(["exec","-i",container,"pg_restore","-U","supabase_admin","-d",recovery,"--exit-on-error"],dump);
    const restored = docker(["exec",container,"psql","-U","postgres","-d",recovery,"-Atq","-c",`select version||':'||status from public.work_orders where id='${oid}'; select count(*) from public.work_order_events where work_order_id='${oid}'; select quantity from public.work_order_materials where work_order_id='${oid}'; select count(*) from auth.users where id='${user.id}';`]).toString().trim();
    assert.equal(restored,"6:completed\n6\n1.2345\n1");
    const authorization = docker(["exec",container,"psql","-U","postgres","-d",recovery,"-Atq","-c",`select relrowsecurity from pg_class where oid='public.work_order_materials'::regclass; select has_table_privilege('authenticated','public.work_order_materials','SELECT'),has_table_privilege('authenticated','public.work_order_materials','INSERT'); select has_function_privilege('authenticated','public.record_work_order_material(text,integer,uuid,text,text,numeric,text,uuid,text)','EXECUTE'); select count(*) from pg_policies where schemaname='storage' and policyname='service files require active role and site';`]).toString().trim();
    assert.equal(authorization,"t\nt|f\nt\n1");
    const isolatedRead = docker(["exec",container,"psql","-U","postgres","-d",recovery,"-Atq","-c",`begin; set local role authenticated; set local request.jwt.claim.sub='${user.id}'; select count(*) from public.work_orders where id='${oid}'; select count(*) from public.work_orders where id='${foreign}'; rollback;`]).toString().trim();
    assert.equal(isolatedRead,"1\n0");
    // Storage bytes are backed up separately from PostgreSQL and restored to a
    // new synthetic path using a real authorized Admin JWT, not service-role.
    const photoBackup = Buffer.from(await (await fetch(signed.signedUrl)).arrayBuffer());
    ok(await admin.client.storage.from(bucket).remove([object]), "remove own synthetic source for recovery test");
    assert.equal(sql(`select count(*) from storage.objects where bucket_id='${bucket}' and name='${object}';`),"0");
    const restoredObject = `SITE-907/${suffix}/restored-proof.png`;
    ok(await admin.client.storage.from(bucket).upload(restoredObject,photoBackup,{contentType:"image/png"}), "restore synthetic object");
    const restoredUrl = ok(await user.client.storage.from(bucket).createSignedUrl(restoredObject,60), "restored photo viewer access");
    const recoveredPhoto = await fetch(restoredUrl.signedUrl); assert.equal(recoveredPhoto.status,200);
    assert.deepEqual(Buffer.from(await recoveredPhoto.arrayBuffer()),png);
    console.log("PASS: DB restore preserves data/Auth/owners/ACL/RLS and scoped viewer reads; separately backed-up synthetic photo restored to a new path after deleting its exact synthetic source, bytes/viewer access verified");
  } finally { sql(`drop database ${recovery};`); }
  console.log("Local full-stack checks complete, including targeted Edge paths; not production/customer UAT sign-off, exhaustive security or load/disaster-recovery acceptance");
} catch (error) {
  // Assertions and own diagnostic labels only; don't print Supabase error objects.
  console.error("FAIL:", error instanceof Error ? error.message : "local check failed");
  process.exitCode=1;
} finally {
  sql(`update private.service_report_settings set reviews_enabled=${reportGateBefore==='t'?'true':'false'},drafts_enabled=${draftGateBefore==='t'?'true':'false'};`);
  for (const {client,channel} of channels) await client.removeChannel(channel);
  for (const client of clients) client.realtime.disconnect();
  for (const client of clients) await client.auth.signOut();
  operator.realtime.disconnect();
}
