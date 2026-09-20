import { useEffect, useMemo, useRef, useState } from "react";
import type {
  ChatMessage,
  ClientKind,
  PresenceStatus,
  PublicUser,
  WsServerMessage,
} from "@codefriends/shared";
import { CLIENTS, CLIENT_LABEL } from "@codefriends/shared";
import { login, wsUrl } from "./api";
import { clearSession, loadSession, saveSession } from "./session";

const AGENT_CLIENTS = new Set<ClientKind>(["cursor", "claude", "codex", "gemini"]);

export function App() {
  const stored = loadSession();
  const [token, setToken] = useState(stored?.token ?? "");
  const [self, setSelf] = useState<PublicUser | null>(stored?.user ?? null);
  const [friends, setFriends] = useState<PublicUser[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  const [connected, setConnected] = useState(false);
  const [typingFrom, setTypingFrom] = useState<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    let retry: number | undefined;
    const connect = () => {
      const ws = new WebSocket(wsUrl(token));
      wsRef.current = ws;
      ws.onopen = () => {
        if (!cancelled) setConnected(true);
      };
      ws.onmessage = (ev) => {
        const msg = JSON.parse(ev.data) as WsServerMessage;
        if (msg.type === "hello_ok") {
          setSelf(msg.self);
          setFriends(msg.friends);
          setMessages(msg.messages);
          saveSession({ token, user: msg.self });
          setActiveId((cur) => cur ?? pickDefaultFriend(msg.friends, msg.messages, msg.self.id));
        } else if (msg.type === "friends") {
          setFriends(msg.friends);
        } else if (msg.type === "presence") {
          setFriends((cur) => cur.map((f) => (f.id === msg.user.id ? msg.user : f)));
          setSelf((cur) => (cur && cur.id === msg.user.id ? msg.user : cur));
        } else if (msg.type === "dm") {
          setMessages((cur) =>
            cur.some((m) => m.id === msg.message.id) ? cur : [...cur, msg.message],
          );
        } else if (msg.type === "typing") {
          setTypingFrom(msg.typing ? msg.from : null);
        } else if (msg.type === "error") {
          setError(msg.error);
        }
      };
      ws.onclose = () => {
        if (cancelled) return;
        setConnected(false);
        retry = window.setTimeout(connect, 1500);
      };
    };
    connect();
    return () => {
      cancelled = true;
      if (retry) window.clearTimeout(retry);
      wsRef.current?.close();
    };
  }, [token]);

  const send = (payload: object) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(payload));
  };

  const agents = friends.filter((f) => f.online && AGENT_CLIENTS.has(f.client));
  const people = friends.filter((f) => !(f.online && AGENT_CLIENTS.has(f.client)));
  const filteredAgents = filterPeople(agents, query);
  const filteredPeople = filterPeople(people, query);
  const active = friends.find((f) => f.id === activeId) ?? null;
  const thread = useMemo(
    () =>
      active && self
        ? messages.filter(
            (m) =>
              (m.from === self.id && m.to === active.id) ||
              (m.from === active.id && m.to === self.id),
          )
        : [],
    [active, messages, self],
  );

  if (!token || !self) {
    return <Login onError={setError} error={error} onReady={(t, u) => {
      saveSession({ token: t, user: u });
      setToken(t);
      setSelf(u);
      setError("");
    }} />;
  }

  return (
    <div className="shell">
      <header className="top">
        <div>
          <div className="kicker">Community</div>
          <h1>CodeFriends</h1>
        </div>
        <button
          className="ghost"
          type="button"
          onClick={() => {
            clearSession();
            wsRef.current?.close();
            setToken("");
            setSelf(null);
          }}
        >
          Sign out
        </button>
      </header>

      <label className="search">
        <span className="sr-only">Search community</span>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search community"
          onKeyDown={(e) => {
            if (e.key === "Enter" && query.trim()) {
              send({ type: "add_friend", username: query.trim() });
            }
          }}
        />
      </label>

      <SelfBar
        self={self}
        connected={connected}
        onChange={(patch) => send({ type: "presence", ...patch })}
      />

      <section className="list">
        <SectionTitle label="Agents online" count={filteredAgents.length} />
        {filteredAgents.map((friend) => (
          <FriendRow
            key={friend.id}
            friend={friend}
            active={friend.id === activeId}
            showClient
            onClick={() => setActiveId(friend.id)}
          />
        ))}
        <SectionTitle label="Friends" count={filteredPeople.length} />
        {filteredPeople.map((friend) => (
          <FriendRow
            key={friend.id}
            friend={friend}
            active={friend.id === activeId}
            onClick={() => setActiveId(friend.id)}
          />
        ))}
      </section>

      <DmPanel
        self={self}
        friend={active}
        messages={thread}
        draft={draft}
        typing={Boolean(active && typingFrom === active.id)}
        onDraft={setDraft}
        onSend={() => {
          if (!active || !draft.trim()) return;
          send({ type: "dm", to: active.id, text: draft });
          setDraft("");
        }}
        onTyping={(typing) => active && send({ type: "typing", to: active.id, typing })}
      />

      {error ? <p className="banner">{error}</p> : null}
      <footer className="fineprint">
        Steam Friends–style panel concept — not official. Not affiliated with Cursor, Anthropic, OpenAI, or Google.
      </footer>
    </div>
  );
}

