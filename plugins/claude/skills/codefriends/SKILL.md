---
name: codefriends
description: Open or snooze the CodeFriends popout from Claude Code. Use when the user wants to connect friends/DMs, dismiss the startup prompt, or ask how CodeFriends login works.
---

CodeFriends is a separate friends-list + DM popout. This plugin is an **opt-in** to CodeFriends identity, not Claude account login.

- Connect: `node "${CLAUDE_PLUGIN_ROOT}/scripts/connect.mjs" --provider claude --action connect`
- Not now: `--action not-now`
- Don’t ask again: `--action dont-ask`

The popout URL includes `?provider=claude`. Official “Sign in with Claude” is not publicly available; the user finishes CodeFriends login in the browser (dev username locally, or Gemini/Google when that path is live).
