# Help packet: Security — session regenerate after login

Optional Path 05 drill. Accepting is voluntary. Run agents on **your** account. Send back a PR or patch.

Related path: https://github.com/1ststepai/codefriends/blob/main/docs/school-paths/path-05-input-validation-and-abuse.md

## Failure scenario

A friend follows a link that already carried someone else’s session id. After they “log in,” the browser keeps that pre-set id — so the attacker who planted it rides the new authenticated session without ever knowing the password.

## One concrete fix

Issue a **new** session identifier after successful login (and after privilege changes). Set Secure, HttpOnly, and a strict SameSite policy on session cookies when the stack uses cookies. If the app uses bearer tokens in memory/local storage instead, mint a fresh token post-login and invalidate the prior anonymous/pre-auth token.

## Ask your AI to…

1. Find where login completes and where the session/token is created.
2. Regenerate or rotate the session/token at that exact moment — not only at first anonymous visit.
3. Apply Secure / HttpOnly / SameSite (or the stack’s equivalent) for cookie sessions.
4. Add a short test or manual prove-it: pre-auth id must not equal post-login id.

## Prove it

- [ ] Session/token value before login ≠ value after login for the same browser.
- [ ] Logout invalidates the post-login credential.
- [ ] PR describes the regeneration hook in one sentence.

## Friend review questions

- Does linking a second identity also rotate the session?
- Any log line that prints the raw session id?
- Cookie flags verified in a real browser response, or only assumed?

## Context (fill in)

- Repo URL:
- Branch:
- Relevant paths:
- Session mechanism (cookie / bearer / other):
- What's blocked / tried:

## How to send back

Open a PR against the branch above. Patch file OK if a PR is not practical.
