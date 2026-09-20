import * as vscode from "vscode";

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

  const open = vscode.commands.registerCommand(OPEN, async () => {
    const popout = cfg("popoutUrl", "http://127.0.0.1:5173").replace(/\/$/, "");
    const server = cfg("serverUrl", "http://127.0.0.1:8787").replace(/\/$/, "");
    const stored = (await context.secrets.get(TOKEN_KEY)) ?? "";
    const url = new URL(popout);
    url.searchParams.set("provider", "cursor");
    url.searchParams.set("client", "cursor");
    if (stored) {
      try {
        const res = await fetch(`${server}/api/auth/handoff`, {
          method: "POST",
          headers: { authorization: `Bearer ${stored}` },
        });
        const data = (await res.json()) as { code?: string };
        if (res.ok && data.code) url.searchParams.set("handoff", data.code);
      } catch {
        // Popout still opens; user can sign in there.
      }
    }
    await vscode.env.openExternal(vscode.Uri.parse(url.toString()));
  });

  const refresh = vscode.commands.registerCommand(REFRESH, () => poll(item));

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
        body: JSON.stringify({ username, client: "cursor" }),
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
  });

  let timer: ReturnType<typeof setInterval> | undefined;
  const armTimer = () => {
    if (timer) clearInterval(timer);
    const ms = vscode.workspace.getConfiguration("codefriends").get<number>("pollMs", 15_000);
    timer = setInterval(() => void poll(item), Math.max(3000, ms));
  };

  const configWatch = vscode.workspace.onDidChangeConfiguration((e) => {
    if (e.affectsConfiguration("codefriends")) {
      armTimer();
      void poll(item);
    }
  });

  context.subscriptions.push(item, open, refresh, devSignIn, signOut, configWatch, {
    dispose: () => timer && clearInterval(timer),
  });

  armTimer();
  void poll(item);
}

export function deactivate(): void {}

function cfg(key: string, fallback: string): string {
  return vscode.workspace.getConfiguration("codefriends").get<string>(key, fallback);
}

async function poll(item: vscode.StatusBarItem): Promise<void> {
  const base = cfg("serverUrl", "http://127.0.0.1:8787").replace(/\/$/, "");
  try {
    const res = await fetch(`${base}/api/presence`);
    if (!res.ok) throw new Error(String(res.status));
    const data = (await res.json()) as { onlineCount?: number };
    const n = data.onlineCount ?? 0;
    item.text = `CodeFriends · ${n} online`;
    item.tooltip = `${n} friend${n === 1 ? "" : "s"} online — click to open the popout`;
  } catch {
    item.text = "CodeFriends · offline";
    item.tooltip = "CodeFriends server is not reachable. Start apps/server, then click to open the popout.";
  }
}
