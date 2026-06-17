import type { WSEvent } from './types';
import { tokenStorage } from './auth';

type EventHandler = (event: WSEvent) => void;

/**
 * Resolve the WS endpoint. A relative value (e.g. "/ws") is turned into an
 * absolute ws(s):// URL against the current page origin — so the app works by
 * IP or domain with no rebuild, and inherits TLS from the page (wss on https).
 * Absolute ws(s):// values are used as-is.
 */
function resolveWsUrl(value: string): string {
  if (/^wss?:\/\//i.test(value)) return value;
  if (typeof window === 'undefined') return value;
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const path = value.startsWith('/') ? value : `/${value}`;
  return `${proto}//${window.location.host}${path}`;
}

class WSClient {
  private ws: WebSocket | null = null;
  private handlers: Map<string, Set<EventHandler>> = new Map();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectDelay = 1000;
  private maxDelay = 30_000;
  private shouldConnect = false;
  private url: string;

  constructor() {
    this.url = resolveWsUrl(import.meta.env.VITE_WS_URL ?? '/ws');
  }

  connect() {
    this.shouldConnect = true;
    this.reconnectDelay = 1000;
    this._open();
  }

  disconnect() {
    this.shouldConnect = false;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.ws) {
      this.ws.onclose = null;
      this.ws.close();
      this.ws = null;
    }
  }

  on(type: string, handler: EventHandler) {
    if (!this.handlers.has(type)) this.handlers.set(type, new Set());
    this.handlers.get(type)!.add(handler);
    return () => this.off(type, handler);
  }

  off(type: string, handler: EventHandler) {
    this.handlers.get(type)?.delete(handler);
  }

  private _open() {
    if (!this.shouldConnect) return;
    const token = tokenStorage.getAccess();
    if (!token) return;

    const urlWithToken = `${this.url}?token=${encodeURIComponent(token)}`;
    const ws = new WebSocket(urlWithToken);
    this.ws = ws;

    ws.onopen = () => {
      console.log('[WS] connected');
      this.reconnectDelay = 1000;
      // Also send token as first message for servers that prefer it
      ws.send(JSON.stringify({ type: 'auth', token }));
    };

    ws.onmessage = (ev) => {
      try {
        const event: WSEvent = JSON.parse(ev.data as string);
        const handlers = this.handlers.get(event.type);
        if (handlers) handlers.forEach((h) => h(event));
        // Also dispatch to wildcard handlers
        const wildcards = this.handlers.get('*');
        if (wildcards) wildcards.forEach((h) => h(event));
      } catch {
        // ignore parse errors
      }
    };

    ws.onclose = () => {
      console.log('[WS] disconnected');
      this._scheduleReconnect();
    };

    ws.onerror = () => {
      ws.close();
    };
  }

  private _scheduleReconnect() {
    if (!this.shouldConnect) return;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectDelay = Math.min(this.reconnectDelay * 1.5, this.maxDelay);
      this._open();
    }, this.reconnectDelay);
  }
}

export const wsClient = new WSClient();
