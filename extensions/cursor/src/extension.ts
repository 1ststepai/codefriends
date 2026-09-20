import * as vscode from "vscode";
import {
  CONNECT_SNOOZE_MS,
  DONT_ASK_KEY,
  SNOOZE_KEY,
  buildPopoutUrl,
  connectPromptMessage,
  decideConnectPrompt,
  resolveIdeProvider,
  type ConnectHost,
} from "./connectPrompt";

const OPEN = "codefriends.openPopout";
const REFRESH = "codefriends.refreshPresence";
const DEV_SIGNIN = "codefriends.devSignIn";
const SIGNOUT = "codefriends.signOut";
const TOKEN_KEY = "codefriends.sessionToken";

export function activate(context: vscode.ExtensionContext): void {
  const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 80);
  item.command = OPEN;
  item.tooltip = "Open the CodeFriends popout (chat stays outside the IDE)";
  item.text = "CodeFriends · …";
  item.show();

  const open = vscode.commands.registerCommand(OPEN, () => openPopout(context));

  const refresh = vscode.commands.registerCommand(REFRESH, () => poll(item, context));

  const devSignIn = vscode.commands.registerCommand(DEV_SIGNIN, async () => {
    const username = await vscode.window.showInputBox({
      prompt: "Dev username (local demo only, no password)",
      value: "maya",
      ignoreFocusOut: true,
    });
    if (!username) return;
    const server = cfg("serverUrl", "http://127.0.0.1:8787").replace(/\/$/, "");
    try {
      const res = await fetch(`${server}/api/auth/login`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username, client: resolveProvider() }),
      });
      const data = (await res.json()) as { token?: string; error?: string };
      if (!res.ok || !data.token) {
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }
      await context.secrets.store(TOKEN_KEY, data.token);
      void vscode.window.showInformationMessage(`CodeFriends: signed in as ${username}. Opening popout.`);
      await vscode.commands.executeCommand(OPEN);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      void vscode.window.showErrorMessage(`CodeFriends sign-in failed: ${message}`);
    }
  });

  const signOut = vscode.commands.registerCommand(SIGNOUT, async () => {
    await context.secrets.delete(TOKEN_KEY);
    void vscode.window.showInformationMessage("CodeFriends session cleared from this editor.");
    void poll(item, context);
  });

  let timer: ReturnType<typeof setInterval> | undefined;
  const armTimer = () => {
    if (timer) clearInterval(timer);
    const ms = vscode.workspace.getConfiguration("codefriends").get<number>("pollMs", 15_000);
    timer = setInterval(() => void poll(item, context), Math.max(3000, ms));
  };

  const configWatch = vscode.workspace.onDidChangeConfiguration((e) => {
    if (e.affectsConfiguration("codefriends")) {
      armTimer();
      void poll(item, context);
    }
  });

  context.subscriptions.push(item, open, refresh, devSignIn, signOut, configWatch, {
    dispose: () => timer && clearInterval(timer),
  });

  armTimer();
  void poll(item, context);
  void maybeAskToConnect(context);
}

export function deactivate(): void {}

function cfg(key: string, fallback: string): string {
  return vscode.workspace.getConfiguration("codefriends").get<string>(key, fallback);
}

function resolveProvider(): ConnectHost {
  const setting = vscode.workspace.getConfiguration("codefriends").get<string>("provider", "auto");
  return resolveIdeProvider(vscode.env.appName ?? "", setting ?? "auto");
}

async function openPopout(context: vscode.ExtensionContext): Promise<void> {
  const popout = cfg("popoutUrl", "http://127.0.0.1:5173");
  const server = cfg("serverUrl", "http://127.0.0.1:8787").replace(/\/$/, "");
  const stored = (await context.secrets.get(TOKEN_KEY)) ?? "";
  const provider = resolveProvider();
  let handoff = "";
  if (stored) {
    try {
      const res = await fetch(`${server}/api/auth/handoff`, {
        method: "POST",
        headers: { authorization: `Bearer ${stored}` },
      });
      const data = (await res.json()) as { code?: string };
      if (res.ok && data.code) handoff = data.code;
    } catch {
      // Popout still opens; user can sign in there.
    }
  }
  const href = buildPopoutUrl({ popoutUrl: popout, provider, handoff });
  await vscode.env.openExternal(vscode.Uri.parse(href));
}

async function maybeAskToConnect(context: vscode.ExtensionContext): Promise<void> {
  const enabled = vscode.workspace.getConfiguration("codefriends").get<boolean>("connectPrompt", true);
  if (!enabled) return;

  const stored = (await context.secrets.get(TOKEN_KEY)) ?? "";
  const decision = decideConnectPrompt({
    hasSession: Boolean(stored),
    dontAskAgain: context.globalState.get<boolean>(DONT_ASK_KEY) === true,
    snoozeUntil: context.globalState.get<number>(SNOOZE_KEY) ?? 0,
  });
  if (decision !== "prompt") return;

  const host = resolveProvider();
  const pick = await vscode.window.showInformationMessage(
    connectPromptMessage(host),
    "Connect",
    "Not now",
    "Don't ask again",
  );
  if (pick === "Connect") {
    await context.globalState.update(SNOOZE_KEY, Date.now() + CONNECT_SNOOZE_MS);
    await vscode.commands.executeCommand(OPEN);
  } else if (pick === "Not now") {
    await context.globalState.update(SNOOZE_KEY, Date.now() + CONNECT_SNOOZE_MS);
  } else if (pick === "Don't ask again") {
    await context.globalState.update(DONT_ASK_KEY, true);
  }
}

async function poll(item: vscode.StatusBarItem, context: vscode.ExtensionContext): Promise<void> {
  const base = cfg("serverUrl", "http://127.0.0.1:8787").replace(/\/$/, "");
  const connected = Boolean(await context.secrets.get(TOKEN_KEY));
  try {
    const res = await fetch(`${base}/api/presence`);
    if (!res.ok) throw new Error(String(res.status));
    const data = (await res.json()) as { onlineCount?: number };
    const n = data.onlineCount ?? 0;
    item.text = connected ? `$(check) CodeFriends · ${n} online` : `CodeFriends · ${n} online`;
    item.tooltip = connected
      ? `Connected · ${n} friend${n === 1 ? "" : "s"} online — click to open the popout`
      : `${n} friend${n === 1 ? "" : "s"} online — click to open the popout`;
  } catch {
    item.text = connected ? "$(check) CodeFriends · offline" : "CodeFriends · offline";
    item.tooltip = connected
      ? "Connected, but the CodeFriends server is not reachable. Start apps/server, then click to open the popout."
      : "CodeFriends server is not reachable. Start apps/server, then click to open the popout.";
  }
}
