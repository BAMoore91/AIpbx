import { describe, it, expect } from 'vitest';
import { sipUserFromChannelName } from '../ari/routing.js';

describe('multi-tenant: tenant resolution by SIP endpoint', () => {
  it('extracts the sip_username from a PJSIP channel name', () => {
    expect(sipUserFromChannelName('PJSIP/alice_a1b2-00000007')).toBe('alice_a1b2');
    expect(sipUserFromChannelName('PJSIP/t1-1001-0000abcd')).toBe('t1-1001');
  });

  it('returns null for non-PJSIP or malformed channel names', () => {
    expect(sipUserFromChannelName('Local/1001@default-0001;1')).toBeNull();
    expect(sipUserFromChannelName('')).toBeNull();
    expect(sipUserFromChannelName(undefined)).toBeNull();
    expect(sipUserFromChannelName(null)).toBeNull();
  });

  it('is unaffected by the (non-unique) dialled extension number', () => {
    // Two tenants both have extension 1001 but distinct, globally-unique
    // sip_usernames — resolution keys off the username, never the number.
    expect(sipUserFromChannelName('PJSIP/acme_1001-00000001')).toBe('acme_1001');
    expect(sipUserFromChannelName('PJSIP/globex_1001-00000002')).toBe('globex_1001');
  });
});
