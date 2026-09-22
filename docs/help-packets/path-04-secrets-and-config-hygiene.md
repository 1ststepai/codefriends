# Help packet: Path 04 — secrets & config hygiene

This file is a **help packet**. The author is asking a friend to finish stuck work **on the friend's own AI usage** (Cursor, Claude, Codex, Gemini, or similar). Accepting is voluntary. Run agents on your own account — this packet does not use anyone else's vendor quota.

Only the notes below are included. This is not a dump of chat history.

When you are done, send back a PR (preferred) or a patch. Do not post this packet to socials unless the author asks you to.

## 1. Goal

Secrets stay in env / platform stores; `.env.example` documents names; OAuth (or similar) callback URIs match env exactly.

Path outline: https://github.com/1ststepai/codefriends/blob/main/docs/school-paths/path-04-secrets-and-config-hygiene.md

## 2. Context

- Repo URL:
- Branch:
- Relevant paths:
- Hosts involved (API / popout / IdP console):

## 3. Constraints

- Never commit real secret values — names and shapes only.
- Do not rewrite app code just to rotate a secret.
- Call out build-time (`VITE_*`) vs runtime env clearly.

## 4. What's blocked / tried

_(mismatch symptoms; rotate-if-leaked notes — no raw secrets)_

## 5. Success criteria

- Fresh clone can configure from example + docs.
- Callback URI matches exactly.
- No secrets in the PR diff.

## 6. How to send back

Open a pull request against the branch above (preferred). A patch file is fine if a PR is not practical.

## 7. Optional: CodeFriends library item

https://github.com/1ststepai/codefriends/blob/main/docs/school-paths/path-04-secrets-and-config-hygiene.md
