import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { query, queryOne, withTransaction } from '../db.js';
import { audit } from '../audit.js';
import { conflict, notFound, badRequest } from '../errors.js';
import { parse, requireAuth, clientIp, created, PaginationQuery, offset } from './helpers.js';
import { hashPassword } from '../auth/passwords.js';
import type { TenantRow } from '../types/db.js';

/**
 * Platform tenant management — superadmin only. This is the control surface for
 * multi-tenancy: create/suspend/configure tenants and onboard their first admin.
 *
 * Day-to-day, a superadmin manages a tenant's resources by setting the
 * `X-Tenant-Id` header (handled in the auth plugin); these routes manage the
 * tenants themselves.
 */

const slug = z
  .string()
  .trim()
  .min(2)
  .max(48)
  .regex(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/, 'lowercase alphanumeric + hyphens');

const tenantCreate = z.object({
  name: z.string().trim().min(1).max(120),
  slug,
  domain: z.string().trim().max(255).optional(),
  plan: z.enum(['free', 'pro', 'enterprise']).default('pro'),
  max_extensions: z.coerce.number().int().min(1).max(100000).default(50),
  max_concurrent_calls: z.coerce.number().int().min(1).max(100000).default(30),
  // Optional first admin — onboard the tenant in one call.
  admin: z
    .object({
      email: z.string().email(),
      password: z.string().min(8).max(200),
      first_name: z.string().trim().max(80).optional(),
      last_name: z.string().trim().max(80).optional(),
    })
    .optional(),
});

const tenantUpdate = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  domain: z.string().trim().max(255).nullable().optional(),
  plan: z.enum(['free', 'pro', 'enterprise']).optional(),
  max_extensions: z.coerce.number().int().min(1).max(100000).optional(),
  max_concurrent_calls: z.coerce.number().int().min(1).max(100000).optional(),
  is_active: z.boolean().optional(),
  settings: z.record(z.unknown()).optional(),
});

interface TenantUsage {
  extensions: number;
  users: number;
  ai_agents: number;
  did_numbers: number;
  trunks: number;
  active_calls: number;
}

async function usageFor(tenantId: string): Promise<TenantUsage> {
  const row = await queryOne<Record<keyof TenantUsage, string>>(
    `SELECT
       (SELECT count(*) FROM extensions   WHERE tenant_id = $1) AS extensions,
       (SELECT count(*) FROM users        WHERE tenant_id = $1) AS users,
       (SELECT count(*) FROM ai_agents    WHERE tenant_id = $1) AS ai_agents,
       (SELECT count(*) FROM did_numbers  WHERE tenant_id = $1) AS did_numbers,
       (SELECT count(*) FROM trunks       WHERE tenant_id = $1) AS trunks,
       (SELECT count(*) FROM calls        WHERE tenant_id = $1 AND status <> 'ended') AS active_calls`,
    [tenantId],
  );
  const n = (v: string | undefined) => Number(v ?? 0);
  return {
    extensions: n(row?.extensions),
    users: n(row?.users),
    ai_agents: n(row?.ai_agents),
    did_numbers: n(row?.did_numbers),
    trunks: n(row?.trunks),
    active_calls: n(row?.active_calls),
  };
}

