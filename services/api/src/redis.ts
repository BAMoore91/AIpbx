import { Redis } from 'ioredis';
import { logger } from './logger.js';

/**
 * Two ioredis connections: one for commands (and publishing), one dedicated to
 * subscriptions (a connection in subscribe mode cannot issue normal commands).
 *
 * Channels are namespaced per tenant: `tenant:<tenantId>:events`. The WS hub
 * subscribes with a psubscribe pattern and fans messages out to clients.
 */

export const TENANT_CHANNEL_PREFIX = 'tenant:';
export const TENANT_CHANNEL_PATTERN = 'tenant:*:events';

export function tenantChannel(tenantId: string): string {
  return `${TENANT_CHANNEL_PREFIX}${tenantId}:events`;
}

export interface RealtimeEvent {
  type: string;
  tenantId: string;
  data: Record<string, unknown>;
  ts: number;
}

let client: Redis | null = null;
let subscriber: Redis | null = null;

export function initRedis(url: string): { client: Redis; subscriber: Redis } {
  if (client && subscriber) return { client, subscriber };
  const opts = { lazyConnect: false, maxRetriesPerRequest: 3 };
  client = new Redis(url, opts);
  subscriber = new Redis(url, opts);
  client.on('error', (err) => logger.error({ err }, 'redis client error'));
  subscriber.on('error', (err) => logger.error({ err }, 'redis subscriber error'));
  return { client, subscriber };
}

export function getRedis(): Redis {
  if (!client) throw new Error('Redis not initialized — call initRedis() first');
  return client;
}

export function getSubscriber(): Redis {
  if (!subscriber) throw new Error('Redis subscriber not initialized');
  return subscriber;
}

/** Publish a tenant-scoped realtime event to Redis (fans out to all API nodes). */
export async function publishEvent(
  type: string,
  tenantId: string,
  data: Record<string, unknown>,
): Promise<void> {
  const event: RealtimeEvent = { type, tenantId, data, ts: Date.now() };
  await getRedis().publish(tenantChannel(tenantId), JSON.stringify(event));
}

// ---- Presence helpers (extension/agent state) ----------------------------

const presenceKey = (tenantId: string) => `presence:${tenantId}`;

export async function setPresence(
  tenantId: string,
  sipUsername: string,
  state: string,
): Promise<void> {
  await getRedis().hset(presenceKey(tenantId), sipUsername, state);
  await publishEvent('presence.changed', tenantId, { sipUsername, state });
}

export async function getPresence(
  tenantId: string,
): Promise<Record<string, string>> {
  return getRedis().hgetall(presenceKey(tenantId));
}

export async function closeRedis(): Promise<void> {
  await Promise.allSettled([client?.quit(), subscriber?.quit()]);
  client = null;
  subscriber = null;
}
