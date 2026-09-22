# Path 03: Data you won't lose

**Goal:** User-visible state survives a process restart — friends, DMs, board posts, library items — via an ordinary durable store and named migrations.

**Help packet:** [path-03-data-you-wont-lose.md](../help-packets/path-03-data-you-wont-lose.md)

## Why this path

In-memory-only demos lie. A school cohort needs the board and DMs to still be there after deploy, crash, or laptop sleep.

## Constraints

- Prefer SQL (SQLite / D1 / similar) over ad-hoc JSON files for relational graphs.
- Migrations are named and additive; do not wipe seed data on restart.
- Cap unbounded history (e.g. DM thread length) so disks stay honest.
- Presence sockets may stay in memory; durable fields (`last_seen`, profile, messages) write back to the store.

## Steps

1. **Name the store.** File SQLite locally, D1 (or equivalent) in production — one schema story.
2. **Migrations.** Confirm schema versioning exists; add a tiny additive migration only if the feature needs it.
3. **Write path.** Create a durable row (message, topic, or library item). Restart the process.
4. **Read path.** Same row is still there for the same user.
5. **Idempotent seeds.** Demo users / official shelf insert when missing, never truncate on boot.

## Success criteria

- [ ] Restart (or Worker redeploy) keeps the durable rows you care about.
- [ ] You can point to the migration list and the table names involved.
- [ ] Seed data does not destroy cohort content on every boot.
- [ ] History caps are documented if they exist.

## Send-back checklist (if a friend helps)

- Migration name + up SQL in the PR.
- Note local vs production driver (`better-sqlite3`, D1, Turso, …).
- Smoke or a one-line restart check described in the PR body.
