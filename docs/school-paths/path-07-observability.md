# Path 07: Observability

**Stage:** Ship  
**Goal:** Failures are diagnosable — useful logs, gated admin metrics if present, no secrets in log lines.

**Help packet:** [path-07-observability.md](../help-packets/path-07-observability.md)

## What can go wrong

`/health` is red and nobody knows why. Tokens leak into logs. Metrics are public. Tunnel outages look like app outages.

## Ask your AI to…

1. Ensure one happy-path and one failure-path leave an actionable log breadcrumb.
2. Gate `/metrics` (or equivalent) so anonymous access fails.
3. Never log access tokens, OAuth codes, or raw sessions.
4. Add or update a short “if health fails, check X then Y” operator note.

## Prove it

- [ ] You can find a forced failure in logs within a few minutes.
- [ ] Admin metrics (if any) reject unauthenticated access.
- [ ] No secrets in log lines from your change.

## Friend review questions

- App down vs tunnel/DNS — which did you verify?
- Is the runbook note somewhere the next operator will find?
- Did the PR add a new dashboard product, or wire what already exists?
