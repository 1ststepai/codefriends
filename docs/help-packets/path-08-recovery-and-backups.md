# Help packet: Path 08 — recovery & backups

This file is a **help packet**. Accepting is voluntary. Run agents on **your** account. Send back a PR (preferred) or a patch. Do not post to socials unless the author asks.

Path: https://github.com/1ststepai/codefriends/blob/main/docs/school-paths/path-08-recovery-and-backups.md

## Failure scenario

The laptop that held the SQLite file is gone. “Just re-seed” brings back demo users — not the cohort’s board or DMs. Nobody practiced restore while calm.

## One concrete fix

Take a real backup, restore once into a scratch target, read a known durable row, and write the operator paragraph.

## Ask your AI to…

1. Locate data (file path or DB id — no credentials in the packet).
2. Perform backup using the platform’s boring option (copy/export).
3. Restore to non-production and query one known row.
4. Confirm idempotent seeds do not wipe restored cohort rows.

## Prove it

- [ ] Backup artifact exists.
- [ ] Restore drill showed the known row.
- [ ] Operator note lists where/how/when.

## Friend review questions

- Practiced restore, or backup-only theater?
- Backup blobs kept out of git?
- What is the action if the primary host dies tonight?

## Context (fill in)

- Repo URL:
- Branch:
- Relevant paths:
- Data location (no credentials):
- What's blocked / tried:

## How to send back

Open a PR against the branch above. Patch file OK if a PR is not practical. Redact secrets from command logs.
