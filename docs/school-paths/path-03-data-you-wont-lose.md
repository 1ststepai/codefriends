# Path 03: Data you won't lose

**Stage:** Finish  
**Goal:** Friend-visible state survives restart — friends, DMs, board, library — via a durable store and named migrations.

**Help packet:** [path-03-data-you-wont-lose.md](../help-packets/path-03-data-you-wont-lose.md)

## What can go wrong

In-memory-only demos vanish on deploy. The cohort loses board posts and DMs, then stops trusting the school.

## Ask your AI to…

1. Name the store (SQLite file, D1, etc.) and the tables that hold cohort data.
2. Use additive named migrations; never wipe seeds or cohort rows on boot.
3. Write one durable row, restart, and read it back.
4. Cap unbounded history if the product already does (e.g. DM thread length).

## Prove it

- [ ] Restart keeps the rows under test.
- [ ] You can point at the migration list.
- [ ] Seeds insert-when-missing only.

## Friend review questions

- What disappears if the process dies right now?
- Did the PR add a migration or only app code?
- Are presence sockets allowed to be in-memory while durable fields write to the store?
