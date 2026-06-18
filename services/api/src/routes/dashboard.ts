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

    const [active, today, queueSla, sentiment, byHour] = await Promise.all([
      queryOne<{ count: string }>(
        `SELECT count(*)::text AS count FROM calls WHERE tenant_id = $1 AND status NOT IN ('ended')`,
        [t],
      ),
      queryOne<{
        total: string;
        answered: string;
        missed: string;
        avg_talk: string | null;
      }>(
        `SELECT
            count(*)::text AS total,
            count(*) FILTER (WHERE disposition = 'answered')::text AS answered,
            count(*) FILTER (WHERE disposition IN ('no-answer','abandoned','busy','failed'))::text AS missed,
            avg(talk_seconds)::numeric(10,1)::text AS avg_talk
         FROM calls
         WHERE tenant_id = $1 AND started_at >= date_trunc('day', now())`,
        [t],
      ),
      query<{ name: string; within_sla: string; total: string }>(
        `SELECT q.name,
                count(c.*) FILTER (WHERE c.ring_seconds <= q.service_level)::text AS within_sla,
                count(c.*)::text AS total
         FROM queues q
         LEFT JOIN calls c ON c.queue_id = q.id AND c.tenant_id = $1
              AND c.started_at >= date_trunc('day', now())
         WHERE q.tenant_id = $1
         GROUP BY q.id, q.name, q.service_level
         ORDER BY count(c.*) DESC
         LIMIT 5`,
        [t],
      ),
      query<{ sentiment: string | null; count: string }>(
        `SELECT sentiment, count(*)::text AS count
         FROM calls
         WHERE tenant_id = $1 AND started_at >= now() - interval '7 days' AND sentiment IS NOT NULL
         GROUP BY sentiment`,
        [t],
      ),
      query<{ hour: string; calls: string; answered: string }>(
        `SELECT to_char(date_trunc('hour', started_at), 'HH24:00') AS hour,
                count(*)::text AS calls,
                count(*) FILTER (WHERE disposition = 'answered')::text AS answered
         FROM calls
         WHERE tenant_id = $1 AND started_at >= date_trunc('day', now())
         GROUP BY 1 ORDER BY 1`,
        [t],
      ),
    ]);

    // Top queues (today) + an overall SLA % across all of them.
    const topQueues = queueSla.rows.map((r) => ({
      name: r.name,
      waiting: 0,
      sla: Number(r.total) > 0 ? Math.round((Number(r.within_sla) / Number(r.total)) * 100) : 100,
    }));
    const slaTotals = queueSla.rows.reduce(
      (acc, r) => ({ within: acc.within + Number(r.within_sla), total: acc.total + Number(r.total) }),
      { within: 0, total: 0 },
    );
    const queueSlaPct = slaTotals.total > 0 ? (slaTotals.within / slaTotals.total) * 100 : 100;

    // Sentiment counts (7d) → whole-number percentages.
    const sCounts = { positive: 0, neutral: 0, negative: 0 };
    for (const r of sentiment.rows) {
      const k = (r.sentiment ?? '').toLowerCase();
      if (k === 'positive' || k === 'neutral' || k === 'negative') sCounts[k] = Number(r.count);
    }
    const sTotal = sCounts.positive + sCounts.neutral + sCounts.negative;
    const pct = (n: number) => (sTotal > 0 ? Math.round((n / sTotal) * 100) : 0);

    // Shape MUST match the web `DashboardStats` type (snake_case).
    return reply.send({
      active_calls: Number(active?.count ?? 0),
      calls_today: Number(today?.total ?? 0),
      answered_today: Number(today?.answered ?? 0),
      missed_today: Number(today?.missed ?? 0),
      avg_handle_time: today?.avg_talk ? Math.round(Number(today.avg_talk)) : 0,
      queue_sla_pct: queueSlaPct,
      sentiment_breakdown: {
        positive: pct(sCounts.positive),
        neutral: pct(sCounts.neutral),
        negative: pct(sCounts.negative),
      },
      calls_by_hour: byHour.rows.map((r) => ({
        hour: r.hour,
        calls: Number(r.calls),
        answered: Number(r.answered),
      })),
      top_queues: topQueues,
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