export async function tenantRoutes(app: FastifyInstance): Promise<void> {
  const guard = { preHandler: [app.authenticate, app.requireSuperadmin] };

  // LIST (with usage)
  app.get('/tenants', guard, async (request, reply) => {
    const { page, pageSize } = parse(PaginationQuery, request.query);
    const { rows } = await query<TenantRow>(
      `SELECT * FROM tenants ORDER BY created_at DESC LIMIT $1 OFFSET $2`,
      [pageSize, offset(page, pageSize)],
    );
    const total = await queryOne<{ count: string }>(`SELECT count(*) FROM tenants`);
    const data = await Promise.all(
      rows.map(async (t) => ({ ...t, usage: await usageFor(t.id) })),
    );
    return reply.send({ data, page, pageSize, total: Number(total?.count ?? 0) });
  });

  // GET one (with usage)
  app.get('/tenants/:id', guard, async (request, reply) => {
    const { id } = request.params as { id: string };
    const t = await queryOne<TenantRow>(`SELECT * FROM tenants WHERE id = $1`, [id]);
    if (!t) throw notFound('Tenant not found');
    return reply.send({ ...t, usage: await usageFor(t.id) });
  });

  // CREATE (+ optional first admin user, atomically)
  app.post('/tenants', guard, async (request, reply) => {
    const auth = requireAuth(request);
    const data = parse(tenantCreate, request.body);

    const dup = await queryOne(`SELECT id FROM tenants WHERE slug = $1`, [data.slug]);
    if (dup) throw conflict('A tenant with that slug already exists');

    const result = await withTransaction(async (client) => {
      const tRes = await client.query<TenantRow>(
        `INSERT INTO tenants (name, slug, domain, plan, max_extensions, max_concurrent_calls)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
        [data.name, data.slug, data.domain ?? null, data.plan, data.max_extensions, data.max_concurrent_calls],
      );
      const tenant = tRes.rows[0]!;

      let adminUserId: string | null = null;
      if (data.admin) {
        const hash = await hashPassword(data.admin.password);
        const uRes = await client.query<{ id: string }>(
          `INSERT INTO users (tenant_id, email, password_hash, first_name, last_name, role, is_active)
           VALUES ($1,$2,$3,$4,$5,'admin',true) RETURNING id`,
          [tenant.id, data.admin.email, hash, data.admin.first_name ?? null, data.admin.last_name ?? null],
        );
        adminUserId = uRes.rows[0]!.id;
      }
      return { tenant, adminUserId };
    });

    await audit(auth, {
      action: 'tenant.create',
      entity: 'tenant',
      entityId: result.tenant.id,
      metadata: { slug: data.slug, plan: data.plan, withAdmin: Boolean(data.admin) },
      ip: clientIp(request),
    });
    return created(reply, { ...result.tenant, usage: await usageFor(result.tenant.id), adminUserId: result.adminUserId });
  });

  // UPDATE (plan, limits, domain, active)
  app.patch('/tenants/:id', guard, async (request, reply) => {
    const auth = requireAuth(request);
    const { id } = request.params as { id: string };
    const data = parse(tenantUpdate, request.body);
    const entries = Object.entries(data).filter(([, v]) => v !== undefined);
    if (entries.length === 0) {
      const cur = await queryOne<TenantRow>(`SELECT * FROM tenants WHERE id = $1`, [id]);
      if (!cur) throw notFound('Tenant not found');
      return reply.send(cur);
    }
    const sets = entries
      .map(([k], i) => `${k} = $${i + 1}`)
      .concat('updated_at = now()')
      .join(', ');
    const params = entries.map(([k, v]) => (k === 'settings' ? JSON.stringify(v) : v));
    const row = await queryOne<TenantRow>(
      `UPDATE tenants SET ${sets} WHERE id = $${params.length + 1} RETURNING *`,
      [...params, id],
    );
    if (!row) throw notFound('Tenant not found');
    await audit(auth, { action: 'tenant.update', entity: 'tenant', entityId: id, metadata: data, ip: clientIp(request) });
    return reply.send({ ...row, usage: await usageFor(row.id) });
  });

  // SUSPEND / ACTIVATE
  for (const [path, active] of [['suspend', false], ['activate', true]] as const) {
    app.post(`/tenants/:id/${path}`, guard, async (request, reply) => {
      const auth = requireAuth(request);
      const { id } = request.params as { id: string };
      const row = await queryOne<TenantRow>(
        `UPDATE tenants SET is_active = $1, updated_at = now() WHERE id = $2 RETURNING *`,
        [active, id],
      );
      if (!row) throw notFound('Tenant not found');
      await audit(auth, { action: `tenant.${path}`, entity: 'tenant', entityId: id, ip: clientIp(request) });
      return reply.send(row);
    });
  }

  // DELETE — guarded: refuse to delete a tenant that still has data unless ?force=1.
  app.delete('/tenants/:id', guard, async (request, reply) => {
    const auth = requireAuth(request);
    const { id } = request.params as { id: string };
    const force = (request.query as { force?: string })?.force === '1';
    if (id === auth.homeTenantId) throw badRequest('You cannot delete your own tenant');
    const usage = await usageFor(id);
    const hasData = usage.extensions + usage.users + usage.ai_agents + usage.trunks > 0;
    if (hasData && !force) {
      throw conflict('Tenant has data; suspend it, or pass ?force=1 to delete (cascades).');
    }
    const row = await queryOne<{ id: string }>(`DELETE FROM tenants WHERE id = $1 RETURNING id`, [id]);
    if (!row) throw notFound('Tenant not found');
    await audit(auth, { action: 'tenant.delete', entity: 'tenant', entityId: id, metadata: { force }, ip: clientIp(request) });
    return reply.code(204).send();
  });

  // Current effective tenant (handy for the console when impersonating).
  app.get('/tenants/context/current', { preHandler: [app.authenticate] }, async (request, reply) => {
    const auth = requireAuth(request);
    const t = await queryOne<TenantRow>(`SELECT * FROM tenants WHERE id = $1`, [auth.tenantId]);
    if (!t) throw notFound('Tenant not found');
    return reply.send({
      tenant: t,
      usage: await usageFor(t.id),
      impersonating: auth.impersonating,
      homeTenantId: auth.homeTenantId,
    });
  });
}
