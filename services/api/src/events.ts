import { publishEvent } from './redis.js';
import type { WebhookDispatcher } from './services/webhooks.js';
import { logger } from './logger.js';

/**
 * Central event emitter. A single call both:
 *   1. publishes to Redis (→ WS hub fans out to connected clients, all nodes)
 *   2. dispatches to tenant webhooks (HMAC-signed)
 *
 * Known event types: call.started, call.updated, call.ended, presence.changed,
 * queue.stats, voicemail.new, recording.ready.
 */
export class EventBus {
  constructor(private readonly webhooks: WebhookDispatcher) {}

  async emit(
    tenantId: string,
    type: string,
    data: Record<string, unknown>,
  ): Promise<void> {
    await Promise.allSettled([
      publishEvent(type, tenantId, data),
      this.webhooks.dispatch(tenantId, type, data),
    ]).then((results) => {
      for (const r of results) {
        if (r.status === 'rejected') logger.warn({ err: r.reason, type }, 'emit partial failure');
      }
    });
  }
}
