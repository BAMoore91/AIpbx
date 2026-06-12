import { queryOne } from '../db.js';
import type {
  DidNumberRow,
  ExtensionRow,
  IvrMenuRow,
  QueueRow,
  RingGroupRow,
  AiAgentRow,
  TimeConditionRow,
  DestType,
} from '../types/db.js';

/**
 * Routing engine. Given a tenant + the dialed number (DID for inbound, or an
 * internal number), resolve the destination type and the row that handles it.
 * Time-conditions are followed transitively until a concrete destination is hit.
 */

export interface RouteTarget {
  type: DestType | 'unknown';
  /** The concrete handling row, narrowed by type. */
  extension?: ExtensionRow;
  ivr?: IvrMenuRow;
  queue?: QueueRow;
  ringGroup?: RingGroupRow;
  aiAgent?: AiAgentRow;
  /** For voicemail, the mailbox/extension number. */
  voicemailBox?: string;
}

/** Look up the tenant that owns a DID (inbound calls arrive on a DID). */
export async function resolveDidTenant(
  did: string,
): Promise<DidNumberRow | null> {
  return queryOne<DidNumberRow>(
    `SELECT * FROM did_numbers WHERE e164 = $1 AND is_active = true`,
    [did],
  );
}

/** Resolve an arbitrary (dest_type, dest_id) into a concrete RouteTarget. */
export async function resolveDestination(
  tenantId: string,
  destType: string | null,
  destId: string | null,
  depth = 0,
): Promise<RouteTarget> {
  if (depth > 6 || !destType) return { type: 'unknown' };

  switch (destType) {
    case 'extension': {
      const ext = await lookupExtension(tenantId, destId);
      return ext ? { type: 'extension', extension: ext } : { type: 'unknown' };
    }
    case 'ai_agent': {
      const agent = await queryOne<AiAgentRow>(
        `SELECT * FROM ai_agents
         WHERE tenant_id = $1 AND (id::text = $2 OR number = $2) AND is_active = true`,
        [tenantId, destId],
      );
      return agent ? { type: 'ai_agent', aiAgent: agent } : { type: 'unknown' };
    }
    case 'ivr': {
      const ivr = await queryOne<IvrMenuRow>(
        `SELECT * FROM ivr_menus WHERE tenant_id = $1 AND (id::text = $2 OR number = $2)`,
        [tenantId, destId],
      );
      return ivr ? { type: 'ivr', ivr } : { type: 'unknown' };
    }
    case 'queue': {
      const queue = await queryOne<QueueRow>(
        `SELECT * FROM queues WHERE tenant_id = $1 AND (id::text = $2 OR number = $2)`,
        [tenantId, destId],
      );
      return queue ? { type: 'queue', queue } : { type: 'unknown' };
    }
    case 'ring_group': {
      const rg = await queryOne<RingGroupRow>(
        `SELECT * FROM ring_groups WHERE tenant_id = $1 AND (id::text = $2 OR number = $2)`,
        [tenantId, destId],
      );
      return rg ? { type: 'ring_group', ringGroup: rg } : { type: 'unknown' };
    }
    case 'voicemail':
      return { type: 'voicemail', voicemailBox: destId ?? undefined };
    case 'time_condition': {
      const tc = await queryOne<TimeConditionRow>(
        `SELECT * FROM time_conditions WHERE tenant_id = $1 AND id::text = $2`,
        [tenantId, destId],
      );
      if (!tc) return { type: 'unknown' };
      const matched = isWithinTimeCondition(tc);
      const next = matched
        ? { type: tc.match_dest_type, id: tc.match_dest_id }
        : { type: tc.nomatch_dest_type, id: tc.nomatch_dest_id };
      return resolveDestination(tenantId, next.type, next.id, depth + 1);
    }
    default:
      return { type: 'unknown' };
  }
}

/** Resolve an internally dialed number (no DID) within a tenant. */
export async function resolveInternalNumber(
  tenantId: string,
  number: string,
): Promise<RouteTarget> {
  // Order: extension, ai_agent, queue, ring_group, ivr.
  const ext = await lookupExtension(tenantId, number);
  if (ext) return { type: 'extension', extension: ext };
  for (const t of ['ai_agent', 'queue', 'ring_group', 'ivr'] as const) {
    const r = await resolveDestination(tenantId, t, number);
    if (r.type !== 'unknown') return r;
  }
  return { type: 'unknown' };
}

async function lookupExtension(
  tenantId: string,
  idOrNumber: string | null,
): Promise<ExtensionRow | null> {
  if (!idOrNumber) return null;
  return queryOne<ExtensionRow>(
    `SELECT * FROM extensions WHERE tenant_id = $1 AND (extension = $2 OR id::text = $2)`,
    [tenantId, idOrNumber],
  );
}

/**
 * Evaluate a time condition against the current time in its timezone.
 * Rules: [{ days: ["mon",...], start: "09:00", end: "17:00" }].
 * Holidays (date strings "YYYY-MM-DD") force a non-match.
 */
export function isWithinTimeCondition(
  tc: TimeConditionRow,
  now = new Date(),
): boolean {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: tc.timezone || 'UTC',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const parts = Object.fromEntries(
    fmt.formatToParts(now).map((p) => [p.type, p.value]),
  );
  const weekday = (parts.weekday ?? '').toLowerCase().slice(0, 3);
  const isoDate = `${parts.year}-${parts.month}-${parts.day}`;
  const minutes = Number(parts.hour) * 60 + Number(parts.minute);

  const holidays = Array.isArray(tc.holidays) ? (tc.holidays as unknown[]) : [];
  if (holidays.some((h) => String(h) === isoDate)) return false;

  for (const rule of tc.rules ?? []) {
    const days = (rule.days ?? []).map((d) => d.toLowerCase().slice(0, 3));
    if (days.length && !days.includes(weekday)) continue;
    const start = toMinutes(rule.start);
    const end = toMinutes(rule.end);
    if (start === null || end === null) continue;
    if (minutes >= start && minutes < end) return true;
  }
  return false;
}

function toMinutes(hhmm: string | undefined): number | null {
  if (!hhmm) return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}
