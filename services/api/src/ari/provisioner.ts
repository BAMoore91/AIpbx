import { query } from '../db.js';
import { logger } from '../logger.js';
import type { Crypto } from '../crypto.js';
import type { ExtensionRow, TrunkRow } from '../types/db.js';
import type { AriClient } from './types.js';

/**
 * PjsipProvisioner — turns extension/trunk rows into Asterisk PJSIP config.
 *
 * In a full deployment Asterisk reads PJSIP from the `ps_endpoints` / `ps_aors`
 * / `ps_auths` realtime tables in the SAME PostgreSQL database (sorcery +
 * res_config_pgsql). Since the realtime wiring is environment-specific and not
 * guaranteed to be present here, this provisioner:
 *
 *   1. Computes the intended realtime rows and logs them (the authoritative
 *      "intended action"), and
 *   2. Best-effort writes them to ps_* tables IF those tables exist
 *      (idempotent upsert; silently skips if the tables are absent), and
 *   3. Asks Asterisk to reload res_pjsip via ARI so changes take effect.
 *
 * This keeps the control-plane pragmatic and observable without hard-coupling
 * to a particular realtime schema. Secrets are decrypted only at the moment we
 * push them to Asterisk; they are never stored in plaintext in our own tables.
 */
export class PjsipProvisioner {
  constructor(
    private readonly crypto: Crypto,
    private readonly ari: () => AriClient | null,
  ) {}

  async syncExtension(ext: ExtensionRow): Promise<void> {
    const secret = this.crypto.tryDecrypt(ext.sip_password) ?? '';
    const endpoint = ext.sip_username;
    const allow = ext.codecs.join(',');

    logger.info(
      {
        action: 'provision.extension',
        endpoint,
        transport: ext.transport,
        allow,
        maxContacts: ext.max_contacts,
      },
      'provisioning PJSIP endpoint',
    );

    await this.upsertPsRows({
      endpoint,
      transport: ext.transport,
      allow,
      context: 'from-internal',
      maxContacts: ext.max_contacts,
      authUser: ext.sip_username,
      authPass: secret,
    });

    await this.reload();
  }

  async removeExtension(sipUsername: string): Promise<void> {
    logger.info({ action: 'deprovision.extension', endpoint: sipUsername }, 'removing PJSIP endpoint');
    await this.deletePsRows(sipUsername);
    await this.reload();
  }

  async syncTrunk(trunk: TrunkRow): Promise<void> {
    const secret = this.crypto.tryDecrypt(trunk.secret) ?? '';
    const endpoint = `trunk_${trunk.id}`;
    logger.info(
      {
        action: 'provision.trunk',
        endpoint,
        host: trunk.host,
        port: trunk.port,
        authType: trunk.auth_type,
        register: trunk.register,
      },
      'provisioning PJSIP trunk',
    );
    await this.upsertPsRows({
      endpoint,
      transport: `transport-${trunk.transport}`,
      allow: trunk.codecs.join(','),
      context: 'from-trunk',
      maxContacts: trunk.max_channels,
      authUser: trunk.username ?? endpoint,
      authPass: secret,
      remoteHost: trunk.host,
      remotePort: trunk.port,
      // Trunks authenticate OUTBOUND to the carrier (e.g. Twilio challenges our
      // INVITE); inbound is matched by source IP/origination, not auth.
      outboundAuth: trunk.auth_type === 'userpass',
    });
    await this.reload();
  }

  // --- internal: best-effort realtime upsert -------------------------------

  private async upsertPsRows(p: {
    endpoint: string;
    transport: string;
    allow: string;
    context: string;
    maxContacts: number;
    authUser: string;
    authPass: string;
    remoteHost?: string;
    remotePort?: number;
    outboundAuth?: boolean;
  }): Promise<void> {
    try {
      await query(
        `INSERT INTO ps_aors (id, max_contacts, remove_existing${p.remoteHost ? ', contact' : ''})
         VALUES ($1, $2, 'yes'${p.remoteHost ? ", $3" : ''})
         ON CONFLICT (id) DO UPDATE SET max_contacts = EXCLUDED.max_contacts`,
        p.remoteHost
          ? [p.endpoint, p.maxContacts, `sip:${p.remoteHost}:${p.remotePort ?? 5060}`]
          : [p.endpoint, p.maxContacts],
      );
      await query(
        `INSERT INTO ps_auths (id, auth_type, username, password)
         VALUES ($1, 'userpass', $2, $3)
         ON CONFLICT (id) DO UPDATE SET username = EXCLUDED.username, password = EXCLUDED.password`,
        [p.endpoint, p.authUser, p.authPass],
      );
      // Trunks use outbound_auth (we authenticate to the carrier); endpoints use
      // inbound auth (the device authenticates to us).
      const authCol = p.outboundAuth ? 'outbound_auth' : 'auth';
      await query(
        `INSERT INTO ps_endpoints (id, transport, aors, ${authCol}, context, allow, disallow)
         VALUES ($1, $2, $1, $1, $3, $4, 'all')
         ON CONFLICT (id) DO UPDATE SET transport = EXCLUDED.transport, context = EXCLUDED.context, allow = EXCLUDED.allow, ${authCol} = $1`,
        [p.endpoint, p.transport, p.context, p.allow],
      );
    } catch (err) {
      // ps_* realtime tables not present in this environment — that's expected
      // when Asterisk realtime isn't wired. We've already logged the intent.
      logger.debug({ err: (err as Error).message, endpoint: p.endpoint }, 'ps_* realtime upsert skipped');
    }
  }

  private async deletePsRows(endpoint: string): Promise<void> {
    try {
      await query(`DELETE FROM ps_endpoints WHERE id = $1`, [endpoint]);
      await query(`DELETE FROM ps_auths WHERE id = $1`, [endpoint]);
      await query(`DELETE FROM ps_aors WHERE id = $1`, [endpoint]);
    } catch (err) {
      logger.debug({ err: (err as Error).message }, 'ps_* delete skipped');
    }
  }

  private async reload(): Promise<void> {
    const client = this.ari();
    if (!client) return;
    try {
      await client.asterisk.reloadModule({ moduleName: 'res_pjsip.so' });
    } catch (err) {
      logger.warn({ err: (err as Error).message }, 'res_pjsip reload failed');
    }
  }
}
