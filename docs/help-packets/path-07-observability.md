# Help packet: Path 07 — observability

This file is a **help packet**. Accepting is voluntary. Run agents on **your** account. Send back a PR (preferred) or a patch. Do not post to socials unless the author asks.

Path: https://github.com/1ststepai/codefriends/blob/main/docs/school-paths/path-07-observability.md

## Failure scenario

Health is red. Logs are either empty or full of bearer tokens. Someone scrapes `/metrics` from the public internet. The next operator has no runbook.

## One concrete fix

Actionable failure breadcrumbs, gated admin metrics if present, zero secrets in logs — wire what exists; do not invent a new product surface.

## Ask your AI to…

1. Reproduce one known bad config and confirm an actionable log line.
2. Ensure metrics/admin routes reject anonymous access.
3. Scrub tokens/codes/sessions from log paths you touch.
4. Add a short “if health fails, check X then Y” note where operator docs already live.

## Prove it

- [ ] Forced failure is findable in logs.
- [ ] Metrics (if any) are not public.
- [ ] No secrets in log lines from this change.

## Friend review questions

- App vs tunnel/DNS — which did you verify?
- Feature freeze respected (no new dashboard product)?
- Where does the next operator read the runbook blurb?

## Context (fill in)

- Repo URL:
- Branch:
- Relevant paths:
- Where logs are read:
- What's blocked / tried:

## How to send back

Open a PR against the branch above. Patch file OK if a PR is not practical.
