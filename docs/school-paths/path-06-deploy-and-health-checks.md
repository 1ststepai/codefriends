# Path 06: Deploy & health checks

**Goal:** A public https origin serves the API (and popout if co-hosted), `/health` returns ok, and a post-deploy smoke or manual check proves the friend-visible loop still works.

**Help packet:** [path-06-deploy-and-health-checks.md](../help-packets/path-06-deploy-and-health-checks.md)

## Why this path

“Works on my laptop” is not a ship. Health checks and a stable public URL turn a cohort demo into something friends can bookmark.

## Constraints

- Prefer $0 / already-paid tiers when following this repo’s deploy docs — no new paywalls for core.
- Quick tunnels that rotate every restart are fine for a spike; named hostnames for anything friends rely on.
- `/health` should be cheap and dependency-light (ok flag, optional online count / store name).
- Do not claim uptime SLAs you are not measuring.

## Steps

1. **Pick a path.** Worker+D1, Node self-host + tunnel, or the repo’s documented $0 layout — one backend.
2. **Public URL.** Set `CODEFRIENDS_PUBLIC_URL` / popout URL (or equivalents) to the https origin friends will open.
3. **Health.** `GET /health` returns success JSON on that origin.
4. **Auth callback.** Production login redirect URIs include that same host if OAuth is live.
5. **Smoke.** Run repo smoke against a temp DB locally, then a short manual check on the deployed host (login or presence).

## Success criteria

- [ ] Friends can open a stable https URL (or you documented that the URL rotates and why).
- [ ] `/health` is green on the deployed origin.
- [ ] Popout or desktop can reach the API (CORS / same-origin as designed).
- [ ] You know how to read deploy logs when health fails.

## Send-back checklist (if a friend helps)

- Exact hostname and which service owns it (Worker, Vercel, tunnel, …).
- Env vars changed on the host — names only in the PR.
- Health response sample (redact anything sensitive).
