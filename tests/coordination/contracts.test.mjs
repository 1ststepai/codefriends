import test from 'node:test';
import assert from 'node:assert/strict';
import { claim,release,enqueue,consume,inbox,transition,nextTask,validateActor,scopesOverlap,assertNoAction,forbiddenActions } from '../../scripts/coordination-contracts.mjs';
import { transact } from '../../scripts/coordination-store.mjs';
const sha = 'a'.repeat(40), now = '2026-09-23T12:00:00Z';
const actor = (identity='codex', sessionId='session-1') => ({identity,provider:identity,agentId:identity+'-engineer',role:identity+'-role',sessionId});
const config = {allowedAgents:['codex','cursor','claude','verifier','growth','community','human'],registeredRepos:['1ststepai/main-website','1ststepai/1ststep-resume','1ststepai/codefriends'],roleBindings:['codex','cursor','claude','verifier','growth','community','human'].map(identity=>({agentId:identity+'-engineer',role:identity+'-role',identities:[identity],repos:['1ststepai/main-website','1ststepai/1ststep-resume','1ststepai/codefriends'],products:['business']}))};
const state = () => ({schemaVersion:'firststep.runtime.v1',leases:[],requests:[]});
const task = (overrides={}) => ({id:'COORD-001',repo:'1ststepai/main-website',status:'ready',priority:1,paths:['docs/a.md'],eligibleAgents:['codex','cursor'],dependsOn:[],acceptanceCriteria:['Metadata tests pass'],ownerRole:'public-lead-engineer',nextAction:'Verify',baseline:sha,ownerDecisionRequired:false,auditRequired:true,...overrides});
const req = (overrides={}) => ({id:'REQUEST-001',sourceRepo:'1ststepai/main-website',sourceTask:'COORD-001',from:actor(),to:{kind:'repo',id:'1ststepai/codefriends'},type:'AUDIT_REQUEST',createdAt:now,message:'Review exact candidate metadata',references:['commit:'+sha],requiredResponse:'Evidence-backed verdict',dataClassification:'INTERNAL_METADATA_ONLY',...overrides});

