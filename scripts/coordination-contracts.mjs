// Path and task-selection concepts adapted from SwingTradePros coordination.
// See docs/SOURCE-AUDIT.md for exact upstream and the existing OS mailbox mapping.
export const identities = ['codex', 'cursor', 'claude', 'verifier', 'growth', 'community', 'human'];
export const requestTypes = ['QUESTION', 'IMPLEMENTATION_REQUEST', 'AUDIT_REQUEST', 'VERIFICATION_REQUEST', 'HANDOFF', 'BLOCKER', 'PRODUCT_OPPORTUNITY', 'GROWTH_OPPORTUNITY', 'OWNER_DECISION', 'FYI'];
export const forbiddenActions = ['merge', 'production_deploy', 'apply_migration', 'purchase', 'billing_change', 'auth_change', 'entitlement_change', 'publish', 'trade', 'outreach'];
const transitions = { ready: ['in_progress', 'blocked'], in_progress: ['review', 'blocked'], review: ['done', 'in_progress', 'blocked'], blocked: ['ready'], done: [] };
const id = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,99}$/;
export function insist(ok, message) { if (!ok) throw new Error(message); }
export function identifier(value) { insist(typeof value === 'string' && id.test(value), 'Invalid identifier'); return value; }
export function cleanMetadata(value) {
  const text = JSON.stringify(value);
  insist(text.length <= 32000, 'Metadata packet too large');
  insist(!/(?:sk-(?:or-|ant-)?[a-z0-9-]{15,}|gh[pousr]_[a-z0-9]{20,}|github_pat_[a-z0-9_]+|-----BEGIN [^-]*PRIVATE KEY|admin-login\.txt|["']?(?:password|api[_-]?key|access[_-]?token|client[_-]?secret)["']?\s*[:=]\s*["']?[^\s"',}]{5,})/i.test(text), 'Credential-like content rejected');
  return value;
}
export function pathScope(value) {
  insist(typeof value === 'string' && value.length <= 240 && value.length > 0 && !value.startsWith('/') && !/[\\:{}?\[\]\x00-\x1f]/.test(value) && !value.split('/').some(x => ['.', '..', ''].includes(x)), 'Invalid relative scope');
  insist(!value.includes('*') || value.endsWith('/**') && !value.slice(0, -3).includes('*'), 'Use exact paths or directory/** scopes');
  return value;
}
export function scopesOverlap(a, b) {
  // Conservative directory-prefix overlap; no arbitrary glob dialect ambiguity.
  a = pathScope(a).replace(/\/\*\*$/, ''); b = pathScope(b).replace(/\/\*\*$/, '');
  return a === b || a.startsWith(b + '/') || b.startsWith(a + '/');
}
export function validateTask(t) {
  identifier(t.id); insist(/^1ststepai\/[A-Za-z0-9_.-]+$/.test(t.repo), 'Invalid repo');
  insist(Object.hasOwn(transitions, t.status), 'Invalid task status');
  insist(Number.isInteger(t.priority) && t.priority >= 1 && t.priority <= 8, 'Priority must be 1..8');
  insist(Array.isArray(t.paths) && t.paths.length > 0, 'Task needs bounded paths'); t.paths.forEach(pathScope);
  insist(t.eligibleAgents?.length && t.eligibleAgents.every(x => identities.includes(x)), 'Invalid eligible agents');
  insist(Array.isArray(t.dependsOn) && !t.dependsOn.includes(t.id), 'Invalid dependencies');
  insist(t.acceptanceCriteria?.length && t.ownerRole && t.nextAction, 'Task requires acceptance, owner and next action');
  insist(/^[a-f0-9]{40}$/.test(t.baseline), 'Task requires exact baseline');
  insist(typeof t.ownerDecisionRequired === 'boolean', 'Explicit owner gate required');
  cleanMetadata(t); return t;
}
export function eligible(task, tasks, leases, actor) {
  return task.status === 'ready' && !task.ownerDecisionRequired && task.eligibleAgents.includes(actor.identity)
    && task.dependsOn.every(d => tasks.some(x => x.id === d && x.status === 'done'))
    && !leases.some(l => l.state === 'active' && l.repo === task.repo && l.paths.some(a => task.paths.some(b => scopesOverlap(a, b))));
}
export function nextTask(tasks, leases, actor) {
  return tasks.filter(t => eligible(t, tasks, leases, actor)).sort((a,b) => a.priority - b.priority || a.id.localeCompare(b.id))[0] ?? null;
}
export function validateActor(actor, config) {
  insist(identities.includes(actor.identity), 'Unknown agent identity');
  insist(config.allowedAgents.includes(actor.identity), 'Identity not enabled');
  identifier(actor.agentId); identifier(actor.sessionId); identifier(actor.role);
  insist(typeof actor.provider === 'string' && actor.provider.length > 0 && actor.provider.length < 80, 'Execution provider required');
  insist(!['codex','claude','cursor'].includes(actor.identity) || actor.provider === actor.identity, 'Cannot claim another provider identity');
  insist(actor.identity !== 'human' || actor.provider === 'human', 'Human identity requires human provider');
  insist(config.roleBindings.some(b => b.agentId === actor.agentId && b.role === actor.role && b.identities.includes(actor.identity)), 'Role not registered for agent identity');
  return actor;
}
export function sameActor(a,b) { return a.agentId === b.agentId && a.identity === b.identity && a.provider === b.provider && a.role === b.role; }
export function claim(state, task, tasks, actor, branch, now) {
  validateTask(task); insist(eligible(task, tasks, state.leases, actor), 'Task blocked, locked, gated or ineligible');
  insist(!state.leases.some(x => x.state === 'active' && sameActor(x.actor, actor)), 'Release existing claim before selecting new work');
  insist(branch && branch !== 'main' && !/[\s~^:?*\[\\]/.test(branch), 'Isolated branch required');
  const lease = { id: `${task.repo}:${task.id}`, taskId: task.id, repo: task.repo, paths: task.paths, actor, branch, baseline: task.baseline, state: 'active', acquiredAt: now, updatedAt: now };
  insist(!state.leases.some(x => x.id === lease.id && x.state === 'active'), 'Task already claimed');
  state.leases.push(lease); return lease;
}
export function release(state, leaseId, actor, handoff, now) {
  const lease = state.leases.findLast(x => x.id === leaseId && x.state === 'active');
  insist(lease && sameActor(lease.actor, actor), 'Only claimant may release');
  insist(handoff?.candidateSha && /^[a-f0-9]{40}$/.test(handoff.candidateSha) && handoff.evidence?.length && handoff.nextAction, 'Resumable handoff required');
  cleanMetadata(handoff);
  lease.state = 'released'; lease.updatedAt = now; lease.handoff = { ...handoff, actor, at: now };
  return lease;
}
export function transition(task, to, actor, evidence = {}) {
  insist(transitions[task.status]?.includes(to), 'Invalid task transition');
  insist(!task.ownerDecisionRequired, 'OWNER_DECISION_REQUIRED');
  if (to === 'in_progress') insist(task.eligibleAgents.includes(actor.identity), 'Ineligible implementer');
  if (to === 'done') {
    insist(evidence.candidateSha === task.candidateSha && /^[a-f0-9]{40}$/.test(evidence.candidateSha ?? '') && evidence.deterministic?.result === 'PASS' && evidence.deterministic.references?.length, 'Exact candidate verification required');
    if (task.auditRequired) insist(evidence.audit?.verdict === 'PASS' && evidence.audit.candidateSha === task.candidateSha && evidence.audit.references?.length && evidence.audit.agentId !== task.claimedBy && evidence.audit.provider !== task.implementationProvider, 'Independent exact-candidate audit required');
  }
  return { ...task, status: to, evidence };
}
export function validateRequest(r, actor, config) {
  const keys = ['id','sourceRepo','sourceTask','from','to','type','createdAt','message','references','requiredResponse','dataClassification'];
  insist(Object.keys(r).every(k => keys.includes(k)), 'Unexpected request field');
  identifier(r.id); identifier(r.sourceTask);
  insist(config.registeredRepos.includes(r.sourceRepo), 'Unregistered source repo');
  insist(config.roleBindings.some(b=>b.agentId===actor.agentId && b.repos.includes(r.sourceRepo)), 'Sender lacks source repository scope');
  insist(sameActor(r.from, actor) && r.from.role === actor.role, 'Sender identity mismatch');
  insist(requestTypes.includes(r.type), 'Invalid request type');
  insist(r.dataClassification === 'INTERNAL_METADATA_ONLY', 'Only minimized metadata is allowed');
  insist(r.message?.length > 0 && r.message.length < 4000 && typeof r.requiredResponse === 'string', 'Bounded message/response required');
  insist(Array.isArray(r.references) && r.references.every(x => typeof x === 'string' && x.length < 500), 'Invalid references');
  insist(Number.isFinite(Date.parse(r.createdAt)), 'Timestamp required');
  insist(['agent','role','repo','product','human','all'].includes(r.to?.kind), 'Invalid recipient kind');
  const recipients = config.roleBindings.filter(b => {
    if (r.to.kind === 'all') return true;
    if (r.to.kind === 'human') return b.identities.includes('human');
    if (r.to.kind === 'repo') return b.repos.includes(r.to.id);
    if (r.to.kind === 'product') return b.products.includes(r.to.id);
    return r.to.kind === 'agent' ? b.agentId === r.to.id : b.role === r.to.id;
  }).map(x => x.agentId);
  insist(recipients.length > 0, 'Recipient is not registered');
  cleanMetadata(r); return [...new Set(recipients)].sort();
}
export function enqueue(state, r, actor, config) {
  const recipients = validateRequest(r, actor, config);
  const existing = state.requests.find(x => x.request.id === r.id);
  if (existing) { insist(JSON.stringify(existing.request) === JSON.stringify(r), 'REQUEST_IDEMPOTENCY_CONFLICT'); return existing; }
  const record = { request: r, recipients, status: 'QUEUED', osDelivery: 'AVAILABLE_TO_RECIPIENT', receipts: [], resolution: null };
  state.requests.push(record); return record;
}
export function consume(state, requestId, actor, step, now, resolution = null) {
  const record = state.requests.find(x => x.request.id === requestId);
  insist(record?.recipients.includes(actor.agentId), 'Not a recipient');
  const order = ['UNREAD','INGESTED','ACKNOWLEDGED','IN_PROGRESS','RESOLVED'];
  insist(order.includes(step) && step !== 'UNREAD', 'Invalid consumption state');
  const prior = record.receipts.filter(r => r.agentId === actor.agentId);
  const current = prior.at(-1)?.state ?? 'UNREAD';
  if (current === step) return record;
  insist(order.indexOf(step) === order.indexOf(current) + 1, 'Receipt transition must be sequential');
  if (step === 'RESOLVED') insist(resolution?.references?.length && resolution.summary, 'Resolution evidence required');
  cleanMetadata(resolution);
  record.receipts.push({ agentId: actor.agentId, identity: actor.identity, provider: actor.provider, sessionId: actor.sessionId, state: step, at: now, resolution });
  if (record.recipients.every(id => record.receipts.some(x => x.agentId === id && x.state === 'RESOLVED'))) { record.status = 'RESOLVED'; record.resolution = record.receipts.filter(x => x.state === 'RESOLVED'); }
  return record;
}
export function inbox(state, actor) {
  return state.requests.filter(r => r.recipients.includes(actor.agentId)).map(r => ({ ...r, consumption: r.receipts.filter(x => x.agentId === actor.agentId).at(-1)?.state ?? 'UNREAD' }));
}
export function assertNoAction(action) { insist(!forbiddenActions.includes(action), 'Owner-authorized external executor required; this service cannot perform that action'); }
