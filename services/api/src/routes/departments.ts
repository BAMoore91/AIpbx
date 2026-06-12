import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { query, queryOne } from '../db.js';
import { audit } from '../audit.js';
import { conflict, notFound } from '../errors.js';
import { parse, requireAuth, clientIp, created, PaginationQuery, offset } from './helpers.js';
import { requirePermission } from '../auth/access.js';
import { DEPARTMENT_ROLES } from '../auth/permissions.js';

const departmentCreate = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).optional(),
  manager_user_id: z.string().uuid().nullable().optional(),
});
const departmentUpdate = departmentCreate.partial();
const memberUpsert = z.object({
  user_id: z.string().uuid(),
  role: z.enum(['owner', 'manager', 'receptionist', 'user']),
});

/**
 * Departments (a.k.a. groups) and per-department role membership. All routes
 * require the `departments.manage` permission (System Owner/Admin, or a
 * department Owner for their own department membership in a fuller build).
 */
export async function departmentRoutes(app: FastifyInstance): Promise<void> {
  const manage = { preHandler: [app.authenticate, requirePermission('departments.manage')] };
  const read = { preHandler: [app.authenticate] };

  // Catalog of assignable department roles (handy for the UI).
  app.get('/departments/roles', read, async (_request, reply) => reply.send({ roles: DEPARTMENT_ROLES }));

  // LIST (with member + resource counts)
  app.get('/departments', read, async (request, reply) => {
    const auth = requireAuth(request);
    const { page, pageSize } = parse(PaginationQuery, request.query);
    const { rows } = await query(
      `SELECT d.*,
              (SELECT count(*) FROM department_members m WHERE m.department_id = d.id) AS member_count,
              (SELECT count(*) FROM extensions e WHERE e.department_id = d.id)        AS extension_count
         FROM departments d
        WHERE d.tenant_id = $1
        ORDER BY d.name ASC
        LIMIT $2 OFFSET $3`,
      [auth.tenantId, pageSize, offset(page, pageSize)],
    );
    const total = await queryOne<{ count: string }>(
      `SELECT count(*) FROM departments WHERE tenant_id = $1`,
      [auth.tenantId],
    );
    return reply.send({ data: rows, page, pageSize, total: Number(total?.count ?? 0) });
  });

  // GET one (with members joined to user identity)
  app.get('/departments/:id', read, async (request, reply) => {
    const auth = requireAuth(request);
    const { id } = request.params as { id: string };
    const dept = await queryOne(`SELECT * FROM departments WHERE id = $1 AND tenant_id = $2`, [id, auth.tenantId]);
    if (!dept) throw notFound('Department not found');
    const { rows: members } = await query(
      `SELECT m.id, m.user_id, m.role, u.email, u.first_name, u.last_name
         FROM department_members m JOIN users u ON u.id = m.user_id
        WHERE m.department_id = $1
        ORDER BY m.role, u.email`,
      [id],
    );
    return reply.send({ ...dept, members });
  });

  // CREATE
  app.post('/departments', manage, async (request, reply) => {
    const auth = requireAuth(request);
    const data = parse(departmentCreate, request.body);
    const dup = await queryOne(`SELECT id FROM departments WHERE tenant_id = $1 AND name = $2`, [auth.tenantId, data.name]);
    if (dup) throw conflict('A department with that name already exists');
    const row = await queryOne(
      `INSERT INTO departments (tenant_id, name, description, manager_user_id)
       VALUES ($1,$2,$3,$4) RETURNING *`,
      [auth.tenantId, data.name, data.description ?? null, data.manager_user_id ?? null],
    );
    await audit(auth, { action: 'department.create', entity: 'department', entityId: String(row!.id), ip: clientIp(request) });
    return created(reply, row);
  });

  // UPDATE
  app.patch('/departments/:id', manage, async (request, reply) => {
    const auth = requireAuth(request);
    const { id } = request.params as { id: string };
    const data = parse(departmentUpdate, request.body);
    const entries = Object.entries(data).filter(([, v]) => v !== undefined);
    if (entries.length === 0) {
      const cur = await queryOne(`SELECT * FROM departments WHERE id = $1 AND tenant_id = $2`, [id, auth.tenantId]);
      if (!cur) throw notFound('Department not found');
      return reply.send(cur);
    }
    const sets = entries.map(([k], i) => `${k} = $${i + 1}`).concat('updated_at = now()').join(', ');
    const row = await queryOne(
      `UPDATE departments SET ${sets} WHERE id = $${entries.length + 1} AND tenant_id = $${entries.length + 2} RETURNING *`,
      [...entries.map(([, v]) => v), id, auth.tenantId],
    );
    if (!row) throw notFound('Department not found');
    await audit(auth, { action: 'department.update', entity: 'department', entityId: id, ip: clientIp(request) });
    return reply.send(row);
  });

  // DELETE
  app.delete('/departments/:id', manage, async (request, reply) => {
    const auth = requireAuth(request);
    const { id } = request.params as { id: string };
    const row = await queryOne(`DELETE FROM departments WHERE id = $1 AND tenant_id = $2 RETURNING id`, [id, auth.tenantId]);
    if (!row) throw notFound('Department not found');
    await audit(auth, { action: 'department.delete', entity: 'department', entityId: id, ip: clientIp(request) });
    return reply.code(204).send();
  });

  // ── Membership ──────────────────────────────────────────────────────────

  // Add or update a member's department role (upsert).
  app.put('/departments/:id/members', manage, async (request, reply) => {
    const auth = requireAuth(request);
    const { id } = request.params as { id: string };
    const data = parse(memberUpsert, request.body);
    const dept = await queryOne(`SELECT id FROM departments WHERE id = $1 AND tenant_id = $2`, [id, auth.tenantId]);
    if (!dept) throw notFound('Department not found');
    const user = await queryOne(`SELECT id FROM users WHERE id = $1 AND tenant_id = $2`, [data.user_id, auth.tenantId]);
    if (!user) throw notFound('User not found in this tenant');
    const row = await queryOne(
      `INSERT INTO department_members (department_id, user_id, role)
       VALUES ($1,$2,$3)
       ON CONFLICT (department_id, user_id) DO UPDATE SET role = EXCLUDED.role
       RETURNING *`,
      [id, data.user_id, data.role],
    );
    await audit(auth, { action: 'department.member.set', entity: 'department', entityId: id, metadata: { user_id: data.user_id, role: data.role }, ip: clientIp(request) });
    return reply.send(row);
  });

  // Remove a member.
  app.delete('/departments/:id/members/:userId', manage, async (request, reply) => {
    const auth = requireAuth(request);
    const { id, userId } = request.params as { id: string; userId: string };
    const dept = await queryOne(`SELECT id FROM departments WHERE id = $1 AND tenant_id = $2`, [id, auth.tenantId]);
    if (!dept) throw notFound('Department not found');
    await query(`DELETE FROM department_members WHERE department_id = $1 AND user_id = $2`, [id, userId]);
    await audit(auth, { action: 'department.member.remove', entity: 'department', entityId: id, metadata: { user_id: userId }, ip: clientIp(request) });
    return reply.code(204).send();
  });
}
