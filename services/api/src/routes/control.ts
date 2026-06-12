import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { query, queryOne } from '../db.js';
import { audit } from '../audit.js';
import { badRequest, notFound } from '../errors.js';
import { parse, requireAuth, clientIp } from './helpers.js';
import type { AriController } from '../ari/controller.js';
import type { CallRow } from '../types/db.js';

/**
 * Call-control REST actions used by the softphone / console. Each verifies the
 * channel belongs to the caller's tenant before acting via ARI.
 */
export async function controlRoutes(app: FastifyInstance, ari: AriController): Promise<void> {
  const guard = { preHandler: [app.authenticate] };

  /** Ensure the channel maps to a call in this tenant. */
  async function tenantOwnsChannel(tenantId: string, channelId: string): Promise<CallRow> {
    const call = await queryOne<CallRow>(
      `SELECT * FROM calls WHERE tenant_id = $1 AND channel_id = $2`,
      [tenantId, channelId],
    );
    if (!call) throw notFound('Channel not found for this tenant');
    return call;
  }

  // Originate a new call from an extension to a destination.
  app.post('/control/originate', guard, async (request, reply) => {
    const auth = requireAuth(request);
    const Body = z.object({
      from: z.string().min(1), // extension number to ring first
      to: z.string().min(1), // destination number
      callerId: z.string().optional(),
    });
    const body = parse(Body, request.body);
    const ext = await queryOne<{ sip_username: string }>(
      `SELECT sip_username FROM extensions WHERE tenant_id = $1 AND extension = $2`,
      [auth.tenantId, body.from],
    );
    if (!ext) throw badRequest('Originating extension not found');
    const result = await ari.originate({
      tenantId: auth.tenantId,
      endpoint: `PJSIP/${ext.sip_username}`,
      callerId: body.callerId,
      extension: body.to,
      variables: { AIPBX_DEST: body.to },
    });
    await audit(auth, { action: 'control.originate', entity: 'call', entityId: result.callId, metadata: { ...body }, ip: clientIp(request) });
    return reply.code(201).send(result);
  });

  app.post('/control/:channelId/hangup', guard, async (request, reply) => {
    const auth = requireAuth(request);
    const { channelId } = request.params as { channelId: string };
    await tenantOwnsChannel(auth.tenantId, channelId);
    await ari.hangup(channelId);
    await audit(auth, { action: 'control.hangup', entity: 'channel', entityId: channelId, ip: clientIp(request) });
    return reply.code(204).send();
  });

  app.post('/control/:channelId/hold', guard, async (request, reply) => {
    const auth = requireAuth(request);
    const { channelId } = request.params as { channelId: string };
    const Body = z.object({ on: z.boolean().default(true) });
    const { on } = parse(Body, request.body ?? {});
    await tenantOwnsChannel(auth.tenantId, channelId);
    await ari.hold(channelId, on);
    if (on) await query(`UPDATE calls SET status = 'hold' WHERE channel_id = $1`, [channelId]);
    else await query(`UPDATE calls SET status = 'answered' WHERE channel_id = $1`, [channelId]);
    await audit(auth, { action: 'control.hold', entity: 'channel', entityId: channelId, metadata: { on }, ip: clientIp(request) });
    return reply.send({ ok: true, hold: on });
  });

  app.post('/control/:channelId/dtmf', guard, async (request, reply) => {
    const auth = requireAuth(request);
    const { channelId } = request.params as { channelId: string };
    const Body = z.object({ digits: z.string().regex(/^[0-9*#A-D]+$/) });
    const { digits } = parse(Body, request.body);
    await tenantOwnsChannel(auth.tenantId, channelId);
    await ari.sendDtmf(channelId, digits);
    return reply.send({ ok: true });
  });

  app.post('/control/:channelId/transfer', guard, async (request, reply) => {
    const auth = requireAuth(request);
    const { channelId } = request.params as { channelId: string };
    const Body = z.object({ destination: z.string().min(1) });
    const { destination } = parse(Body, request.body);
    await tenantOwnsChannel(auth.tenantId, channelId);
    await ari.transfer(channelId, auth.tenantId, destination);
    await audit(auth, { action: 'control.transfer', entity: 'channel', entityId: channelId, metadata: { destination }, ip: clientIp(request) });
    return reply.send({ ok: true });
  });

  app.post('/control/:channelId/record/start', guard, async (request, reply) => {
    const auth = requireAuth(request);
    const { channelId } = request.params as { channelId: string };
    const call = await tenantOwnsChannel(auth.tenantId, channelId);
    const name = await ari.startRecording(channelId, call.id);
    // Pre-create a recordings row; the file is uploaded to S3 by the post-call
    // pipeline. s3_key follows a deterministic convention.
    const recId = randomUUID();
    const s3Key = `${auth.tenantId}/recordings/${call.id}/${name}.wav`;
    await query(
      `INSERT INTO recordings (id, tenant_id, call_id, s3_key, format) VALUES ($1,$2,$3,$4,'wav')`,
      [recId, auth.tenantId, call.id, s3Key],
    );
    await query(`UPDATE calls SET recording_id = $2 WHERE id = $1`, [call.id, recId]);
    await audit(auth, { action: 'control.record.start', entity: 'channel', entityId: channelId, metadata: { recId, name }, ip: clientIp(request) });
    return reply.send({ ok: true, recordingId: recId, name });
  });

  app.post('/control/:channelId/record/stop', guard, async (request, reply) => {
    const auth = requireAuth(request);
    const { channelId } = request.params as { channelId: string };
    const Body = z.object({ name: z.string().min(1) });
    const { name } = parse(Body, request.body);
    await tenantOwnsChannel(auth.tenantId, channelId);
    await ari.stopRecording(name);
    await audit(auth, { action: 'control.record.stop', entity: 'channel', entityId: channelId, metadata: { name }, ip: clientIp(request) });
    return reply.send({ ok: true });
  });
}