function Login({
  error,
  onError,
  onReady,
}: {
  error: string;
  onError: (msg: string) => void;
  onReady: (token: string, user: PublicUser) => void;
}) {
  const [username, setUsername] = useState("maya");
  const [displayName, setDisplayName] = useState("");
  const [busy, setBusy] = useState(false);

  return (
    <div className="shell login">
      <div className="kicker">CodeFriends</div>
      <h1>Drop in without burning IDE RAM</h1>
      <p className="lede">
        Username auth for local demo — first login creates the account. Demo roster is already
        friends: maya, devjay, sam, rio, alex, casey, taylor, jordan, parker.
      </p>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          onError("");
          try {
            const session = await login(username, displayName || undefined);
            onReady(session.token, session.user);
          } catch (err) {
            onError(err instanceof Error ? err.message : "Login failed");
          } finally {
            setBusy(false);
          }
        }}
      >
        <label>
          Username
          <input
            autoFocus
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="maya"
            autoComplete="username"
          />
        </label>
        <label>
          Display name <span className="optional">optional</span>
          <input
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="same as username"
          />
        </label>
        <button className="primary" disabled={busy} type="submit">
          {busy ? "Connecting…" : "Open popout"}
        </button>
      </form>
      {error ? <p className="banner">{error}</p> : null}
      <footer className="fineprint">
        Not affiliated with Cursor, Anthropic, OpenAI, or Google.
      </footer>
    </div>
  );
}

function SelfBar({
  self,
  connected,
  onChange,
}: {
  self: PublicUser;
  connected: boolean;
  onChange: (patch: { status?: PresenceStatus; statusText?: string; client?: ClientKind }) => void;
}) {
  return (
    <div className="self">
      <Avatar name={self.displayName} status={connected ? self.status : "offline"} />
      <div className="meta">
        <strong>{self.displayName}</strong>
        <div className="self-controls">
          <select
            value={self.status}
            onChange={(e) => onChange({ status: e.target.value as PresenceStatus })}
          >
            <option value="available">Available</option>
            <option value="away">Away</option>
            <option value="offline">Appear offline</option>
          </select>
          <select
            value={self.client}
            onChange={(e) => onChange({ client: e.target.value as ClientKind })}
          >
            {CLIENTS.map((c) => (
              <option key={c} value={c}>
                {CLIENT_LABEL[c]}
              </option>
            ))}
          </select>
        </div>
        <input
          className="status-input"
          value={self.statusText}
          onChange={(e) => onChange({ statusText: e.target.value })}
          placeholder="What are you working on?"
        />
      </div>
    </div>
  );
}

