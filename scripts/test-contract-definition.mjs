// Embedded PostgreSQL uses the real access migration with a local auth.uid shim.
// Pass an absolute installed @electric-sql/pglite/dist/index.js path.
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
const {PGlite} = await import(pathToFileURL(process.argv[2]).href);
const db = new PGlite();
let checks=0;
const ok=(value)=>{assert.ok(value);checks++;};
const denied=async(fn,code)=>{try{await fn();assert.fail('expected rejection');}catch(e){assert.equal(e.code,code);checks++;}};
try {
 const admin='44444444-4444-4444-8444-444444444444';
 const engineer='44444444-4444-4444-8444-444444444445';
 const otherViewer='44444444-4444-4444-8444-444444444446';
 await db.exec(`create role anon; create role authenticated; create schema auth;
 create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb);
 create function auth.uid() returns uuid language sql as $$ select nullif(current_setting('test.uid',true),'')::uuid $$;
 grant usage on schema auth to authenticated; grant execute on function auth.uid() to authenticated;`);
 await db.exec(await readFile(new URL('../supabase/migrations/202608190001_access_foundation.sql',import.meta.url),'utf8'));
 await db.exec(`
 insert into public.jobsites(id,name,province,site_type) values('SITE-901','UAT A','Bangkok','test'),('SITE-902','UAT B','Bangkok','test');
 insert into auth.users(id,email) values('${admin}','uat-admin@demo.invalid'),('${engineer}','uat-engineer@demo.invalid'),('${otherViewer}','uat-viewer@demo.invalid');
 update public.profiles set role='admin' where id='${admin}';
 update public.profiles set role='engineer' where id='${engineer}';
 insert into public.user_jobsites(user_id,jobsite_id) values('${engineer}','SITE-901'),('${otherViewer}','SITE-902');
 create table public.assets(id text primary key, jobsite_id text not null references public.jobsites,unique(jobsite_id,id));
 insert into public.assets values('AC-1','SITE-901'),('AC-2','SITE-902');`);
 for(const f of ['20261117163924_contract_reporting_foundation.sql','20261120160221_contract_definition_commands.sql']) await db.exec(await readFile(new URL('../supabase/migrations/'+f,import.meta.url),'utf8'));
 const id='11111111-1111-4111-8111-111111111111',group='22222222-2222-4222-8222-222222222222',request='33333333-3333-4333-8333-333333333333';
 const definition={name:'ทดสอบ',starts_on:'2026-06-01',ends_on:'2027-05-31',groups:[{id:group,name:'AHU A',building:'A',asset_type:'AHU',major_frequency:2,minor_frequency:4}],targets:[{group_id:group,month_start:'2026-06-01',cleaning_kind:'major',target:14},{group_id:group,month_start:'2027-05-01',cleaning_kind:'major',target:12}]};
 const save=(d=definition,v=0,k=request,site='SITE-901')=>db.query('select public.save_contract_definition($1,$2,$3,$4,$5) result',[id,site,v,k,JSON.stringify(d)]);
 await db.exec(`set test.uid='${admin}'; set role authenticated;`);
 await denied(()=>save(),'42501'); // gate OFF
 await denied(()=>db.query("select public.list_contract_definitions('SITE-901')"),'42501');
 await db.exec('reset role; update private.contract_reporting_settings set enabled=true; set role authenticated;');
 let r=await save();ok(r.rows[0].result.version===1);
 r=await save();ok(r.rows[0].result.replayed===true);
 await denied(()=>save({...definition,name:'changed'}),'22023');
 await denied(()=>save(definition,0,'55555555-5555-4555-8555-555555555555'),'40001');
 await denied(()=>save(definition,1,crypto.randomUUID(),'SITE-902'),'42501');
 await denied(()=>db.query('select * from public.maintenance_contracts'),'42501');
 await db.exec(`set test.uid='${engineer}';`);
 await denied(()=>save(),'42501');
 r=await db.query('select public.read_contract_definition($1,$2) result',[id,'SITE-901']);ok(r.rows[0].result.targets.length===2);
 r=await db.query("select public.list_contract_definitions('SITE-901') result");
 ok(r.rows[0].result.length===1 && r.rows[0].result[0].id===id && r.rows[0].result[0].site_id==='SITE-901');
 await denied(()=>db.query("select public.list_contract_definitions('SITE-902')"),'42501');
 await denied(()=>db.query('select public.read_contract_definition($1,$2)',[id,'SITE-902']),'42501');
 await db.exec(`set test.uid='${otherViewer}';`);
 await denied(()=>db.query("select public.list_contract_definitions('SITE-901')"),'42501');
 await denied(()=>db.query('select public.read_contract_definition($1,$2)',[id,'SITE-901']),'42501');
 await denied(()=>db.query('select public.read_contract_definition($1,$2)',[id,'SITE-902']),'P0002');
 r=await db.query("select public.list_contract_definitions('SITE-902') result");ok(r.rows[0].result.length===0);
 await db.exec(`reset role; update public.profiles set is_active=false where id='${engineer}'; set test.uid='${engineer}'; set role authenticated;`);
 await denied(()=>db.query('select public.read_contract_definition($1,$2)',[id,'SITE-901']),'42501');
 await denied(()=>save(),'42501');
 await db.exec(`set test.uid='${admin}';`);
 for(const d of [
  {...definition,targets:[{...definition.targets[0],target:1.5}]},
  {...definition,targets:[{...definition.targets[0],month_start:'2027-06-01'}]},
  {...definition,groups:[...definition.groups,...definition.groups]},
  {...definition,targets:[...definition.targets,...definition.targets]},
 ]) { try {await save(d,1,crypto.randomUUID());assert.fail('invalid save accepted');}catch(e){ok(['22023','23505'].includes(e.code));} }
 r=await db.query('select public.read_contract_definition($1,$2) result',[id,'SITE-901']);ok(r.rows[0].result.contract.version===1 && r.rows[0].result.targets.length===2);
 r=await save({...definition,name:'ฉบับสอง'},1,crypto.randomUUID());ok(r.rows[0].result.version===2);
 // Failure to retain the receipt must roll back the definition and all children.
 await db.exec(`reset role;
 create function private.fail_contract_receipt() returns trigger language plpgsql as $$ begin raise exception 'injected receipt failure'; end $$;
 create trigger fail_receipt before insert on private.contract_definition_receipts for each row execute function private.fail_contract_receipt();
 set role authenticated;`);
 await denied(()=>save({...definition,name:'must roll back'},2,crypto.randomUUID()),'P0001');
 r=await db.query('select public.read_contract_definition($1,$2) result',[id,'SITE-901']);ok(r.rows[0].result.contract.version===2 && r.rows[0].result.contract.name==='ฉบับสอง' && r.rows[0].result.targets.length===2);
 await db.exec('reset role; drop trigger fail_receipt on private.contract_definition_receipts; set role authenticated;');
 r=await save();ok(r.rows[0].result.replayed===true && r.rows[0].result.version===1); // original acknowledgement is not current state
 r=await db.query('select public.read_contract_definition($1,$2) result',[id,'SITE-901']);ok(r.rows[0].result.contract.version===2);
 const group2=crypto.randomUUID();
 const withMembers={...definition,groups:[...definition.groups,{...definition.groups[0],id:group2,name:'AHU B'}],
  members:[{group_id:group,asset_id:'AC-1'}]};
 r=await save(withMembers,2,crypto.randomUUID());ok(r.rows[0].result.version===3);
 await denied(()=>save(definition,3,crypto.randomUUID()),'22023');
 await denied(()=>save({...withMembers,members:[{group_id:group,asset_id:'AC-2'}]},3,crypto.randomUUID()),'23503');
 await denied(()=>save({...withMembers,members:[{group_id:crypto.randomUUID(),asset_id:'AC-1'}]},3,crypto.randomUUID()),'23503');
 await denied(()=>save({...withMembers,members:[...withMembers.members,{group_id:group2,asset_id:'AC-1'}]},3,crypto.randomUUID()),'23505');
 await denied(()=>db.query('select * from public.contract_asset_memberships'),'42501');
 r=await db.query('select public.read_contract_definition($1,$2) result',[id,'SITE-901']);
 ok(r.rows[0].result.contract.version===3 && r.rows[0].result.members[0].group_id===group);
 r=await save({...withMembers,members:[{group_id:group2,asset_id:'AC-1'}]},3,crypto.randomUUID());ok(r.rows[0].result.version===4);
 r=await db.query('select public.read_contract_definition($1,$2) result',[id,'SITE-901']);
 ok(r.rows[0].result.members.length===1 && r.rows[0].result.members[0].group_id===group2);
 await db.exec("reset role; set role anon;");await denied(()=>db.query('select public.contract_reporting_ready()'),'42501');
 console.log(`PASS ${checks} embedded PostgreSQL checks (repository access policies, local auth.uid shim)`);
} finally {await db.close();}
