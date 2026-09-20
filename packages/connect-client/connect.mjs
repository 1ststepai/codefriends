#!/usr/bin/env node
/**
 * Thin CodeFriends companion for CLI hosts and generic/local editors.
 * Opens the popout so the user can finish CodeFriends login there.
 * Does not implement Cursor / Claude / Codex / Ollama SSO.
 */
import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline/promises";
import { stdin as stdinStream, stdout as stdoutStream } from "node:process";

export const CONNECT_HOSTS = ["cursor", "claude", "codex", "gemini", "generic"];
export const CONNECT_SNOOZE_MS = 3 * 24 * 60 * 60 * 1000;

export function emptyConnectHostState() {
  return { dontAskAgain: false, snoozeUntil: 0, sessionToken: "" };
}

export function decideConnectPrompt(state, now = Date.now()) {
  if (state.sessionToken) return "skip-connected";
  if (state.dontAskAgain) return "skip-dont-ask";
  if ((state.snoozeUntil ?? 0) > now) return "skip-snoozed";
  return "prompt";
}

export function applyConnectChoice(state, choice, now = Date.now(), snoozeMs = CONNECT_SNOOZE_MS) {
  if (choice === "dont-ask") return { ...state, dontAskAgain: true };
  if (choice === "not-now" || choice === "connect") {
    return { ...state, snoozeUntil: now + snoozeMs };
  }
  return state;
}

export function resolveIdeProvider(appName, setting = "auto") {
  const normalized = String(setting ?? "auto")
    .trim()
    .toLowerCase();
  if (CONNECT_HOSTS.includes(normalized)) return normalized;
  if (/cursor/i.test(appName ?? "")) return "cursor";
  return "generic";
}

export function popoutClientFor(provider) {
  if (provider === "generic" || provider === "dev") return "web";
  return provider;
}

export function buildPopoutUrl(opts) {
  const url = new URL(String(opts.popoutUrl).replace(/\/$/, ""));
  url.searchParams.set("provider", opts.provider);
  url.searchParams.set("client", opts.client ?? popoutClientFor(opts.provider));
  if (opts.handoff) url.searchParams.set("handoff", opts.handoff);
  return url.toString();
}

export function hostLabel(host) {
  switch (host) {
    case "cursor":
      return "Cursor";
    case "claude":
      return "Claude Code";
    case "codex":
      return "Codex";
    case "gemini":
      return "Gemini";
    default:
      return "this editor";
  }
}

export function defaultStatePath() {
  return process.env.CODEFRIENDS_STATE_FILE || join(process.env.CODEFRIENDS_HOME || homedir(), ".codefriends", "connect-state.json");
}

export function loadState(file = defaultStatePath()) {
  try {
    const raw = JSON.parse(readFileSync(file, "utf8"));
    const hosts = raw?.hosts && typeof raw.hosts === "object" ? raw.hosts : {};
    return { version: 1, hosts };
  } catch {
    return { version: 1, hosts: {} };
  }
}

export function hostState(store, host) {
  const row = store.hosts[host];
  return {
    ...emptyConnectHostState(),
    ...(row && typeof row === "object" ? row : {}),
    sessionToken: typeof row?.sessionToken === "string" ? row.sessionToken : "",
    dontAskAgain: Boolean(row?.dontAskAgain),
    snoozeUntil: Number(row?.snoozeUntil) || 0,
  };
}

export function saveHostState(file, host, next) {
  const store = loadState(file);
  store.hosts[host] = next;
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(store, null, 2)}\n`);
  return store;
}

export function connectPromptText(host) {
  const label = hostLabel(host);
  return [
    "Connect CodeFriends?",
    `Opt-in to the CodeFriends popout (friends + DMs) alongside ${label}.`,
    `This is not ${label} account login — CodeFriends cannot inject into that host’s native sign-in screen.`,
  ].join(" ");
}

export function hookPayload(host, decision, provider) {
  if (decision !== "prompt") return {};
  const text = `${connectPromptText(host)} Actions: \`node scripts/connect.mjs --provider ${provider} --action connect\` · \`--action not-now\` · \`--action dont-ask\`.`;
  if (host === "claude") {
    return {
      systemMessage: text,
      hookSpecificOutput: {
        hookEventName: "SessionStart",
        additionalContext: text,
      },
    };
  }
  if (host === "gemini") {
    return {
      systemMessage: text,
      hookSpecificOutput: { additionalContext: text },
    };
  }
  return { systemMessage: text };
}

export function parseArgs(argv) {
  const out = {
    provider: "generic",
    action: "",
    hook: "",
    prompt: false,
    json: false,
    printUrl: false,
    dryRun: false,
    popoutUrl: process.env.CODEFRIENDS_POPOUT_URL || "http://127.0.0.1:5173",
    serverUrl: process.env.CODEFRIENDS_SERVER_URL || "http://127.0.0.1:8787",
    stateFile: defaultStatePath(),
    now: Date.now(),
    sessionToken: "",
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === "--provider" && next) {
      out.provider = next;
      i++;
    } else if (arg === "--action" && next) {
      out.action = next;
      i++;
    } else if (arg === "--hook" && next) {
      out.hook = next;
      i++;
    } else if (arg === "--popout-url" && next) {
      out.popoutUrl = next;
      i++;
    } else if (arg === "--server-url" && next) {
      out.serverUrl = next;
      i++;
    } else if (arg === "--state-file" && next) {
      out.stateFile = next;
      i++;
    } else if (arg === "--now" && next) {
      out.now = Number(next);
      i++;
    } else if (arg === "--session-token" && next) {
      out.sessionToken = next;
      i++;
    } else if (arg === "--prompt") {
      out.prompt = true;
    } else if (arg === "--json") {
      out.json = true;
    } else if (arg === "--print-url") {
      out.printUrl = true;
    } else if (arg === "--dry-run") {
      out.dryRun = true;
    } else if (arg === "--help" || arg === "-h") {
      out.action = "help";
    }
  }
  if (!CONNECT_HOSTS.includes(out.provider) && out.provider !== "dev") {
    out.provider = "generic";
  }
  if (out.provider === "dev") out.provider = "generic";
  if (out.hook && !out.hook.length) out.hook = out.provider;
  return out;
}

