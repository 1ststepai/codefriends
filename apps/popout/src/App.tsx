import { useEffect, useMemo, useRef, useState } from "react";
import type {
  ChatMessage,
  ClientKind,
  ForumReply,
  ForumTopic,
  LibraryItem,
  PresenceStatus,
  PublicUser,
  WsServerMessage,
} from "@codefriends/shared";
import {
  CLIENTS,
  CLIENT_LABEL,
  LIBRARY_DESCRIPTION_MAX,
  LIBRARY_KIND_LABEL,
  LIBRARY_KINDS,
  LIBRARY_TITLE_MAX,
  parseInviteToken,
  REPLY_BODY_MAX,
  STATUS_TEXT_MAX,
  TOPIC_BODY_MAX,
  TOPIC_TITLE_MAX,
} from "@codefriends/shared";
import type { AuthProviderInfo } from "@codefriends/shared";
import {
  acceptInvite,
  addLibraryItem,
  addTopicReply,
  apiUrl,
  createInvite,
  createTopic,
  deleteLibraryItem,
  fetchProviders,
  getTopic,
  listLibrary,
  listTopics,
  login,
  mockProviderLogin,
  peekInvite,
  redeemHandoff,
  updateProfile,
  wsUrl,
} from "./api";
import {
  clearPendingInvite,
  clearSession,
  loadPendingInvite,
  loadSession,
  savePendingInvite,
  saveSession,
} from "./session";

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
  const [pendingInvite, setPendingInvite] = useState(() => inviteFromLocation() || loadPendingInvite());
  const [inviteFrom, setInviteFrom] = useState<PublicUser | null>(null);
  const [wsReady, setWsReady] = useState(false);
  const [view, setView] = useState<"friends" | "board" | "library">("friends");
  const [topics, setTopics] = useState<ForumTopic[]>([]);
  const [openTopicId, setOpenTopicId] = useState<string | null>(null);
  const [openTopic, setOpenTopic] = useState<ForumTopic | null>(null);
  const [replies, setReplies] = useState<ForumReply[]>([]);
  const [libraryItems, setLibraryItems] = useState<LibraryItem[]>([]);
  const [openLibraryId, setOpenLibraryId] = useState<string | null>(null);
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
    const fromUrl = inviteFromLocation();
    if (fromUrl) {
      savePendingInvite(fromUrl);
      setPendingInvite(fromUrl);
    }
  }, []);

  useEffect(() => {
    if (!pendingInvite) {
      setInviteFrom(null);
      return;
    }
    let cancelled = false;
    peekInvite(pendingInvite)
      .then((info) => {
        if (!cancelled) setInviteFrom(info.inviter);
      })
      .catch(() => {
        if (!cancelled) setInviteFrom(null);
      });
    return () => {
      cancelled = true;
    };
  }, [pendingInvite]);

  useEffect(() => {
    if (!token || !pendingInvite || !wsReady) return;
    let cancelled = false;
    void acceptInvite(token, pendingInvite)
      .then((result) => {
        if (cancelled) return;
        setFriends(result.friends);
        setActiveId((cur) => cur ?? result.friend.id);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Could not accept invite");
      })
      .finally(() => {
        if (cancelled) return;
        clearPendingInvite();
        setPendingInvite("");
        setInviteFrom(null);
        stripInviteLocation();
      });
    return () => {
      cancelled = true;
    };
  }, [token, pendingInvite, wsReady]);

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
    setWsReady(false);
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
          setWsReady(true);
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

  useEffect(() => {
    if (!token || view !== "board") return;
    let cancelled = false;
    listTopics(token)
      .then((items) => {
        if (!cancelled) setTopics(items);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Could not load the school board");
      });
    return () => {
      cancelled = true;
    };
  }, [token, view]);

  useEffect(() => {
    if (!token || view !== "library") return;
    let cancelled = false;
    listLibrary(token)
      .then((items) => {
        if (!cancelled) setLibraryItems(items);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Could not load the build library");
      });
    return () => {
      cancelled = true;
    };
  }, [token, view]);

  useEffect(() => {
    if (!token || !openTopicId) {
      setOpenTopic(null);
      setReplies([]);
      return;
    }
    let cancelled = false;
    getTopic(token, openTopicId)
      .then((found) => {
        if (cancelled) return;
        setOpenTopic(found.topic);
        setReplies(found.replies);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Could not open that thread");
      });
    return () => {
      cancelled = true;
    };
  }, [token, openTopicId]);

  const send = (payload: object) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(payload));
  };

  const agents = friends.filter((f) => f.online && AGENT_CLIENTS.has(f.client));
  const people = friends.filter((f) => !(f.online && AGENT_CLIENTS.has(f.client)));
  const filteredAgents = filterPeople(agents, query);
  const filteredPeople = filterPeople(people, query);
  const filteredTopics = filterTopics(topics, query);
  const filteredLibrary = filterLibrary(libraryItems, query);
  const openLibrary = libraryItems.find((item) => item.id === openLibraryId) ?? null;
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
        inviteFrom={inviteFrom}
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
    <div className={`shell${view === "library" ? " library-mode" : ""}`}>
      <header className="top">
        <div>
          <div className="kicker">Learn together</div>
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

      <nav className="mode-tabs" aria-label="Popout sections">
        <button
          type="button"
          className={view === "friends" ? "active" : ""}
          onClick={() => setView("friends")}
        >
          Friends
        </button>
        <button
          type="button"
          className={view === "board" ? "active" : ""}
          onClick={() => setView("board")}
        >
          School board
        </button>
        <button
          type="button"
          className={view === "library" ? "active" : ""}
          onClick={() => setView("library")}
        >
          Library
        </button>
      </nav>

      <label className="search">
        <span className="sr-only">
          {view === "board" ? "Search the school board" : view === "library" ? "Search the library" : "Search friends"}
        </span>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={
            view === "board" ? "Search the school board" : view === "library" ? "Search the library" : "Search friends"
          }
          onKeyDown={(e) => {
            if (view === "friends" && e.key === "Enter" && query.trim()) {
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
        onFriends={setFriends}
        onError={setError}
      />

      {view === "friends" ? (
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
      ) : view === "board" ? (
        <TopicList
          token={token}
          topics={filteredTopics}
          activeId={openTopicId}
          onError={setError}
          onPosted={(topic) => {
            setTopics((cur) => [topic, ...cur.filter((t) => t.id !== topic.id)]);
            setOpenTopicId(topic.id);
            setOpenTopic(topic);
            setReplies([]);
          }}
          onOpen={setOpenTopicId}
        />
      ) : (
        <LibraryList
          token={token}
          items={filteredLibrary}
          activeId={openLibraryId}
          onError={setError}
          onAdded={(item) => {
            setLibraryItems((cur) => {
              const next = [item, ...cur.filter((row) => row.id !== item.id)];
              const official = next.filter((row) => row.source === "official");
              const community = next.filter((row) => row.source !== "official");
              return [...official, ...community];
            });
            setOpenLibraryId(item.id);
          }}
          onOpen={setOpenLibraryId}
        />
      )}

      {view === "friends" ? (
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
      ) : view === "board" ? (
        <BoardPanel
          token={token}
          topic={openTopic}
          replies={replies}
          onError={setError}
          onReplied={(topic, nextReplies) => {
            setOpenTopic(topic);
            setReplies(nextReplies);
            setTopics((cur) => cur.map((t) => (t.id === topic.id ? topic : t)));
          }}
        />
      ) : (
        <LibraryPanel
          token={token}
          selfId={self.id}
          item={openLibrary}
          onError={setError}
          onRemoved={(id) => {
            setLibraryItems((cur) => cur.filter((row) => row.id !== id));
            setOpenLibraryId((cur) => (cur === id ? null : cur));
          }}
        />
      )}

      {error ? <p className="banner">{error}</p> : null}
      <footer className="fineprint">
        CodeFriends popout. Not affiliated with Cursor, Anthropic, OpenAI, or Google.
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
  inviteFrom,
}: {
  error: string;
  onError: (msg: string) => void;
  onReady: (token: string, user: PublicUser) => void;
  providers: AuthProviderInfo[];
  mockProviders: boolean;
  inviteFrom: PublicUser | null;
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
      <div className="kicker">Learn together</div>
      <h1>An AI coding school with your friends in the room</h1>
      <p className="lede">
        Learn with friends while you use Cursor, Claude, Codex, or Gemini. Presence, DMs, a short
        profile (GitHub / tools / optional socials), a school board, and a build library of 1stStep
        starters plus projects the cohort shares. One CodeFriends user can link several of those
        identities so you stay a single person in the room.
      </p>
      {inviteFrom ? (
        <p className="lede highlight">
          Invite from <strong>{inviteFrom.displayName}</strong> (@{inviteFrom.username}). Sign in and
          you’ll be friends immediately — no request to approve.
        </p>
      ) : null}
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
  onFriends,
  onError,
}: {
  self: PublicUser;
  connected: boolean;
  onChange: (patch: { status?: PresenceStatus; statusText?: string; client?: ClientKind }) => void;
  providers: AuthProviderInfo[];
  token: string;
  onLinked: (user: PublicUser) => void;
  onFriends: (friends: PublicUser[]) => void;
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
        <label className="status-label">
          Now working on
          <input
            className="status-input"
            value={self.statusText}
            maxLength={STATUS_TEXT_MAX}
            onChange={(e) => onChange({ statusText: e.target.value })}
            placeholder="a lesson, a refactor, pairing…"
          />
        </label>
        <ProfileEditor self={self} token={token} onSaved={onLinked} onError={onError} />
        <InviteBar token={token} onFriends={onFriends} onError={onError} />
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

const PROFILE_URL_FIELDS = [
  { key: "githubUrl", label: "GitHub", placeholder: "https://github.com/you" },
  { key: "website", label: "Website", placeholder: "https://" },
  { key: "twitterUrl", label: "Twitter / X", placeholder: "@handle or https://x.com/you" },
  { key: "facebookUrl", label: "Facebook", placeholder: "https://facebook.com/you" },
  { key: "telegramUrl", label: "Telegram", placeholder: "@username or https://t.me/you" },
  { key: "whatsappUrl", label: "WhatsApp", placeholder: "phone or https://wa.me/…" },
] as const;

type ProfileUrlKey = (typeof PROFILE_URL_FIELDS)[number]["key"];

function profileUrlState(self: PublicUser): Record<ProfileUrlKey, string> {
  return {
    githubUrl: self.githubUrl ?? "",
    website: self.website ?? "",
    twitterUrl: self.twitterUrl ?? "",
    facebookUrl: self.facebookUrl ?? "",
    telegramUrl: self.telegramUrl ?? "",
    whatsappUrl: self.whatsappUrl ?? "",
  };
}

function ProfileEditor({
  self,
  token,
  onSaved,
  onError,
}: {
  self: PublicUser;
  token: string;
  onSaved: (user: PublicUser) => void;
  onError: (msg: string) => void;
}) {
  const [urls, setUrls] = useState(() => profileUrlState(self));
  const [tools, setTools] = useState((self.tools ?? []).join(", "));
  const [currentlyBuilding, setCurrentlyBuilding] = useState(self.currentlyBuilding ?? "");
  const [ownsBusiness, setOwnsBusiness] = useState(Boolean(self.ownsBusiness));
  const [businessNote, setBusinessNote] = useState(self.businessNote ?? "");
  const [wantsToHelp, setWantsToHelp] = useState(Boolean(self.wantsToHelpOthersBuild));

  useEffect(() => {
    setUrls(profileUrlState(self));
    setTools((self.tools ?? []).join(", "));
    setCurrentlyBuilding(self.currentlyBuilding ?? "");
    setOwnsBusiness(Boolean(self.ownsBusiness));
    setBusinessNote(self.businessNote ?? "");
    setWantsToHelp(Boolean(self.wantsToHelpOthersBuild));
  }, [
    self.githubUrl,
    self.website,
    self.twitterUrl,
    self.facebookUrl,
    self.telegramUrl,
    self.whatsappUrl,
    self.tools,
    self.currentlyBuilding,
    self.ownsBusiness,
    self.businessNote,
    self.wantsToHelpOthersBuild,
  ]);

  const save = async (patch: Parameters<typeof updateProfile>[1]) => {
    onError("");
    try {
      onSaved(await updateProfile(token, patch));
    } catch (err) {
      onError(err instanceof Error ? err.message : "Could not update profile");
    }
  };

  return (
    <div className="profile-edit">
      {PROFILE_URL_FIELDS.map((field) => (
        <label key={field.key} className="status-label">
          {field.label}
          <input
            className="status-input"
            value={urls[field.key]}
            placeholder={field.placeholder}
            onChange={(e) => setUrls((current) => ({ ...current, [field.key]: e.target.value }))}
            onBlur={() => {
              if (urls[field.key] !== (self[field.key] ?? "")) void save({ [field.key]: urls[field.key] });
            }}
          />
        </label>
      ))}
      <label className="status-label">
        Tools
        <input
          className="status-input"
          value={tools}
          placeholder="Cursor, Claude, Rust"
          onChange={(e) => setTools(e.target.value)}
          onBlur={() => {
            if (tools !== (self.tools ?? []).join(", ")) void save({ tools });
          }}
        />
      </label>
      <label className="status-label">
        What are you currently building?
        <input
          className="status-input"
          value={currentlyBuilding}
          maxLength={STATUS_TEXT_MAX}
          placeholder="a lesson, a CLI, pairing notes…"
          onChange={(e) => setCurrentlyBuilding(e.target.value)}
          onBlur={() => {
            if (currentlyBuilding !== (self.currentlyBuilding ?? "")) void save({ currentlyBuilding });
          }}
        />
      </label>
      <label className="check-label">
        <input
          type="checkbox"
          checked={ownsBusiness}
          onChange={(e) => {
            const next = e.target.checked;
            setOwnsBusiness(next);
            void save({ ownsBusiness: next });
          }}
        />
        Do you own a business?
      </label>
      {ownsBusiness ? (
        <label className="status-label">
          Business (one line)
          <input
            className="status-input"
            value={businessNote}
            maxLength={STATUS_TEXT_MAX}
            placeholder="a weekend study club, a tiny tool…"
            onChange={(e) => setBusinessNote(e.target.value)}
            onBlur={() => {
              if (businessNote !== (self.businessNote ?? "")) void save({ businessNote });
            }}
          />
        </label>
      ) : null}
      <label className="check-label">
        <input
          type="checkbox"
          checked={wantsToHelp}
          onChange={(e) => {
            const next = e.target.checked;
            setWantsToHelp(next);
            void save({ wantsToHelpOthersBuild: next });
          }}
        />
        Want to help others with building?
      </label>
    </div>
  );
}

function ProfileBits({ user, links }: { user: PublicUser; links: boolean }) {
  const tools = user.tools ?? [];
  const chips = PROFILE_URL_FIELDS.filter((field) => user[field.key]).map((field) => ({
    key: field.key,
    label: field.key === "website" ? "Site" : field.key === "twitterUrl" ? "Twitter/X" : field.label,
    href: user[field.key],
  }));
  const signals = [
    user.currentlyBuilding ? user.currentlyBuilding : "",
    user.ownsBusiness ? (user.businessNote ? `Owns a business · ${user.businessNote}` : "Owns a business") : "",
    user.wantsToHelpOthersBuild ? "Happy to help others build" : "",
  ].filter(Boolean);
  if (!chips.length && !signals.length && tools.length === 0) return null;
  return (
    <span className="profile-bits">
      {tools.length ? <span className="tools">{tools.join(" · ")}</span> : null}
      {signals.map((signal) => (
        <span key={signal} className="tools">
          {signal}
        </span>
      ))}
      {chips.map((chip) =>
        links ? (
          <a key={chip.key} href={chip.href} target="_blank" rel="noreferrer">
            {chip.label}
          </a>
        ) : (
          <span key={chip.key} className="tools">
            {chip.label}
          </span>
        ),
      )}
    </span>
  );
}

function InviteBar({
  token,
  onFriends,
  onError,
}: {
  token: string;
  onFriends: (friends: PublicUser[]) => void;
  onError: (msg: string) => void;
}) {
  const [url, setUrl] = useState("");
  const [paste, setPaste] = useState("");
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);

  return (
    <div className="invite">
      <div className="invite-row">
        <button
          type="button"
          className="ghost compact"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            onError("");
            try {
              const created = await createInvite(token);
              setUrl(created.url);
              const ok = await copyText(created.url);
              setCopied(ok);
            } catch (err) {
              onError(err instanceof Error ? err.message : "Could not create invite");
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? "Creating…" : "Create invite link"}
        </button>
        {url ? (
          <button
            type="button"
            className="ghost compact"
            onClick={async () => {
              const ok = await copyText(url);
              setCopied(ok);
            }}
          >
            {copied ? "Copied" : "Copy"}
          </button>
        ) : null}
      </div>
      {url ? <input className="status-input" readOnly value={url} onFocus={(e) => e.target.select()} /> : null}
      <form
        className="invite-accept"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!paste.trim()) return;
          setBusy(true);
          onError("");
          try {
            const result = await acceptInvite(token, paste);
            onFriends(result.friends);
            setPaste("");
          } catch (err) {
            onError(err instanceof Error ? err.message : "Could not accept invite");
          } finally {
            setBusy(false);
          }
        }}
      >
        <input
          value={paste}
          onChange={(e) => setPaste(e.target.value)}
          placeholder="Paste invite link or code"
          autoComplete="off"
        />
        <button className="ghost compact" disabled={busy || !paste.trim()} type="submit">
          Accept
        </button>
      </form>
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
          {showClient || friend.online ? <ClientBadge client={friend.client} /> : null}
        </span>
        <span className="status">{friend.statusText || (friend.online ? "Available" : "Offline")}</span>
        <ProfileBits user={friend} links={false} />
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
        <p>Click a friend to DM. Learn in the same room — this popout holds the chat, not the IDE.</p>
      </section>
    );
  }

  return (
    <section className="dm">
      <header>
        <span>
          DM · <strong>{friend.displayName}</strong>
          <ProfileBits user={friend} links />
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

function TopicList({
  token,
  topics,
  activeId,
  onOpen,
  onPosted,
  onError,
}: Readonly<{
  token: string;
  topics: ForumTopic[];
  activeId: string | null;
  onOpen: (id: string) => void;
  onPosted: (topic: ForumTopic) => void;
  onError: (msg: string) => void;
}>) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);

  return (
    <section className="list">
      <SectionTitle label="Threads" count={topics.length} />
      <form
        className="board-compose"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!title.trim() || !body.trim()) return;
          setBusy(true);
          onError("");
          try {
            onPosted(await createTopic(token, title, body));
            setTitle("");
            setBody("");
          } catch (err) {
            onError(err instanceof Error ? err.message : "Could not post to the board");
          } finally {
            setBusy(false);
          }
        }}
      >
        <p className="lede">Ask a question or share what you are learning. Anyone signed in on this school can read and reply.</p>
        <input
          value={title}
          maxLength={TOPIC_TITLE_MAX}
          placeholder="Title — what are you working through?"
          onChange={(e) => setTitle(e.target.value)}
        />
        <textarea
          value={body}
          maxLength={TOPIC_BODY_MAX}
          placeholder="Notes, a question, or a snippet (plain text is fine)"
          rows={3}
          onChange={(e) => setBody(e.target.value)}
        />
        <button className="ghost compact" disabled={busy || !title.trim() || !body.trim()} type="submit">
          {busy ? "Posting…" : "Post to the board"}
        </button>
      </form>
      {topics.map((topic) => (
        <button
          key={topic.id}
          type="button"
          className={`row ${topic.id === activeId ? "active" : ""}`}
          onClick={() => onOpen(topic.id)}
        >
          <span className="meta">
            <span className="name-line">
              <strong>{topic.title}</strong>
            </span>
            <span className="status">
              {topic.authorDisplayName} · {formatWhen(topic.createdAt)} · {topic.replyCount}{" "}
              {topic.replyCount === 1 ? "reply" : "replies"}
            </span>
          </span>
        </button>
      ))}
    </section>
  );
}

