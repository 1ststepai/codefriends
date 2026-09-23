# Repository coordination adapter

This additive pilot extends the SwingTradePros protocol. Existing repository AGENTS,
CLAUDE, decisions, queues, OS schemas and release gates remain authoritative. The
portfolio routes requirements; it cannot take product implementation ownership.

At cycle start: fetch origin/main; read repository authority, local coordination,
relevant open PRs and the shared role inbox; ingest references, reconcile against
current project state, acknowledge; then select work. Never require previous chat.

Set COORD_IDENTITY (codex/cursor/claude/verifier/growth/community/human), COORD_PROVIDER
(actual executor), COORD_AGENT_ID (durable registered agent), COORD_ROLE and
COORD_SESSION_ID (new per runtime). Use only your identity, not another provider.
These declarations are recorded alongside the authenticated GitHub actor. Shared
owner tokens do NOT cryptographically prove provider identity; see control-plane
docs/SECURITY.md. No AI runner may declare human approval.

Commands from this repo root (Node 22+, git and authenticated gh; no packages):

```
node scripts/agent-coordinator.mjs validate
node scripts/agent-relay.mjs inbox
node scripts/agent-relay.mjs consume REQUEST-ID INGESTED
# Read evidence and reconcile before acknowledging.
node scripts/agent-relay.mjs consume REQUEST-ID ACKNOWLEDGED
node scripts/agent-coordinator.mjs next
node scripts/agent-coordinator.mjs preflight TASK-ID
node scripts/agent-coordinator.mjs claim TASK-ID
node scripts/agent-coordinator.mjs transition TASK-ID in_progress
node scripts/agent-relay.mjs send minimized-request.json
node scripts/agent-status-bridge.mjs
node scripts/agent-status-bridge.mjs check
```

The task queue is a branch-reviewed work manifest. A claim becomes effective only
when the shared GitHub lease transaction succeeds. Publish task changes/handoffs in
the same isolated branch/PR; do not start editing based only on a local lock file.
locks/ is an index/reference, not another lock authority. In-progress work has one
claimant, a branch, bounded paths and baseline. No automatic expired-lock takeover.

Task states: ready -> in_progress -> review -> done; in_progress/review may block;
blocked -> ready after dependency/owner resolution. Review may return to in_progress.
done requires exact-candidate deterministic evidence; an audit-required milestone
also needs independent provider, distinct agent, PASS and evidence for that SHA.
No routine per-commit model audit. Completion is not permission to merge/deploy.

Claim release requires a JSON handoff with candidateSha, evidence references and
nextAction: node scripts/agent-coordinator.mjs release TASK-ID handoff.json.
A replacement session uses the SAME durable identity, reads the retained inbox and
checkpoint, verifies the branch, then continues. Changing provider requires a reviewed
ownership transfer; no impersonation. Offline recipients keep queued messages.

Sensitive actions and unresolved owner decisions stay blocked. Only authorized human
decisions may resolve owner gates through reviewed GitHub records. There is no merge,
deploy, auth/billing, migration, purchase, publishing, trading or outreach command.
Never store secrets, user records, private audit content or transcripts. Public repos
hold only safe coordination templates; private operational records stay private.

Before yielding, validate metadata, record tests/risks/blockers/next action, refresh
status, publish reviewable changes and release or explain retained claim. Verify receipt
before saying delivered. No source/test/preview/production claim may substitute for another.
