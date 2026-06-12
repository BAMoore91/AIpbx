import type { IncomingMessage, Server as HttpServer } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocketServer, WebSocket } from 'ws';
import { logger } from '../logger.js';
import { JwtService } from '../auth/jwt.js';
import {
  getSubscriber,
  TENANT_CHANNEL_PATTERN,
  type RealtimeEvent,
} from '../redis.js';

interface ClientMeta {
  tenantId: string;
  userId: string;
  /** Optional event-type filter the client subscribed to. Empty = all. */
  topics: Set<string>;
}

/**
 * Authenticated WebSocket hub. Clients connect to `/ws?token=<accessJWT>`.
 * Each client is bound to its tenant; the hub subscribes to a Redis pattern
 * and fans tenant-scoped events out to matching sockets.
 *
 * Outbound frames: { type, tenantId, data, ts }.
 * Inbound (client→server) control: { action: 'subscribe'|'unsubscribe'|'ping',
 *   topics?: string[] }.
 */
export class WsHub {
  private readonly wss: WebSocketServer;
  private readonly clients = new Map<WebSocket, ClientMeta>();

  constructor(private readonly jwt: JwtService) {
    this.wss = new WebSocketServer({ noServer: true });
    this.wss.on('connection', (ws, meta: ClientMeta) => this.onConnection(ws, meta));
  }

  /** Attach to the shared HTTP server's upgrade event for path `/ws`. */
  attach(server: HttpServer): void {
    server.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
      let url: URL;
      try {
        url = new URL(req.url ?? '', 'http://localhost');
      } catch {
        socket.destroy();
        return;
      }
      if (url.pathname !== '/ws') return; // let other handlers deal with it

      const token =
        url.searchParams.get('token') ??
        req.headers.authorization?.replace('Bearer ', '');
      if (!token) {
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
        socket.destroy();
        return;
      }
      try {
        const claims = this.jwt.verifyAccess(token);
        const meta: ClientMeta = {
          tenantId: claims.tid,
          userId: claims.sub,
          topics: new Set(),
        };
        this.wss.handleUpgrade(req, socket, head, (ws) => {
          this.wss.emit('connection', ws, meta);
        });
      } catch {
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
        socket.destroy();
      }
    });
  }

  /** Subscribe to Redis once; fans events to connected clients of that tenant. */
  startRedisBridge(): void {
    const sub = getSubscriber();
    sub.psubscribe(TENANT_CHANNEL_PATTERN).catch((err: unknown) => {
      logger.error({ err }, 'failed to psubscribe to tenant events');
    });
    sub.on('pmessage', (_pattern: string, _channel: string, message: string) => {
      let event: RealtimeEvent;
      try {
        event = JSON.parse(message);
      } catch {
        return;
      }
      this.broadcast(event);
    });
  }

  private onConnection(ws: WebSocket, meta: ClientMeta): void {
    this.clients.set(ws, meta);
    logger.debug({ tenantId: meta.tenantId, userId: meta.userId }, 'ws connected');
    ws.send(JSON.stringify({ type: 'connected', tenantId: meta.tenantId, ts: Date.now() }));

    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        if (msg.action === 'subscribe' && Array.isArray(msg.topics)) {
          for (const t of msg.topics) meta.topics.add(String(t));
        } else if (msg.action === 'unsubscribe' && Array.isArray(msg.topics)) {
          for (const t of msg.topics) meta.topics.delete(String(t));
        } else if (msg.action === 'ping') {
          ws.send(JSON.stringify({ type: 'pong', ts: Date.now() }));
        }
      } catch {
        /* ignore malformed client frames */
      }
    });

    ws.on('close', () => this.clients.delete(ws));
    ws.on('error', () => this.clients.delete(ws));
  }

  /** Deliver an event to all sockets in its tenant that want its type. */
  private broadcast(event: RealtimeEvent): void {
    const frame = JSON.stringify(event);
    for (const [ws, meta] of this.clients) {
      if (meta.tenantId !== event.tenantId) continue;
      if (meta.topics.size > 0 && !meta.topics.has(event.type)) continue;
      if (ws.readyState === WebSocket.OPEN) ws.send(frame);
    }
  }

  /** Direct local push (used by in-process emitters in addition to Redis). */
  pushLocal(event: RealtimeEvent): void {
    this.broadcast(event);
  }

  close(): void {
    for (const ws of this.clients.keys()) ws.close();
    this.clients.clear();
    this.wss.close();
  }
}
