// Repeatable SQL acceptance harness. Requires Docker + existing postgres:16-alpine.
// Builds a FRESH database, never links to Supabase or opens a host port.
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const repo=fileURLToPath(new URL('../',import.meta.url));
const container='thaicon-tor-check-'+randomUUID().replaceAll('-','').slice(0,12);
function docker(args,quiet=false) {
  const r=spawnSync('docker',args,{encoding:'utf8',cwd:repo});
  if(r.status!==0)throw Error(r.stderr||r.error?.message||'Docker command failed');
  if(!quiet&&r.stdout.trim())console.log(r.stdout.trim());
  return r.stdout.trim();
}
let created=false;
try {
  docker(['image','inspect','postgres:16-alpine'],true);
  docker(['run','--rm','-d','--name',container,'--network','none','--label','purpose=thaicon-tor-disposable',
    '-e','POSTGRES_HOST_AUTH_METHOD=trust','-e','POSTGRES_DB=thaicon_tor_check','postgres:16-alpine'],true);
  created=true;
  let ready=false;
  for(let attempt=0;attempt<30;attempt++) {
    const r=spawnSync('docker',['exec',container,'pg_isready','-U','postgres','-d','thaicon_tor_check'],{encoding:'utf8'});
    if(r.status===0){ready=true;break;}
    await new Promise(resolve=>setTimeout(resolve,200));
  }
  if(!ready)throw Error('Database did not start');
  docker(['cp','scripts',container+':/checks'],true);
  docker(['cp','supabase/migrations',container+':/migrations'],true);
  const psql=(file,quiet=true)=>docker(['exec',container,'psql','-U','postgres','-d','thaicon_tor_check','-v','ON_ERROR_STOP=1','--single-transaction','-f',file],quiet);
  // Test files contain BEGIN/ROLLBACK themselves, so use plain psql for them.
  psql('/checks/tor-db-bootstrap.sql');
  const migrations=(await readdir(new URL('../supabase/migrations/',import.meta.url))).filter(f=>f.endsWith('.sql')).sort();
  for(const migration of migrations)psql('/migrations/'+migration);
  console.log(`PASS: fresh install of ${migrations.length} migrations`);
  for(const file of ['tor-db-preflight.sql','tor-scope-check.sql','tor-work-order-check.sql','tor-order-creation-check.sql','tor-realtime-check.sql','tor-materials-check.sql','tor-uat-catalog-check.sql','tor-report-review-check.sql','tor-report-save-check.sql','tor-repair-check.sql','tor-plan-check.sql','tor-alarm-check.sql','tor-live-snapshot-check.sql']) {
    const output=docker(['exec',container,'psql','-U','postgres','-d','thaicon_tor_check','-v','ON_ERROR_STOP=1','-f','/checks/'+file],true);
    console.log(`PASS: ${file}`);
    if(file==='tor-work-order-check.sql'&&!output.includes('assertions passed'))throw Error('Missing assertion completion');
  }
  const concurrency=spawnSync(process.execPath,['scripts/tor-command-concurrency.mjs'],{
    cwd:repo,encoding:'utf8',env:{...process.env,TOR_DB_CONTAINER:container},
  });
  if(concurrency.status!==0)throw Error(concurrency.stderr||concurrency.stdout);
  console.log(concurrency.stdout.trim());
  const planRace=spawnSync(process.execPath,['scripts/tor-plan-concurrency.mjs'],{cwd:repo,encoding:'utf8',env:{...process.env,TOR_DB_CONTAINER:container}});
  if(planRace.status!==0)throw Error(planRace.stderr||planRace.stdout);
  console.log(planRace.stdout.trim());
  console.log('SQL harness complete (Auth/Storage shims; HTTP/JWT integration still required)');
} finally {
  if(created) {
    const identity=docker(['inspect',container,'--format','{{.Config.Labels.purpose}} {{.HostConfig.NetworkMode}}'],true);
    if(identity!=='thaicon-tor-disposable none')throw Error('Refusing cleanup: container identity changed');
    docker(['rm','-f',container],true);
    console.log('Temporary test container removed');
  }
}
