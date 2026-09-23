import { execFileSync } from 'node:child_process';
import { insist } from './coordination-contracts.mjs';

// No token values in arguments, logs or files. gh supplies its existing authenticated context.
export function gh(args, input) {
  try { return JSON.parse(execFileSync('gh', args, { input, encoding: 'utf8', stdio: ['pipe','pipe','pipe'], timeout: 30000, maxBuffer: 5 * 1024 * 1024 })); }
  catch (error) {
    const stderr = String(error.stderr ?? '');
    const failure = new Error(/HTTP (409|422)/.test(stderr) ? 'STATE_CONFLICT_RETRY_FROM_CURRENT' : 'GitHub operation failed; no success receipt. Verify access/network without printing credentials.');
    failure.conflict = /HTTP (409|422)/.test(stderr); throw failure;
  }
}
export function githubStore(config) {
  insist(config.controlPlane.repo === '1ststepai/1ststep-control-plane' && config.controlPlane.branch === 'coordination-state', 'Unapproved state target');
  const endpoint = `repos/${config.controlPlane.repo}/contents/coordination/runtime-state.json`;
  return {
    async read() {
      const doc = gh(['api', `${endpoint}?ref=${config.controlPlane.branch}`]);
      const value = JSON.parse(Buffer.from(doc.content, 'base64').toString('utf8'));
      insist(value.schemaVersion === 'firststep.runtime.v1' && Array.isArray(value.leases) && Array.isArray(value.requests), 'Invalid shared state');
      return { version: doc.sha, value };
    },
    async compareAndSwap(version, value) {
      // GitHub rejects a stale blob SHA. A single file serializes all claims and relay writes.
      const actor = gh(['api', 'user']).login;
      value.lastWriter = { githubActor: actor, at: new Date().toISOString(), identityAssurance: 'DECLARED_PROVIDER_GITHUB_ACTOR_VERIFIED' };
      const receipt = gh(['api', '--method','PUT', endpoint, '--input','-'], JSON.stringify({ branch: config.controlPlane.branch, sha: version, message: 'coordination: persist claim or relay receipt', content: Buffer.from(JSON.stringify(value, null, 2) + '\n').toString('base64') }));
      return { commit: receipt.commit.sha, blob: receipt.content.sha, githubActor: actor };
    }
  };
}
export async function transact(store, change) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const snapshot = await store.read();
    const value = structuredClone(snapshot.value);
    const result = change(value);
    if (JSON.stringify(value) === JSON.stringify(snapshot.value)) return { result, unchanged: true, blob: snapshot.version };
    try { return { result, durable: await store.compareAndSwap(snapshot.version, value) }; }
    catch (error) { if (!error.conflict || attempt === 2) throw error; }
  }
}
