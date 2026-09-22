# Help packet: Path 02 — auth that isn't a toy

This file is a **help packet**. The author is asking a friend to finish stuck work **on the friend's own AI usage** (Cursor, Claude, Codex, Gemini, or similar). Accepting is voluntary. Run agents on your own account — this packet does not use anyone else's vendor quota.

Only the notes below are included. This is not a dump of chat history.

When you are done, send back a PR (preferred) or a patch. Do not post this packet to socials unless the author asks you to.

## 1. Goal

Make one production-capable login path work end-to-end, and keep blocked/dev providers honest in the UI — no pretend OAuth, no password door.

Path outline: https://github.com/1ststepai/codefriends/blob/main/docs/school-paths/path-02-auth-that-isnt-a-toy.md

## 2. Context

- Repo URL:
- Branch:
- Relevant paths:
- Provider(s) involved:
- Callback URL configured:

## 3. Constraints

- Do not scrape IDE auth files or impersonate first-party CLI OAuth clients.
- Do not auto-merge identities by email.
- Dev username login must stay out of production UX unless explicitly enabled.
- Auth-only PR — no drive-by friends UI redesign.

## 4. What's blocked / tried

_(start/callback errors, env names without secret values)_

## 5. Success criteria

- Live provider completes start → session (or handoff).
- Blocked providers show a real reason.
- Sessions stored hashed; logout revokes the bearer.

## 6. How to send back

Open a pull request against the branch above (preferred). A patch file is fine if a PR is not practical.

## 7. Optional: CodeFriends library item

https://github.com/1ststepai/codefriends/blob/main/docs/school-paths/path-02-auth-that-isnt-a-toy.md
