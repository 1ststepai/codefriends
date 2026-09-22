# Path 02: Auth that isn't a toy

**Goal:** Sign-in that maps to a real identity row (or an honest “blocked / dev-only” state) — not a shared password door and not a fake “Continue with X” button.

**Help packet:** [path-02-auth-that-isnt-a-toy.md](../help-packets/path-02-auth-that-isnt-a-toy.md)

## Why this path

Toy auth trains bad habits: empty password forms, pretended OAuth, or silent merges by email. Production discipline means live providers where they exist, and clear blocked reasons where they do not.

## Constraints

- Prefer provider-native identity (e.g. Google OIDC) over inventing passwords.
- Do not scrape IDE auth files or impersonate first-party CLI clients.
- Linking a second provider to one user must be explicit — never auto-merge by email.
- Dev username login stays **dev-only**; hide it in production UX unless explicitly enabled.

## Steps

1. **Catalog honesty.** List which providers are `live`, `unconfigured`, `blocked`, or `dev`. Match UI to that catalog.
2. **One live path.** Complete start → callback → session (or handoff) for a real provider you can register.
3. **Session shape.** Bearer (or equivalent) is random; store only a hash. Logout revokes that token.
4. **Linking (optional).** While signed in, attach a second identity to the same user id without creating a duplicate person in the friends graph.
5. **Failure modes.** Wrong callback URL, missing client secret, and “user denied” each produce a readable error — not a blank spinner.

## Success criteria

- [ ] At least one production-capable login path works end-to-end.
- [ ] Blocked providers show why they are blocked, not a dead button that pretends to work.
- [ ] Sessions are not recoverable from the database as plaintext tokens.
- [ ] You cannot “guess” another user’s session from a username alone.

## Send-back checklist (if a friend helps)

- PR with auth fix only — no drive-by redesign of the friends UI.
- Document env vars touched (`CLIENT_ID`, callback URL, etc.).
- Confirm smoke or manual login still passes after the change.
