/**
 * Documents Connect CodeFriends? prompt paths:
 * first run, Not now (cooldown), Don't ask again, already connected,
 * and popout URLs for each host.
 */
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import {
  applyConnectChoice,
  buildPopoutUrl,
  CONNECT_SNOOZE_MS,
  decideConnectPrompt,
  emptyConnectHostState,
  hookPayload,
  hostState,
  loadState,
  parseArgs,
  popoutClientFor,
  resolveIdeProvider,
  run,
} from "./connect.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "../..");

test("first run → prompt", () => {
  assert.equal(decideConnectPrompt(emptyConnectHostState(), 1_000), "prompt");
});

test("already connected → do not nag", () => {
  assert.equal(
    decideConnectPrompt({ ...emptyConnectHostState(), sessionToken: "tok_abc" }, 1_000),
    "skip-connected",
  );
});

test("Don't ask again persists", () => {
  const next = applyConnectChoice(emptyConnectHostState(), "dont-ask", 1_000);
  assert.equal(next.dontAskAgain, true);
  assert.equal(decideConnectPrompt(next, 1_000 + CONNECT_SNOOZE_MS * 10), "skip-dont-ask");
});

test("Not now snoozes until cooldown elapses", () => {
  const now = 1_700_000_000_000;
  const next = applyConnectChoice(emptyConnectHostState(), "not-now", now);
  assert.equal(decideConnectPrompt(next, now + 60_000), "skip-snoozed");
  assert.equal(decideConnectPrompt(next, now + CONNECT_SNOOZE_MS + 1), "prompt");
});

test("Connect also snoozes so we do not re-ask the same window streak", () => {
  const now = 5_000;
  const next = applyConnectChoice(emptyConnectHostState(), "connect", now);
  assert.equal(decideConnectPrompt(next, now + 1), "skip-snoozed");
});

test("popout URLs keep ?provider= for each host", () => {
  const base = "http://127.0.0.1:5173";
  assert.equal(
    buildPopoutUrl({ popoutUrl: base, provider: "cursor", handoff: "abc" }),
    "http://127.0.0.1:5173/?provider=cursor&client=cursor&handoff=abc",
  );
  assert.equal(buildPopoutUrl({ popoutUrl: base, provider: "claude" }), "http://127.0.0.1:5173/?provider=claude&client=claude");
  assert.equal(buildPopoutUrl({ popoutUrl: base, provider: "codex" }), "http://127.0.0.1:5173/?provider=codex&client=codex");
  assert.equal(buildPopoutUrl({ popoutUrl: base, provider: "gemini" }), "http://127.0.0.1:5173/?provider=gemini&client=gemini");
  assert.equal(buildPopoutUrl({ popoutUrl: base, provider: "generic" }), "http://127.0.0.1:5173/?provider=generic&client=web");
  assert.equal(popoutClientFor("dev"), "web");
});

test("VS Code host detect: Cursor vs generic (VSCodium / vanilla)", () => {
  assert.equal(resolveIdeProvider("Cursor", "auto"), "cursor");
  assert.equal(resolveIdeProvider("VSCodium", "auto"), "generic");
  assert.equal(resolveIdeProvider("Visual Studio Code", "auto"), "generic");
  assert.equal(resolveIdeProvider("Cursor", "generic"), "generic");
});

