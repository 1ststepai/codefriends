---
description: Connect CodeFriends (opt-in popout, not Claude account login)
---

Run this command with the Bash tool. Do not invent a Claude or Cursor SSO flow.

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/connect.mjs" --provider claude --action connect
```

Then tell the user the CodeFriends popout opened with `?provider=claude` so they can finish **CodeFriends** login in the browser. This plugin cannot sign them into Claude.
