import { query } from '../db.js';
import { logger } from '../logger.js';
import type { S3Service } from './s3.js';

/**
 * Data-retention sweeper. On a daily interval, purges call history, recordings,
 * transcripts, voicemails, messages, and audit logs older than the retention
 * window — 90 days by default, overridable per tenant via
 * `tenants.settings.retention_days`. S3 objects are deleted before their DB rows
 * so nothing is orphaned in object storage.
 */

const BATCH = 500;

/** Resolve a tenant's effective retention window (days). */
export function retentionDaysFor(
  settings: Record<string, unknown> | null | undefined,
  fallback: number,
): number {
  const v = settings?.retention_days;
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : fallback;
}

interface TenantRow {
  id: string;
  settings: Record<string, unknown> | null;
}

export class RetentionSweeper {
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly s3: S3Service,
    private readonly opts: { enabled: boolean; days: number; intervalHours: number },
  ) {}

  start(): void {
    if (!this.opts.enabled) {
      logger.info('retention sweep disabled');
      return;
    }
    const intervalMs = this.opts.intervalHours * 3600 * 1000;
    // First run shortly after boot, then on the configured interval.
    const kick = setTimeout(() => void this.runOnce().catch((err) => logger.error({ err }, 'retention sweep failed')), 60_000);
    kick.unref?.();
    this.timer = setInterval(() => void this.runOnce().catch((err) => logger.error({ err }, 'retention sweep failed')), intervalMs);
    this.timer.unref?.();
    logger.info({ days: this.opts.days, intervalHours: this.opts.intervalHours }, 'retention sweep scheduled');
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Sweep every tenant once. Safe to call manually. */
  async runOnce(): Promise<void> {
    const { rows } = await query<TenantRow>(`SELECT id, settings FROM tenants`);
    for (const t of rows) {
      const days = retentionDaysFor(t.settings, this.opts.days);
      try {
        await this.sweepTenant(t.id, days);
      } catch (err) {
        logger.error({ err, tenantId: t.id }, 'retention sweep error for tenant');
      }
    }
  }

  private async sweepTenant(tenantId: string, days: number): Promise<void> {
    const cutoff = new Date(Date.now() - days * 86400 * 1000).toISOString();

    const recDeleted = await this.purgeS3Backed(
      tenantId,
      'recordings',
      'created_at',
      cutoff,
    );
    const vmDeleted = await this.purgeS3Backed(tenantId, 'voicemails', 'created_at', cutoff);

    // Deleting old calls cascades transcripts + any remaining recording rows
    // (FKs are ON DELETE CASCADE / SET NULL). Recording/voicemail S3 objects
    // were already removed above.
    const callsDeleted = await this.purgeRows(
      `DELETE FROM calls WHERE id IN (SELECT id FROM calls WHERE tenant_id = $1 AND started_at < $2 LIMIT ${BATCH})`,
      tenantId,
      cutoff,
    );
    const msgDeleted = await this.purgeRows(
      `DELETE FROM messages WHERE id IN (SELECT id FROM messages WHERE tenant_id = $1 AND created_at < $2 LIMIT ${BATCH})`,
      tenantId,
      cutoff,
    );
    const auditDeleted = await this.purgeRows(
      `DELETE FROM audit_logs WHERE id IN (SELECT id FROM audit_logs WHERE tenant_id = $1 AND created_at < $2 LIMIT ${BATCH})`,
      tenantId,
      cutoff,
    );

    if (recDeleted + vmDeleted + callsDeleted + msgDeleted + auditDeleted > 0) {
      logger.info(
        { tenantId, days, recordings: recDeleted, voicemails: vmDeleted, calls: callsDeleted, messages: msgDeleted, auditLogs: auditDeleted },
        'retention sweep purged',
      );
    }
  }

  /** Delete S3 objects then rows for a recordings/voicemails-shaped table. */
  private async purgeS3Backed(
    tenantId: string,
    table: 'recordings' | 'voicemails',
    tsCol: string,
    cutoff: string,
  ): Promise<number> {
    let total = 0;
    // Loop in batches until none remain (or we've cleared a sane cap).
    for (let i = 0; i < 50; i++) {
      const { rows } = await query<{ id: string; s3_key: string | null }>(
        `SELECT id, s3_key FROM ${table} WHERE tenant_id = $1 AND ${tsCol} < $2 LIMIT ${BATCH}`,
        [tenantId, cutoff],
      );
      if (rows.length === 0) break;
      for (const r of rows) {
        if (r.s3_key) {
          try {
            await this.s3.delete(r.s3_key);
          } catch (err) {
            logger.warn({ err, key: r.s3_key }, 'retention: S3 delete failed (continuing)');
          }
        }
      }
      const ids = rows.map((r) => r.id);
      await query(`DELETE FROM ${table} WHERE id = ANY($1::uuid[])`, [ids]);
      total += rows.length;
      if (rows.length < BATCH) break;
    }
    return total;
  }

  private async purgeRows(sql: string, tenantId: string, cutoff: string): Promise<number> {
    let total = 0;
    for (let i = 0; i < 50; i++) {
      const res = await query(sql, [tenantId, cutoff]);
      const n = res.rowCount ?? 0;
      total += n;
      if (n < BATCH) break;
    }
    return total;
  }
}
