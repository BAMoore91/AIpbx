import { logger } from '../logger.js';
import { badRequest } from '../errors.js';

/**
 * Minimal Twilio REST client — no SDK dependency. Covers exactly the surface we
 * need to stand up an Elastic SIP Trunk automatically from an Account SID + key:
 *
 *   - api.twilio.com/2010-04-01     → account + IncomingPhoneNumbers
 *   - trunking.twilio.com/v1        → Trunks, OriginationUrls, CredentialLists,
 *                                     Credentials, PhoneNumbers (associations)
 *
 * Auth is HTTP Basic. Two credential shapes are supported:
 *   - Account SID + Auth Token        (basic user = AccountSid)
 *   - API Key SID + API Key Secret    (basic user = SKxx␣, still needs AccountSid
 *                                      in the URL path)
 * Either way `accountSid` identifies the account; `authUser`/`authPass` are the
 * Basic credentials.
 */

const API_BASE = 'https://api.twilio.com/2010-04-01';
const TRUNKING_BASE = 'https://trunking.twilio.com/v1';

export interface TwilioCreds {
  accountSid: string;
  authUser: string; // AccountSid or API Key SID
  authPass: string; // Auth Token or API Key Secret
}

export interface TwilioPhoneNumber {
  sid: string;
  phoneNumber: string; // E.164
  friendlyName: string | null;
  capabilities: { voice?: boolean; sms?: boolean; mms?: boolean };
}

export interface TwilioTrunk {
  sid: string;
  friendlyName: string | null;
  domainName: string; // <name>.pstn.twilio.com — the termination SIP URI host
}

export interface TwilioOriginationUrl {
  sid: string;
  sipUrl: string;
  enabled: boolean;
  priority: number;
  weight: number;
}

/** Build creds from the two accepted input shapes. */
export function makeCreds(input: {
  accountSid: string;
  authToken?: string;
  apiKeySid?: string;
  apiKeySecret?: string;
}): TwilioCreds {
  if (input.apiKeySid && input.apiKeySecret) {
    return { accountSid: input.accountSid, authUser: input.apiKeySid, authPass: input.apiKeySecret };
  }
  if (input.authToken) {
    return { accountSid: input.accountSid, authUser: input.accountSid, authPass: input.authToken };
  }
  throw badRequest('Provide either authToken or both apiKeySid and apiKeySecret');
}

export class TwilioClient {
  private readonly authHeader: string;

  constructor(private readonly creds: TwilioCreds) {
    this.authHeader =
      'Basic ' + Buffer.from(`${creds.authUser}:${creds.authPass}`).toString('base64');
  }

  // --- low-level ----------------------------------------------------------

  private async request<T>(
    method: 'GET' | 'POST' | 'DELETE',
    url: string,
    form?: Record<string, string | number | boolean | undefined>,
  ): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
      const body =
        form &&
        new URLSearchParams(
          Object.fromEntries(
            Object.entries(form)
              .filter(([, v]) => v !== undefined)
              .map(([k, v]) => [k, String(v)]),
          ),
        );
      const res = await fetch(url, {
        method,
        headers: {
          Authorization: this.authHeader,
          ...(body ? { 'content-type': 'application/x-www-form-urlencoded' } : {}),
        },
        body,
        signal: controller.signal,
      });
      const text = await res.text();
      if (!res.ok) {
        let msg = `Twilio ${method} ${res.status}`;
        try {
          const j = JSON.parse(text) as { message?: string; code?: number };
          if (j.message) msg = `Twilio: ${j.message}${j.code ? ` (code ${j.code})` : ''}`;
        } catch {
          /* non-JSON error body */
        }
        logger.warn({ status: res.status, url, body: text.slice(0, 300) }, 'twilio api error');
        throw badRequest(msg);
      }
      return (text ? JSON.parse(text) : {}) as T;
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        throw badRequest('Twilio request timed out');
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  // --- account / numbers (2010-04-01) ------------------------------------

  /** Validate credentials by fetching the account; returns the friendly name. */
  async verify(): Promise<{ accountSid: string; friendlyName: string; status: string }> {
    const a = await this.request<{ sid: string; friendly_name: string; status: string }>(
      'GET',
      `${API_BASE}/Accounts/${this.creds.accountSid}.json`,
    );
    return { accountSid: a.sid, friendlyName: a.friendly_name, status: a.status };
  }

