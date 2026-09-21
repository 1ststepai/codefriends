import type { PublicUser } from "@codefriends/shared";

const KEY = "codefriends.session";

export interface StoredSession {
  token: string;
  user: PublicUser;
}

export function loadSession(): StoredSession | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as StoredSession) : null;
  } catch {
    return null;
  }
}

export function saveSession(session: StoredSession): void {
  localStorage.setItem(KEY, JSON.stringify(session));
}

export function clearSession(): void {
  localStorage.removeItem(KEY);
}

const INVITE_KEY = "codefriends.invite";

export function loadPendingInvite(): string {
  try {
    return sessionStorage.getItem(INVITE_KEY) ?? "";
  } catch {
    return "";
  }
}

export function savePendingInvite(token: string): void {
  try {
    sessionStorage.setItem(INVITE_KEY, token);
  } catch {
    /* private mode */
  }
}

export function clearPendingInvite(): void {
  try {
    sessionStorage.removeItem(INVITE_KEY);
  } catch {
    /* ignore */
  }
}
