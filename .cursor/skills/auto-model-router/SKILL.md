---
name: auto-model-router
description: "Before choosing a model or effort, classify the lightest sufficient tier (fast, standard, reasoning, max) and execution mode (local or cloud). Suggest one line. Auto-continue only clear reversible fast. Confirm spendy or high-risk. Mode is advisory — do not launch a cloud agent."
---

# Auto model router (project pointer)

Follow the canonical skill:
https://raw.githubusercontent.com/1ststepai/auto-model-router/main/skills/auto-model-router/SKILL.md

Before substantial work:

1. Classify tier: `fast` / `standard` / `reasoning` / `max`.
2. Classify mode: `local` / `cloud`.
3. Suggest: `Auto suggests <tier> / <mode> — <reason>. Confirm to run, or override: fast, standard, reasoning, or max.`
4. Auto-continue only clear reversible `fast`. Wait on spendy tiers and high-risk work.
5. Do not launch Cursor Cloud Agents or Codex because mode is `cloud`.
