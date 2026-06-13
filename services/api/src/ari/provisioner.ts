import { query } from '../db.js';
import { logger } from '../logger.js';
import type { Crypto } from '../crypto.js';
import type { ExtensionRow, TrunkRow } from '../types/db.js';
import type { AriClient } from './types.js';

/**
 * PjsipProvisioner — turns extension/trunk rows into Asterisk PJSIP objects
 * via **realtime**. Asterisk reads `ps_endpoints` / `ps_aors` / `ps_auths`
 * (and writes `ps_contacts` on REGISTER) from THIS database through
 * res_config_odbc + sorcery realtime (see asterisk/etc/asterisk/sorcery.conf
 * and db/asterisk_realtime.sql). Writing these rows is therefore sufficient to
 * make an endpoint live — no static pjsip.conf edits, no full reload required
 * (realtime objects are fetched on demand). We still nudge a reload so any
 * cached state refreshes promptly.
 *
 * Secrets are decrypted only at the moment we push them; they are never stored
 * in plaintext in our own `extensions`/`trunks` tables.
 */
export class PjsipProvisioner {
  constructor(
    private readonly crypto: Crypto,
    private readonly ari: () => AriClient | null,
  ) {}

  async syncExtension(ext: ExtensionRow): Promise<void> {
    const secret = this.crypto.tryDecrypt(ext.sip_password) ?? '';
    const id = ext.sip_username;
    const isWebrtc = ext.type === 'webrtc' || ext.transport === 'transport-wss';

    logger.info(
      { action: 'provision.extension', endpoint: id, transport: ext.transport, webrtc: isWebrtc },
      'provisioning PJSIP endpoint (realtime)',
    );

    // AOR — dynamic registration (the phone registers a contact).
    await this.upsert('ps_aors', {
      id,
      max_contacts: ext.max_contacts,
      remove_existing: 'yes',
      qualify_frequency: 30,
    });
    // Inbound auth — the device authenticates to us.
    await this.upsert('ps_auths', {
      id,
      auth_type: 'userpass',
      username: ext.sip_username,
      password: secret,
    });
    // Endpoint.
    await this.upsert('ps_endpoints', {
      ...this.endpointDefaults(),
      id,
      transport: ext.transport,
      aors: id,
      auth: id,
      context: 'aipbx-internal',
      allow: (ext.codecs && ext.codecs.length ? ext.codecs : ['opus', 'ulaw', 'alaw']).join(','),
      callerid: ext.display_name ? `${ext.display_name} <${ext.extension}>` : ext.extension,
      ...(isWebrtc ? this.webrtcDefaults() : {}),
    });

    await this.reload();
  }

  async removeExtension(sipUsername: string): Promise<void> {
    logger.info({ action: 'deprovision.extension', endpoint: sipUsername }, 'removing PJSIP endpoint');
    await this.deleteEndpoint(sipUsername);
    await this.reload();
  }

