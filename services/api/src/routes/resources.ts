import type { FastifyInstance } from 'fastify';
import type { QueryResultRow } from 'pg';
import { registerCrud } from './crud.js';
import * as S from './schemas.js';
import type { AriController } from '../ari/controller.js';
import type { ExtensionRow, TrunkRow } from '../types/db.js';

/**
 * Wires up CRUD routes for all tenant-scoped resources. Extensions and trunks
 * get secret encryption + PJSIP provisioning hooks; the rest are plain CRUD.
 */
export function registerResourceRoutes(
  app: FastifyInstance,
  ari: AriController,
): void {
  const crypto = app.ctx.crypto;

  // Extensions: encrypt sip_password, provision PJSIP on write, redact secret.
  registerCrud<unknown, unknown>(app, {
    resource: 'extensions',
    table: 'extensions',
    createSchema: S.extensionCreate,
    updateSchema: S.extensionUpdate,
    beforeCreate: (data) => {
      const d = data as Record<string, unknown>;
      return { ...d, sip_password: crypto.encrypt(String(d.sip_password)) };
    },
    beforeUpdate: (data) => {
      const d = data as Record<string, unknown>;
      if (d.sip_password) return { ...d, sip_password: crypto.encrypt(String(d.sip_password)) };
      return d;
    },
    afterWrite: async (op, row) => {
      const ext = row as unknown as ExtensionRow;
      if (op === 'delete') await ari.provisioner.removeExtension(ext.sip_username);
      else await ari.provisioner.syncExtension(ext);
    },
    redact: redactSecret('sip_password'),
  });

  // Trunks: encrypt secret, provision PJSIP trunk, redact secret.
  registerCrud<unknown, unknown>(app, {
    resource: 'trunks',
    table: 'trunks',
    createSchema: S.trunkCreate,
    updateSchema: S.trunkUpdate,
    beforeCreate: (data) => {
      const d = data as Record<string, unknown>;
      if (d.secret) return { ...d, secret: crypto.encrypt(String(d.secret)) };
      return d;
    },
    beforeUpdate: (data) => {
      const d = data as Record<string, unknown>;
      if (d.secret) return { ...d, secret: crypto.encrypt(String(d.secret)) };
      return d;
    },
    afterWrite: async (op, row) => {
      if (op !== 'delete') await ari.provisioner.syncTrunk(row as unknown as TrunkRow);
    },
    redact: redactSecret('secret'),
  });

  registerCrud(app, { resource: 'did_numbers', table: 'did_numbers', createSchema: S.didCreate, updateSchema: S.didUpdate });
  registerCrud(app, { resource: 'outbound_routes', table: 'outbound_routes', orderBy: 'priority ASC', createSchema: S.outboundRouteCreate, updateSchema: S.outboundRouteUpdate });
  registerCrud(app, { resource: 'ring_groups', table: 'ring_groups', createSchema: S.ringGroupCreate, updateSchema: S.ringGroupUpdate });
  registerCrud(app, { resource: 'queues', table: 'queues', createSchema: S.queueCreate, updateSchema: S.queueUpdate });
  registerCrud(app, { resource: 'ivr_menus', table: 'ivr_menus', createSchema: S.ivrCreate, updateSchema: S.ivrUpdate });
  registerCrud(app, { resource: 'time_conditions', table: 'time_conditions', createSchema: S.timeConditionCreate, updateSchema: S.timeConditionUpdate });
  registerCrud(app, { resource: 'ai_agents', table: 'ai_agents', createSchema: S.aiAgentCreate, updateSchema: S.aiAgentUpdate });
  registerCrud(app, { resource: 'knowledge_bases', table: 'knowledge_bases', createSchema: S.knowledgeBaseCreate, updateSchema: S.knowledgeBaseUpdate });
  registerCrud(app, { resource: 'webhooks', table: 'webhooks', createSchema: S.webhookCreate, updateSchema: S.webhookUpdate, redact: redactSecret('secret') });
}

function redactSecret(col: string) {
  return (row: QueryResultRow): QueryResultRow => {
    if (row && col in row) {
      const copy = { ...row };
      copy[col] = row[col] ? '***' : null;
      return copy;
    }
    return row;
  };
}
