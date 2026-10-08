// Local-only Edge runtime. Never prints generated secrets or request bodies.
import { cp,readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
const target=path.resolve(process.argv[2]??"");
if(!(await readFile(path.join(target,"supabase/config.toml"),"utf8")).includes('project_id = "thaicon-tor-local"'))throw Error("Wrong local target");
await cp("supabase/functions",path.join(target,"supabase/functions"),{recursive:true});
console.log("Serving local Edge Functions on isolated thaicon-tor-local; output suppressed");
const child=spawn("npx.cmd",["--yes","supabase@2.119.0","functions","serve","--workdir",target],{shell:true,stdio:["ignore","pipe","pipe"]});
let captured="";for(const stream of [child.stdout,child.stderr])stream.on("data",chunk=>{captured+=chunk.toString();});
const timer=setInterval(()=>console.log("Isolated local Edge runtime active/starting; no remote deployment"),30000);
child.on("close",code=>{clearInterval(timer);if(code)console.error("Local Edge runtime exited; diagnostic count="+captured.split(/\r?\n/).filter(l=>/error|failed/i.test(l)).length);process.exitCode=code??1;});