function FriendRow({
  friend,
  active,
  showClient,
  onClick,
}: {
  friend: PublicUser;
  active: boolean;
  showClient?: boolean;
  onClick: () => void;
}) {
  return (
    <button type="button" className={`row ${active ? "active" : ""}`} onClick={onClick}>
      <Avatar name={friend.displayName} status={friend.online ? friend.status : "offline"} />
      <span className="meta">
        <span className="name-line">
          <strong>{friend.displayName}</strong>
          {showClient ? <ClientBadge client={friend.client} /> : null}
        </span>
        <span className="status">{friend.statusText || (friend.online ? "Available" : "Offline")}</span>
      </span>
    </button>
  );
}

function ClientBadge({ client }: { client: ClientKind }) {
  return <span className={`badge ${client}`}>{CLIENT_LABEL[client]}</span>;
}

function DmPanel({
  self,
  friend,
  messages,
  draft,
  typing,
  onDraft,
  onSend,
  onTyping,
}: {
  self: PublicUser;
  friend: PublicUser | null;
  messages: ChatMessage[];
  draft: string;
  typing: boolean;
  onDraft: (v: string) => void;
  onSend: () => void;
  onTyping: (typing: boolean) => void;
}) {
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" });
  }, [messages.length, friend?.id]);

  if (!friend) {
    return (
      <section className="dm empty">
        <p>Click a friend to DM. The IDE stays a thin badge — this popout holds the chat.</p>
      </section>
    );
  }

  return (
    <section className="dm">
      <header>
        <span>
          DM · <strong>{friend.displayName}</strong>
        </span>
        <span className="chevron" aria-hidden>
          ▾
        </span>
      </header>
      <div className="thread">
        {messages.map((m) => (
          <div key={m.id} className={`bubble ${m.from === self.id ? "mine" : "theirs"}`}>
            <time>{formatTime(m.createdAt)}</time>
            <p>{m.text}</p>
          </div>
        ))}
        {typing ? <p className="typing">{friend.displayName} is typing…</p> : null}
        <div ref={end} />
      </div>
      <form
        className="composer"
        onSubmit={(e) => {
          e.preventDefault();
          onTyping(false);
          onSend();
        }}
      >
        <input
          value={draft}
          placeholder="Type a message…"
          onChange={(e) => {
            onDraft(e.target.value);
            onTyping(Boolean(e.target.value));
          }}
          onBlur={() => onTyping(false)}
        />
      </form>
    </section>
  );
}

function SectionTitle({ label, count }: { label: string; count: number }) {
  return (
    <h2>
      {label} <span>({count})</span>
    </h2>
  );
}

function Avatar({ name, status }: { name: string; status: PresenceStatus }) {
  const hue = hashHue(name);
  return (
    <span className="avatar" style={{ background: `hsl(${hue} 28% 28%)` }}>
      {initials(name)}
      <i className={`dot ${status}`} />
    </span>
  );
}

function filterPeople(list: PublicUser[], query: string) {
  const q = query.trim().toLowerCase();
  if (!q) return list;
  return list.filter(
    (f) =>
      f.displayName.toLowerCase().includes(q) ||
      f.username.toLowerCase().includes(q) ||
      f.statusText.toLowerCase().includes(q),
  );
}

function pickDefaultFriend(friends: PublicUser[], messages: ChatMessage[], selfId: string) {
  const last = [...messages].reverse().find((m) => m.from === selfId || m.to === selfId);
  if (last) return last.from === selfId ? last.to : last.from;
  return friends[0]?.id ?? null;
}

function initials(name: string) {
  return name.slice(0, 1).toUpperCase();
}

function hashHue(name: string) {
  let n = 0;
  for (const ch of name) n = (n * 31 + ch.charCodeAt(0)) >>> 0;
  return n % 360;
}

function formatTime(ts: number) {
  return new Date(ts).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}
