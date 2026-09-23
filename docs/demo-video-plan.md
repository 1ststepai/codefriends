# Demo video plan — two tools, one room

About **30 seconds**. Two people send a live 1:1 DM through CodeFriends while one is in **Cursor** and the other is in **Claude Code**. The chat UI is the popout, not a panel inside either IDE. The last frame is an invite link.

Checked against the README and the live host on **21 Sep 2026**:

| Check | What is true right now |
| --- | --- |
| Live app | [https://codefriends.1ststep.ai](https://codefriends.1ststep.ai) — Express serving the popout, `store: sqlite` (`GET /health`) |
| Cursor / Claude / Codex identity | **Blocked.** `GET /api/auth/providers` returns `blocked` and “no public OAuth.” Do not show “Sign in with Cursor” or “Sign in with Claude” as if they work. |
| Gemini / Google | **Unconfigured** on this host (no `GEMINI_GOOGLE_*`). |
| Mock provider linking | **Off** (`mockProviders: false`). Do not film a linked Cursor+Claude identity. |
| Login that actually works | **Dev username.** `POST /api/auth/login` with `{ "username" }` — no password. The login screen still says this form is “not used in production.” It is on for this host (`CODEFRIENDS_DEV_LOGIN`). Sign in **off camera**. |
| Where the message appears | Popout (or the desktop window if it is loading this same origin). The Cursor extension is a status-bar badge only. The Claude plugin opens the popout; it does not drop the DM into Claude’s prompt. |

The cross-tool beat is real: each popout is opened with `?provider=cursor` or `?provider=claude`, so the other person’s row shows a **Cursor** or **Claude** badge plus the free-text “Now working on” line. The message itself is a normal DM over the existing WebSocket.

---

## 1. Concept

One screen recording, no B-roll, no product tour.

- Left life: Cursor, status bar `CodeFriends · N online`, CodeFriends window beside the editor.
- Right life: Claude Code, CodeFriends window beside the terminal.
- They are already friends. One short message each way, live.
- End on the invite URL, full frame, readable for a few seconds.

Do not show the school board, library, help packet, or profile form. Do not show seed users `maya` or `parker` — those names are shared on this host.

---

## 2. Script

Silent by default. Burn captions in; do not rely on anyone hearing the keys. **At most one spoken line**, and only over the end card (see shot 6). If you skip it, the video is still complete.

People: **A** (Cursor) and **B** (Claude Code). Usernames are whatever you created in prep — not the seed roster (`maya`, `devjay`, `sam`, `rio`, `alex`, `casey`, `taylor`, `jordan`, `parker`).

Before you hit record, both popouts are already open, signed in, on the DM thread, and the connect nag has already been dismissed. The 30 seconds start in the work, not on a login form.

| Time | Who | On screen | What they do |
| --- | --- | --- | --- |
| 0:00–0:03 | Both | Hard split. Left: Cursor editor, status bar reading `CodeFriends · N online` (the `$(check)` mark is fine). Right: Claude Code session, idle, not generating. | Nobody types. Caption: **Two tools. One room.** |
| 0:03–0:07 | Both | Cut to the two CodeFriends windows only (drop the IDE chrome for this beat). A’s friends row on B’s screen shows the **Cursor** badge. B’s row on A’s screen shows the **Claude** badge. Under the name, the status line set in prep (`pairing` is enough). | Nobody types. Caption: **Chat stays in CodeFriends.** |
| 0:07–0:14 | A | A’s CodeFriends window, DM with B open. Composer is the popout field, not Cursor chat. | A types `you seeing this from claude?` and sends. Hold on the bubble so it is readable. |
| 0:14–0:21 | B | Cut to B on the send. Claude Code stays visible in the background so it is obvious the reply is not Claude’s answer. The incoming bubble is already in the popout (it should land in well under a second; if it doesn’t, retake — do not fake it with a paste). | B types `yeah. same thread.` and sends. |
| 0:21–0:26 | A | Cut back to A. B’s reply is already in the thread. Then A clicks **Create invite link**. The read-only URL field fills (`https://codefriends.1ststep.ai?invite=…`). | Do not also open Cursor chat. Caption: **Invite link. 7 days.** |
| 0:26–0:30 | — | Full-frame end card. Same URL, large, on the dark popout background or a still of that field. Under it: `codefriends.1ststep.ai`. Small line: `Not affiliated with Cursor or Anthropic.` | Optional spoken line, once: **“Friends in the room. The chat stays out of the IDE.”** If you use a voice, do not add a second line. |

That is the whole film. The landing moment is shot 4: B’s popout already shows A’s text while Claude Code is still just a terminal.

### What not to say or show

- Do not say they signed in with their Cursor or Claude accounts. They didn’t. Identity OAuth for both is blocked.
- Do not imply the DM arrived inside Cursor’s agent chat or Claude’s reply. It arrived in the CodeFriends window.
- Do not film the username form. Its own copy says it is a local demo and “not used in production,” which will fight the end card.
- Text only. No images, voice notes, or typing indicators as the hero (a typing flicker is fine if it happens; don’t wait on it).

---

## 3. Tools and setup

Do this once, then rehearse the table above twice before a take.

### Record

- **OBS Studio** (or any screen recorder that can do a clean window or display capture). Record each machine separately at 1080p, 30fps, then cut. A single-machine split only works if Cursor and Claude Code plus two popout windows all fit without overlap — two displays is the reliable version.
- System audio off. Mic off unless you record the one end-card line as a separate take.
- Crop to the windows. No desktop notifications, no other DMs, no seed traffic in the thread. Use a fresh pair of users so the thread starts empty.

### Accounts (live host)

1. On [https://codefriends.1ststep.ai](https://codefriends.1ststep.ai), sign in as a **new** username (first login creates the user). Repeat in a second browser profile for the other person.
2. On A: **Create invite link**. On B: open that URL (or paste it and **Accept**). Friends immediately, no request. You cannot accept your own link. Already-friends does nothing — if the row is missing, the accept did not happen.
3. Each person sets **Now working on** to a short line (`pairing` or `in cursor` / `in claude`). 80 characters max.
4. Open A’s popout with `?provider=cursor` and B’s with `?provider=claude` so the badge is the tool, not `web`. The extension and the Claude plugin do this when they open the window. A bare tab will show the wrong badge.
5. Leave both on the DM. Create a **second** invite at the end of prep and do not use it until the last shot — or click **Create invite link** live in shot 5. Tokens last **7 days** and are reusable. Make the one you publish during the session you post, not days earlier.

Dev login on this public URL is a demo, not an account system. Anyone who can reach the host can sign in as any username, including yours. Use names you don’t mind being public. Don’t type anything private in the DM; the thread is stored (last 200 messages).

### Cursor

- Extension from `extensions/cursor` (Install from Location after `npm run compile -w codefriends`).
- Settings, pointed at the live origin — the defaults are localhost and will not hit this host:

  - `codefriends.popoutUrl` = `https://codefriends.1ststep.ai`
  - `codefriends.serverUrl` = `https://codefriends.1ststep.ai`

- Command **CodeFriends: Sign in with username (dev)** once, so the badge is `$(check) CodeFriends · N online` and the startup **Connect CodeFriends?** prompt does not fire on camera.
- Clicking the badge opens the popout. That is the only Cursor UI in the video.

### Claude Code

- Plugin from `plugins/claude` (`claude plugin marketplace add` this repo, or `--plugin-dir plugins/claude`). This is Claude Code, not claude.ai in the browser.
- Popout URL for the plugin: `https://codefriends.1ststep.ai` (`CODEFRIENDS_POPOUT_URL` / the connect client). `/codefriends` opens `?provider=claude`.
- Run `/codefriends` once before the take so SessionStart is not the first thing on screen. Sign in as B in that window.
- There is no Claude account OAuth to complete. If a button says **Continue with Claude** and looks disabled, leave it out of frame. The state label is “blocked — no public OAuth.”

### Popout vs desktop

Use the **live popout** in its own window (or Chrome/Edge **Install app**). That is the UI viewers will get from the invite link.

The Tauri app (`npm run desktop`) wraps a local popout by default. Use it in the video only if that window is actually loading `https://codefriends.1ststep.ai`. A local `npm run dev` window is the wrong host.

---

## 4. Distribution

Post the file, not a link-in-bio. The invite URL in the caption must match the URL on the last frame.

### Where

| Place | How to post | Don’t |
| --- | --- | --- |
| **X** | Native video upload. URL in the post text as well as on screen. | Don’t thread a feature list under it. One post. |
| **Cursor Community Discord** | Public server, join from [discord.com/invite/cursor](https://discord.com/invite/cursor). Post only in a channel whose rules allow project shares (often a showcase / feedback channel — read the pins that day). | Don’t drop it in support or announcements. |
| **Claude Discord** | Public server linked from [claude.com/community](https://claude.com/community) (“Claude Discord”). Same rule: a share / showcase channel only. | Don’t use a guessed invite, and don’t post in a private or staff channel. |
| **Anthropic Discord** | The server Anthropic staff have pointed at in public (`discord.com/invite/anthropic`, and the invite they posted via r/ClaudeAI). Join is sometimes locked after raids — if the invite fails, skip it. | Don’t treat r/ClaudeAI as the same place; that subreddit is not Anthropic. |

Those are public communities. This plan does not include private servers, DMs to strangers, or invite codes that are not on those pages.

Skip Codex and Gemini communities for this cut. The picture is Cursor + Claude Code only, and Gemini login is not configured on the live host anyway.

### Hashtags

On X only, three is enough: `#Cursor` `#Claude` `#buildinpublic`

Don’t add `#Discord` or a pile of tool tags. Discord posts get no hashtags.

### Caption

```
Two people, one DM, live.

Left is Cursor. Right is Claude Code.
The message shows up in CodeFriends — not inside either IDE.

Invite (7 days): https://codefriends.1ststep.ai?invite=PASTE
```

Swap in the real token. Keep the “not inside either IDE” line so the clip doesn’t over-claim. You can add “Not affiliated with Cursor or Anthropic.” as a second line if the end card is hard to read on a phone.

---

## 5. Timeline

One sitting if both machines already have the extension and the plugin. Times are work, not calendar padding.

| Step | If the tools are already installed | If this is the first install |
| --- | --- | --- |
| Accounts, invite accept, badges, status text, point both clients at the live URL | 20 min | 60–90 min (compile/install the Cursor extension, add the Claude plugin, fix localhost settings) |
| Two dry runs of the shot list | 15 min | 15 min |
| Record 3 takes per machine | 20 min | 20 min |
| Edit: sync the landing cut, captions, end card, export 1080p | 45 min | 45 min |
| Post X + the Discords you can actually post in that day | 15 min | 15 min |

**About 2 hours** when setup is done. **About 3 to 3.5 hours** if you are installing the extension and plugin in the same sitting. A missed landing (message not visible before the cut) means another take, not a longer edit.

---

## 6. Success metric (first 48 hours)

**Shares and signups that came from the invite link on screen.** Count them like this — there is no analytics product in the repo (no Plausible, PostHog, or share pixel), and the API does not return a signup or click total.

### Shares

- **X:** reposts + quote posts on that post, from X’s own counts. Likes are not shares.
- **Discord:** no share count. Don’t invent one. A reply that says someone joined is a note, not a metric.

### Signups from the link

There is no per-invite accept log. Accepting writes a **friend row** (`friends.created_at`) and, if the username is new, a **user row** (`users.created_at`). `GET /api/presence` only shows who is online now. It is not a signup counter.

If you can read the host SQLite file (`CODEFRIENDS_DB` on the machine that serves the site):

```sql
-- New usernames in the window. Not unique humans: dev login has no email and no password.
SELECT username, display_name, created_at
FROM users
WHERE created_at >= :posted_at_ms AND created_at < :posted_at_ms + 48*60*60*1000;

-- People who became friends with the account that owned the link.
-- This is the closest stand-in for “accepted the invite.”
-- It also counts Add friend by username, and a repeat accept does not insert a row.
SELECT u.username, f.created_at
FROM friends f
JOIN users u ON u.id = f.friend_id
WHERE f.user_id = :inviter_user_id
  AND f.created_at >= :posted_at_ms
  AND f.created_at < :posted_at_ms + 48*60*60*1000;
```

`:posted_at_ms` is when you publish, in Unix milliseconds. Snapshot both queries **before** you post so seed users and anyone already on the friends list are not in the delta.

If you cannot read the database, the honest public count is: **how many new names appear on that inviter’s friends list** 48 hours later, minus the list you screenshotted at post time. Say that number is “new friends on the poster account,” not “verified signups.” People can sign in as an existing username, add a friend without the link, or accept and already be friends (that accept does not show up).

### Target

No baseline exists yet, so don’t invent a rate. Write down the two numbers after 48 hours:

1. X reposts + quote posts.
2. New friend rows on the poster (SQL if you have the file, otherwise the friends-list delta).

That pair is the result. A repost with no new friend, or a new friend with no repost, both count — report them separately.
