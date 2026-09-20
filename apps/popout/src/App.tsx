import { useEffect, useMemo, useRef, useState } from "react";
import type {
  ChatMessage,
  ClientKind,
  PresenceStatus,
  PublicUser,
  WsServerMessage,
} from "@codefriends/shared";
import { CLIENTS, CLIENT_LABEL } from "@codefriends/shared";
import type { AuthProviderInfo } from "@codefriends/shared";
import { apiUrl, fetchProviders, login, mockProviderLogin, redeemHandoff, wsUrl } from "./api";
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
  const [providers, setProviders] = useState<AuthProviderInfo[]>([]);
  const [mockProviders, setMockProviders] = useState(false);
  const [bootstrapping, setBootstrapping] = useState(() => hasAuthQuery());
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchProviders()
      .then((catalog) => {
        if (cancelled) return;
        setProviders(catalog.providers);
        setMockProviders(catalog.mockProviders);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Could not load sign-in options");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const err = params.get("error");
    const handoff = params.get("handoff");
    const rawToken = params.get("token");
    if (err) setError(err);
    if (!handoff && !rawToken) {
      setBootstrapping(false);
      return;
    }
    let cancelled = false;
    const finish = () => {
      if (!cancelled) setBootstrapping(false);
      stripAuthQuery();
    };
    if (rawToken) {
      setToken(rawToken);
      finish();
      return;
    }
    void redeemHandoff(handoff!, clientHint())
      .then((session) => {
        if (cancelled) return;
        saveSession(session);
        setToken(session.token);
        setSelf(session.user);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Could not restore session");
      })
      .finally(finish);
    return () => {
      cancelled = true;
    };
  }, []);

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
          setSelf((cur) => {
            if (!cur || cur.id !== msg.user.id) return cur;
            return { ...msg.user, identities: msg.user.identities ?? cur.identities };
          });
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

  if (bootstrapping) {
    return (
      <div className="shell login">
        <div className="kicker">CodeFriends</div>
        <h1>Opening your session…</h1>
      </div>
    );
  }

  if (!token || !self) {
    return (
      <Login
        onError={setError}
        error={error}
        providers={providers}
        mockProviders={mockProviders}
        onReady={(t, u) => {
          saveSession({ token: t, user: u });
          setToken(t);
          setSelf(u);
          setError("");
        }}
      />
    );
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
        providers={providers}
        token={token}
        onChange={(patch) => send({ type: "presence", ...patch })}
        onLinked={(u) => {
          setSelf(u);
          saveSession({ token, user: u });
        }}
        onError={setError}
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
        CodeFriends overlay. Not affiliated with Cursor, Anthropic, OpenAI, or Google.
      </footer>
    </div>
  );
}

function Login({
  error,
  onError,
  onReady,
  providers,
  mockProviders,
}: {
  error: string;
  onError: (msg: string) => void;
  onReady: (token: string, user: PublicUser) => void;
  providers: AuthProviderInfo[];
  mockProviders: boolean;
}) {
  const hinted = providerHint();
  const genericHost = hinted === "generic";
  const [username, setUsername] = useState("maya");
  const [displayName, setDisplayName] = useState("");
  const [busy, setBusy] = useState(false);
  const [mockSubject, setMockSubject] = useState("");
  const [mockProvider, setMockProvider] = useState(hinted && hinted !== "dev" && hinted !== "generic" ? hinted : "cursor");
  const productProviders = providers.filter((p) => p.id !== "dev");
  const dev = providers.find((p) => p.id === "dev");
  const showDev = !providers.length || dev?.availability === "dev" || genericHost;
  const highlighted = productProviders.find((p) => p.id === hinted);

  return (
    <div className="shell login">
      <div className="kicker">CodeFriends</div>
      <h1>Drop in without burning IDE RAM</h1>
      <p className="lede">
        Sign in with the same account you already use in Cursor, Claude, Codex, or Gemini. One
        CodeFriends user can link several of those identities so the friends graph stays a single
        person.
      </p>
      {genericHost ? (
        <p className="lede highlight">
          Opened from a local / open-source editor (VS Code, VSCodium, Continue, Ollama GUI, Open
          WebUI, SillyTavern, …). This is an opt-in to a <strong>CodeFriends</strong> identity — not
          “login with Ollama” or any host SSO.
        </p>
      ) : highlighted ? (
        <p className="lede highlight">
          Opened from {highlighted.label}.{" "}
          {highlighted.availability === "live"
            ? `Continue with your ${highlighted.accountOf} account.`
            : highlighted.availability === "unconfigured"
              ? highlighted.nextStep ??
                `Sign in with Google in this popout once GEMINI_GOOGLE_* env is set. That is CodeFriends Gemini identity, not ${highlighted.label} CLI login.`
              : highlighted.blockedReason ?? "This provider’s official login is not publicly available yet."}
        </p>
      ) : null}
      <div className="provider-grid">
        {productProviders.map((provider) => (
          <ProviderButton
            key={provider.id}
            provider={provider}
            emphasized={provider.id === hinted}
            disabled={busy}
            onStart={() => {
              if (provider.startPath) {
                window.location.href = `${apiUrl(provider.startPath)}?client=${encodeURIComponent(clientHint() ?? provider.id)}`;
              }
            }}
          />
        ))}
      </div>
      {showDev ? (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            onError("");
            try {
              const session = await login(username, displayName || undefined, clientHint());
              onReady(session.token, session.user);
            } catch (err) {
              onError(err instanceof Error ? err.message : "Login failed");
            } finally {
              setBusy(false);
            }
          }}
        >
          <p className="lede">
            <strong>Local / smoke demo</strong> — username only, no password. Same roster as before:
            maya, parker, and friends. Not used in production.
          </p>
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
      ) : null}
      {mockProviders ? (
        <form
          className="mock-form"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            onError("");
            try {
              const session = await mockProviderLogin(mockProvider, {
                subject: mockSubject,
                usernameHint: mockSubject,
              });
              onReady(session.token, session.user);
            } catch (err) {
              onError(err instanceof Error ? err.message : "Mock login failed");
            } finally {
              setBusy(false);
            }
          }}
        >
          <p className="lede">
            <strong>Mock provider</strong> (CODEFRIENDS_MOCK_PROVIDERS=1) — exercises the identity
            interface without a real OAuth app.
          </p>
          <label>
            Provider
            <select value={mockProvider} onChange={(e) => setMockProvider(e.target.value)}>
              {productProviders.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Provider subject
            <input
              value={mockSubject}
              onChange={(e) => setMockSubject(e.target.value)}
              placeholder="stable-account-id"
            />
          </label>
          <button className="ghost wide" disabled={busy} type="submit">
            Continue with mock identity
          </button>
        </form>
      ) : null}
      {error ? <p className="banner">{error}</p> : null}
      <footer className="fineprint">
        Not affiliated with Cursor, Anthropic, OpenAI, or Google.
      </footer>
    </div>
  );
}

