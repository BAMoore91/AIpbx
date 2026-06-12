import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { query, queryOne } from '../db.js';
import { audit } from '../audit.js';
import { notFound } from '../errors.js';
import {
  parse,
  requireAuth,
  PaginationQuery,
  paginate,
  offset,
  clientIp,
} from './helpers.js';
import type { RecordingRow, VoicemailRow } from '../types/db.js';
import { visibleDepartments, can } from '../auth/access.js';
import { forbidden } from '../errors.js';

/** Recordings, transcripts, and voicemails with presigned S3 download URLs. */
export async function mediaRoutes(app: FastifyInstance): Promise<void> {
  const read = { preHandler: [app.authenticate] };
  const write = { preHandler: [app.authenticate] };

  // ---- Recordings ---------------------------------------------------------
  // Recordings inherit their department from the parent call. Users without
  // tenant-wide recordings.view see only recordings for calls in departments
  // where their department role grants it.
  app.get('/recordings', read, async (request, reply) => {
    const auth = requireAuth(request);
    const { page, pageSize } = parse(PaginationQuery, request.query);
    const vis = await visibleDepartments(auth, 'recordings.view');
    const where = ['r.tenant_id = $1'];
    const params: unknown[] = [auth.tenantId];
    if (vis !== 'all') {
      params.push(vis);
      where.push(`c.department_id = ANY($${params.length}::uuid[])`);
    }
    const whereSql = where.join(' AND ');
    const rows = await query<RecordingRow>(
      `SELECT r.* FROM recordings r LEFT JOIN calls c ON c.id = r.call_id
        WHERE ${whereSql} ORDER BY r.created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, pageSize, offset(page, pageSize)],
    );
    const count = await queryOne<{ count: string }>(
      `SELECT count(*)::text AS count FROM recordings r LEFT JOIN calls c ON c.id = r.call_id WHERE ${whereSql}`,
      params,
    );
    return reply.send(paginate(rows.rows, Number(count?.count ?? 0), page, pageSize));
  });

  app.get('/recordings/:id/download', read, async (request, reply) => {
    const auth = requireAuth(request);
    const { id } = request.params as { id: string };
    const rec = await queryOne<RecordingRow & { department_id: string | null }>(
      `SELECT r.*, c.department_id FROM recordings r
         LEFT JOIN calls c ON c.id = r.call_id
        WHERE r.tenant_id = $1 AND r.id = $2`,
      [auth.tenantId, id],
    );
    if (!rec) throw notFound('Recording not found');
    if (!(await can(auth, 'recordings.view', rec.department_id))) {
      throw forbidden('Missing permission: recordings.view');
    }
    const url = await app.ctx.s3.presignedGet(rec.s3_key, 900);
    return reply.send({ url, expiresIn: 900, format: rec.format });
  });

  // ---- Transcripts (search) ----------------------------------------------
  const TranscriptSearch = z.object({
    q: z.string().min(1),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(25),
  });
  app.get('/transcripts/search', read, async (request, reply) => {
    const auth = requireAuth(request);
    const { q, page, pageSize } = parse(TranscriptSearch, request.query);
    // Full-text search over transcripts joined to tenant-scoped calls.
    const rows = await query(
      `SELECT t.id, t.call_id, t.language, t.created_at,
              ts_headline('english', coalesce(t.full_text,''), plainto_tsquery('english', $2)) AS snippet
       FROM transcripts t
       JOIN calls c ON c.id = t.call_id AND c.tenant_id = $1
       WHERE to_tsvector('english', coalesce(t.full_text,'')) @@ plainto_tsquery('english', $2)
       ORDER BY t.created_at DESC LIMIT $3 OFFSET $4`,
      [auth.tenantId, q, pageSize, offset(page, pageSize)],
    );
    return reply.send({ data: rows.rows, page, pageSize, query: q });
  });

  app.get('/calls/:callId/transcript', read, async (request, reply) => {
    const auth = requireAuth(request);
    const { callId } = request.params as { callId: string };
    const call = await queryOne(`SELECT id FROM calls WHERE tenant_id = $1 AND id = $2`, [auth.tenantId, callId]);
    if (!call) throw notFound('Call not found');
    const t = await queryOne(`SELECT * FROM transcripts WHERE call_id = $1 ORDER BY created_at DESC LIMIT 1`, [callId]);
    if (!t) throw notFound('Transcript not found');
    return reply.send(t);
  });

  // ---- Voicemails ---------------------------------------------------------
  app.get('/voicemails', read, async (request, reply) => {
    const auth = requireAuth(request);
    const Q = PaginationQuery.extend({ extension: z.string().optional(), unread: z.coerce.boolean().optional() });
    const { page, pageSize, extension, unread } = parse(Q, request.query);
    const where = ['tenant_id = $1'];
    const params: unknown[] = [auth.tenantId];
    if (extension) {
      params.push(extension);
      where.push(`extension = $${params.length}`);
    }
    if (unread) where.push('is_read = false');
    const whereSql = where.join(' AND ');
    const rows = await query<VoicemailRow>(
      `SELECT * FROM voicemails WHERE ${whereSql} ORDER BY created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, pageSize, offset(page, pageSize)],
    );
    const count = await queryOne<{ count: string }>(
      `SELECT count(*)::text AS count FROM voicemails WHERE ${whereSql}`,
      params,
    );
    return reply.send(paginate(rows.rows, Number(count?.count ?? 0), page, pageSize));
  });

  app.get('/voicemails/:id/download', read, async (request, reply) => {
    const auth = requireAuth(request);
    const { id } = request.params as { id: string };
    const vm = await queryOne<VoicemailRow>(`SELECT * FROM voicemails WHERE tenant_id = $1 AND id = $2`, [auth.tenantId, id]);
    if (!vm) throw notFound('Voicemail not found');
    const url = await app.ctx.s3.presignedGet(vm.s3_key, 900);
    return reply.send({ url, expiresIn: 900 });
  });

  app.patch('/voicemails/:id/read', write, async (request, reply) => {
    const auth = requireAuth(request);
    const { id } = request.params as { id: string };
    const Body = z.object({ is_read: z.boolean().default(true) });
    const { is_read } = parse(Body, request.body ?? {});
    const row = await queryOne(
      `UPDATE voicemails SET is_read = $3 WHERE tenant_id = $1 AND id = $2 RETURNING *`,
      [auth.tenantId, id, is_read],
    );
    if (!row) throw notFound('Voicemail not found');
    await audit(auth, { action: 'voicemails.read', entity: 'voicemail', entityId: id, ip: clientIp(request) });
    return reply.send(row);
  });

  app.delete('/voicemails/:id', write, async (request, reply) => {
    const auth = requireAuth(request);
    const { id } = request.params as { id: string };
    const vm = await queryOne<VoicemailRow>(`SELECT * FROM voicemails WHERE tenant_id = $1 AND id = $2`, [auth.tenantId, id]);
    if (!vm) throw notFound('Voicemail not found');
    await query(`DELETE FROM voicemails WHERE id = $1`, [id]);
    try {
      await app.ctx.s3.delete(vm.s3_key);
    } catch {
      /* object may already be gone */
    }
    await audit(auth, { action: 'voicemails.delete', entity: 'voicemail', entityId: id, ip: clientIp(request) });
    return reply.code(204).send();
  });
}
