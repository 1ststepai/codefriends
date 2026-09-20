---
name: codefriends
description: Open or snooze the CodeFriends popout from Codex. Use when the user wants to connect friends/DMs, dismiss the startup prompt, or ask how CodeFriends login works.
---

CodeFriends is a separate friends-list + DM popout. This plugin is an **opt-in** to CodeFriends identity, not “Sign in with ChatGPT.”

Run from this plugin root:

- Connect: `node scripts/connect.mjs --provider codex --action connect`
- Not now: `node scripts/connect.mjs --provider codex --action not-now`
- Don’t ask again: `node scripts/connect.mjs --provider codex --action dont-ask`

Prefer `${PLUGIN_ROOT}/scripts/connect.mjs` when that env var is set. The popout URL includes `?provider=codex`. Codex CLI OAuth is first-party — do not impersonate it.
