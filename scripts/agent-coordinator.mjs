import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateTask, validateActor, insist, nextTask, scopesOverlap, claim, release, transition, sameActor, inbox } from './coordination-contracts.mjs';
import { gh, githubStore, transact } from './coordination-store.mjs';
export function load(root = process.cwd()) {
  const json = p => JSON.parse(readFileSync(resolve(root,p), 'utf8'));
  const config = json('coordination/config.json');
  const tasks = json('coordination/tasks.json').tasks;
  tasks.forEach(validateTask);
  insist(tasks.every(t => t.repo === config.repo), 'Task queue belongs to a different repository');
  insist(new Set(tasks.map(t => t.id)).size === tasks.length, 'Duplicate tasks');
  for (const task of tasks) insist(task.dependsOn.every(d => tasks.some(x => x.id === d)), 'Unknown dependency');
  return { root, config, tasks };
}
export function actorFromEnvironment(config) {
  return validateActor({ identity: process.env.COORD_IDENTITY, provider: process.env.COORD_PROVIDER, agentId: process.env.COORD_AGENT_ID, role: process.env.COORD_ROLE, sessionId: process.env.COORD_SESSION_ID }, config);
}
export function git(args, root) { return execFileSync('git', args, { cwd: root, encoding: 'utf8', timeout: 30000, stdio: ['ignore','pipe','pipe'] }).trim(); }
export function preflight(context, task) {
  const { root, config } = context;
  insist(git(['remote','get-url','origin'],root).replace(/\.git$/,'').endsWith('/' + config.repo), 'Repository identity mismatch');
  git(['fetch','origin',config.defaultBranch,'--quiet'],root);
  insist(!git(['status','--porcelain'],root), 'Dirty worktree; preserve concurrent work');
  const branch = git(['branch','--show-current'],root);
  insist(branch && branch !== config.defaultBranch, 'Use isolated branch/worktree');
  insist(Number(git(['rev-list','--count',`HEAD..origin/${config.defaultBranch}`],root)) === 0, 'Stale branch');
  // Paginate both PRs and files; never infer no overlap from a truncated first page.
  const prs = gh(['api','--paginate','--slurp',`repos/${config.repo}/pulls?state=open&per_page=100`]).flat();
  const conflicts = [];
  for (const pr of prs.filter(p => p.head.ref !== branch)) {
    const files = gh(['api','--paginate','--slurp',`repos/${config.repo}/pulls/${pr.number}/files?per_page=100`]).flat();
    insist(files.length < 3000, 'GitHub PR file limit reached; overlap inventory incomplete');
    if (files.some(f => task.paths.some(p => scopesOverlap(p,f.filename)))) conflicts.push(pr);
  }
  insist(!conflicts.length, `Open PR path overlap: ${conflicts.map(p => p.number).join(',')}`);
  return branch;
}
export async function main(args = process.argv.slice(2)) {
  const [command = 'validate', taskId, extra] = args;
  const context = load(); const { config, tasks, root } = context;
  if (command === 'validate') { console.log(JSON.stringify({ status: 'VALID', tasks: tasks.length })); return; }
  const actor = actorFromEnvironment(config); const store = githubStore(config);
  if (command === 'next') { const s = await store.read(); console.log(JSON.stringify({ inbox: inbox(s.value,actor).filter(x=>!['ACKNOWLEDGED','IN_PROGRESS','RESOLVED'].includes(x.consumption)), next: nextTask(tasks,s.value.leases,actor) },null,2)); return; }
  const task = tasks.find(x => x.id === taskId); insist(task,'Unknown task');
  if (command === 'preflight') { console.log(JSON.stringify({ branch: preflight(context,task), status: 'PASS' })); return; }
  if (command === 'claim') {
    const branch = preflight(context,task);
    const result = await transact(store, state => {
      insist(!inbox(state,actor).some(x => ['UNREAD','INGESTED'].includes(x.consumption)), 'Ingest, reconcile and acknowledge inbox first');
      return claim(state,task,tasks,actor,branch,new Date().toISOString());
    });
    console.log(JSON.stringify(result,null,2)); return;
  }
  if (command === 'release') {
    const handoff = JSON.parse(readFileSync(extra,'utf8'));
    console.log(JSON.stringify(await transact(store,s=>release(s,`${config.repo}:${task.id}`,actor,handoff,new Date().toISOString())),null,2)); return;
  }
  if (command === 'transition') {
    const state = await store.read();
    const lease = state.value.leases.findLast(x => x.id === `${config.repo}:${task.id}` && x.state === 'active');
    insist(lease && sameActor(lease.actor,actor), 'Active claimant required');
    insist(lease.branch === git(['branch','--show-current'],root) && lease.baseline === task.baseline && JSON.stringify(lease.paths) === JSON.stringify(task.paths), 'Claim scope/baseline/branch changed; reconcile before transition');
    const evidence = args[3] ? JSON.parse(readFileSync(args[3],'utf8')) : {};
    const updated = transition({ ...task, claimedBy: actor.agentId, implementationProvider: actor.provider },extra,actor,evidence);
    writeFileSync(resolve(root,'coordination/tasks.json'),JSON.stringify({schemaVersion:'firststep.tasks.v1',tasks:tasks.map(t=>t.id===task.id?updated:t)},null,2)+'\n');
    console.log('LOCAL_TASK_UPDATE_REQUIRES_BRANCH_PUBLICATION'); return;
  }
  throw new Error('Unsupported command; no external action executor is provided');
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(e=>{console.error(e.message);process.exitCode=1;});
