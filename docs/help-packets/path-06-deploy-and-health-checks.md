# Help packet: Path 06 — deploy & health checks

This file is a **help packet**. Accepting is voluntary. Run agents on **your** account. Send back a PR (preferred) or a patch. Do not post to socials unless the author asks.

Path: https://github.com/1ststepai/codefriends/blob/main/docs/school-paths/path-06-deploy-and-health-checks.md

## Failure scenario

Friday demo: the link in the board topic is a dead tunnel from Tuesday. Friends refresh `/health` on the wrong host and conclude “the app is down” when only DNS moved.

## One concrete fix

One public https origin, green `/health`, popout/API reachability — prefer free/already-paid tiers; no new paywall for core.

## Ask your AI to…

1. Document the chosen backend (Worker, Node+tunnel, …) and hostname owner.
2. Align public/popout URLs and OAuth callbacks if login is live.
3. Keep `/health` cheap; sample the JSON (redact anything sensitive).
4. Note whether the URL rotates and how friends should get the new one.

## Prove it

- [ ] `/health` ok on the deployed origin.
- [ ] Popout can reach the API.
- [ ] PR body names hostname + owning service.

## Friend review questions

- Tunnel vs app — which failed last time, and how do you tell?
- Stable named host or rotating quick tunnel?
- Any new paid plan introduced?

## Context (fill in)

- Repo URL:
- Branch:
- Relevant paths:
- Target host / platform:
- Public URL:
- What's blocked / tried:

## How to send back

Open a PR against the branch above. Patch file OK if a PR is not practical.
