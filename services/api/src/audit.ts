import { query } from './db.js';
import { logger } from './logger.js';
import type { AuthContext } from './types/http.js';

export interface AuditEntry {
  action: string;
  entity?: string;
  entityId?: string;
  metadata?: Record<string, unknown>;
  ip?: string | null;
}

/**
 * Record a mutating action in audit_logs. Failures are logged but never block
 * the request — auditing must not take down the API.
 */
export async function audit(
  auth: AuthContext | undefined,
  entry: AuditEntry,
): Promise<void> {
  try {
    await query(
      `INSERT INTO audit_logs (tenant_id, user_id, action, entity, entity_id, metadata, ip)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        auth?.tenantId ?? null,
        auth?.userId ?? null,
        entry.action,
        entry.entity ?? null,
        entry.entityId ?? null,
        JSON.stringify(entry.metadata ?? {}),
        entry.ip ?? null,
      ],
    );
  } catch (err) {
    logger.warn({ err, action: entry.action }, 'audit write failed');
  }
}
