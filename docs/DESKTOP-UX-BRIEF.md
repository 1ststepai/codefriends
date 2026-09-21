# CodeFriends Desktop — UX Brief (v1)

**Goal:** A dedicated desktop chat app that feels as clean as a modern assistant client (chat-first, calm, almost no chrome) — not Discord-in-a-browser, and not an in-IDE webview war.

**Audience:** People learning / building with AI coding tools who want friends in the room without leaving their flow for a heavy website.

**Product line (keep):** Presence · 1:1 DMs · invites · short profile · optional school board · build library.  
**Shell change:** Daily driver = **desktop app**. Website = signup / download / fallback only. IDE = thin badge / “Open CodeFriends” deep link only — **no chat inside Cursor/Claude/Codex**.

---

## Design principles

1. **Simple > featureful.** Every control earns its place. Prefer hide over clutter.
2. **Chat is the hero.** Friend list is a slim rail; the thread owns the window.
3. **Calm density.** Soft surfaces, generous padding, short type hierarchy. No neon “gamer Discord” default.
4. **Steam Friends energy.** Who’s around, what they’re on, tap → DM. Not channels-first.
5. **Honest & light.** No fake online counts. No scores. Soft 1stStep / starter-kit links, never a hire pitch.

---

## Visual direction (“nice but simple”)

| Token | Direction |
| --- | --- |
| Theme | Dark default + system light. One accent (soft blue-violet or teal — pick one, not rainbow). |
| Type | One UI font. Clear message body ~15–16px. Names slightly stronger; timestamps whisper. |
| Bubbles | Soft rounded; yours tinted with accent wash; theirs neutral surface. Not cartoon speech balloons. |
| Rail | ~240px. Avatars + name + one-line status. Unread = small pill, not a red scream. |
| Motion | 150–200ms ease on open/close. Presence dots breathe gently. No bounce spam. |
| Empty states | One illustration or quiet icon + one sentence + one primary action. |

**Sweet polish (high leverage, low complexity):**
- **Presence glow** — tiny status ring on avatar (online / away / in-tool).
- **Tool chip** — `Cursor` / `Claude` / `Codex` / `Gemini` as a quiet badge under the name.
- **“Now building”** — one-line under friend (already in product); truncate, never wrap into a novel.
- **Invite card** — beautiful share sheet (copy link + QR optional later); feels premium, not “paste this token.”
- **Handoff toast** — when opened from an IDE badge: “Signed in · you’re in CodeFriends” then fade.
- **Focus mode** — hide board/library until needed; chat-only layout toggle.

---

## Window & chrome

```
┌──────────────────────────────────────────────────────────┐
│ ● ● ●   CodeFriends          [ search friends ]   ⚙  — □ │
├────────────┬─────────────────────────────────────────────┤
│ Friends    │  Parker                          online · Cursor│
│ ─────────  │  building: starter kit for week one            │
│ ● Maya     │─────────────────────────────────────────────│
│ ○ Parker ◄ │                                              │
│ ● Sam      │   message thread                             │
│            │                                              │
│ ─────────  │─────────────────────────────────────────────│
│ Board      │  [ message…                              ] ↩ │
│ Library    │                                              │
│ Profile    │                                              │
└────────────┴─────────────────────────────────────────────┘
```

- **Traffic lights / native title bar** — feel like a real Mac/Windows app.
- **Tray / menu bar icon** — green/grey presence; click opens last DM or friends list; right-click: Online / Away / Quit.
- **Notifications** — OS native for DMs when unfocused; respect Focus / DND.
- **Single main window** in v1 (no multi-window maze). Popout-from-tray is the same window.

---

## Core screens (v1)

### 1. Friends (home)
- Sorted: online first, then recent DM, then A–Z.
- Row: avatar · name · tool chip · “now building” · unread.
- Primary actions: **Invite friend**, **New DM** (pick friend).

### 2. DM thread
- Header: name · presence · tool · profile chips (GitHub / site) as quiet links.
- Body: text only (matches current product). Soft timestamps on hover or every N messages.
- Composer: one field + send. Markdown light later; v1 plain text is fine if backend is plain.
- Empty thread: “Say hi — keep it short.”

### 3. Invite
- Full-width card: link, copy button, expiry note (“good for 7 days”).
- Success state after someone accepts: “You’re friends with X” → open DM.

### 4. Profile (yours)
- Same fields as today (GitHub paste, tools, socials, building, wants-to-help).  
- Layout like a clean settings card, not a form jungle. Save once.

### 5. Board & Library (secondary)
- Behind the rail, not competing with DMs.
- Board: topic list → topic detail. No upvote chrome in v1.
- Library: cards for 1stStep starters + cohort shares; open in browser / copy clone URL.

### 6. Sign-in
- Calm full-window gate. Show **what’s live** (e.g. Google/Gemini) and **what’s blocked** honestly (Cursor/Claude/Codex partner limits) — same truth as the README, prettier.
- Dev username only in non-prod builds.

---

## Features that make it “pretty sweet” without bloating

| Feature | Why it feels sweet | v1? |
| --- | --- | --- |
| Tray presence | Feels alive while you code | Yes |
| Tool chip + now building | Steam Friends “what game” vibe for AI tools | Yes |
| Beautiful invite card | Growth moment that looks intentional | Yes |
| Focus / chat-only layout | Power users + new users both happy | Yes |
| Soft “starter kit” / “repo next steps” cards in Library | Ties 1stStep free tools without marketing spam | Yes |
| Ambient presence sound (optional, off by default) | Tiny “friend online” chime | Maybe |
| Custom accent + wallpaper wash behind chat | Personal, still simple | Later |
| Voice / screenshare | Out of scope (already) | No |
| Servers / roles / @everyone | Discord trap — avoid | No |

---

## Explicit non-goals (v1 desktop)

- Chat webview inside Cursor / Claude / Codex / Gemini GUIs  
- Rebuilding the API (reuse Worker / local server)  
- Media/blob DMs, payments, Live Share, voice  
- Turning the Board into Reddit  

---

## Technical shell (recommendation, not a rewrite mandate)

- **Reuse** `apps/popout` UI as the starting surface where possible; wrap in a **desktop shell** (Tauri preferred for lighter feel, Electron acceptable for speed).
- Deep link: `codefriends://open?dm=…` / handoff from existing IDE badge.
- Auto-update channel for the desktop binary.
- Keep PWA/web as fallback for people who won’t install yet.

---

## Success criteria

A new user can: install → sign in → invite one friend → send a DM → see them “in Cursor” with a one-line status — and say the app feels **calm and modern**, not like a website in a trench coat.

---

## Next build slices (when you say go)

1. Desktop shell + tray + open existing popout  
2. Visual refresh pass (tokens, bubbles, rail, empty states)  
3. Invite card + notifications polish  
4. Library cards for starter kit + repo-next-steps  
5. Sign-in honesty UI  

*Brief owner: 1stStep / CodeFriends · drafted for Evan · Sep 2026*
