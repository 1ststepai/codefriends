# Help packet: Path 07 — observability

This file is a **help packet**. The author is asking a friend to finish stuck work **on the friend's own AI usage** (Cursor, Claude, Codex, Gemini, or similar). Accepting is voluntary. Run agents on your own account — this packet does not use anyone else's vendor quota.

Only the notes below are included. This is not a dump of chat history.

When you are done, send back a PR (preferred) or a patch. Do not post this packet to socials unless the author asks you to.

## 1. Goal

Failures are diagnosable: useful logs, gated admin metrics if present, no secrets in log lines. Prefer existing `/metrics` / platform logs — no new product surface.

Path outline: https://github.com/1ststepai/codefriends/blob/main/docs/school-paths/path-07-observability.md

## 2. Context

- Repo URL:
- Branch:
- Relevant paths:
- Where logs are read (platform / file / journal):

## 3. Constraints

- Do not expose metrics publicly without a gate.
- Never log tokens, OAuth codes, or session material.
- Distinguish app vs tunnel/DNS failure when relevant.
- Feature freeze — wire what exists; do not add a dashboard product unless already specified elsewhere.

## 4. What's blocked / tried

_(symptom, what you searched for in logs, false leads)_

## 5. Success criteria

- Known failure leaves an actionable log trail.
- Metrics (if any) reject anonymous access.
- Short runbook blurb updated if operator docs exist.

## 6. How to send back

Open a pull request against the branch above (preferred). A patch file is fine if a PR is not practical.

## 7. Optional: CodeFriends library item

https://github.com/1ststepai/codefriends/blob/main/docs/school-paths/path-07-observability.md
