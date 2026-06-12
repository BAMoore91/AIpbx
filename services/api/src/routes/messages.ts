import type { FastifyInstance } from 'fastify';
import { query, queryOne } from '../db.js';
import { audit } from '../audit.js';
import { notFound } from '../errors.js';
import {
  parse,
  requireAuth,
  PaginationQuery,
  paginate,
  offset,
  created,
  clientIp,
} from './helpers.js';
import { messageCreate } from './schemas.js';

/** SMS / internal chat messages. Outbound sends are queued (carrier delivery
 *  is handled by the trunk/provider integration — left as a TODO hook). */
export async function messageRoutes(app: FastifyInstance): Promise<void> {
  const read = { preHandler: [app.authenticate] };
  const write = { preHandler: [app.authenticate] };

  app.get('/messages', read, async (request, reply) => {
    const auth = requireAuth(request);
    const { page, pageSize } = parse(PaginationQuery, request.query);
    const rows = await query(
      `SELECT * FROM messages WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
      [auth.tenantId, pageSize, offset(page, pageSize)],
    );
    const count = await queryOne<{ count: string }>(
      `SELECT count(*)::text AS count FROM messages WHERE tenant_id = $1`,
      [auth.tenantId],
    );
    return reply.send(paginate(rows.rows, Number(count?.count ?? 0), page, pageSize));
  });

  app.post('/messages', write, async (request, reply) => {
    const auth = requireAuth(request);
    const data = parse(messageCreate, request.body);
    const row = await queryOne(
      `INSERT INTO messages (tenant_id, channel, direction, from_addr, to_addr, body, status)
       VALUES ($1,$2,$3,$4,$5,$6,'queued') RETURNING *`,
      [auth.tenantId, data.channel, data.direction, data.from_addr ?? null, data.to_addr, data.body],
    );
    await audit(auth, { action: 'messages.create', entity: 'message', entityId: String(row!.id), ip: clientIp(request) });
    // TODO: dispatch to carrier (Twilio/Telnyx) via the trunk provider here.
    return created(reply, row);
  });

  app.get('/messages/:id', read, async (request, reply) => {
    const auth = requireAuth(request);
    const { id } = request.params as { id: string };
    const row = await queryOne(`SELECT * FROM messages WHERE tenant_id = $1 AND id = $2`, [auth.tenantId, id]);
    if (!row) throw notFound('Message not found');
    return reply.send(row);
  });
}
