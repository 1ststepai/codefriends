# CodeFriends (Gemini CLI)

This extension offers an **opt-in** “Connect CodeFriends?” prompt when a Gemini CLI session starts.

- **Connect** opens the CodeFriends popout with `?provider=gemini`.
- CodeFriends identity is **Continue with Google** in that popout (server needs `GEMINI_GOOGLE_*` env). That is separate from Gemini CLI’s own auth. The API provider id is still `gemini`.
- **Not now** / **Don’t ask again** are stored under `~/.codefriends/connect-state.json` for the `gemini` host only.

Commands: `/codefriends` (connect). Or run `node ${extensionPath}/scripts/connect.mjs --provider gemini --action not-now|dont-ask`.
