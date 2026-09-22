# Path 07: Observability (logs/errors)

**Goal:** Failures are diagnosable — structured enough logs, gated admin metrics if present, and errors that tell an operator what broke without dumping secrets.

**Help packet:** [path-07-observability.md](../help-packets/path-07-observability.md)

## Why this path

When the board is quiet and `/health` is red, you need a trail. Observability here means readable ops, not a full APM purchase.

## Constraints

- Prefer loopback or same-origin for admin/metrics scrapes; do not open metrics to the world without a gate.
- Never log access tokens, OAuth codes, or raw session material.
- Distinguish app down vs tunnel/DNS down when self-hosting behind a tunnel.
- Keep the feature freeze: wire existing `/metrics` / logs — do not bolt on a new product surface.

## Steps

1. **Happy path log.** One request (health or login start) leaves a breadcrumb you can find in platform logs.
2. **Failure path.** Force a known bad config (wrong callback, missing binding) and confirm the error is actionable.
3. **Metrics gate.** If `/metrics` exists, confirm unauthenticated access is denied and authorized access works.
4. **Client errors.** Popout/API error strings should help a builder fix config — not expose internal paths of other users.
5. **Runbook note.** Add or update a short “if health fails, check X then Y” in operator docs you already maintain.

## Success criteria

- [ ] You can find a failed deploy or login in logs within a few minutes.
- [ ] Admin metrics (if any) are not public.
- [ ] No secrets in log lines from your change.
- [ ] Tunnel vs app failure modes are documented when relevant.

## Send-back checklist (if a friend helps)

- Before/after: how you reproduced the failure.
- Link or path to the runbook blurb updated.
- Confirm smoke still passes.
