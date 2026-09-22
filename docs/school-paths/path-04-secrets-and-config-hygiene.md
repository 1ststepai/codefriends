# Path 04: Secrets & config hygiene

**Goal:** Runtime secrets live in env / platform secret stores; the repo only ships examples and docs. Callback URLs match exactly what the IdP allows.

**Help packet:** [path-04-secrets-and-config-hygiene.md](../help-packets/path-04-secrets-and-config-hygiene.md)

## Why this path

Leaked keys and mismatched OAuth callbacks are the fastest way to burn a free-tier weekend. Hygiene is a production skill, not a polish pass.

## Constraints

- Never commit `.env`, private keys, or session material.
- `.env.example` documents names and shapes — not real values.
- Public URL vs popout URL vs OAuth callback must be consistent (http(s) only for browser redirects).
- Rotating a secret should not require rewriting application code.

## Steps

1. **Inventory.** List every secret the app needs (DB URL, OAuth client secret, admin token, …).
2. **Example file.** Ensure each name appears in `.env.example` with a one-line comment.
3. **Callback match.** Register the exact redirect URI the code uses; fix drift before debugging “login broken.”
4. **Build-time vs runtime.** Know which vars are baked into a static popout at build time vs read by the API at runtime.
5. **Leak check.** Search the repo and recent commits for accidental tokens; rotate if anything landed.

## Success criteria

- [ ] A fresh clone can configure from `.env.example` + docs alone.
- [ ] No real secrets in git history for this change set.
- [ ] OAuth (or other) callback URI in the console matches env exactly.
- [ ] You know which deploy step must be redone when a Vite/`VITE_*` value changes.

## Send-back checklist (if a friend helps)

- Diff shows `.env.example` / docs only for secret *names* — never values.
- Call out any rotation the operator must do after merge.
- Confirm local boot still reads config the same way.
