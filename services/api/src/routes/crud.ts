import type { FastifyInstance } from 'fastify';
import type { QueryResultRow } from 'pg';
import { z } from 'zod';
import { query, queryOne, buildUpdateSet } from '../db.js';
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
import type { UserRole } from '../types/db.js';

/**
 * Generic tenant-scoped CRUD route generator. Every row carries a tenant_id and
 * is filtered by request.auth.tenantId, giving uniform tenant isolation. Inputs
 * are validated with zod; mutations are audited.
 */
export interface CrudOptions<TCreate, TUpdate> {
  /** URL segment, e.g. "trunks". */
  resource: string;
  /** DB table name (trusted, not user input). */
  table: string;
  createSchema: z.ZodType<TCreate>;
  updateSchema: z.ZodType<TUpdate>;
  /** Roles allowed to mutate. Read is allowed to any authenticated user. */
  writeRoles?: UserRole[];
  /** Optional column list to order list results by (default created_at DESC). */
  orderBy?: string;
  /** Transform the create payload before insert (e.g. encrypt secrets). */
  beforeCreate?: (data: TCreate, tenantId: string) => Promise<Record<string, unknown>> | Record<string, unknown>;
  /** Transform the update payload before update. */
  beforeUpdate?: (data: TUpdate, tenantId: string) => Promise<Record<string, unknown>> | Record<string, unknown>;
  /** Hook after a row is created/updated/deleted (e.g. provisioning). */
  afterWrite?: (op: 'create' | 'update' | 'delete', row: QueryResultRow, tenantId: string) => Promise<void>;
  /** Strip sensitive columns from responses (e.g. secrets). */
  redact?: (row: QueryResultRow) => QueryResultRow;
}

export function registerCrud<TCreate, TUpdate>(
  app: FastifyInstance,
  opts: CrudOptions<TCreate, TUpdate>,
): void {
  const {
    resource,
    table,
    orderBy = 'created_at DESC',
    writeRoles = ['admin', 'supervisor'],
    redact = (r) => r,
  } = opts;

  const base = `/${resource}`;
  const writeGuard = { preHandler: [app.authenticate, app.requireRole(...writeRoles)] };
  const readGuard = { preHandler: [app.authenticate] };

  // LIST
  app.get(base, readGuard, async (request, reply) => {
    const auth = requireAuth(request);
    const { page, pageSize } = parse(PaginationQuery, request.query);
    const rows = await query(
      `SELECT * FROM ${table} WHERE tenant_id = $1 ORDER BY ${orderBy} LIMIT $2 OFFSET $3`,
      [auth.tenantId, pageSize, offset(page, pageSize)],
    );
    const count = await queryOne<{ count: string }>(
      `SELECT count(*)::text AS count FROM ${table} WHERE tenant_id = $1`,
      [auth.tenantId],
    );
    return reply.send(
      paginate(rows.rows.map(redact), Number(count?.count ?? 0), page, pageSize),
    );
  });

  // GET ONE
  app.get(`${base}/:id`, readGuard, async (request, reply) => {
    const auth = requireAuth(request);
    const { id } = request.params as { id: string };
    const row = await queryOne(
      `SELECT * FROM ${table} WHERE tenant_id = $1 AND id = $2`,
      [auth.tenantId, id],
    );
    if (!row) throw notFound(`${resource} not found`);
    return reply.send(redact(row));
  });

  // CREATE
  app.post(base, writeGuard, async (request, reply) => {
    const auth = requireAuth(request);
    const data = parse(opts.createSchema, request.body);
    const prepared = (await opts.beforeCreate?.(data, auth.tenantId)) ?? (data as Record<string, unknown>);
    const payload = { ...prepared, tenant_id: auth.tenantId };
    const cols = Object.keys(payload);
    const placeholders = cols.map((_, i) => `$${i + 1}`).join(', ');
    const row = await queryOne(
      `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${placeholders}) RETURNING *`,
      cols.map((c) => normalize(payload[c])),
    );
    await opts.afterWrite?.('create', row!, auth.tenantId);
    await audit(auth, { action: `${resource}.create`, entity: resource, entityId: String(row!.id), ip: clientIp(request) });
    return created(reply, redact(row!));
  });

  // UPDATE
  app.patch(`${base}/:id`, writeGuard, async (request, reply) => {
    const auth = requireAuth(request);
    const { id } = request.params as { id: string };
    const data = parse(opts.updateSchema, request.body);
    const prepared = (await opts.beforeUpdate?.(data, auth.tenantId)) ?? (data as Record<string, unknown>);
    const entries = Object.fromEntries(
      Object.entries(prepared).filter(([, v]) => v !== undefined).map(([k, v]) => [k, normalize(v)]),
    );
    if (Object.keys(entries).length === 0) {
      const existing = await queryOne(`SELECT * FROM ${table} WHERE tenant_id = $1 AND id = $2`, [auth.tenantId, id]);
      if (!existing) throw notFound(`${resource} not found`);
      return reply.send(redact(existing));
    }
    const { clause, params } = buildUpdateSet(entries, 1);
    const row = await queryOne(
      `UPDATE ${table} SET ${clause} WHERE tenant_id = $${params.length + 1} AND id = $${params.length + 2} RETURNING *`,
      [...params, auth.tenantId, id],
    );
    if (!row) throw notFound(`${resource} not found`);
    await opts.afterWrite?.('update', row, auth.tenantId);
    await audit(auth, { action: `${resource}.update`, entity: resource, entityId: id, ip: clientIp(request) });
    return reply.send(redact(row));
  });

  // DELETE
  app.delete(`${base}/:id`, writeGuard, async (request, reply) => {
    const auth = requireAuth(request);
    const { id } = request.params as { id: string };
    const row = await queryOne(
      `DELETE FROM ${table} WHERE tenant_id = $1 AND id = $2 RETURNING *`,
      [auth.tenantId, id],
    );
    if (!row) throw notFound(`${resource} not found`);
    await opts.afterWrite?.('delete', row, auth.tenantId);
    await audit(auth, { action: `${resource}.delete`, entity: resource, entityId: id, ip: clientIp(request) });
    return reply.code(204).send();
  });
}

/** Serialize JS objects/arrays for jsonb/text[] columns when needed. */
function normalize(value: unknown): unknown {
  if (value === undefined) return null;
  // Arrays map to Postgres array params natively via pg; objects → jsonb string.
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    return JSON.stringify(value);
  }
  return value;
}
