import type { WsServerMessage } from "@codefriends/shared";

export interface PresenceSocket {
  send(payload: WsServerMessage): void;
  readonly ready: boolean;
}

export interface Presence {
  attach(userId: string, socket: PresenceSocket): void;
  /** Returns true when that user has no remaining sockets. */
  detach(userId: string, socket: PresenceSocket): boolean;
  socketsOf(userId: string): PresenceSocket[];
  isConnected(userId: string): boolean;
  connectedIds(): string[];
}

export class MemoryPresence implements Presence {
  private readonly sockets = new Map<string, Set<PresenceSocket>>();

  attach(userId: string, socket: PresenceSocket): void {
    const set = this.sockets.get(userId) ?? new Set();
    set.add(socket);
    this.sockets.set(userId, set);
  }

  detach(userId: string, socket: PresenceSocket): boolean {
    const set = this.sockets.get(userId);
    if (!set) return false;
    set.delete(socket);
    if (set.size === 0) {
      this.sockets.delete(userId);
      return true;
    }
    return false;
  }

  socketsOf(userId: string): PresenceSocket[] {
    return [...(this.sockets.get(userId) ?? [])];
  }

  isConnected(userId: string): boolean {
    return (this.sockets.get(userId)?.size ?? 0) > 0;
  }

  connectedIds(): string[] {
    return [...this.sockets.keys()];
  }
}

/** HTTP isolates that do not hold sockets (Cloudflare Worker front door). */
export class SnapshotPresence implements Presence {
  constructor(private readonly ids: ReadonlySet<string>) {}

  attach(): void {
    /* sockets live in the Durable Object */
  }

  detach(): boolean {
    return false;
  }

  socketsOf(): PresenceSocket[] {
    return [];
  }

  isConnected(userId: string): boolean {
    return this.ids.has(userId);
  }

  connectedIds(): string[] {
    return [...this.ids];
  }
}

export function wrapJsonSocket(sendRaw: (data: string) => void, isOpen: () => boolean): PresenceSocket {
  return {
    send(payload) {
      if (!isOpen()) return;
      sendRaw(JSON.stringify(payload));
    },
    get ready() {
      return isOpen();
    },
  };
}
