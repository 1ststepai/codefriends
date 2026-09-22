# Help packet: Path 05 — security & abuse basics

This file is a **help packet**. Accepting is voluntary. Run agents on **your** account. Send back a PR (preferred) or a patch. Do not post to socials unless the author asks.

Path: https://github.com/1ststepai/codefriends/blob/main/docs/school-paths/path-05-input-validation-and-abuse.md

## Failure scenario

Someone posts a 50kb board body or a `javascript:` “library link.” Or an anonymous client hits a write route and it succeeds. The friendly school becomes a spam magnet overnight.

## One concrete fix

Fail closed on unauthenticated writes; enforce server-side bounds and https URL cleaning; keep official shelf items undeletable by normal users.

## Ask your AI to…

1. Map durable write routes and confirm each requires auth.
2. Reject over-long fields with clear 4xx (not silent truncate-only).
3. Reuse existing https / host allowlist helpers for library and profile URLs.
4. Optionally continue with one Path 05 security drill packet if the author names it.

## Prove it

- [ ] Over-long / bad URL rejected with a clear error.
- [ ] Unauthenticated write fails.
- [ ] Official items remain undeletable by normal users.

## Friend review questions

- Which routes were tested?
- Any new SaaS dependency that was unnecessary?
- Did an optional security drill ship in the same PR?

## Context (fill in)

- Repo URL:
- Branch:
- Relevant paths:
- Routes or fields under test:
- Optional security drill (if any):
- What's blocked / tried:

## How to send back

Open a PR against the branch above. Patch file OK if a PR is not practical.
