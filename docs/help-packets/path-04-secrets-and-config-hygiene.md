# Help packet: Path 04 — secrets & config hygiene

This file is a **help packet**. Accepting is voluntary. Run agents on **your** account. Send back a PR (preferred) or a patch. Do not post to socials unless the author asks.

Path: https://github.com/1ststepai/codefriends/blob/main/docs/school-paths/path-04-secrets-and-config-hygiene.md

## Failure scenario

Login “randomly” fails after a deploy. The real bug: callback URL drifted, or a teammate committed a client secret “just for local.” Rotation becomes a fire drill.

## One concrete fix

Secrets stay in env/platform stores; `.env.example` documents names only; OAuth (or similar) callback URIs match env **exactly**.

## Ask your AI to…

1. Diff env example vs required runtime names.
2. Fix callback / public URL / popout URL consistency (http(s) only for browser redirects).
3. Call out build-time vs runtime vars.
4. Search the change set for accidental secret values — never paste them into the PR.

## Prove it

- [ ] Fresh clone can configure from example + docs.
- [ ] Callback URI matches the IdP console entry.
- [ ] PR contains no secret values.

## Friend review questions

- Any rotation the operator must do after merge?
- Which host owns which URL?
- Would rotating the secret require a code change?

## Context (fill in)

- Repo URL:
- Branch:
- Relevant paths:
- Hosts (API / popout / IdP):
- What's blocked / tried:

## How to send back

Open a PR against the branch above. Patch file OK if a PR is not practical.
