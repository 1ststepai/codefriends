# Help packet: Path 08 — recovery & backups

This file is a **help packet**. The author is asking a friend to finish stuck work **on the friend's own AI usage** (Cursor, Claude, Codex, Gemini, or similar). Accepting is voluntary. Run agents on your own account — this packet does not use anyone else's vendor quota.

Only the notes below are included. This is not a dump of chat history.

When you are done, send back a PR (preferred) or a patch. Do not post this packet to socials unless the author asks you to.

## 1. Goal

Document and practice one restore path for durable data (SQLite copy, D1 export, etc.). Seeds are not a substitute for cohort backups.

Path outline: https://github.com/1ststepai/codefriends/blob/main/docs/school-paths/path-08-recovery-and-backups.md

## 2. Context

- Repo URL:
- Branch:
- Relevant paths:
- Data location (file path or DB id — no credentials):

## 3. Constraints

- Practice restore on a scratch/non-production target first.
- Do not commit backup blobs into git.
- Confirm idempotent seeds do not wipe restored cohort rows.
- Prefer free/platform-native export over new paid SaaS for this path.

## 4. What's blocked / tried

_(backup command used, restore error, what row you expected to see)_

## 5. Success criteria

- Backup artifact exists.
- Restore drill showed a known durable row.
- Operator note lists where backups live and how to restore.

## 6. How to send back

Open a pull request against the branch above (preferred). A patch file is fine if a PR is not practical. Redact secrets from any command logs.

## 7. Optional: CodeFriends library item

https://github.com/1ststepai/codefriends/blob/main/docs/school-paths/path-08-recovery-and-backups.md