test("CLI first run / dismiss / never / connected against a temp state file", async () => {
  const dir = mkdtempSync(join(tmpdir(), "cf-connect-"));
  const stateFile = join(dir, "state.json");
  const now = "1000000";
  const quiet = {
    stdin: process.stdin,
    stdout: { write() {} },
    stderr: { write() {} },
  };
  const common = ["--provider", "claude", "--state-file", stateFile, "--now", now, "--json"];

  try {
    const first = await run([...common], quiet);
    assert.equal(first.decision, "prompt");

    const snooze = await run([...common, "--action", "not-now"], quiet);
    assert.equal(snooze.choice, "not-now");
    assert.equal(hostState(loadState(stateFile), "claude").snoozeUntil, Number(now) + CONNECT_SNOOZE_MS);
    const still = await run([...common], quiet);
    assert.equal(still.decision, "skip-snoozed");

    const later = await run(
      ["--provider", "claude", "--state-file", stateFile, "--now", String(Number(now) + CONNECT_SNOOZE_MS + 5), "--json"],
      quiet,
    );
    assert.equal(later.decision, "prompt");

    await run([...common, "--action", "dont-ask"], quiet);
    const never = await run(
      ["--provider", "claude", "--state-file", stateFile, "--now", String(Number(now) + CONNECT_SNOOZE_MS * 8), "--json"],
      quiet,
    );
    assert.equal(never.decision, "skip-dont-ask");

    const otherHost = await run(["--provider", "codex", "--state-file", stateFile, "--now", now, "--json"], quiet);
    assert.equal(otherHost.decision, "prompt", "Don't ask again is per-host");

    const connected = await run(
      ["--provider", "gemini", "--state-file", stateFile, "--session-token", "tok", "--json"],
      quiet,
    );
    assert.equal(connected.decision, "skip-connected");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("Connect action prints a provider-tagged popout URL", async () => {
  const dir = mkdtempSync(join(tmpdir(), "cf-connect-"));
  const stateFile = join(dir, "state.json");
  try {
    const result = await run(
      [
        "--provider",
        "cursor",
        "--action",
        "connect",
        "--state-file",
        stateFile,
        "--popout-url",
        "http://127.0.0.1:5173",
        "--json",
        "--dry-run",
      ],
      { stdin: process.stdin, stdout: { write() {} }, stderr: { write() {} } },
    );
    assert.match(result.url, /provider=cursor/);
    assert.match(result.url, /client=cursor/);
    assert.doesNotMatch(result.url, /Sign in with Cursor/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("SessionStart hook payload is opt-in copy, not host SSO", () => {
  const silent = hookPayload("claude", "skip-dont-ask", "claude");
  assert.deepEqual(silent, {});
  const claude = hookPayload("claude", "prompt", "claude");
  assert.match(claude.systemMessage, /Connect CodeFriends/);
  assert.match(claude.systemMessage, /not Claude Code account login/);
  assert.equal(claude.hookSpecificOutput.hookEventName, "SessionStart");
  const gemini = hookPayload("gemini", "prompt", "gemini");
  assert.match(gemini.systemMessage, /Connect CodeFriends/);
  const generic = hookPayload("generic", "prompt", "generic");
  assert.match(generic.systemMessage, /not this editor account login/);
});

test("parseArgs maps --provider dev to generic (no fake Ollama SSO)", () => {
  const args = parseArgs(["--provider", "dev"]);
  assert.equal(args.provider, "generic");
});

test("vendored plugin scripts stay identical to the canonical client", () => {
  const canonical = readFileSync(join(here, "connect.mjs"), "utf8");
  for (const rel of ["plugins/claude/scripts/connect.mjs", "plugins/codex/scripts/connect.mjs", "plugins/gemini/scripts/connect.mjs"]) {
    const copy = readFileSync(join(repoRoot, rel), "utf8");
    assert.equal(copy, canonical, `${rel} must match packages/connect-client/connect.mjs`);
  }
});

test("host plugin manifests exist and stay honest about SSO", () => {
  const claude = JSON.parse(readFileSync(join(repoRoot, "plugins/claude/.claude-plugin/plugin.json"), "utf8"));
  assert.equal(claude.name, "codefriends");
  assert.match(claude.description, /not Claude account login/);

  const hooks = JSON.parse(readFileSync(join(repoRoot, "plugins/claude/hooks/hooks.json"), "utf8"));
  assert.match(hooks.hooks.SessionStart[0].hooks[0].command, /provider claude/);

  const codex = JSON.parse(readFileSync(join(repoRoot, "plugins/codex/.codex-plugin/plugin.json"), "utf8"));
  assert.match(codex.description, /not ChatGPT\/Codex account login/);

  const gemini = JSON.parse(readFileSync(join(repoRoot, "plugins/gemini/gemini-extension.json"), "utf8"));
  assert.match(gemini.description, /not Gemini CLI login/);
});
