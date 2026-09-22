# Help packet: Path 05 — input validation & abuse basics

This file is a **help packet**. The author is asking a friend to finish stuck work **on the friend's own AI usage** (Cursor, Claude, Codex, Gemini, or similar). Accepting is voluntary. Run agents on your own account — this packet does not use anyone else's vendor quota.

Only the notes below are included. This is not a dump of chat history.

When you are done, send back a PR (preferred) or a patch. Do not post this packet to socials unless the author asks you to.

## 1. Goal

Write routes require auth; field lengths and URLs are validated server-side; official shelf / others’ data cannot be deleted by a normal user.

Path outline: https://github.com/1ststepai/codefriends/blob/main/docs/school-paths/path-05-input-validation-and-abuse.md

## 2. Context

- Repo URL:
- Branch:
- Relevant paths:
- Routes or fields under test:

## 3. Constraints

- Fail closed for unauthenticated writes.
- Prefer clear 4xx messages over silent truncate for builder UIs.
- No new CAPTCHA/payment/rate-limit SaaS unless already required.
- https-only (and host allowlists) where the product already enforces them.

## 4. What's blocked / tried

_(payload that slipped through, missing gate, error text)_

## 5. Success criteria

- Over-long / bad URL rejected with a clear error.
- Unauthenticated write fails.
- Official items remain undeletable by normal users.

## 6. How to send back

Open a pull request against the branch above (preferred). A patch file is fine if a PR is not practical.

## 7. Optional: CodeFriends library item

https://github.com/1ststepai/codefriends/blob/main/docs/school-paths/path-05-input-validation-and-abuse.md
