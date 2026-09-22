# Path 01: Ship a friend-visible demo

**Goal:** Something another signed-in friend can see — presence online, and one 1:1 DM delivered — without building Discord.

**Help packet:** [path-01-friend-visible-demo.md](../help-packets/path-01-friend-visible-demo.md)

## Why this path

A demo nobody else can open is a private sketch. CodeFriends starts with friends in the room: you go online, they go online, one message lands.

## Constraints

- Text only. No voice, Live Share, or media blobs.
- Use the existing popout / API surface when working on this repo; if you are building elsewhere, keep the same bar: presence + one DM.
- Tool-agnostic — Cursor, Claude, Codex, Gemini, or other. Run agents on **your** account.
- Do not invent a second chat product. Prove the smallest friend-visible loop.

## Steps

1. **Two identities.** Sign in as yourself; have a friend (or a second test user) signed in on another client.
2. **Presence.** Confirm both appear online (status bar count and/or friends list). Optional: set a short “now working on” status.
3. **One DM.** Send a single 1:1 message. Confirm it arrives and, if the product claims history, that it survives a refresh.
4. **Share the proof.** Screenshot or note: who was online, what was sent, what the friend saw. No vanity metrics.

## Success criteria

- [ ] At least two users show as online at the same time.
- [ ] One DM is delivered to the intended friend (not a channel dump).
- [ ] You can explain in one sentence what “friend-visible” means for this product.
- [ ] Optional: invite link accepted so the friend edge exists without a pending queue.

## Send-back checklist (if a friend helps)

- PR or patch with the smallest change that fixed the stuck step.
- Note which clients were used (web / IDE badge / desktop).
- Do not scrape chat history into a help packet — only what you typed into the packet.
