# Help packet: Security — redirect allowlist

Optional Path 05 drill. Accepting is voluntary. Run agents on **your** account. Send back a PR or patch.

Related path: https://github.com/1ststepai/codefriends/blob/main/docs/school-paths/path-05-input-validation-and-abuse.md

## Failure scenario

Login finishes and the app honors a `?next=` (or `return_to` / `redirect`) query param. An attacker sends your users through your real login page — then bounces them to a lookalike phishing host that harvests the next password they type.

## One concrete fix

Allowlist redirect destinations (same-origin paths or an explicit host list). Reject absolute URLs to unknown hosts, protocol-relative URLs, and encoded tricks (`%2f%2f`, nested redirects). Default to a safe in-app landing when the param is missing or invalid.

## Ask your AI to…

1. Find every post-auth redirect that reads user-controlled input.
2. Replace “trust the query string” with an allowlist check.
3. Add tests for `https://evil.example/`, `//evil.example`, and encoded variants.
4. Keep OAuth provider callback URLs configured in the IdP console — do not confuse those with open redirects in *your* app.

## Prove it

- [ ] Evil absolute URL is rejected or ignored.
- [ ] Safe same-origin path still works.
- [ ] At least one encoded bypass attempt fails the check.

## Friend review questions

- Were invite links / handoff codes audited too?
- Does the error tell a builder what happened without reflecting the attacker URL into HTML?
- Any third-party “login with” button that still forwards raw `next`?

## Context (fill in)

- Repo URL:
- Branch:
- Relevant paths:
- Param names involved:
- What's blocked / tried:

## How to send back

Open a PR against the branch above. Patch file OK if a PR is not practical.
