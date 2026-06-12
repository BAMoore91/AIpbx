import type { FastifyInstance } from 'fastify';
import { query, queryOne } from '../db.js';
import { audit } from '../audit.js';
import { notFound } from '../errors.js';
import { parse, requireAuth, created, clientIp } from './helpers.js';
import { queueMemberCreate, kbDocumentCreate } from './schemas.js';

/** Nested collections: queue members and knowledge-base documents. */
export async function nestedRoutes(app: FastifyInstance): Promise<void> {
  const write = { preHandler: [app.authenticate, app.requireRole('admin', 'supervisor')] };
  const read = { preHandler: [app.authenticate] };

  // ---- Queue members (scoped via the parent queue's tenant) --------------
  app.get('/queues/:queueId/members', read, async (request, reply) => {
    const auth = requireAuth(request);
    const { queueId } = request.params as { queueId: string };
    await assertQueue(auth.tenantId, queueId);
    const rows = await query(
      `SELECT * FROM queue_members WHERE queue_id = $1 ORDER BY penalty ASC, created_at ASC`,
      [queueId],
    );
    return reply.send({ data: rows.rows });
  });

  app.post('/queues/:queueId/members', write, async (request, reply) => {
    const auth = requireAuth(request);
    const { queueId } = request.params as { queueId: string };
    await assertQueue(auth.tenantId, queueId);
    const data = parse(queueMemberCreate, request.body);
    const row = await queryOne(
      `INSERT INTO queue_members (queue_id, extension, penalty, paused)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (queue_id, extension) DO UPDATE SET penalty = EXCLUDED.penalty, paused = EXCLUDED.paused
       RETURNING *`,
      [queueId, data.extension, data.penalty, data.paused],
    );
    await audit(auth, { action: 'queue_members.create', entity: 'queue_member', entityId: String(row!.id), ip: clientIp(request) });
    return created(reply, row);
  });

  app.delete('/queues/:queueId/members/:id', write, async (request, reply) => {
    const auth = requireAuth(request);
    const { queueId, id } = request.params as { queueId: string; id: string };
    await assertQueue(auth.tenantId, queueId);
    const row = await queryOne(
      `DELETE FROM queue_members WHERE queue_id = $1 AND id = $2 RETURNING id`,
      [queueId, id],
    );
    if (!row) throw notFound('Queue member not found');
    await audit(auth, { action: 'queue_members.delete', entity: 'queue_member', entityId: id, ip: clientIp(request) });
    return reply.code(204).send();
  });

  // ---- Knowledge-base documents ------------------------------------------
  app.get('/knowledge_bases/:kbId/documents', read, async (request, reply) => {
    const auth = requireAuth(request);
    const { kbId } = request.params as { kbId: string };
    await assertKb(auth.tenantId, kbId);
    const rows = await query(
      `SELECT id, kb_id, title, source, chunk_index, created_at FROM kb_documents
       WHERE kb_id = $1 ORDER BY chunk_index ASC, created_at ASC`,
      [kbId],
    );
    return reply.send({ data: rows.rows });
  });

  app.post('/knowledge_bases/:kbId/documents', write, async (request, reply) => {
    const auth = requireAuth(request);
    const { kbId } = request.params as { kbId: string };
    await assertKb(auth.tenantId, kbId);
    const data = parse(kbDocumentCreate, request.body);
    const row = await queryOne(
      `INSERT INTO kb_documents (kb_id, title, source, content, chunk_index)
       VALUES ($1,$2,$3,$4,$5) RETURNING id, kb_id, title, source, chunk_index, created_at`,
      [kbId, data.title ?? null, data.source ?? null, data.content, data.chunk_index],
    );
    await audit(auth, { action: 'kb_documents.create', entity: 'kb_document', entityId: String(row!.id), ip: clientIp(request) });
    return created(reply, row);
  });

  app.delete('/knowledge_bases/:kbId/documents/:id', write, async (request, reply) => {
    const auth = requireAuth(request);
    const { kbId, id } = request.params as { kbId: string; id: string };
    await assertKb(auth.tenantId, kbId);
    const row = await queryOne(`DELETE FROM kb_documents WHERE kb_id = $1 AND id = $2 RETURNING id`, [kbId, id]);
    if (!row) throw notFound('Document not found');
    await audit(auth, { action: 'kb_documents.delete', entity: 'kb_document', entityId: id, ip: clientIp(request) });
    return reply.code(204).send();
  });
}

async function assertQueue(tenantId: string, queueId: string): Promise<void> {
  const q = await queryOne(`SELECT id FROM queues WHERE tenant_id = $1 AND id = $2`, [tenantId, queueId]);
  if (!q) throw notFound('Queue not found');
}

async function assertKb(tenantId: string, kbId: string): Promise<void> {
  const kb = await queryOne(`SELECT id FROM knowledge_bases WHERE tenant_id = $1 AND id = $2`, [tenantId, kbId]);
  if (!kb) throw notFound('Knowledge base not found');
}
