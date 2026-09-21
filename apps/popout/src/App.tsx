import { useEffect, useMemo, useRef, useState } from "react";
import type {
  ChatMessage,
  ClientKind,
  ForumReply,
  ForumTopic,
  HelpPacket,
  LibraryItem,
  PresenceStatus,
  PublicUser,
  WsServerMessage,
} from "@codefriends/shared";
import {
  CLIENTS,
  CLIENT_LABEL,
  formatHelpPacket,
  HELP_PACKET_FIELD_MAX,
  HELP_PACKET_LIBRARY_URL,
  HELP_PACKET_TITLE_MAX,
  helpPacketFilename,
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
  createHelpPacket,
  createInvite,
  createTopic,
  deleteLibraryItem,
  fetchProviders,
  getHelpPacket,
  getTopic,
  listHelpPackets,
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
  const [view, setView] = useState<"friends" | "board" | "library" | "profile">("friends");
  const [topics, setTopics] = useState<ForumTopic[]>([]);
  const [openTopicId, setOpenTopicId] = useState<string | null>(null);
  const [openTopic, setOpenTopic] = useState<ForumTopic | null>(null);
  const [replies, setReplies] = useState<ForumReply[]>([]);
  const [libraryItems, setLibraryItems] = useState<LibraryItem[]>([]);
  const [openLibraryId, setOpenLibraryId] = useState<string | null>(null);
  const [helpPackets, setHelpPackets] = useState<HelpPacket[]>([]);
  const [helpOpen, setHelpOpen] = useState(false);
  const [openPacket, setOpenPacket] = useState<HelpPacket | null>(null);
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
    listHelpPackets(token)
      .then((packets) => {
        if (!cancelled) setHelpPackets(packets);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Could not load help packets");
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

  useEffect(() => {
    const onDesktop = (ev: Event) => {
      const detail = (ev as CustomEvent<{ status?: PresenceStatus; dm?: string }>).detail;
      if (!detail) return;
      if (detail.status === "available" || detail.status === "away" || detail.status === "offline") {
        send({ type: "presence", status: detail.status });
      }
      if (typeof detail.dm === "string" && detail.dm) {
        setActiveId(detail.dm);
        setView("friends");
      }
    };
    window.addEventListener("codefriends:desktop", onDesktop);
    return () => window.removeEventListener("codefriends:desktop", onDesktop);
  }, [token]);

  const agents = friends.filter((f) => f.online && AGENT_CLIENTS.has(f.client));
  const people = friends.filter((f) => !(f.online && AGENT_CLIENTS.has(f.client)));
  const filteredAgents = filterPeople(agents, query);
  const filteredPeople = filterPeople(people, query);
  const filteredTopics = filterTopics(topics, query);
  const filteredLibrary = filterLibrary(libraryItems, query);
  const filteredPackets = filterHelpPackets(helpPackets, query);
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
    <div className={`shell view-${view}`}>
      <header className="top">
        <h1>CodeFriends</h1>
        <button
          className="ghost quiet"
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
          aria-label="School board"
          onClick={() => setView("board")}
        >
          Board
        </button>
        <button
          type="button"
          className={view === "library" ? "active" : ""}
          onClick={() => setView("library")}
        >
          Library
        </button>
        <button
          type="button"
          className={view === "profile" ? "active" : ""}
          onClick={() => setView("profile")}
        >
          Profile
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
            if ((view === "friends" || view === "profile") && e.key === "Enter" && query.trim()) {
              send({ type: "add_friend", username: query.trim() });
            }
          }}
        />
      </label>

      {view === "friends" || view === "profile" ? (
        <section className="list">
          {filteredAgents.length ? (
            <>
              <SectionTitle label="Agents online" count={filteredAgents.length} />
              {filteredAgents.map((friend) => (
                <FriendRow
                  key={friend.id}
                  friend={friend}
                  active={friend.id === activeId}
                  showClient
                  onClick={() => {
                    setActiveId(friend.id);
                    setView("friends");
                  }}
                />
              ))}
            </>
          ) : null}
          {filteredPeople.map((friend) => (
            <FriendRow
              key={friend.id}
              friend={friend}
              active={friend.id === activeId}
              onClick={() => {
                setActiveId(friend.id);
                setView("friends");
              }}
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
      ) : view === "library" ? (
        <LibraryList
          token={token}
          items={filteredLibrary}
          packets={filteredPackets}
          activeId={openLibraryId}
          activePacketId={openPacket?.id ?? null}
          helpOpen={helpOpen}
          onError={setError}
          onAdded={(item) => {
            setLibraryItems((cur) => {
              const next = [item, ...cur.filter((row) => row.id !== item.id)];
              const official = next.filter((row) => row.source === "official");
              const community = next.filter((row) => row.source !== "official");
              return [...official, ...community];
            });
            setOpenLibraryId(item.id);
            setHelpOpen(false);
            setOpenPacket(null);
          }}
          onOpen={(id) => {
            const item = libraryItems.find((row) => row.id === id);
            setOpenLibraryId(id);
            if (item?.url === HELP_PACKET_LIBRARY_URL) {
              setHelpOpen(true);
              setOpenPacket(null);
            } else {
              setHelpOpen(false);
              setOpenPacket(null);
            }
          }}
          onWritePacket={() => {
            const shelf = libraryItems.find((row) => row.url === HELP_PACKET_LIBRARY_URL);
            setOpenLibraryId(shelf?.id ?? null);
            setHelpOpen(true);
            setOpenPacket(null);
          }}
          onOpenPacket={async (id) => {
            try {
              const packet = await getHelpPacket(token, id);
              setOpenPacket(packet);
              setHelpOpen(true);
              setOpenLibraryId(null);
              setError("");
            } catch (err) {
              setError(err instanceof Error ? err.message : "Could not open that packet");
            }
          }}
        />
      ) : null}

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
      ) : view === "library" && helpOpen ? (
        <HelpPacketPanel
          token={token}
          packet={openPacket}
          onError={setError}
          onSaved={(packet) => {
            setHelpPackets((cur) => [packet, ...cur.filter((row) => row.id !== packet.id)]);
            setOpenPacket(packet);
          }}
          onWriteAnother={() => {
            setOpenPacket(null);
            const shelf = libraryItems.find((row) => row.url === HELP_PACKET_LIBRARY_URL);
            setOpenLibraryId(shelf?.id ?? null);
          }}
        />
      ) : view === "library" ? (
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
      ) : (
        <section className="dm profile-pane">
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
        </section>
      )}

      {error ? (
        <p className="banner">
          <span>{error}</span>
          <button type="button" className="ghost quiet" onClick={() => setError("")}>
            Dismiss
          </button>
        </p>
      ) : null}
      <footer className="fineprint">Not affiliated with Cursor, Anthropic, OpenAI, or Google.</footer>
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
  const google = providers.find((p) => p.id === "gemini");
  const later = providers.filter((p) => p.id !== "gemini" && p.id !== "dev");
  const productProviders = providers.filter((p) => p.id !== "dev");
  const dev = providers.find((p) => p.id === "dev");
  const showDev = dev?.availability === "dev";
  const googleLive = google?.availability === "live" && Boolean(google.startPath);
  const openedHost = hostOpenedFrom(hinted);
  const highlighted = productProviders.find((p) => p.id === hinted);
  const googleHref =
    googleLive && google.startPath
      ? oauthStartHref(google.startPath, { client: clientHint() ?? "web" })
      : undefined;

  return (
    <div className="shell login">
      <div className="kicker">Learn together</div>
      <h1>An AI coding school with your friends in the room</h1>
      <p className="lede">
        Learn with friends in Cursor, Claude, Codex, or Gemini. Sign in with Google to join —
        presence, DMs, a school board, and a build library.
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
          “login with Ollama” or any host SSO. Continue with Google to join.
        </p>
      ) : highlighted && highlighted.id !== "gemini" ? (
        <p className="lede highlight">
          Opened from {openedHost ?? highlighted.label}.{" "}
          {highlighted.blockedReason ?? "This provider’s official login is not publicly available yet."}
          {googleLive ? " Continue with Google to get in — keep using that tool as usual." : ""}
        </p>
      ) : googleLive ? (
        <p className="lede highlight">
          {openedHost ? `Opened from ${openedHost}. ` : ""}
          Continue with your Google account
          {hinted === "gemini" ? ". That is CodeFriends sign-in, not Gemini CLI login." : "."}
        </p>
      ) : google?.availability === "unconfigured" ? (
        <p className="lede highlight">
          {google.nextStep ??
            "Sign in with Google once GEMINI_GOOGLE_* env is set. That is CodeFriends identity, not Gemini CLI login."}
        </p>
      ) : null}
      {googleHref ? (
        <a className="primary google-signin" href={googleHref}>
          Continue with Google
        </a>
      ) : (
        <button type="button" className="primary google-signin" disabled>
          Continue with Google
          <span className="provider-state">{google ? availabilityLabel(google) : "loading"}</span>
        </button>
      )}
      {later.length ? (
        <details className="coming-later">
          <summary>Coming later</summary>
          <ul>
            {later.map((provider) => (
              <li key={provider.id}>
                <strong>{provider.label}</strong>
                <p>
                  {provider.blockedReason ??
                    (provider.availability === "mock"
                      ? "Mock identity only — there is no public third-party login API yet."
                      : "Not available yet")}
                </p>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
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
            <strong>Local demo</strong> — username only, no password. Seed roster includes maya and
            parker. Not used in production.
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
      {error ? (
        <p className="banner">
          <span>{error}</span>
          <button type="button" className="ghost quiet" onClick={() => onError("")}>
            Dismiss
          </button>
        </p>
      ) : null}
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

  const urlField = (field: (typeof PROFILE_URL_FIELDS)[number]) => (
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
  );

  return (
    <div className="profile-edit">
      {PROFILE_URL_FIELDS.slice(0, 2).map(urlField)}
      <details className="fold nested">
        <summary>Optional socials</summary>
        {PROFILE_URL_FIELDS.slice(2).map(urlField)}
      </details>
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
            {providers.find((p) => p.id === id.provider)?.label ?? id.provider}
          </span>
        ))}
      </span>
      {linkable.map((provider) => {
        if (linked.has(provider.id)) return null;
        if (provider.availability === "live" && provider.startPath) {
          const href = oauthStartHref(provider.startPath, {
            link: "1",
            token,
            client: self.client,
          });
          if (!href) return null;
          return (
            <a key={provider.id} className="link-account" href={href}>
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
        <p>Say hi — keep it short.</p>
      </section>
    );
  }

  return (
    <section className="dm">
      <header>
        <span className="name-line">
          <strong>{friend.displayName}</strong>
          {friend.online ? <ClientBadge client={friend.client} /> : null}
        </span>
        <span className="status">{friend.statusText || (friend.online ? "Available" : "Offline")}</span>
        <ProfileBits user={friend} links />
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
      <details className="fold panel">
        <summary>Start a thread</summary>
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
          <p className="lede">Ask a question or share what you are learning. Anyone signed in can read and reply.</p>
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
      </details>
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
        <p>Open a thread. Shared notes for the cohort — not a 1:1 message.</p>
      </section>
    );
  }

  return (
    <section className="dm">
      <header>
        <strong>{topic.title}</strong>
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
  packets,
  activeId,
  activePacketId,
  helpOpen,
  onOpen,
  onAdded,
  onError,
  onWritePacket,
  onOpenPacket,
}: Readonly<{
  token: string;
  items: LibraryItem[];
  packets: HelpPacket[];
  activeId: string | null;
  activePacketId: string | null;
  helpOpen: boolean;
  onOpen: (id: string) => void;
  onAdded: (item: LibraryItem) => void;
  onError: (msg: string) => void;
  onWritePacket: () => void;
  onOpenPacket: (id: string) => void;
}>) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [url, setUrl] = useState("");
  const [kind, setKind] = useState<(typeof LIBRARY_KINDS)[number]>("github");
  const [busy, setBusy] = useState(false);
  const official = items.filter((item) => item.source === "official");
  const community = items.filter((item) => item.source !== "official");
  const starter = official.find((item) => item.url !== HELP_PACKET_LIBRARY_URL) ?? official[0];

  return (
    <section className="list">
      <div className="library-hero">
        <p className="lede">1stStep starters, cohort shares, and help packets for a friend’s AI chat.</p>
        <div className="library-hero-actions">
          <button
            className="primary"
            type="button"
            disabled={!starter}
            onClick={() => starter && onOpen(starter.id)}
          >
            Start your build
          </button>
          <button className="ghost compact" type="button" onClick={onWritePacket}>
            Write a help packet
          </button>
        </div>
      </div>
      <details className="fold panel">
        <summary>Share a project</summary>
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
      </details>
      <SectionTitle label="1stStep shelf" count={official.length} />
      {official.map((item) => (
        <LibraryCard
          key={item.id}
          item={item}
          active={item.id === activeId && (item.url !== HELP_PACKET_LIBRARY_URL || (helpOpen && !activePacketId))}
          onOpen={() => onOpen(item.id)}
        />
      ))}
      {packets.length ? (
        <>
          <SectionTitle label="Your help packets" count={packets.length} />
          {packets.map((packet) => (
            <button
              key={packet.id}
              type="button"
              className={`library-card ${packet.id === activePacketId ? "active" : ""}`}
              onClick={() => onOpenPacket(packet.id)}
            >
              <span className="name-line">
                <strong>{packet.title}</strong>
                <span className="badge">Packet</span>
              </span>
            </button>
          ))}
        </>
      ) : null}
      {community.length ? (
        <>
          <SectionTitle label="From the cohort" count={community.length} />
          {community.map((item) => (
            <LibraryCard key={item.id} item={item} active={item.id === activeId} onOpen={() => onOpen(item.id)} />
          ))}
        </>
      ) : null}
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
        {item.source === "official" ? (
          <span className="badge official">1stStep</span>
        ) : (
          <span className="badge">{LIBRARY_KIND_LABEL[item.kind]}</span>
        )}
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
        <p>Open a starter from the 1stStep shelf, write a help packet, or open a project a friend shared.</p>
      </section>
    );
  }
  const own = item.authorId === selfId && item.source === "community";
  return (
    <section className="dm">
      <header>
        <strong>{item.title}</strong>
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

const EMPTY_PACKET_FIELDS = {
  title: "",
  goal: "",
  repoUrl: "",
  branch: "",
  paths: "",
  constraints: "",
  blocked: "",
  successCriteria: "",
  sendBack: "",
  libraryItemUrl: "",
};

function HelpPacketPanel({
  token,
  packet,
  onSaved,
  onError,
  onWriteAnother,
}: Readonly<{
  token: string;
  packet: HelpPacket | null;
  onSaved: (packet: HelpPacket) => void;
  onError: (msg: string) => void;
  onWriteAnother: () => void;
}>) {
  const [fields, setFields] = useState(EMPTY_PACKET_FIELDS);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setFields(EMPTY_PACKET_FIELDS);
    setCopied(false);
  }, [packet?.id]);

  const markdown = packet?.markdown ?? formatHelpPacket(fields);
  const title = packet?.title || fields.title;
  const canSave = !packet && Boolean(fields.title.trim() && fields.goal.trim());

  const setField = (key: keyof typeof EMPTY_PACKET_FIELDS, value: string) => {
    setFields((cur) => ({ ...cur, [key]: value }));
    setCopied(false);
  };

  const copyMarkdown = async () => {
    try {
      await navigator.clipboard.writeText(markdown);
      setCopied(true);
      onError("");
    } catch {
      onError("Could not copy — select the preview and copy it yourself");
    }
  };

  const downloadMarkdown = () => {
    const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" });
    const href = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = href;
    a.download = helpPacketFilename(title);
    a.click();
    URL.revokeObjectURL(href);
  };

  return (
    <section className="dm">
      <header>
        <strong>Help packet</strong>
        <span className="status">They run this on their own AI usage.</span>
      </header>
      <div className="thread">
        <details className="fold nested packet-consent">
          <summary>How sharing works</summary>
          <p className="lede">
            Write this only if you want a friend to help. They accept voluntarily and finish on{" "}
            <strong>their</strong> Cursor / Claude / Codex / Gemini usage — we never claim to
            stretch vendor quotas. Only the notes you type (no chat-history scrape). Copy or
            download the markdown; nothing is posted to socials.
          </p>
        </details>
        {packet ? (
          <div className="packet-actions">
            <button className="ghost compact" type="button" onClick={onWriteAnother}>
              Write another
            </button>
          </div>
        ) : (
          <form
            className="packet-form"
            onSubmit={async (e) => {
              e.preventDefault();
              if (!canSave) return;
              setBusy(true);
              onError("");
              try {
                onSaved(await createHelpPacket(token, fields));
              } catch (err) {
                onError(err instanceof Error ? err.message : "Could not save help packet");
              } finally {
                setBusy(false);
              }
            }}
          >
            <input
              value={fields.title}
              maxLength={HELP_PACKET_TITLE_MAX}
              placeholder="Title"
              onChange={(e) => setField("title", e.target.value)}
            />
            <textarea
              value={fields.goal}
              maxLength={HELP_PACKET_FIELD_MAX}
              placeholder="1. Goal — what done looks like"
              rows={3}
              onChange={(e) => setField("goal", e.target.value)}
            />
            <details className="fold nested">
              <summary>Repo, constraints, and send-back</summary>
              <input
                value={fields.repoUrl}
                maxLength={HELP_PACKET_FIELD_MAX}
                placeholder="2. Repo URL"
                onChange={(e) => setField("repoUrl", e.target.value)}
              />
              <input
                value={fields.branch}
                maxLength={HELP_PACKET_FIELD_MAX}
                placeholder="Branch"
                onChange={(e) => setField("branch", e.target.value)}
              />
              <input
                value={fields.paths}
                maxLength={HELP_PACKET_FIELD_MAX}
                placeholder="Relevant paths"
                onChange={(e) => setField("paths", e.target.value)}
              />
              <textarea
                value={fields.constraints}
                maxLength={HELP_PACKET_FIELD_MAX}
                placeholder="3. Constraints — don't touch X, stack notes"
                rows={2}
                onChange={(e) => setField("constraints", e.target.value)}
              />
              <textarea
                value={fields.blocked}
                maxLength={HELP_PACKET_FIELD_MAX}
                placeholder="4. What's blocked / tried"
                rows={2}
                onChange={(e) => setField("blocked", e.target.value)}
              />
              <textarea
                value={fields.successCriteria}
                maxLength={HELP_PACKET_FIELD_MAX}
                placeholder="5. Success criteria"
                rows={2}
                onChange={(e) => setField("successCriteria", e.target.value)}
              />
              <textarea
                value={fields.sendBack}
                maxLength={HELP_PACKET_FIELD_MAX}
                placeholder="6. How to send back (PR link preferred)"
                rows={2}
                onChange={(e) => setField("sendBack", e.target.value)}
              />
              <input
                value={fields.libraryItemUrl}
                maxLength={HELP_PACKET_FIELD_MAX}
                placeholder="7. Optional CodeFriends library item (https://)"
                onChange={(e) => setField("libraryItemUrl", e.target.value)}
              />
            </details>
            <button className="ghost compact" disabled={busy || !canSave} type="submit">
              {busy ? "Saving…" : "Save draft"}
            </button>
          </form>
        )}
        <details className="fold nested">
          <summary>Markdown preview</summary>
          <pre className="packet-preview">{markdown}</pre>
        </details>
        <div className="packet-actions">
          <button className="primary" type="button" onClick={() => void copyMarkdown()}>
            {copied ? "Copied" : "Copy markdown"}
          </button>
          <button className="ghost compact" type="button" onClick={downloadMarkdown}>
            Download .md
          </button>
        </div>
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

function filterHelpPackets(list: HelpPacket[], query: string) {
  const q = query.trim().toLowerCase();
  if (!q) return list;
  return list.filter(
    (packet) => packet.title.toLowerCase().includes(q) || packet.markdown.toLowerCase().includes(q),
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

function hostOpenedFrom(hinted: string | undefined): string | undefined {
  if (!hinted || hinted === "dev") return undefined;
  if (hinted === "generic") return "a local editor";
  return hinted in CLIENT_LABEL ? CLIENT_LABEL[hinted as ClientKind] : hinted;
}

function oauthStartHref(startPath: string, params: Record<string, string>): string | undefined {
  if (!/^\/api\/auth\/[a-z0-9-]+\/start$/.test(startPath)) return;
  const url = new URL(apiUrl(startPath), window.location.origin);
  for (const [key, value] of Object.entries(params)) {
    if (value) url.searchParams.set(key, value);
  }
  return url.toString();
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
