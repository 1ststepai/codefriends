# Path 05: Security & abuse basics

**Stage:** Finish  
**Goal:** Untrusted input is bounded; write routes require auth; a few high-impact security defaults have a prove-it check.

**Help packet:** [path-05-input-validation-and-abuse.md](../help-packets/path-05-input-validation-and-abuse.md)

**Optional security drills** (same shelf, Path 05 family):

- [Session regenerate after login](../help-packets/security-session-regenerate.md)
- [Redirect allowlist](../help-packets/security-redirect-allowlist.md)
- [Frame denial headers](../help-packets/security-frame-denial.md)
- [Session-store ACL](../help-packets/security-session-store-acl.md)

## What can go wrong

Friendly cohorts still get spam, oversize payloads, and classic web footguns (stolen sessions, phishing redirects, framed UIs, open session caches).

## Ask your AI to…

1. Gate every durable write behind a signed-in user (or stricter).
2. Enforce server-side length limits and https URL cleaning where the product already expects them.
3. Keep official shelf / others’ data undeletable by normal users.
4. Optionally pick one security drill above and land the single concrete fix.

## Prove it

- [ ] Over-long payloads return clear 4xx.
- [ ] Unauthenticated writes fail closed.
- [ ] Official items cannot be deleted by a normal user.
- [ ] Optional: one security drill’s prove-it check passes.

## Friend review questions

- Which write routes were audited?
- Which optional security drill (if any) was done, and what evidence exists?
- Any new dependency that is security theater without a test?
