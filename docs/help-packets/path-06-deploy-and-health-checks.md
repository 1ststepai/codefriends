# Help packet: Path 06 — deploy & health checks

This file is a **help packet**. The author is asking a friend to finish stuck work **on the friend's own AI usage** (Cursor, Claude, Codex, Gemini, or similar). Accepting is voluntary. Run agents on your own account — this packet does not use anyone else's vendor quota.

Only the notes below are included. This is not a dump of chat history.

When you are done, send back a PR (preferred) or a patch. Do not post this packet to socials unless the author asks you to.

## 1. Goal

Public https origin serves the API; `/health` is green; friends can open the popout against that API. Prefer free/already-paid tiers — no new paywall for core.

Path outline: https://github.com/1ststepai/codefriends/blob/main/docs/school-paths/path-06-deploy-and-health-checks.md

## 2. Context

- Repo URL:
- Branch:
- Relevant paths:
- Target host / platform:
- Public URL (if stable):

## 3. Constraints

- One backend path (Worker, Node+tunnel, etc.) — do not dual-write.
- Document rotating quick-tunnel URLs if that is the chosen spike path.
- Do not invent uptime SLAs.

## 4. What's blocked / tried

_(health body, DNS/tunnel symptoms, CORS errors — redact secrets)_

## 5. Success criteria

- `/health` ok on the deployed origin.
- Popout/API reachability confirmed.
- Callback URIs updated if OAuth is live on that host.

## 6. How to send back

Open a pull request against the branch above (preferred). A patch file is fine if a PR is not practical. Include hostname + owning service in the PR body.

## 7. Optional: CodeFriends library item

https://github.com/1ststepai/codefriends/blob/main/docs/school-paths/path-06-deploy-and-health-checks.md
