import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { load, actorFromEnvironment } from './agent-coordinator.mjs';
import { enqueue, consume, inbox, insist } from './coordination-contracts.mjs';
import { githubStore, transact } from './coordination-store.mjs';
export async function main(args = process.argv.slice(2)) {
  const [command = 'inbox', arg, step, resolutionFile] = args;
  const {config} = load(); const actor = actorFromEnvironment(config); const store = githubStore(config);
  if (command === 'inbox') { const state = await store.read(); console.log(JSON.stringify({blob:state.version,items:inbox(state.value,actor)},null,2)); return; }
  if (command === 'send') {
    const r = JSON.parse(readFileSync(arg,'utf8')); insist(r.sourceRepo === config.repo || config.portfolio === true, 'Source repo does not match checkout');
    console.log(JSON.stringify(await transact(store,s=>enqueue(s,r,actor,config)),null,2)); return;
  }
  if (command === 'consume') {
    const resolution = resolutionFile ? JSON.parse(readFileSync(resolutionFile,'utf8')) : null;
    console.log(JSON.stringify(await transact(store,s=>consume(s,arg,actor,step,new Date().toISOString(),resolution)),null,2)); return;
  }
  throw new Error('Use inbox, send <metadata.json>, consume <id> <INGESTED|ACKNOWLEDGED|IN_PROGRESS|RESOLVED> [resolution.json]');
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(e=>{console.error(e.message);process.exitCode=1;});
