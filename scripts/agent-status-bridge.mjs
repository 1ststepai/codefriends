import { readFileSync, writeFileSync } from 'node:fs';
import { load } from './agent-coordinator.mjs';
const {config,tasks} = load();
const snapshot = { schemaVersion:'firststep.status.v1', repo:config.repo, authority:config.authority, sourceSha:config.baseline, testedSha:null, previewSha:null, productionSha:null, truth:'SOURCE_OBSERVED_ONLY', tasks:tasks.map(({id,status,ownerRole,nextAction,ownerDecisionRequired})=>({id,status,ownerRole,nextAction,ownerDecisionRequired})), runtime:'UNKNOWN', sharedState:config.controlPlane };
const json = JSON.stringify(snapshot,null,2)+'\n';
const md = `# Coordination status\n\nSource baseline: ${snapshot.sourceSha}\n\nTested/Preview/Production: UNKNOWN. This is coordination metadata, not release proof.\n\n${snapshot.tasks.map(t=>`- ${t.id}: ${t.status}; ${t.ownerRole}; ${t.nextAction}`).join('\n')}\n\nShared leases and inboxes: ${config.controlPlane.repo}@${config.controlPlane.branch}. Read before work; this snapshot is not a live heartbeat.\n`;
if (process.argv[2] === 'check') {
  if (readFileSync('coordination/status.json','utf8').replaceAll('\r\n','\n') !== json || readFileSync('coordination/STATUS.md','utf8').replaceAll('\r\n','\n') !== md) throw new Error('Status snapshot differs; regenerate');
} else { writeFileSync('coordination/status.json',json); writeFileSync('coordination/STATUS.md',md); }
