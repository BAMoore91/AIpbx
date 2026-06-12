# Integrations

## Twilio — automatic Elastic SIP Trunk provisioning

AIpbx can stand up a complete Twilio [Elastic SIP Trunk](https://www.twilio.com/docs/sip-trunking)
from nothing but an **Account SID** and a **key** (Auth Token, or an API Key
SID + Secret). One call provisions both sides end-to-end.

### What it does

Given the credentials, the API (`POST /api/integrations/twilio/connect`) performs:

1. **Validate** the credentials against the Twilio account.
2. **Create (or reuse)** an Elastic SIP Trunk with a unique termination domain
   `aipbx-<tenant>-<rand>.pstn.twilio.com`.
3. **Origination** — add an Origination URL pointing at this PBX
   (`sip:$PUBLIC_IP:5060`, or `sip:$DOMAIN:5061;transport=tls`) so Twilio
   delivers inbound PSTN calls to Asterisk.
4. **Termination** — create a Credential List + credential and attach it to the
   trunk. Asterisk authenticates **outbound** INVITEs to Twilio with it
   (`outbound_auth`). The password is encrypted at rest (AES-256-GCM).
5. **Numbers** — import the account's voice numbers as `did_numbers` and
   associate them with the trunk on Twilio so inbound routes over it.
6. **Outbound route** — add an `outbound_routes` row (`_[+0-9].` → this trunk).
7. **Provision PJSIP** — push the trunk endpoint/aor/auth to Asterisk and reload.

The whole thing is **idempotent**: re-running reuses the existing trunk (matched
by friendly name) and origination URL.

### Prerequisites

| Requirement | Why |
|-------------|-----|
| `PUBLIC_IP` **or** `DOMAIN` set in `.env` | Twilio needs a reachable origination target |
| UDP/5060 (or TLS/5061) reachable from the internet | Twilio signaling → Asterisk |
| RTP `10000–10200/udp` open | Media |
| Admin role | Carrier config spends money on Twilio and is privileged |
| Twilio creds | Account SID (`AC…`) + Auth Token, **or** API Key SID (`SK…`) + Secret |

### Use it from the console

**Trunks → Connect Twilio**:
1. Paste Account SID + Auth Token, pick a label → **Verify & continue**.
2. Review the discovered numbers, choose where inbound calls land (AI
   receptionist, IVR, queue, ring group, extension, or voicemail), pick UDP/TLS.
3. **Provision trunk**. Done — inbound + outbound now work.

Credentials are sent once over TLS to the API and are **not stored**; only the
generated Twilio *termination* credential is persisted (encrypted).

### Use it from the API

```bash
# 1. Verify + list numbers (no changes)
curl -X POST https://$DOMAIN/api/integrations/twilio/verify \
  -H "Authorization: Bearer $ADMIN_JWT" -H 'content-type: application/json' \
  -d '{"accountSid":"AC...","authToken":"..."}'

# 2. Provision the trunk end-to-end
curl -X POST https://$DOMAIN/api/integrations/twilio/connect \
  -H "Authorization: Bearer $ADMIN_JWT" -H 'content-type: application/json' \
  -d '{
        "accountSid":"AC...",
        "authToken":"...",
        "label":"Twilio Main",
        "transport":"udp",
        "importNumbers":true,
        "defaultDestType":"ai_agent",
        "defaultDestId":"<ai_agent_uuid>"
      }'
```

API-key form: send `apiKeySid` + `apiKeySecret` instead of `authToken` (the
`accountSid` is still required to scope the account).

Response:
```json
{
  "trunkId": "…", "twilioTrunkSid": "TK…",
  "terminationUri": "aipbx-….pstn.twilio.com",
  "originationTarget": "sip:203.0.113.10:5060",
  "numbersImported": 3, "outboundRouteId": "…",
  "numbers": [{ "e164": "+15551230000", "sid": "PN…" }]
}
```

### Inbound call matching (Asterisk)

Twilio sends inbound INVITEs from its [signaling IP ranges](https://www.twilio.com/docs/sip-trunking/ip-addresses).
Out of the box these match the **anonymous inbound** endpoint and flow into
`from-trunk → Stasis`, so it just works. To harden, restrict to Twilio's
networks with a PJSIP `identify` (or the cloud firewall). Example:

```ini
; pjsip.conf — restrict inbound to Twilio signaling networks (NA examples)
[twilio-identify]
type=identify
endpoint=trunk_<id>
match=54.172.60.0/30
match=54.244.51.0/30
match=54.171.127.192/30
match=35.156.191.128/30
; …see Twilio docs for the full, region-specific list
```

### Outbound

The auto-created `outbound_routes` row matches E.164 destinations and dials
`PJSIP/<number>@trunk_<id>`. Twilio challenges the INVITE; Asterisk answers with
the termination credential (`outbound_auth`). Set per-route caller ID under
**Routing → Outbound Routes** (defaults to your first imported number).

### Security notes

- Account-level credentials are used transiently and never written to disk.
- The persisted Twilio **termination** credential is encrypted with
  `ENCRYPTION_KEY` (AES-256-GCM), same as all SIP secrets.
- Prefer an **API Key** (`SK…`) over the Auth Token — it can be revoked
  independently.
- Use `transport: "tls"` for encrypted signaling (SRTP for media is negotiated
  by the WebRTC/secure profiles).
