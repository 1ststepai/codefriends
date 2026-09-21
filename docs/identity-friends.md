# Unified identity + friends graph

CodeFriends accounts are anchored on **email or phone**, then attach tool identities (Cursor / Claude / Codex / Gemini) onto one `users.id`. Friends, presence, and DMs all key off that id — the same human in Cursor and Claude is one friend.

## Anchor (email / phone)

1. `POST /api/auth/anchor/start` with `{ email }` **or** `{ phone }` → OTP challenge.
2. `POST /api/auth/anchor/verify` with `{ challengeId, code }` → session (creates user if new).
3. Signed-in attach: `POST /api/me/anchor/start` + `/verify` (same OTP store).

OTP codes are **hashed** in SQLite. There is **no SMS/email provider wired** yet. With `otpMock` on (local default; worker only when `CODEFRIENDS_OTP_MOCK=1`), the start response includes `mockCode` so tests and local UI can complete the loop. Production gap: plug a real sender and keep `otpMock` off.

Anchors are unique. They are **not** used to auto-merge separate provider logins by email (same rule as before).

## Verified tool links (not OAuth for Cursor / Claude / Codex)

Gemini **Sign in with Google** (OIDC) stays as a real login/link path.

For Cursor / Claude / Codex (and optional Gemini attach without OAuth):

1. Signed-in user: `POST /api/identities/link/start { "provider": "cursor" }` → one-time `code`.
2. Local plugin / `connect-client` (or the user pasting):  
   `POST /api/identities/link/complete { code, provider, subject, … }`.
3. Detach: `DELETE /api/identities/:provider`.

**What “verified” means:** the code was issued to an authenticated CodeFriends session and redeemed once with a claimed `subject` (stable id the companion can honestly supply — e.g. a local machine/account hint). It does **not** mean Cursor/Anthropic/OpenAI OAuth proved account ownership. We do not fake OAuth or scrape vendor sessions.

`identities.verification_method` is one of: `oidc` | `link_code` | `mock` | `dev` | `anchor` (anchor is the email/phone path on the user row, not an identities row).

## Friends: requests vs invite links

| Path | Behavior |
| --- | --- |
| `POST /api/friends` / WS `add_friend` | Creates a **pending** friend request. Recipient accepts or declines. |
| Mutual pending (A→B and B→A) | Auto-accepts into a bidirectional edge. |
| Invite link `POST /api/invites/accept` | Still creates a **bidirectional friend edge immediately** (trusted shortcut). Documented product choice — invites skip the request queue. |
| Seed roster | Uses instant edges so demos stay friends. |

Accept / decline / cancel:  
`POST /api/friends/requests/:id/accept|decline|cancel`.

## Presence + DMs

- Presence is per `users.id`. Linking Cursor + Claude onto one user makes one online friend; `client` reflects the last tool that updated presence.
- `GET /api/presence/resolve?provider=&subject=` maps a tool identity to that public user.
- 1:1 DMs stay friends-only on unified ids; thread cap remains **200** (`CODEFRIENDS_DM_HISTORY_LIMIT`).
