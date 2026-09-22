# Path 05: Input validation & abuse basics

**Goal:** Untrusted input is bounded and rejected early; write routes require auth; public peek endpoints stay read-only and minimal.

**Help packet:** [path-05-input-validation-and-abuse.md](../help-packets/path-05-input-validation-and-abuse.md)

## Why this path

School cohorts are friendly — attackers are not. Length limits, https-only links, and bearer gates are the boring floor that keeps a small instance alive.

## Constraints

- Prefer reject-with-message over silent truncate when the client is a developer UI.
- Library URLs and profile links: https only; host allowlists where the product already has them (e.g. GitHub profile).
- No anonymous school-board writes on a shared instance.
- Do not add CAPTCHA / payments / rate-limit SaaS in this path unless the instance already depends on them — start with auth + bounds.

## Steps

1. **Map write routes.** List POSTs/DELETEs that change durable state; each needs a signed-in user (or stricter).
2. **Bounds.** Title/body/status fields have max lengths enforced server-side (not only in the UI).
3. **URL cleaning.** Community library items and profile URLs go through the same https / host checks.
4. **Own-only deletes.** Users can remove their community items/drafts, not official shelf rows or other people’s data.
5. **Abuse sketch.** Note one realistic abuse (spam topics, huge DM flood) and the existing cap or gate that limits it.

## Success criteria

- [ ] Over-long payloads return 4xx with a clear error.
- [ ] Unauthenticated writes fail closed.
- [ ] Official shelf items cannot be deleted by a normal user.
- [ ] You can name the field limits that matter for board + library + help packets.

## Send-back checklist (if a friend helps)

- Tests or smoke coverage for the new rejection path when practical.
- No new dependencies for “security theater.”
- Keep error strings useful for builders, not stack traces for strangers.
