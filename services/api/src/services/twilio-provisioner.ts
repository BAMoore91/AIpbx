import { randomUUID, randomBytes } from 'node:crypto';
import { withTransaction } from '../db.js';
import { logger } from '../logger.js';
import { badRequest } from '../errors.js';
import type { Crypto } from '../crypto.js';
import type { AppConfig } from '../config.js';
import type { PjsipProvisioner } from '../ari/provisioner.js';
import type { TrunkRow, DestType } from '../types/db.js';
import { TwilioClient, makeCreds, type TwilioPhoneNumber } from './twilio.js';

/**
 * Twilio Elastic SIP Trunk auto-provisioner.
 *
 * Given an Account SID + key it performs the entire bring-up, idempotently:
 *   1. Validate credentials.
 *   2. Create (or reuse) a Twilio Elastic SIP Trunk with a unique termination
 *      domain `<name>.pstn.twilio.com`.
 *   3. Add an Origination URL pointing at our Asterisk public SIP address so
 *      Twilio delivers inbound PSTN calls to us.
 *   4. Create a Credential List + credential and attach it for *termination*
 *      (outbound) auth — our Asterisk authenticates outbound INVITEs with it.
 *   5. Import the account's phone numbers as DIDs and (optionally) associate
 *      them with the trunk so inbound routes over it.
 *   6. Persist a `trunks` row (secret encrypted at rest), `did_numbers`, and an
 *      `outbound_routes` row, then provision PJSIP.
 *
 * Twilio side-effects happen before our DB transaction; they're reused on retry
 * (we look up an existing trunk by friendly name / domain) so re-running is safe.
 */

export interface ConnectTwilioInput {
  tenantId: string;
  accountSid: string;
  authToken?: string;
  apiKeySid?: string;
  apiKeySecret?: string;
  label?: string;
  transport?: 'udp' | 'tls';
  importNumbers?: boolean; // default true
  assignNumbersOnTwilio?: boolean; // default true — route the DIDs over the trunk
  defaultDestType?: DestType; // where imported DIDs ring (default 'extension')
  defaultDestId?: string | null;
}

export interface ConnectTwilioResult {
  trunkId: string;
  twilioTrunkSid: string;
  terminationUri: string;
  originationTarget: string;
  numbersImported: number;
  outboundRouteId: string;
  numbers: Array<{ e164: string; sid: string }>;
}

export interface TwilioProvisionerDeps {
  crypto: Crypto;
  config: AppConfig;
  provisioner: PjsipProvisioner;
}

/** Our public SIP target Twilio should send inbound calls to. */
function originationTarget(config: AppConfig, transport: 'udp' | 'tls'): string {
  const host = config.publicIp || config.domain;
  if (!host) {
    throw badRequest(
      'PUBLIC_IP or DOMAIN must be configured so Twilio knows where to send inbound calls',
    );
  }
  if (transport === 'tls') return `sip:${host}:5061;transport=tls`;
  return `sip:${host}:${config.sipPort}`;
}

/** Twilio domain labels: lowercase alphanumeric + hyphens, globally unique. */
function uniqueTrunkDomain(tenantId: string): { name: string; domain: string } {
  const short = tenantId.replace(/-/g, '').slice(0, 8);
  const rand = randomBytes(3).toString('hex');
  const name = `aipbx-${short}-${rand}`;
  return { name, domain: `${name}.pstn.twilio.com` };
}

/** Termination credential meeting Twilio's complexity rules (upper+lower+digit). */
function makeTerminationCredential(): { username: string; password: string } {
  return {
    username: `aipbx${randomBytes(4).toString('hex')}`,
    password: `${randomBytes(12).toString('hex')}Aa1`,
  };
}

/** Validate creds and return account + phone numbers — no changes made. */
export async function previewTwilio(input: {
  accountSid: string;
  authToken?: string;
  apiKeySid?: string;
  apiKeySecret?: string;
}): Promise<{ account: { friendlyName: string; status: string }; numbers: TwilioPhoneNumber[] }> {
  const client = new TwilioClient(makeCreds(input));
  const account = await client.verify();
  const numbers = await client.listPhoneNumbers();
  return { account: { friendlyName: account.friendlyName, status: account.status }, numbers };
}

