import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { query, queryOne } from '../db.js';
import { notFound } from '../errors.js';
import { parse, requireAuth, paginate, offset } from './helpers.js';

const CallFilter = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
  direction: z.enum(['inbound', 'outbound', 'internal']).optional(),
  status: z.enum(['ringing', 'answered', 'in-progress', 'hold', 'ended']).optional(),
  disposition: z.string().optional(),
  from: z.string().optional(), // ISO date lower bound (started_at)
  to: z.string().optional(),
  number: z.string().optional(), // matches from_number or to_number
  agentId: z.string().uuid().optional(),
  queueId: z.string().uuid().optional(),
});

/** Calls: list/search with filters + pagination, and get one. */
export async function callRoutes(app: FastifyInstance): Promise<void> {
  const read = { preHandler: [app.authenticate] };

  app.get('/calls', read, async (request, reply) => {
    const auth = requireAuth(request);
    const f = parse(CallFilter, request.query);

    const where: string[] = ['tenant_id = $1'];
    const params: unknown[] = [auth.tenantId];
    const add = (frag: string, val: unknown) => {
      params.push(val);
      where.push(frag.replace('$$', `$${params.length}`));
    };
    if (f.direction) add('direction = $$', f.direction);
    if (f.status) add('status = $$', f.status);
    if (f.disposition) add('disposition = $$', f.disposition);
    if (f.agentId) add('ai_agent_id = $$', f.agentId);
    if (f.queueId) add('queue_id = $$', f.queueId);
    if (f.from) add('started_at >= $$', f.from);
    if (f.to) add('started_at <= $$', f.to);
    if (f.number) {
      params.push(`%${f.number}%`);
      where.push(`(from_number ILIKE $${params.length} OR to_number ILIKE $${params.length})`);
    }

    const whereSql = where.join(' AND ');
    const rows = await query(
      `SELECT * FROM calls WHERE ${whereSql} ORDER BY started_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, f.pageSize, offset(f.page, f.pageSize)],
    );
    const count = await queryOne<{ count: string }>(
      `SELECT count(*)::text AS count FROM calls WHERE ${whereSql}`,
      params,
    );
    return reply.send(paginate(rows.rows, Number(count?.count ?? 0), f.page, f.pageSize));
  });

  app.get('/calls/:id', read, async (request, reply) => {
    const auth = requireAuth(request);
    const { id } = request.params as { id: string };
    const row = await queryOne(`SELECT * FROM calls WHERE tenant_id = $1 AND id = $2`, [auth.tenantId, id]);
    if (!row) throw notFound('Call not found');
    // Attach recording + transcript references if present.
    const recordings = await query(`SELECT * FROM recordings WHERE call_id = $1`, [id]);
    const transcript = await queryOne(`SELECT * FROM transcripts WHERE call_id = $1 ORDER BY created_at DESC LIMIT 1`, [id]);
    return reply.send({ ...row, recordings: recordings.rows, transcript });
  });
}
