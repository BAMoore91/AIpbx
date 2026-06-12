import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { query, queryOne } from '../db.js';
import { parse, requireAuth } from './helpers.js';

/** Dashboard stats + reports (tenant-scoped aggregates). */
export async function dashboardRoutes(app: FastifyInstance): Promise<void> {
  const read = { preHandler: [app.authenticate] };

  app.get('/dashboard/stats', read, async (request, reply) => {
    const auth = requireAuth(request);
    const t = auth.tenantId;

    const [active, today, queueSla, sentiment, agents] = await Promise.all([
      queryOne<{ count: string }>(
        `SELECT count(*)::text AS count FROM calls WHERE tenant_id = $1 AND status NOT IN ('ended')`,
        [t],
      ),
      queryOne<{
        total: string;
        answered: string;
        missed: string;
        inbound: string;
        outbound: string;
        avg_talk: string | null;
      }>(
        `SELECT
            count(*)::text AS total,
            count(*) FILTER (WHERE disposition = 'answered')::text AS answered,
            count(*) FILTER (WHERE disposition IN ('no-answer','abandoned','busy','failed'))::text AS missed,
            count(*) FILTER (WHERE direction = 'inbound')::text AS inbound,
            count(*) FILTER (WHERE direction = 'outbound')::text AS outbound,
            avg(talk_seconds)::numeric(10,1)::text AS avg_talk
         FROM calls
         WHERE tenant_id = $1 AND started_at >= date_trunc('day', now())`,
        [t],
      ),
      query<{ queue_id: string; name: string; within_sla: string; total: string }>(
        `SELECT q.id AS queue_id, q.name,
                count(c.*) FILTER (WHERE c.ring_seconds <= q.service_level)::text AS within_sla,
                count(c.*)::text AS total
         FROM queues q
         LEFT JOIN calls c ON c.queue_id = q.id AND c.tenant_id = $1
              AND c.started_at >= date_trunc('day', now())
         WHERE q.tenant_id = $1
         GROUP BY q.id, q.name, q.service_level`,
        [t],
      ),
      query<{ sentiment: string | null; count: string }>(
        `SELECT sentiment, count(*)::text AS count
         FROM calls
         WHERE tenant_id = $1 AND started_at >= now() - interval '7 days' AND sentiment IS NOT NULL
         GROUP BY sentiment`,
        [t],
      ),
      queryOne<{ count: string }>(
        `SELECT count(*)::text AS count FROM ai_agents WHERE tenant_id = $1 AND is_active = true`,
        [t],
      ),
    ]);

    const queueSlaPct = queueSla.rows.map((r) => ({
      queueId: r.queue_id,
      name: r.name,
      total: Number(r.total),
      withinSla: Number(r.within_sla),
      slaPct: Number(r.total) > 0 ? Math.round((Number(r.within_sla) / Number(r.total)) * 100) : 100,
    }));

    return reply.send({
      activeCalls: Number(active?.count ?? 0),
      today: {
        total: Number(today?.total ?? 0),
        answered: Number(today?.answered ?? 0),
        missed: Number(today?.missed ?? 0),
        inbound: Number(today?.inbound ?? 0),
        outbound: Number(today?.outbound ?? 0),
        avgTalkSeconds: today?.avg_talk ? Number(today.avg_talk) : 0,
      },
      queueSla: queueSlaPct,
      sentiment: Object.fromEntries(sentiment.rows.map((r) => [r.sentiment ?? 'unknown', Number(r.count)])),
      activeAiAgents: Number(agents?.count ?? 0),
    });
  });

  // Time-bucketed report for charts and CSV exports.
  app.get('/reports', read, async (request, reply) => {
    const auth = requireAuth(request);
    const Q = z.object({
      from: z.string().optional(),
      to: z.string().optional(),
      granularity: z.enum(['hour', 'day', 'week', 'month']).default('day'),
    });
    const { from, to, granularity } = parse(Q, request.query);
    const params: unknown[] = [auth.tenantId, granularity];
    let range = '';
    if (from) {
      params.push(from);
      range += ` AND started_at >= $${params.length}`;
    }
    if (to) {
      params.push(to);
      range += ` AND started_at <= $${params.length}`;
    }
    const rows = await query(
      `SELECT
          date_trunc($2, started_at) AS bucket,
          count(*)::int AS total,
          count(*) FILTER (WHERE disposition = 'answered')::int AS answered,
          count(*) FILTER (WHERE direction = 'inbound')::int AS inbound,
          count(*) FILTER (WHERE direction = 'outbound')::int AS outbound,
          count(*) FILTER (WHERE ai_agent_id IS NOT NULL)::int AS ai_handled,
          coalesce(avg(talk_seconds),0)::numeric(10,1) AS avg_talk,
          coalesce(sum(cost),0)::numeric(12,4) AS total_cost
       FROM calls
       WHERE tenant_id = $1${range}
       GROUP BY bucket ORDER BY bucket ASC`,
      params,
    );
    return reply.send({ granularity, data: rows.rows });
  });
}
