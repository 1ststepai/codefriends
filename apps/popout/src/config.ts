function trimSlash(value: string): string {
  return value.replace(/\/$/, "");
}

function injected(key: "__CODEFRIENDS_API_URL__" | "__CODEFRIENDS_WS_URL__"): string {
  if (typeof window === "undefined") return "";
  const value = window[key];
  return typeof value === "string" ? value.trim() : "";
}

/** Empty string = same origin (Vite dev proxy or a same-host preview). */
export function apiBase(): string {
  const raw = import.meta.env.VITE_CODEFRIENDS_API_URL || injected("__CODEFRIENDS_API_URL__");
  return raw ? trimSlash(raw) : "";
}

export function apiUrl(path: string): string {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  return `${apiBase()}${normalized}`;
}

export function wsUrl(token: string): string {
  const explicit = import.meta.env.VITE_CODEFRIENDS_WS_URL || injected("__CODEFRIENDS_WS_URL__");
  if (explicit) {
    const base = trimSlash(explicit);
    const joiner = base.includes("?") ? "&" : "?";
    return `${base}${joiner}token=${encodeURIComponent(token)}`;
  }
  const api = apiBase();
  if (api) {
    const url = new URL(trimSlash(api));
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    const prefix = url.pathname.replace(/\/$/, "");
    url.pathname = `${prefix}/ws`;
    url.search = `token=${encodeURIComponent(token)}`;
    return url.toString();
  }
  const proto = location.protocol === "https:" ? "wss" : "ws";
  return `${proto}://${location.host}/ws?token=${encodeURIComponent(token)}`;
}