  async syncTrunk(trunk: TrunkRow): Promise<void> {
    const secret = this.crypto.tryDecrypt(trunk.secret) ?? '';
    const id = `trunk_${trunk.id}`;
    const transport = `transport-${trunk.transport}`;
    const usesAuth = trunk.auth_type === 'userpass';

    logger.info(
      { action: 'provision.trunk', endpoint: id, host: trunk.host, register: trunk.register },
      'provisioning PJSIP trunk (realtime)',
    );

    // AOR points at the carrier's host (static contact, no registration inbound).
    await this.upsert('ps_aors', {
      id,
      contact: `sip:${trunk.host}:${trunk.port}`,
      qualify_frequency: 60,
    });
    if (usesAuth) {
      await this.upsert('ps_auths', {
        id,
        auth_type: 'userpass',
        username: trunk.username ?? id,
        password: secret,
      });
    }
    await this.upsert('ps_endpoints', {
      ...this.endpointDefaults(),
      id,
      transport,
      aors: id,
      // Trunks authenticate OUTBOUND to the carrier (it challenges our INVITE);
      // inbound is matched by source IP / origination, not by inbound auth.
      ...(usesAuth ? { outbound_auth: id } : {}),
      context: 'from-trunk',
      allow: (trunk.codecs && trunk.codecs.length ? trunk.codecs : ['ulaw', 'alaw']).join(','),
      from_domain: trunk.from_domain ?? trunk.host,
      from_user: trunk.from_user ?? trunk.username ?? undefined,
      callerid: trunk.caller_id ?? undefined,
      identify_by: 'ip,username',
    });

    // Identify inbound calls from this trunk by the carrier host.
    await this.upsert('ps_endpoint_id_ips', {
      id,
      endpoint: id,
      match: trunk.host,
      srv_lookups: 'yes',
    });

    // Outbound registration, if the carrier requires us to register.
    if (trunk.register && usesAuth) {
      await this.upsert('ps_registrations', {
        id,
        transport,
        outbound_auth: id,
        server_uri: `sip:${trunk.host}:${trunk.port}`,
        client_uri: `sip:${trunk.username ?? id}@${trunk.host}:${trunk.port}`,
        contact_user: trunk.username ?? id,
        retry_interval: 60,
        endpoint: id,
      });
    } else {
      await this.deleteRow('ps_registrations', id);
    }

    await this.reload();
  }

  // --- column templates ----------------------------------------------------

  /** NAT-friendly defaults applied to every endpoint. */
  private endpointDefaults(): Record<string, unknown> {
    return {
      disallow: 'all',
      direct_media: 'no',
      force_rport: 'yes',
      rewrite_contact: 'yes',
      rtp_symmetric: 'yes',
      dtmf_mode: 'auto',
    };
  }

  /** WebRTC browser-phone profile (DTLS-SRTP, ICE, opus, bundled RTCP). */
  private webrtcDefaults(): Record<string, unknown> {
    return {
      webrtc: 'yes',
      dtls_auto_generate_cert: 'yes',
      ice_support: 'yes',
      media_encryption: 'dtls',
      rtcp_mux: 'yes',
      use_avpf: 'yes',
      media_use_received_transport: 'yes',
      bundle: 'yes',
    };
  }

  // --- generic realtime upsert (best-effort) -------------------------------

  /**
   * Upsert a row into a ps_* realtime table. Best-effort: if the realtime
   * tables aren't present (Asterisk realtime not wired in this environment),
   * we log the intent and continue rather than failing the API write.
   */
  private async upsert(table: string, values: Record<string, unknown>): Promise<void> {
    const entries = Object.entries(values).filter(([, v]) => v !== undefined);
    const cols = entries.map(([k]) => k);
    const params = entries.map(([, v]) => v);
    const placeholders = cols.map((_, i) => `$${i + 1}`);
    const updates = cols.filter((c) => c !== 'id').map((c) => `${c} = EXCLUDED.${c}`);
    const sql =
      `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${placeholders.join(', ')}) ` +
      `ON CONFLICT (id) DO UPDATE SET ${updates.join(', ') || 'id = EXCLUDED.id'}`;
    try {
      await query(sql, params);
    } catch (err) {
      logger.warn(
        { err: (err as Error).message, table, id: values.id },
        'ps_* realtime upsert failed (is db/asterisk_realtime.sql applied?)',
      );
    }
  }

  private async deleteRow(table: string, id: string): Promise<void> {
    try {
      await query(`DELETE FROM ${table} WHERE id = $1`, [id]);
    } catch (err) {
      logger.debug({ err: (err as Error).message, table, id }, 'ps_* delete skipped');
    }
  }

  private async deleteEndpoint(id: string): Promise<void> {
    await this.deleteRow('ps_endpoints', id);
    await this.deleteRow('ps_auths', id);
    await this.deleteRow('ps_aors', id);
    await this.deleteRow('ps_endpoint_id_ips', id);
    await this.deleteRow('ps_registrations', id);
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