export async function mintHandoff(serverUrl, token) {
  if (!token) return "";
  try {
    const res = await fetch(`${serverUrl.replace(/\/$/, "")}/api/auth/handoff`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}` },
    });
    const data = await res.json();
    return res.ok && data.code ? String(data.code) : "";
  } catch {
    return "";
  }
}

export function openExternal(url) {
  const plat = process.platform;
  const cmd = plat === "darwin" ? "open" : plat === "win32" ? "cmd" : "xdg-open";
  const args = plat === "win32" ? ["/c", "start", "", url] : [url];
  const child = spawn(cmd, args, { detached: true, stdio: "ignore" });
  child.unref();
}

function helpText() {
  return `codefriends-connect — open the CodeFriends popout (opt-in, not host SSO)

Usage:
  node connect.mjs --provider <cursor|claude|codex|gemini|generic> [--action connect|not-now|dont-ask]
  node connect.mjs --provider claude --hook claude
  node connect.mjs --provider generic --prompt

Environment:
  CODEFRIENDS_POPOUT_URL   default http://127.0.0.1:5173
  CODEFRIENDS_SERVER_URL   default http://127.0.0.1:8787
  CODEFRIENDS_STATE_FILE   override ~/.codefriends/connect-state.json
`;
}

export async function run(argv = process.argv.slice(2), io = { stdin: stdinStream, stdout: stdoutStream, stderr: process.stderr }) {
  const args = parseArgs(argv);
  if (args.action === "help") {
    io.stdout.write(helpText());
    return { ok: true, decision: "help" };
  }

  const store = loadState(args.stateFile);
  const current = hostState(store, args.provider);
  if (args.sessionToken) current.sessionToken = args.sessionToken;
  const decision = decideConnectPrompt(current, args.now);

  const result = {
    ok: true,
    host: args.provider,
    decision,
    url: "",
    choice: args.action || "",
  };

  const finish = (extra = {}) => {
    Object.assign(result, extra);
    if (args.json) io.stdout.write(`${JSON.stringify(result)}\n`);
    return result;
  };

  if (args.hook) {
    const payload = hookPayload(args.hook, decision, args.provider);
    io.stdout.write(`${JSON.stringify(payload)}\n`);
    return finish({ hook: payload });
  }

  if (args.action === "reset") {
    saveHostState(args.stateFile, args.provider, emptyConnectHostState());
    return finish({ decision: "prompt", choice: "reset" });
  }

  if (args.action === "connect" || args.action === "not-now" || args.action === "dont-ask") {
    const next = applyConnectChoice(current, args.action, args.now);
    if (!args.dryRun) saveHostState(args.stateFile, args.provider, next);
    if (args.action === "connect") {
      const handoff = await mintHandoff(args.serverUrl, next.sessionToken || current.sessionToken);
      const url = buildPopoutUrl({
        popoutUrl: args.popoutUrl,
        provider: args.provider,
        handoff,
      });
      result.url = url;
      if (args.printUrl || args.json) {
        /* printed in finish */
      } else {
        io.stderr.write(`Opening ${url}\n`);
      }
      if (!args.dryRun) openExternal(url);
    }
    return finish();
  }

  if (args.printUrl) {
    const url = buildPopoutUrl({ popoutUrl: args.popoutUrl, provider: args.provider });
    io.stdout.write(`${url}\n`);
    return finish({ url });
  }

  if (args.prompt && decision === "prompt") {
    const choice = await promptChoice(args.provider, io);
    if (!choice) return finish();
    return run(
      [
        "--provider",
        args.provider,
        "--action",
        choice,
        "--state-file",
        args.stateFile,
        "--popout-url",
        args.popoutUrl,
        "--server-url",
        args.serverUrl,
        "--now",
        String(args.now),
        ...(args.dryRun ? ["--dry-run"] : []),
        ...(args.json ? ["--json"] : []),
      ],
      io,
    );
  }

  if (args.prompt && decision !== "prompt") {
    if (!args.json) io.stderr.write(`Skipping connect prompt (${decision}).\n`);
    return finish();
  }

  if (!args.json && !args.hook) {
    io.stderr.write(helpText());
  }
  return finish();
}

async function promptChoice(host, io) {
  if (!io.stdin.isTTY || !io.stdout.isTTY) {
    io.stderr.write(`${connectPromptText(host)}\n  [c] Connect  [n] Not now  [d] Don't ask again\n(non-interactive; pass --action)\n`);
    return "";
  }
  const rl = createInterface({ input: io.stdin, output: io.stdout });
  try {
    io.stdout.write(`${connectPromptText(host)}\n  [c] Connect\n  [n] Not now\n  [d] Don't ask again\n`);
    const answer = (await rl.question("> ")).trim().toLowerCase();
    if (answer === "c" || answer === "connect") return "connect";
    if (answer === "n" || answer === "not now" || answer === "not-now") return "not-now";
    if (answer === "d" || answer === "don't ask again" || answer === "dont-ask" || answer === "never") {
      return "dont-ask";
    }
    return "";
  } finally {
    rl.close();
  }
}

const invokedDirectly = import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("connect.mjs");

if (invokedDirectly && !process.env.CODEFRIENDS_CONNECT_NO_MAIN) {
  run().catch((err) => {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  });
}
