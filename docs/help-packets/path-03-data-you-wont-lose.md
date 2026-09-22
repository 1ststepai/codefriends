# Help packet: Path 03 — data you won't lose

This file is a **help packet**. Accepting is voluntary. Run agents on **your** account. Send back a PR (preferred) or a patch. Do not post to socials unless the author asks.

Path: https://github.com/1ststepai/codefriends/blob/main/docs/school-paths/path-03-data-you-wont-lose.md

## Failure scenario

The board filled up all afternoon. Someone redeployed. Every topic vanished. The cohort stops writing because the school “forgets” them.

## One concrete fix

Make the durable write path survive process restart (or Worker redeploy) with named migrations and idempotent seeds — no boot wipe.

## Ask your AI to…

1. Identify store driver + tables for the rows that disappeared.
2. Add an additive migration only if schema is missing.
3. Prove write → restart → read for one known row.
4. Keep demo/official seeds insert-when-missing only.

## Prove it

- [ ] Restart keeps the row under test.
- [ ] Migration name listed in the PR (if any).
- [ ] Seeds do not truncate cohort data.

## Friend review questions

- Presence-only vs durable fields — which was confused?
- Local sqlite vs D1/Turso — which driver did you verify?
- History caps still documented?

## Context (fill in)

- Repo URL:
- Branch:
- Relevant paths:
- Store driver:
- What's blocked / tried:

## How to send back

Open a PR against the branch above. Patch file OK if a PR is not practical.
