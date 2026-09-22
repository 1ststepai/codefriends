# Path 04: Secrets & config hygiene

**Stage:** Finish  
**Goal:** Secrets live in env / platform stores; the repo ships examples only. Callback URLs match the IdP exactly.

**Help packet:** [path-04-secrets-and-config-hygiene.md](../help-packets/path-04-secrets-and-config-hygiene.md)

## What can go wrong

A committed API key or a drifted OAuth callback burns a free-tier weekend and trains “just paste the secret in chat.”

## Ask your AI to…

1. Inventory every secret name the app needs.
2. Document each in `.env.example` with a one-line comment — never real values.
3. Align public URL, popout URL, and OAuth callback (http(s) only for browser redirects).
4. Separate build-time (`VITE_*`) vars from runtime API config.

## Prove it

- [ ] Fresh clone configures from example + docs.
- [ ] No real secrets in the change set.
- [ ] Callback URI matches env exactly.

## Friend review questions

- Which deploy step must be redone if a Vite env changes?
- Would rotating a secret require a code change?
- Any tokens in recent commits that need rotation?