function BoardPanel({
  token,
  topic,
  replies,
  onReplied,
  onError,
}: Readonly<{
  token: string;
  topic: ForumTopic | null;
  replies: ForumReply[];
  onReplied: (topic: ForumTopic, replies: ForumReply[]) => void;
  onError: (msg: string) => void;
}>) {
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" });
  }, [replies.length, topic?.id]);

  if (!topic) {
    return (
      <section className="dm empty">
        <p>Open a thread on the school board. This is the cohort’s shared notes — not a 1:1 DM.</p>
      </section>
    );
  }

  return (
    <section className="dm">
      <header>
        <span>
          School board · <strong>{topic.title}</strong>
        </span>
        <span className="status">
          {topic.authorDisplayName} · {formatWhen(topic.createdAt)}
        </span>
      </header>
      <div className="thread">
        <article className="board-post">
          <p>{topic.body}</p>
        </article>
        {replies.map((reply) => (
          <div key={reply.id} className="bubble theirs">
            <time>
              {reply.authorDisplayName} · {formatWhen(reply.createdAt)}
            </time>
            <p>{reply.body}</p>
          </div>
        ))}
        <div ref={end} />
      </div>
      <form
        className="composer"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!draft.trim()) return;
          setBusy(true);
          onError("");
          try {
            const result = await addTopicReply(token, topic.id, draft);
            onReplied(result.topic ?? { ...topic, replyCount: replies.length + 1 }, result.replies);
            setDraft("");
          } catch (err) {
            onError(err instanceof Error ? err.message : "Could not reply");
          } finally {
            setBusy(false);
          }
        }}
      >
        <input
          value={draft}
          maxLength={REPLY_BODY_MAX}
          placeholder="Reply so the group can learn with you…"
          onChange={(e) => setDraft(e.target.value)}
        />
        <button className="ghost compact" disabled={busy || !draft.trim()} type="submit">
          {busy ? "Posting…" : "Reply"}
        </button>
      </form>
    </section>
  );
}

