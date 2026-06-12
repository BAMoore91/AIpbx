import { createHmac } from 'node:crypto';
import { query } from '../db.js';
import { logger } from '../logger.js';
import type { WebhookRow } from '../types/db.js';

/**
 * Dispatches tenant events to configured webhook endpoints with an
 * HMAC-SHA256 signature so receivers can verify authenticity.
 *
 * Header: `X-AIpbx-Signature: sha256=<hex>` over the raw JSON body.
 * Delivery is best-effort fire-and-forget with a short timeout.
 */
export class WebhookDispatcher {
  /** Send an event to every active webhook in the tenant subscribed to it. */
  async dispatch(
    tenantId: string,
    event: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    let hooks: WebhookRow[];
    try {
      const res = await query<WebhookRow>(
        `SELECT * FROM webhooks
         WHERE tenant_id = $1 AND is_active = true AND ($2 = ANY(events) OR '*' = ANY(events))`,
        [tenantId, event],
      );
      hooks = res.rows;
    } catch (err) {
      logger.warn({ err, event }, 'failed to load webhooks');
      return;
    }

    const body = JSON.stringify({ event, tenantId, ts: Date.now(), data: payload });
    await Promise.allSettled(
      hooks.map((hook) => this.deliver(hook, event, body)),
    );
  }

  private async deliver(hook: WebhookRow, event: string, body: string): Promise<void> {
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      'x-aipbx-event': event,
    };
    if (hook.secret) {
      const sig = createHmac('sha256', hook.secret).update(body).digest('hex');
      headers['x-aipbx-signature'] = `sha256=${sig}`;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    try {
      const res = await fetch(hook.url, {
        method: 'POST',
        headers,
        body,
        signal: controller.signal,
      });
      if (!res.ok) {
        logger.warn({ url: hook.url, status: res.status }, 'webhook non-2xx');
      }
    } catch (err) {
      logger.warn({ err, url: hook.url }, 'webhook delivery failed');
    } finally {
      clearTimeout(timer);
    }
  }
}