function ProviderButton({
  provider,
  emphasized,
  disabled,
  onStart,
}: {
  provider: AuthProviderInfo;
  emphasized?: boolean;
  disabled?: boolean;
  onStart: () => void;
}) {
  const canStart = provider.availability === "live" && Boolean(provider.startPath);
  const title =
    provider.availability === "live"
      ? `Sign in with ${provider.label}`
      : provider.availability === "unconfigured"
        ? provider.nextStep ?? "Needs OAuth client env vars"
        : provider.blockedReason ?? "Not available yet";
  return (
    <button
      type="button"
      className={`provider ${provider.id} ${emphasized ? "emphasized" : ""}`}
      disabled={disabled || !canStart}
      title={title}
      onClick={onStart}
    >
      Continue with {provider.label}
      <span className="provider-state">{availabilityLabel(provider)}</span>
    </button>
  );
}

function SelfBar({
  self,
  connected,
  onChange,
  providers,
  token,
  onLinked,
  onError,
}: {
  self: PublicUser;
  connected: boolean;
  onChange: (patch: { status?: PresenceStatus; statusText?: string; client?: ClientKind }) => void;
  providers: AuthProviderInfo[];
  token: string;
  onLinked: (user: PublicUser) => void;
  onError: (msg: string) => void;
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
        <LinkedAccounts
          self={self}
          providers={providers}
          token={token}
          onLinked={onLinked}
          onError={onError}
        />
      </div>
    </div>
  );
}

function LinkedAccounts({
  self,
  providers,
  token,
  onLinked,
  onError,
}: {
  self: PublicUser;
  providers: AuthProviderInfo[];
  token: string;
  onLinked: (user: PublicUser) => void;
  onError: (msg: string) => void;
}) {
  const linked = new Set((self.identities ?? []).map((i) => i.provider));
  const linkable = providers.filter((p) => p.id !== "dev");
  return (
    <div className="identities">
      <span className="identity-label">Accounts</span>
      <span className="identity-list">
        {(self.identities ?? []).map((id) => (
          <span key={id.provider} className={`badge ${id.provider === "dev" ? "web" : id.provider}`}>
            {id.provider}
          </span>
        ))}
      </span>
      {linkable.map((provider) => {
        if (linked.has(provider.id)) return null;
        if (provider.availability === "live" && provider.startPath) {
          return (
            <a
              key={provider.id}
              className="link-account"
              href={`${apiUrl(provider.startPath)}?link=1&token=${encodeURIComponent(token)}&client=${encodeURIComponent(self.client)}`}
            >
              Link {provider.label}
            </a>
          );
        }
        return null;
      })}
      {providers.some((p) => p.availability === "mock") ? (
        <button
          type="button"
          className="link-account"
          onClick={async () => {
            const provider = window.prompt("Provider to link (cursor, claude, codex, gemini)", "claude");
            const subject = provider && window.prompt("Stable provider subject");
            if (!provider || !subject) return;
            try {
              const session = await mockProviderLogin(provider, { subject }, token);
              onLinked(session.user);
            } catch (err) {
              onError(err instanceof Error ? err.message : "Link failed");
            }
          }}
        >
          Link mock identity
        </button>
      ) : null}
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

function hasAuthQuery(): boolean {
  const params = new URLSearchParams(window.location.search);
  return Boolean(params.get("handoff") || params.get("token"));
}

function stripAuthQuery(): void {
  const url = new URL(window.location.href);
  url.searchParams.delete("handoff");
  url.searchParams.delete("token");
  url.searchParams.delete("error");
  window.history.replaceState({}, "", url.pathname + url.search + url.hash);
}

function providerHint(): string | undefined {
  return new URLSearchParams(window.location.search).get("provider") ?? undefined;
}

function clientHint(): string | undefined {
  const params = new URLSearchParams(window.location.search);
  const provider = params.get("provider");
  if (params.get("client")) return params.get("client") ?? undefined;
  if (provider === "dev" || provider === "generic") return "web";
  return provider ?? undefined;
}

function availabilityLabel(provider: AuthProviderInfo): string {
  switch (provider.availability) {
    case "live":
      return "ready";
    case "unconfigured":
      return "needs Google OAuth env";
    case "blocked":
      return "blocked — no public OAuth";
    case "mock":
      return "mock only";
    case "dev":
      return "local demo";
    default:
      return provider.availability;
  }
}