function LibraryList({
  token,
  items,
  activeId,
  onOpen,
  onAdded,
  onError,
}: Readonly<{
  token: string;
  items: LibraryItem[];
  activeId: string | null;
  onOpen: (id: string) => void;
  onAdded: (item: LibraryItem) => void;
  onError: (msg: string) => void;
}>) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [url, setUrl] = useState("");
  const [kind, setKind] = useState<(typeof LIBRARY_KINDS)[number]>("github");
  const [busy, setBusy] = useState(false);
  const official = items.filter((item) => item.source === "official");
  const community = items.filter((item) => item.source !== "official");
  const starter = official[0];

  return (
    <section className="list">
      <div className="library-hero">
        <p className="lede">
          Start a build from the trusted <strong>1stStep</strong> shelf, then share a ChatGPT
          project, repo, or demo so friends can learn with you.
        </p>
        <button
          className="primary"
          type="button"
          disabled={!starter}
          onClick={() => starter && onOpen(starter.id)}
        >
          Start your build
        </button>
      </div>
      <SectionTitle label="1stStep shelf" count={official.length} />
      {official.map((item) => (
        <LibraryCard key={item.id} item={item} active={item.id === activeId} onOpen={() => onOpen(item.id)} />
      ))}
      <form
        className="board-compose"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!title.trim() || !description.trim() || !url.trim()) return;
          setBusy(true);
          onError("");
          try {
            onAdded(await addLibraryItem(token, { title, description, url, kind }));
            setTitle("");
            setDescription("");
            setUrl("");
          } catch (err) {
            onError(err instanceof Error ? err.message : "Could not add to the library");
          } finally {
            setBusy(false);
          }
        }}
      >
        <p className="lede">Share what you are building. Anyone signed in can add a link — https only.</p>
        <input
          value={title}
          maxLength={LIBRARY_TITLE_MAX}
          placeholder="Title"
          onChange={(e) => setTitle(e.target.value)}
        />
        <textarea
          value={description}
          maxLength={LIBRARY_DESCRIPTION_MAX}
          placeholder="Short description"
          rows={2}
          onChange={(e) => setDescription(e.target.value)}
        />
        <input
          value={url}
          placeholder="https://"
          onChange={(e) => setUrl(e.target.value)}
        />
        <label className="status-label">
          Kind
          <select value={kind} onChange={(e) => setKind(e.target.value as (typeof LIBRARY_KINDS)[number])}>
            {LIBRARY_KINDS.map((k) => (
              <option key={k} value={k}>
                {LIBRARY_KIND_LABEL[k]}
              </option>
            ))}
          </select>
        </label>
        <button
          className="ghost compact"
          disabled={busy || !title.trim() || !description.trim() || !url.trim()}
          type="submit"
        >
          {busy ? "Adding…" : "Add to the library"}
        </button>
      </form>
      <SectionTitle label="From the cohort" count={community.length} />
      {community.map((item) => (
        <LibraryCard key={item.id} item={item} active={item.id === activeId} onOpen={() => onOpen(item.id)} />
      ))}
    </section>
  );
}

