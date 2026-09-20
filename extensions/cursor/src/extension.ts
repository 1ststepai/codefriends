import * as vscode from "vscode";

const OPEN = "codefriends.openPopout";
const REFRESH = "codefriends.refreshPresence";

export function activate(context: vscode.ExtensionContext): void {
  const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 80);
  item.command = OPEN;
  item.tooltip = "Open the CodeFriends popout (chat stays outside the IDE)";
  item.text = "CodeFriends · …";
  item.show();

  const open = vscode.commands.registerCommand(OPEN, async () => {
    const url = vscode.workspace.getConfiguration("codefriends").get<string>("popoutUrl", "http://127.0.0.1:5173");
    await vscode.env.openExternal(vscode.Uri.parse(url));
  });

  const refresh = vscode.commands.registerCommand(REFRESH, () => poll(item));

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

  context.subscriptions.push(item, open, refresh, configWatch, {
    dispose: () => timer && clearInterval(timer),
  });

  armTimer();
  void poll(item);
}

export function deactivate(): void {}

async function poll(item: vscode.StatusBarItem): Promise<void> {
  const base = vscode.workspace
    .getConfiguration("codefriends")
    .get<string>("serverUrl", "http://127.0.0.1:8787")
    .replace(/\/$/, "");
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