  /** List voice-capable phone numbers on the account. */
  async listPhoneNumbers(): Promise<TwilioPhoneNumber[]> {
    const out: TwilioPhoneNumber[] = [];
    let url: string | null =
      `${API_BASE}/Accounts/${this.creds.accountSid}/IncomingPhoneNumbers.json?PageSize=100`;
    // Follow Twilio's pagination (`next_page_uri`).
    while (url) {
      const page: {
        incoming_phone_numbers: Array<{
          sid: string;
          phone_number: string;
          friendly_name: string;
          capabilities: { voice?: boolean; sms?: boolean; mms?: boolean };
        }>;
        next_page_uri: string | null;
      } = await this.request('GET', url);
      for (const n of page.incoming_phone_numbers) {
        out.push({
          sid: n.sid,
          phoneNumber: n.phone_number,
          friendlyName: n.friendly_name || null,
          capabilities: n.capabilities ?? {},
        });
      }
      url = page.next_page_uri ? `https://api.twilio.com${page.next_page_uri}` : null;
    }
    return out;
  }

  /** Point a phone number's voice traffic at a SIP trunk (Trunking association). */
  async assignNumberToTrunk(trunkSid: string, phoneNumberSid: string): Promise<void> {
    await this.request('POST', `${TRUNKING_BASE}/Trunks/${trunkSid}/PhoneNumbers`, {
      PhoneNumberSid: phoneNumberSid,
    });
  }

  // --- trunking (v1) ------------------------------------------------------

  async listTrunks(): Promise<TwilioTrunk[]> {
    const page = await this.request<{
      trunks: Array<{ sid: string; friendly_name: string; domain_name: string }>;
    }>('GET', `${TRUNKING_BASE}/Trunks?PageSize=50`);
    return page.trunks.map((t) => ({
      sid: t.sid,
      friendlyName: t.friendly_name,
      domainName: t.domain_name,
    }));
  }

  async createTrunk(friendlyName: string, domainName: string): Promise<TwilioTrunk> {
    const t = await this.request<{ sid: string; friendly_name: string; domain_name: string }>(
      'POST',
      `${TRUNKING_BASE}/Trunks`,
      { FriendlyName: friendlyName, DomainName: domainName },
    );
    return { sid: t.sid, friendlyName: t.friendly_name, domainName: t.domain_name };
  }

  async listOriginationUrls(trunkSid: string): Promise<TwilioOriginationUrl[]> {
    const page = await this.request<{
      origination_urls: Array<{
        sid: string;
        sip_url: string;
        enabled: boolean;
        priority: number;
        weight: number;
      }>;
    }>('GET', `${TRUNKING_BASE}/Trunks/${trunkSid}/OriginationUrls`);
    return page.origination_urls.map((o) => ({
      sid: o.sid,
      sipUrl: o.sip_url,
      enabled: o.enabled,
      priority: o.priority,
      weight: o.weight,
    }));
  }

  /** Add an origination URL so Twilio sends inbound calls to our Asterisk. */
  async createOriginationUrl(
    trunkSid: string,
    sipUrl: string,
    friendlyName = 'AIpbx',
  ): Promise<TwilioOriginationUrl> {
    const o = await this.request<{
      sid: string;
      sip_url: string;
      enabled: boolean;
      priority: number;
      weight: number;
    }>('POST', `${TRUNKING_BASE}/Trunks/${trunkSid}/OriginationUrls`, {
      SipUrl: sipUrl,
      FriendlyName: friendlyName,
      Priority: 10,
      Weight: 10,
      Enabled: true,
    });
    return { sid: o.sid, sipUrl: o.sip_url, enabled: o.enabled, priority: o.priority, weight: o.weight };
  }

  /** Create a credential list and one credential for termination (outbound) auth. */
  async createCredentialList(friendlyName: string): Promise<string> {
    const cl = await this.request<{ sid: string }>(
      'POST',
      `${TRUNKING_BASE}/CredentialLists`,
      { FriendlyName: friendlyName },
    );
    return cl.sid;
  }

  async addCredential(
    credentialListSid: string,
    username: string,
    password: string,
  ): Promise<void> {
    await this.request('POST', `${TRUNKING_BASE}/CredentialLists/${credentialListSid}/Credentials`, {
      Username: username,
      Password: password,
    });
  }

  async attachCredentialList(trunkSid: string, credentialListSid: string): Promise<void> {
    await this.request('POST', `${TRUNKING_BASE}/Trunks/${trunkSid}/CredentialLists`, {
      CredentialListSid: credentialListSid,
    });
  }
}
