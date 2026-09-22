# Help packet: Security — frame denial headers

Optional Path 05 drill. Accepting is voluntary. Run agents on **your** account. Send back a PR or patch.

Related path: https://github.com/1ststepai/codefriends/blob/main/docs/school-paths/path-05-input-validation-and-abuse.md

## Failure scenario

A hostile page embeds your app in a full-page iframe. Users think they are clicking *your* “Sign in” or “Send invite,” but the outer page is capturing clicks or overlaying UI. Your school UI becomes a costume for someone else’s site.

## One concrete fix

Send framing defenses on HTML responses: `X-Frame-Options: DENY` (or `SAMEORIGIN` only if you truly need first-party frames) and a CSP `frame-ancestors` directive that matches that policy (`'none'` or an explicit allowlist).

## Ask your AI to…

1. Locate where HTTP security headers are set (middleware, Worker, reverse proxy).
2. Add `X-Frame-Options` and CSP `frame-ancestors` consistently on document responses.
3. Verify with `curl -I` (or browser devtools) on the popout origin and the API origin if it serves HTML.
4. Do not weaken the policy “so a marketing site can iframe us” unless product explicitly requires it — and then allowlist only that host.

## Prove it

- [ ] Response headers include the framing policy on the main HTML entry.
- [ ] A simple local HTML file with `<iframe src="…">` fails to show the app (browser blocks it).
- [ ] PR notes where headers are applied (app vs proxy).

## Friend review questions

- API JSON routes vs HTML — headers on the right surfaces?
- Any intentional embed (desktop WebView) broken by DENY, and was SAMEORIGIN enough?
- CSP not so loose that `frame-ancestors *` sneaks back in?

## Context (fill in)

- Repo URL:
- Branch:
- Relevant paths:
- Origins to protect:
- What's blocked / tried:

## How to send back

Open a PR against the branch above. Patch file OK if a PR is not practical.