export async function connectTwilio(
  deps: TwilioProvisionerDeps,
  input: ConnectTwilioInput,
): Promise<ConnectTwilioResult> {
  const { crypto, config, provisioner } = deps;
  const transport = input.transport ?? 'udp';
  const importNumbers = input.importNumbers ?? true;
  const assignOnTwilio = input.assignNumbersOnTwilio ?? true;
  const label = input.label?.trim() || 'Twilio';

  const client = new TwilioClient(makeCreds(input));

  // 1. Validate credentials up front (clear error if the key is wrong).
  await client.verify();

  // 2. Create or reuse the Elastic SIP Trunk.
  const friendlyName = `AIpbx ${label}`;
  let trunk = (await client.listTrunks()).find((t) => t.friendlyName === friendlyName);
  if (!trunk) {
    const { domain } = uniqueTrunkDomain(input.tenantId);
    trunk = await client.createTrunk(friendlyName, domain);
  }

  // 3. Origination — Twilio → us. Add only if not already present.
  const target = originationTarget(config, transport);
  const existingOrig = await client.listOriginationUrls(trunk.sid);
  if (!existingOrig.some((o) => o.sipUrl === target)) {
    await client.createOriginationUrl(trunk.sid, target, 'AIpbx');
  }

  // 4. Termination credential — us → Twilio (outbound auth).
  const cred = makeTerminationCredential();
  const credentialListSid = await client.createCredentialList(`AIpbx ${label} ${Date.now()}`);
  await client.addCredential(credentialListSid, cred.username, cred.password);
  await client.attachCredentialList(trunk.sid, credentialListSid);

  // 5. Numbers.
  const numbers = importNumbers ? await client.listPhoneNumbers() : [];
  const voiceNumbers = numbers.filter((n) => n.capabilities.voice !== false);
  if (assignOnTwilio) {
    for (const n of voiceNumbers) {
      try {
        await client.assignNumberToTrunk(trunk.sid, n.sid);
      } catch (err) {
        // Number may already be on another trunk — log and continue.
        logger.warn({ err: (err as Error).message, number: n.phoneNumber }, 'twilio number assign skipped');
      }
    }
  }

  // 6. Persist our rows + provision PJSIP (transactional for our DB).
  const trunkId = randomUUID();
  const outboundRouteId = randomUUID();
  const trunkHost = trunk.domainName; // <name>.pstn.twilio.com
  const port = transport === 'tls' ? 5061 : 5060;
  const callerId = voiceNumbers[0]?.phoneNumber ?? input.defaultDestId ?? null;
  const defaultDestType: DestType = input.defaultDestType ?? 'extension';

  const trunkRow = await withTransaction(async (client) => {
    const res = await client.query<TrunkRow>(
      `INSERT INTO trunks
         (id, tenant_id, name, provider, host, port, transport, auth_type,
          username, secret, from_domain, register, codecs, max_channels,
          caller_id, is_active, settings)
       VALUES ($1,$2,$3,'twilio',$4,$5,$6,'userpass',$7,$8,$9,false,
               ARRAY['ulaw','alaw'],$10,$11,true,$12)
       RETURNING *`,
      [
        trunkId,
        input.tenantId,
        label,
        trunkHost,
        port,
        transport,
        cred.username,
        crypto.encrypt(cred.password),
        trunkHost,
        30, // max_channels — Twilio default concurrent-call ceiling
        callerId,
        JSON.stringify({
          twilioTrunkSid: trunk.sid,
          twilioDomain: trunk.domainName,
          credentialListSid,
          accountSid: input.accountSid,
          originationTarget: target,
        }),
      ],
    );

    // DIDs — one row per imported voice number, routed to the default dest.
    for (const n of voiceNumbers) {
      await client.query(
        `INSERT INTO did_numbers (tenant_id, trunk_id, e164, label, dest_type, dest_id, is_active)
         VALUES ($1,$2,$3,$4,$5,$6,true)
         ON CONFLICT (e164) DO UPDATE SET trunk_id = EXCLUDED.trunk_id`,
        [
          input.tenantId,
          trunkId,
          n.phoneNumber,
          n.friendlyName,
          defaultDestType,
          input.defaultDestId ?? null,
        ],
      );
    }

    // Outbound route — send E.164 destinations over this trunk.
    await client.query(
      `INSERT INTO outbound_routes (id, tenant_id, name, pattern, trunk_id, prepend, strip, caller_id, priority)
       VALUES ($1,$2,$3,'_[+0-9].',$4,'',0,$5,100)`,
      [outboundRouteId, input.tenantId, `${label} outbound`, trunkId, callerId],
    );

    return res.rows[0]!;
  });

  // Push PJSIP config to Asterisk (best-effort; logs intent if realtime absent).
  await provisioner.syncTrunk(trunkRow);

  logger.info(
    { trunkId, twilioTrunkSid: trunk.sid, numbers: voiceNumbers.length },
    'twilio trunk provisioned',
  );

  return {
    trunkId,
    twilioTrunkSid: trunk.sid,
    terminationUri: trunkHost,
    originationTarget: target,
    numbersImported: voiceNumbers.length,
    outboundRouteId,
    numbers: voiceNumbers.map((n) => ({ e164: n.phoneNumber, sid: n.sid })),
  };
}
