# Path 02: Auth that isn't a toy

**Stage:** Finish  
**Goal:** Sign-in maps to a real identity (or an honest blocked/dev state) — not a shared password door or a fake “Continue with X” button.

**Help packet:** [path-02-auth-that-isnt-a-toy.md](../help-packets/path-02-auth-that-isnt-a-toy.md)

## What can go wrong

Pretend OAuth, silent email merges, or plaintext sessions train the cohort to ship unsafe “login.” Attackers and confused friends both win.

## Ask your AI to…

1. List providers as live / unconfigured / blocked / dev — and match the UI to that list.
2. Complete one real login path (start → callback → session or handoff).
3. Store only hashed session tokens; regenerate or issue a new session after privilege changes when the stack supports it.
4. Never scrape IDE auth files or impersonate first-party CLI clients.

## Prove it

- [ ] One production-capable login works end-to-end.
- [ ] Blocked providers show why they are blocked.
- [ ] Logout revokes the bearer; username alone cannot steal a session.

## Friend review questions

- Which provider is live on this instance, and which are blocked (with reasons)?
- Are secrets only in env — not in the PR?
- Does the UI hide or clearly label dev-only login in production?
