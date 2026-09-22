# Help packet: Security — session-store ACL

Optional Path 05 drill. Accepting is voluntary. Run agents on **your** account. Send back a PR or patch.

Related path: https://github.com/1ststepai/codefriends/blob/main/docs/school-paths/path-05-input-validation-and-abuse.md

## Failure scenario

Session tokens (or refresh material) live in a shared cache or Redis-like store bound to `0.0.0.0` with a blank password. Anyone on the network who can reach the port dumps every live session and walks into accounts without touching login.

## One concrete fix

Treat the session/token store as sensitive as the primary database: require authentication (ACL/password), bind to private interfaces or a locked-down IP range, drop dangerous commands you do not need, and never expose the port on the public internet.

## Ask your AI to…

1. Identify whether this project (or the author’s deploy) uses Redis, Valkey, Memcached, or another shared session cache.
2. If yes: enable ACL/password, restrict bind address, and document the network path (private VPC / tunnel only).
3. If the app uses only local SQLite hashed sessions with no shared cache, say so in the PR and instead harden DB file permissions / host access — do not invent a Redis dependency just to “check the box.”
4. Confirm app config does not log full session payloads from the store.

## Prove it

- [ ] Unauthenticated clients cannot read the session store from a non-app host (or N/A with written justification).
- [ ] Bind address / ACL settings are documented for operators.
- [ ] No new public port opened for the store.

## Friend review questions

- Is the store reachable from the internet today?
- Are session values encrypted at rest, or only access-gated?
- Did the PR add Redis where SQLite sessions were already enough?

## Context (fill in)

- Repo URL:
- Branch:
- Relevant paths:
- Store type (redis / none / other):
- What's blocked / tried:

## How to send back

Open a PR against the branch above. Patch file OK if a PR is not practical. Never paste store passwords into the packet.