function LibraryCard({
  item,
  active,
  onOpen,
}: {
  item: LibraryItem;
  active: boolean;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      className={`library-card ${item.source} ${active ? "active" : ""}`}
      onClick={onOpen}
    >
      <span className="name-line">
        <strong>{item.title}</strong>
        {item.source === "official" ? <span className="badge official">1stStep</span> : null}
        <span className="badge">{LIBRARY_KIND_LABEL[item.kind]}</span>
      </span>
      <span className="status">{item.description}</span>
    </button>
  );
}

function LibraryPanel({
  token,
  selfId,
  item,
  onRemoved,
  onError,
}: Readonly<{
  token: string;
  selfId: string;
  item: LibraryItem | null;
  onRemoved: (id: string) => void;
  onError: (msg: string) => void;
}>) {
  const [busy, setBusy] = useState(false);
  if (!item) {
    return (
      <section className="dm empty">
        <p>Open a starter from the 1stStep shelf, or a project a friend shared. Learn together — then ship with friends.</p>
      </section>
    );
  }
  const own = item.authorId === selfId && item.source === "community";
  return (
    <section className="dm">
      <header>
        <span>
          Build library · <strong>{item.title}</strong>
        </span>
        <span className="status">
          {item.source === "official" ? "Trusted 1stStep starter" : item.authorDisplayName} ·{" "}
          {LIBRARY_KIND_LABEL[item.kind]}
        </span>
      </header>
      <div className="thread">
        <article className="board-post">
          <p>{item.description}</p>
        </article>
        <a className="primary library-open" href={item.url} target="_blank" rel="noreferrer">
          Open {item.source === "official" ? "starter" : "link"}
        </a>
        {own ? (
          <button
            className="ghost compact"
            type="button"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              onError("");
              try {
                await deleteLibraryItem(token, item.id);
                onRemoved(item.id);
              } catch (err) {
                onError(err instanceof Error ? err.message : "Could not remove that item");
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? "Removing…" : "Remove my item"}
          </button>
        ) : null}
      </div>
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

function filterLibrary(list: LibraryItem[], query: string) {
  const q = query.trim().toLowerCase();
  if (!q) return list;
  return list.filter(
    (item) =>
      item.title.toLowerCase().includes(q) ||
      item.description.toLowerCase().includes(q) ||
      item.url.toLowerCase().includes(q) ||
      item.authorDisplayName.toLowerCase().includes(q) ||
      item.kind.toLowerCase().includes(q),
  );
}

function filterTopics(list: ForumTopic[], query: string) {
  const q = query.trim().toLowerCase();
  if (!q) return list;
  return list.filter(
    (t) =>
      t.title.toLowerCase().includes(q) ||
      t.body.toLowerCase().includes(q) ||
      t.authorDisplayName.toLowerCase().includes(q) ||
      t.authorUsername.toLowerCase().includes(q),
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

function formatWhen(ts: number) {
  return new Date(ts).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function inviteFromLocation(): string {
  return parseInviteToken(window.location.href);
}

function stripInviteLocation(): void {
  const url = new URL(window.location.href);
  url.searchParams.delete("invite");
  if (url.pathname.startsWith("/invite/")) url.pathname = "/";
  window.history.replaceState({}, "", url.pathname + url.search + url.hash);
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
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
