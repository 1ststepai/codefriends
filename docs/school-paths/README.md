# School Paths

Eight short production paths for CodeFriends — an AI coding school with friends in the room.

Each path is a **markdown outline** you (or a friend) can run in Cursor, Claude, Codex, Gemini, or any other coding AI. The goal is shipping discipline, not a certificate and not a single IDE.

| # | Path | What you practice |
| --- | --- | --- |
| 01 | [Ship a friend-visible demo](./path-01-friend-visible-demo.md) | Presence + one DM that proves the product is alive |
| 02 | [Auth that isn't a toy](./path-02-auth-that-isnt-a-toy.md) | Real sign-in, sessions, and honest “blocked” providers |
| 03 | [Data you won't lose](./path-03-data-you-wont-lose.md) | Durable store, migrations, restart survival |
| 04 | [Secrets & config hygiene](./path-04-secrets-and-config-hygiene.md) | Env, callbacks, never commit keys |
| 05 | [Input validation & abuse basics](./path-05-input-validation-and-abuse.md) | Bounds, auth gates, safe defaults |
| 06 | [Deploy & health checks](./path-06-deploy-and-health-checks.md) | Public URL, `/health`, smoke after deploy |
| 07 | [Observability (logs/errors)](./path-07-observability.md) | Readable failures, metrics without drama |
| 08 | [Recovery & backups](./path-08-recovery-and-backups.md) | Restore path before you need it |

## How to use a path

1. Open the path markdown (Library shelf or this folder).
2. Paste it into your own AI chat — **your** usage, not a friend’s quota.
3. Fill the matching [help packet template](../help-packets/README.md) if you want a friend to finish a stuck step and send a PR back.
4. Pin a weekly prompt on the [school board](../school-board-prompts.md) if your cohort runs one.

## Product rules (keep these)

- Free core forever — no gated “layers,” no fake certificates.
- Tool-agnostic — teach production habits that survive IDE changes.
- Help packets are voluntary; friends run agents on their own accounts.
- Official shelf entries for these paths are seeded with the rest of the 1stStep library (see `packages/core/src/seed.ts`).

## Finding Paths in CodeFriends

Sign in → open the **Library** tab → scroll the **official** shelf (author `1ststep`). Look for **School Paths** and **Path 01** … **Path 08**. Each card opens the GitHub markdown for that path.
