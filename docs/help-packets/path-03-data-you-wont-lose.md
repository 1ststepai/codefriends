# Help packet: Path 03 — data you won't lose

This file is a **help packet**. The author is asking a friend to finish stuck work **on the friend's own AI usage** (Cursor, Claude, Codex, Gemini, or similar). Accepting is voluntary. Run agents on your own account — this packet does not use anyone else's vendor quota.

Only the notes below are included. This is not a dump of chat history.

When you are done, send back a PR (preferred) or a patch. Do not post this packet to socials unless the author asks you to.

## 1. Goal

Durable rows (friends / DMs / board / library as relevant) survive process restart via the existing store + named migrations. Seeds stay idempotent.

Path outline: https://github.com/1ststepai/codefriends/blob/main/docs/school-paths/path-03-data-you-wont-lose.md

## 2. Context

- Repo URL:
- Branch:
- Relevant paths:
- Store driver (sqlite file / D1 / other):

## 3. Constraints

- Prefer additive named migrations; do not wipe cohort data on boot.
- Presence may stay in memory; durable fields must write to the store.
- Respect existing history caps.

## 4. What's blocked / tried

_(what disappeared after restart, migration names tried)_

## 5. Success criteria

- Restart keeps the rows under test.
- Migration list updated if a schema change was required.
- Seeds insert-when-missing only.

## 6. How to send back

Open a pull request against the branch above (preferred). A patch file is fine if a PR is not practical.

## 7. Optional: CodeFriends library item

https://github.com/1ststepai/codefriends/blob/main/docs/school-paths/path-03-data-you-wont-lose.md
