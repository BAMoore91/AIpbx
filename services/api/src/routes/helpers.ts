import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { badRequest, unauthorized } from '../errors.js';
import type { AuthContext, Paginated } from '../types/http.js';

/** Parse a body/query/params with a zod schema or throw a 400. */
export function parse<T extends z.ZodTypeAny>(schema: T, data: unknown): z.infer<T> {
  const res = schema.safeParse(data);
  if (!res.success) {
    throw badRequest('Validation failed', res.error.flatten());
  }
  return res.data;
}

/** Require and return the auth context (set by the authenticate preHandler). */
export function requireAuth(request: FastifyRequest): AuthContext {
  if (!request.auth) throw unauthorized();
  return request.auth;
}

export const PaginationQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});

export function paginate<T>(
  data: T[],
  total: number,
  page: number,
  pageSize: number,
): Paginated<T> {
  return { data, page, pageSize, total };
}

export function offset(page: number, pageSize: number): number {
  return (page - 1) * pageSize;
}

/** Send a created resource with 201. */
export function created(reply: FastifyReply, body: unknown): void {
  reply.code(201).send(body);
}

export function clientIp(request: FastifyRequest): string | null {
  const fwd = request.headers['x-forwarded-for'];
  if (typeof fwd === 'string') return fwd.split(',')[0]!.trim();
  return request.ip ?? null;
}
