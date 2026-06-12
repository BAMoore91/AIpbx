import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { makeCreds, TwilioClient } from '../services/twilio.js';

const ACCOUNT = 'AC' + 'a'.repeat(32);

describe('makeCreds', () => {
  it('uses Account SID + Auth Token as Basic creds', () => {
    const c = makeCreds({ accountSid: ACCOUNT, authToken: 'tok_secret' });
    expect(c).toEqual({ accountSid: ACCOUNT, authUser: ACCOUNT, authPass: 'tok_secret' });
  });

  it('prefers API key SID/secret when provided', () => {
    const c = makeCreds({ accountSid: ACCOUNT, apiKeySid: 'SK' + 'b'.repeat(32), apiKeySecret: 'sek' });
    expect(c.authUser).toBe('SK' + 'b'.repeat(32));
    expect(c.authPass).toBe('sek');
    expect(c.accountSid).toBe(ACCOUNT);
  });

  it('throws when no key material is supplied', () => {
    expect(() => makeCreds({ accountSid: ACCOUNT })).toThrow();
  });
});

describe('TwilioClient', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
  });
  afterEach(() => vi.unstubAllGlobals());

  function ok(body: unknown) {
    return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(JSON.stringify(body)) });
  }

  it('sends HTTP Basic auth and hits the account endpoint on verify()', async () => {
    fetchMock.mockReturnValueOnce(ok({ sid: ACCOUNT, friendly_name: 'Acme', status: 'active' }));
    const client = new TwilioClient(makeCreds({ accountSid: ACCOUNT, authToken: 'tok' }));
    const res = await client.verify();

    expect(res).toEqual({ accountSid: ACCOUNT, friendlyName: 'Acme', status: 'active' });
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe(`https://api.twilio.com/2010-04-01/Accounts/${ACCOUNT}.json`);
    const expected = 'Basic ' + Buffer.from(`${ACCOUNT}:tok`).toString('base64');
    expect((opts as { headers: Record<string, string> }).headers.Authorization).toBe(expected);
  });

  it('form-encodes POST bodies for origination URLs', async () => {
    fetchMock.mockReturnValueOnce(
      ok({ sid: 'OUxxxx', sip_url: 'sip:1.2.3.4:5060', enabled: true, priority: 10, weight: 10 }),
    );
    const client = new TwilioClient(makeCreds({ accountSid: ACCOUNT, authToken: 'tok' }));
    await client.createOriginationUrl('TKxxxx', 'sip:1.2.3.4:5060');

    const [url, opts] = fetchMock.mock.calls[0] as [string, { method: string; body: URLSearchParams; headers: Record<string, string> }];
    expect(url).toBe('https://trunking.twilio.com/v1/Trunks/TKxxxx/OriginationUrls');
    expect(opts.method).toBe('POST');
    expect(opts.headers['content-type']).toBe('application/x-www-form-urlencoded');
    const params = new URLSearchParams(opts.body.toString());
    expect(params.get('SipUrl')).toBe('sip:1.2.3.4:5060');
    expect(params.get('Enabled')).toBe('true');
  });

  it('surfaces Twilio error messages on non-2xx', async () => {
    fetchMock.mockReturnValueOnce(
      Promise.resolve({ ok: false, status: 401, text: () => Promise.resolve(JSON.stringify({ message: 'Authenticate', code: 20003 })) }),
    );
    const client = new TwilioClient(makeCreds({ accountSid: ACCOUNT, authToken: 'bad' }));
    await expect(client.verify()).rejects.toThrow(/Authenticate/);
  });

  it('paginates IncomingPhoneNumbers via next_page_uri', async () => {
    fetchMock
      .mockReturnValueOnce(
        ok({
          incoming_phone_numbers: [
            { sid: 'PN1', phone_number: '+15551110000', friendly_name: 'A', capabilities: { voice: true } },
          ],
          next_page_uri: '/2010-04-01/Accounts/x/IncomingPhoneNumbers.json?Page=1',
        }),
      )
      .mockReturnValueOnce(
        ok({
          incoming_phone_numbers: [
            { sid: 'PN2', phone_number: '+15552220000', friendly_name: 'B', capabilities: { voice: true } },
          ],
          next_page_uri: null,
        }),
      );
    const client = new TwilioClient(makeCreds({ accountSid: ACCOUNT, authToken: 'tok' }));
    const nums = await client.listPhoneNumbers();
    expect(nums.map((n) => n.phoneNumber)).toEqual(['+15551110000', '+15552220000']);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
