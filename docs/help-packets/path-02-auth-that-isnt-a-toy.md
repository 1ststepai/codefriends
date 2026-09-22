# Help packet: Path 02 — auth that isn't a toy

This file is a **help packet**. Accepting is voluntary. Run agents on **your** account. Send back a PR (preferred) or a patch. Do not post to socials unless the author asks.

Path: https://github.com/1ststepai/codefriends/blob/main/docs/school-paths/path-02-auth-that-isnt-a-toy.md

## Failure scenario

The login button looks finished — until a friend clicks it. The spinner dies, the callback 404s, or a “dev username” door is the only way in on a public host. Everyone learns the wrong lesson about auth.

## One concrete fix

Land **one** honest production-capable login path end-to-end, and make blocked/dev providers tell the truth in the UI.

## Ask your AI to…

1. Align start → callback → session (or handoff) for the live provider.
2. Match the registered redirect URI to env exactly.
3. Store session tokens hashed; revoke on logout.
4. Do not scrape IDE auth files or impersonate first-party CLI OAuth clients.

## Prove it

- [ ] Live login completes for a real account.
- [ ] Blocked providers show a real reason (not a dead pretend button).
- [ ] Smoke or a manual login still passes after the change.

## Friend review questions

- Which env names changed (values redacted)?
- Is dev login hidden or gated off production?
- Auth-only PR, or did UI drive-bys sneak in?

## Context (fill in)

- Repo URL:
- Branch:
- Relevant paths:
- Provider(s):
- Callback URL configured:
- What's blocked / tried:

## How to send back

Open a PR against the branch above. Patch file OK if a PR is not practical.