test('all seven explicit identities validate, forged provider/role rejected',()=>{
  for (const identity of config.allowedAgents) assert.equal(validateActor(actor(identity),config).identity,identity);
  assert.throws(()=>validateActor({...actor(),provider:'claude'},config),/another provider/);
  assert.throws(()=>validateActor({...actor(),role:'app-owner'},config),/not registered/);
});
test('three pilot scopes allow separate Codex/Cursor claims; overlapping claims fail',()=>{
  for (const repo of config.registeredRepos) {
    const s=state(), a=task({repo}), b=task({id:'COORD-002',repo,paths:['docs/b.md']});
    claim(s,a,[a,b],actor(),'codex/coordination',now);
    claim(s,b,[a,b],actor('cursor'),'cursor/coordination',now);
    assert.equal(s.leases.length,2);
    assert.throws(()=>claim(s,task({repo,id:'COORD-003',paths:['docs/**']}),[a,b],actor('claude'),'claude/review',now));
  }
});
test('scope validation rejects traversal, absolute and ambiguous globs',()=>{
  for(const invalid of ['../a','/a','C:/a','docs\\a','docs/*x','docs//a','docs/./a']) assert.throws(()=>scopesOverlap(invalid,'docs/a'));
  assert.equal(scopesOverlap('docs/**','docs/a/b.md'),true);
  assert.equal(scopesOverlap('docs/a','docs/ab'),false);
});
test('owner gates, dependency gaps and priority ordering affect claims and next-work',()=>{
  const gated=task({ownerDecisionRequired:true}), high=task({id:'COORD-002',priority:2}), low=task({id:'COORD-003',priority:7}), dependent=task({id:'COORD-004',dependsOn:['missing']});
  assert.equal(nextTask([gated,low,dependent,high],[],actor()).id,high.id);
  assert.throws(()=>claim(state(),gated,[gated],actor(),'codex/x',now),/blocked/);
  assert.throws(()=>transition(gated,'in_progress',actor()),/OWNER_DECISION/);
  for (const action of forbiddenActions) assert.throws(()=>assertNoAction(action),/cannot perform/);
});
test('durable cross-repo delivery survives runtime absence and session rotation',()=>{
  const s=state(); enqueue(s,req(),actor(),config);
  const restored=JSON.parse(JSON.stringify(s));
  const cursor=actor('cursor'); assert.equal(inbox(restored,cursor)[0].consumption,'UNREAD');
  consume(restored,'REQUEST-001',cursor,'INGESTED',now);
  consume(restored,'REQUEST-001',actor('cursor','replacement-session'),'ACKNOWLEDGED',now);
  assert.equal(inbox(restored,cursor)[0].consumption,'ACKNOWLEDGED');
  assert.equal(inbox(restored,actor('claude'))[0].consumption,'UNREAD');
  assert.equal(restored.requests[0].osDelivery,'AVAILABLE_TO_RECIPIENT');
});
test('relay supports all routing kinds and rejects forged sender, unknown recipient, secrets and extra fields',()=>{
  for(const to of [{kind:'agent',id:'claude-engineer'},{kind:'role',id:'claude-role'},{kind:'repo',id:'1ststepai/codefriends'},{kind:'product',id:'business'},{kind:'human'},{kind:'all'}]) assert.ok(enqueue(state(),req({to}),actor(),config).recipients.length);
  assert.throws(()=>enqueue(state(),req({from:actor('cursor')}),actor(),config),/mismatch/);
  assert.throws(()=>enqueue(state(),req({to:{kind:'role',id:'missing'}}),actor(),config),/not registered/);
  assert.throws(()=>enqueue(state(),req({message:'read admin-login.txt'}),actor(),config),/Credential/);
  assert.throws(()=>enqueue(state(),req({token:'synthetic'}),actor(),config),/Unexpected/);
});
test('request retries are idempotent; receipt cannot skip stages or impersonate another recipient',()=>{
  const s=state(),r=req({to:{kind:'agent',id:'claude-engineer'}}); enqueue(s,r,actor(),config); enqueue(s,r,actor(),config);
  assert.equal(s.requests.length,1);
  assert.throws(()=>enqueue(s,{...r,message:'changed'},actor(),config),/IDEMPOTENCY/);
  assert.throws(()=>consume(s,r.id,actor('cursor'),'INGESTED',now),/Not a recipient/);
  assert.throws(()=>consume(s,r.id,actor('claude'),'ACKNOWLEDGED',now),/sequential/);
});
test('concurrent transactions re-evaluate shared leases after compare-and-swap conflict',async()=>{
  let current=state(),version=0;
  const store={read:async()=>({version,value:structuredClone(current)}),compareAndSwap:async(v,value)=>{if(v!==version){const e=new Error('conflict');e.conflict=true;throw e;}current=value;version++;return {version};}};
  const t=task();
  const outcomes=await Promise.allSettled([transact(store,s=>claim(s,t,[t],actor(),'codex/x',now)),transact(store,s=>claim(s,t,[t],actor('cursor'),'cursor/x',now))]);
  assert.equal(outcomes.filter(x=>x.status==='fulfilled').length,1);
  assert.equal(current.leases.length,1);
});
test('offline store never returns durable delivery success',async()=>{
  await assert.rejects(transact({read:async()=>{throw new Error('offline');}},()=>true),/offline/);
});
test('release requires claimant and checkpoint; inactive leases remain historical',()=>{
  const s=state(),t=task();const l=claim(s,t,[t],actor(),'codex/x',now);
  const h={candidateSha:sha,evidence:['test:contracts'],nextAction:'Independent review'};
  assert.throws(()=>release(s,l.id,actor('cursor'),h,now),/claimant/);
  assert.throws(()=>release(s,l.id,actor(),{},now),/handoff/);
  release(s,l.id,actor(),h,now);assert.equal(s.leases[0].state,'released');
});
test('independent audit needs exact candidate and evidence; implementer cannot self-certify',()=>{
  const t=task({status:'review',candidateSha:sha,claimedBy:'codex-engineer',implementationProvider:'codex'});
  const e={candidateSha:sha,deterministic:{result:'PASS',references:['tests:42']},audit:{verdict:'PASS',candidateSha:sha,references:['audit:1'],agentId:'claude-engineer',provider:'claude'}};
  assert.equal(transition(t,'done',actor(),e).status,'done');
  assert.throws(()=>transition(t,'done',actor(),{...e,audit:{...e.audit,provider:'codex'}}),/Independent/);
  assert.throws(()=>transition(t,'done',actor(),{...e,candidateSha:'b'.repeat(40)}),/Exact/);
  assert.throws(()=>transition(t,'in_progress',actor('growth')),/Ineligible/);
});
