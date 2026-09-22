# School Paths

**Build → Finish → Ship** — CodeFriends’ free course spine for turning a thin demo into something friends can trust.

Eight short paths. Tool-agnostic (Cursor, Claude, Codex, Gemini, or other). No certificates, no gated “layers,” no paywall on core safety.

| Stage | What it means here |
| --- | --- |
| **Build** | Ship a friend-visible thin slice — presence + one real interaction. |
| **Finish** | Close production gaps: auth, data, secrets, security, deploy, logs. |
| **Ship** | Health, rollback, and a restore drill before you need them. |

Each path is a markdown outline you paste into **your** AI chat. Stuck? Hand a [help packet](../help-packets/README.md) to a friend so they finish a step on **their** usage and send a PR back.

## The eight paths

| # | Stage | Path | Production focus |
| --- | --- | --- | --- |
| 01 | Build | [Friend-visible demo](./path-01-friend-visible-demo.md) | UI + thin API loop (presence + one DM) |
| 02 | Finish | [Auth that isn't a toy](./path-02-auth-that-isnt-a-toy.md) | Auth / sessions / honest providers |
| 03 | Finish | [Data you won't lose](./path-03-data-you-wont-lose.md) | Database / storage / migrations |
| 04 | Finish | [Secrets & config hygiene](./path-04-secrets-and-config-hygiene.md) | Config, env, callbacks |
| 05 | Finish | [Security & abuse basics](./path-05-input-validation-and-abuse.md) | Validation, gates, optional security drills |
| 06 | Finish → Ship | [Deploy & health checks](./path-06-deploy-and-health-checks.md) | Hosting, public URL, `/health` |
| 07 | Ship | [Observability](./path-07-observability.md) | Logs / errors / gated metrics |
| 08 | Ship | [Recovery & backups](./path-08-recovery-and-backups.md) | Availability / restore drill |

Optional security help packets (Path 05 shelf): [session regenerate](../help-packets/security-session-regenerate.md), [redirect allowlist](../help-packets/security-redirect-allowlist.md), [frame denial](../help-packets/security-frame-denial.md), [session-store ACL](../help-packets/security-session-store-acl.md).

## Production areas (crosswalk)

These eight paths cover the habits below without a 13-card certification track. Use the names when you talk with friends; do not treat a finished path as an audit or license.

1. UI/frontend · 2. API/backend · 3. Data/storage · 4. Auth · 5. Deploy/hosting · 6. Cloud/config · 7. CI/smoke · 8. Security defaults · 9. Abuse/rate bounds · 10. Cache/CDN (when you have one) · 11. Scale notes (honest limits) · 12. Logs/errors · 13. Recovery

## How to use a path

1. Open the path (Library shelf or this folder).
2. Paste it into your own AI — **your** usage.
3. Fill the matching [help packet](../help-packets/README.md) if a friend should finish one stuck step.
4. Pin a [Ship / Demo Friday](../school-board-prompts.md) prompt on the school board.

## Product rules

- Free core forever — fundamentals stay open.
- Evidence over badges — a path “done” means a prove-it check + optional friend review, not a video watch.
- Help packets are voluntary.
- Official shelf seeds: `packages/core/src/seed.ts` (same system as other 1stStep cards).

## Finding Paths in CodeFriends

Sign in → **Library** → official shelf (author `1ststep`) → **School Paths**, **Path 01** … **Path 08**, **Path help packets**, or the optional **Security:** cards.
