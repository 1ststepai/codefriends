/** Official 1stStep shelf URL for the portable help-packet template. */
export const HELP_PACKET_LIBRARY_URL =
  "https://github.com/1ststepai/codefriends/blob/main/docs/help-packet.md";

export const HELP_PACKET_TITLE_MAX = 120;
export const HELP_PACKET_FIELD_MAX = 2000;
export const HELP_PACKET_MARKDOWN_MAX = 16_000;
export const HELP_PACKET_LIST_LIMIT = 40;

/** Headings the generated packet always includes (smoke + UI preview). */
export const HELP_PACKET_SECTION_HEADINGS = [
  "## 1. Goal",
  "## 2. Context",
  "## 3. Constraints",
  "## 4. What's blocked / tried",
  "## 5. Success criteria",
  "## 6. How to send back",
] as const;

export interface HelpPacketFields {
  title: string;
  goal: string;
  repoUrl?: string;
  branch?: string;
  paths?: string;
  constraints?: string;
  blocked?: string;
  successCriteria?: string;
  sendBack?: string;
  libraryItemUrl?: string;
}

/** Saved draft. Own-user only — a file to copy, not a public post. */
export interface HelpPacket {
  id: string;
  userId: string;
  title: string;
  markdown: string;
  createdAt: number;
}

export function helpPacketFilename(title: string): string {
  const slug = title
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return `${slug || "help-packet"}.md`;
}

function line(label: string, value: string | undefined): string {
  const v = (value ?? "").trim();
  return v ? `- ${label}: ${v}` : "";
}

function body(text: string | undefined): string {
  const v = (text ?? "").trim();
  return v || "_(not filled)_";
}

/** Portable markdown a friend can paste into their own Cursor/Claude/etc. chat. */
export function formatHelpPacket(fields: HelpPacketFields): string {
  const title = fields.title.trim() || "Untitled";
  const context = [
    line("Repo URL", fields.repoUrl),
    line("Branch", fields.branch),
    line("Relevant paths", fields.paths),
  ]
    .filter(Boolean)
    .join("\n");

  const library = (fields.libraryItemUrl ?? "").trim();

  return [
    `# Help packet: ${title}`,
    "",
    "This file is a **help packet**. The author is asking a friend to finish stuck work **on the friend's own AI usage** (Cursor, Claude, Codex, Gemini, or similar). Accepting is voluntary. Run agents on your own account — this packet does not use anyone else's vendor quota.",
    "",
    "Only the notes below are included. This is not a dump of chat history.",
    "",
    "When you are done, send back a PR (preferred) or a patch. Do not post this packet to socials unless the author asks you to.",
    "",
    "## 1. Goal",
    "",
    body(fields.goal),
    "",
    "## 2. Context",
    "",
    context || "_(not filled)_",
    "",
    "## 3. Constraints",
    "",
    body(fields.constraints),
    "",
    "## 4. What's blocked / tried",
    "",
    body(fields.blocked),
    "",
    "## 5. Success criteria",
    "",
    body(fields.successCriteria),
    "",
    "## 6. How to send back",
    "",
    body(fields.sendBack) === "_(not filled)_"
      ? "Open a pull request against the branch above (preferred). A patch file is fine if a PR is not practical."
      : body(fields.sendBack),
    "",
    "## 7. Optional: CodeFriends library item",
    "",
    library || "_(none)_",
    "",
  ].join("\n");
}
