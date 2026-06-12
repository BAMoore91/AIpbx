import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { audit } from '../audit.js';
import { parse, requireAuth, clientIp } from './helpers.js';
import { previewTwilio, connectTwilio } from '../services/twilio-provisioner.js';
import type { AriController } from '../ari/controller.js';

const DEST_TYPES = ['extension', 'ivr', 'queue', 'ring_group', 'ai_agent', 'voicemail'] as const;

const credentialFields = {
  accountSid: z.string().trim().regex(/^AC[0-9a-fA-F]{32}$/, 'Invalid Account SID (expected ACxxxx…)'),
  authToken: z.string().trim().min(10).optional(),
  apiKeySid: z.string().trim().regex(/^SK[0-9a-fA-F]{32}$/).optional(),
  apiKeySecret: z.string().trim().min(10).optional(),
};

const VerifyBody = z.object(credentialFields);

const ConnectBody = z.object({
  ...credentialFields,
  label: z.string().trim().max(64).optional(),
  transport: z.enum(['udp', 'tls']).optional(),
  importNumbers: z.boolean().optional(),
  assignNumbersOnTwilio: z.boolean().optional(),
  defaultDestType: z.enum(DEST_TYPES).optional(),
  defaultDestId: z.string().optional().nullable(),
});

/**
 * Carrier / integration routes. Twilio Elastic SIP Trunking can be brought up
 * automatically from an Account SID + key:
 *   POST /integrations/twilio/verify   — validate creds, list numbers (no change)
 *   POST /integrations/twilio/connect  — provision the whole trunk end-to-end
 * Both require an admin (carrier config is privileged + spends on Twilio).
 */
export async function integrationRoutes(app: FastifyInstance, ari: AriController): Promise<void> {
  const adminGuard = { preHandler: [app.authenticate, app.requireRole('admin')] };

  app.post('/integrations/twilio/verify', adminGuard, async (request, reply) => {
    const auth = requireAuth(request);
    const body = parse(VerifyBody, request.body);
    const result = await previewTwilio(body);
    await audit(auth, {
      action: 'integration.twilio.verify',
      entity: 'trunk',
      metadata: { accountSid: body.accountSid, numbers: result.numbers.length },
      ip: clientIp(request),
    });
    return reply.send({
      account: result.account,
      numbers: result.numbers.map((n) => ({
        sid: n.sid,
        phoneNumber: n.phoneNumber,
        friendlyName: n.friendlyName,
        voice: n.capabilities.voice !== false,
      })),
    });
  });

  app.post('/integrations/twilio/connect', adminGuard, async (request, reply) => {
    const auth = requireAuth(request);
    const body = parse(ConnectBody, request.body);
    const result = await connectTwilio(
      { crypto: app.ctx.crypto, config: app.ctx.config, provisioner: ari.provisioner },
      { tenantId: auth.tenantId, ...body },
    );
    await audit(auth, {
      action: 'integration.twilio.connect',
      entity: 'trunk',
      entityId: result.trunkId,
      metadata: {
        twilioTrunkSid: result.twilioTrunkSid,
        numbersImported: result.numbersImported,
        terminationUri: result.terminationUri,
      },
      ip: clientIp(request),
    });
    return reply.code(201).send(result);
  });
}
