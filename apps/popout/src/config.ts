function trimSlash(value: string): string {
  return value.replace(/\/$/, "");
}

/** Empty string = same origin (Vite dev proxy or a same-host preview). */
export function apiBase(): string {
  const raw = import.meta.env.VITE_CODEFRIENDS_API_URL;
  return raw ? trimSlash(raw) : "";
}

export function apiUrl(path: string): string {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  return `${apiBase()}${normalized}`;
}

export function wsUrl(token: string): string {
  const explicit = import.meta.env.VITE_CODEFRIENDS_WS_URL;
  if (explicit) {
    const base = trimSlash(explicit);
    const joiner = base.includes("?") ? "&" : "?";
    return `${base}${joiner}token=${encodeURIComponent(token)}`;
  }
  const api = import.meta.env.VITE_CODEFRIENDS_API_URL;
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
