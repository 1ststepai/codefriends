# Path 08: Recovery & backups

**Stage:** Ship  
**Goal:** You have practiced one restore path for durable data before a disk dies. Seeds are not a backup.

**Help packet:** [path-08-recovery-and-backups.md](../help-packets/path-08-recovery-and-backups.md)

## What can go wrong

Persistence without recovery is a single point of failure. Cohort DMs and board posts vanish with the laptop; “we’ll seed again” does not bring them back.

## Ask your AI to…

1. Locate the real data (SQLite path, D1 id, etc.).
2. Take a backup or platform export while idle.
3. Restore into a scratch/non-production target and read a known row.
4. Write one paragraph: where backups live, how often, how to restore.

## Prove it

- [ ] Backup artifact exists (or automation is named).
- [ ] Restore drill showed a real durable row.
- [ ] You know what seed re-creates vs what only lives in backups.

## Friend review questions

- Was the restore practiced, or only theorized?
- Are backup blobs kept out of git?
- What is the next action if the laptop dies tonight?
