import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { query, queryOne } from '../db.js';
import { logger } from '../logger.js';
import { setPresence } from '../redis.js';
import type { AppContext } from '../context.js';
import type { EventBus } from '../events.js';
import type { CallRow, ExtensionRow, IvrMenuRow } from '../types/db.js';
import { PjsipProvisioner } from './provisioner.js';
import {
  resolveDidTenant,
  resolveDestination,
  resolveInternalNumber,
  resolveExtensionBySipUser,
  sipUserFromChannelName,
  type RouteTarget,
} from './routing.js';
import type {
  AriClient,
  AriModule,
  AriChannel,
  StasisStartEvent,
  ChannelDtmfReceivedEvent,
  DeviceStateChangeEvent,
} from './types.js';

const require = createRequire(import.meta.url);

/**
 * AriController owns the connection to Asterisk's REST Interface, registers the
 * Stasis application, routes inbound calls based on DB state, mirrors call
 * lifecycle into the `calls` table, mirrors device state into endpoint_status,
 * and exposes call-control actions used by the REST API.
 */
export class AriController {
  private client: AriClient | null = null;
  readonly provisioner: PjsipProvisioner;

  /** Per-channel DTMF buffers for IVR digit collection. */
  private readonly dtmfBuffers = new Map<string, string>();

  constructor(
    private readonly ctx: AppContext,
    private readonly events: EventBus,
  ) {
    this.provisioner = new PjsipProvisioner(ctx.crypto, () => this.client);
  }

  getClient(): AriClient | null {
    return this.client;
  }

  /** Require a connected client for call-control actions. */
  private requireClient(): AriClient {
    if (!this.client) throw new Error('ARI not connected');
    return this.client;
  }

  async start(): Promise<void> {
    if (!this.ctx.config.ari.enabled) {
      logger.warn('ARI disabled (ARI_ENABLED=false) — call control inactive');
      return;
    }
    const ariModule = require('ari-client') as AriModule;
    const { url, username, password, app } = this.ctx.config.ari;
    try {
      this.client = await ariModule.connect(url, username, password);
    } catch (err) {
      logger.error({ err }, 'failed to connect to ARI — running without call control');
      this.client = null;
      return;
    }

    const client = this.client;
    client.on('StasisStart', (e) => void this.onStasisStart(e).catch((err) =>
      logger.error({ err }, 'StasisStart handler error'),
    ));
    client.on('StasisEnd', (e) => void this.onStasisEnd(e.channel.id).catch(() => undefined));
    client.on('ChannelStateChange', (e) => void this.onStateChange(e.channel).catch(() => undefined));
    client.on('ChannelDtmfReceived', (e) => this.onDtmf(e));
    client.on('ChannelHangupRequest', (e) =>
      void this.onHangup(e.channel.id, e.cause).catch(() => undefined),
    );
    client.on('DeviceStateChange', (e) => void this.onDeviceState(e).catch(() => undefined));

    client.start(app);
    logger.info({ app, url }, 'ARI connected; Stasis app registered');
  }

  // ---- Inbound routing ----------------------------------------------------

  private async onStasisStart(e: StasisStartEvent): Promise<void> {
    const channel = e.channel;
    const dialed = channel.dialplan?.exten ?? e.args[0] ?? '';
    const callerNumber = channel.caller?.number ?? null;
    const callerName = channel.caller?.name ?? null;

    // Determine tenant + destination. Inbound DID first, else internal number.
    const did = await resolveDidTenant(dialed);
    let tenantId: string;
    let target: RouteTarget;
    let direction: CallRow['direction'] = 'inbound';

    if (did) {
      tenantId = did.tenant_id;
      target = await resolveDestination(tenantId, did.dest_type, did.dest_id);
    } else {
      // Internal call: derive tenant from the calling SIP endpoint (globally
      // unique), falling back to an explicit channel var set during originate.
      tenantId =
        (await this.tenantFromChannel(channel)) ??
        (await this.channelVar(channel, 'AIPBX_TENANT')) ??
        '';
      direction = 'internal';
      target = tenantId
        ? await resolveInternalNumber(tenantId, dialed)
        : { type: 'unknown' };
    }

    if (!tenantId) {
      logger.warn({ dialed, channel: channel.name }, 'unable to determine tenant for call; hanging up');
      await channel.hangup().catch(() => undefined);
      return;
    }

    // Tenant gating: reject calls for suspended tenants or over the plan's
    // concurrent-call ceiling.
    if (!(await this.tenantActive(tenantId))) {
      logger.warn({ tenantId }, 'call for inactive tenant; rejecting');
      await channel.hangup().catch(() => undefined);
      return;
    }
    if (!(await this.withinConcurrencyLimit(tenantId))) {
      logger.warn({ tenantId }, 'tenant concurrent-call limit reached; rejecting');
      await this.safePlayBusy(channel);
      await channel.hangup().catch(() => undefined);
      return;
    }

    const callId = await this.createCallRecord({
      tenantId,
      channel,
      direction,
      did: did?.e164 ?? null,
      toNumber: dialed,
      fromNumber: callerNumber,
      fromName: callerName,
    });

    await this.events.emit(tenantId, 'call.started', {
      callId,
      channelId: channel.id,
      direction,
      from: callerNumber,
      to: dialed,
      did: did?.e164 ?? null,
    });

    await this.dispatch(target, { tenantId, callId, channel, dialed, callerNumber, did: did?.e164 ?? null });
  }

  /** Route a resolved target by handling type. */
  private async dispatch(
    target: RouteTarget,
    ctx: {
      tenantId: string;
      callId: string;
      channel: AriChannel;
      dialed: string;
      callerNumber: string | null;
      did: string | null;
    },
  ): Promise<void> {
    switch (target.type) {
      case 'extension':
        return this.routeToExtension(target.extension!, ctx);
      case 'ai_agent':
        return this.routeToAiAgent(target.aiAgent!, ctx);
      case 'ivr':
        return this.routeToIvr(target.ivr!, ctx);
      case 'queue':
        return this.routeToQueue(target.queue!.id, target.queue!.number, ctx);
      case 'ring_group':
        return this.routeToRingGroup(target.ringGroup!, ctx);
      case 'voicemail':
        return this.routeToVoicemail(target.voicemailBox ?? ctx.dialed, ctx);
      default:
        logger.warn({ dialed: ctx.dialed }, 'no route matched; playing unavailable + hangup');
        await ctx.channel.answer().catch(() => undefined);
        await this.safePlay(ctx.channel, 'sound:ss-noservice');
        await ctx.channel.hangup().catch(() => undefined);
        await this.markEnded(ctx.callId, 'no-route', 'failed');
    }
  }

  private async routeToExtension(
    ext: ExtensionRow,
    ctx: { tenantId: string; callId: string; channel: AriChannel },
  ): Promise<void> {
    await this.setHandledBy(ctx.callId, `extension:${ext.extension}`);
    if (ext.dnd || ext.forward_always) {
      // DND or unconditional forward → go to voicemail (or forward target).
      if (ext.forward_always) {
        await this.originateTo(ctx.channel, ext.forward_always, ctx.tenantId);
        return;
      }
      return this.routeToVoicemail(ext.extension, ctx);
    }
    const dialed = await this.originateAndBridge(
      ctx.channel,
      `PJSIP/${ext.sip_username}`,
      ext.ring_timeout,
    );
    if (!dialed) {
      // No-answer → voicemail if enabled.
      if (ext.voicemail_enabled) return this.routeToVoicemail(ext.extension, ctx);
      await ctx.channel.hangup().catch(() => undefined);
      await this.markEnded(ctx.callId, 'no-answer', 'no-answer');
    }
  }

  private async routeToAiAgent(
    agent: import('../types/db.js').AiAgentRow,
    ctx: {
      tenantId: string;
      callId: string;
      channel: AriChannel;
      callerNumber: string | null;
      did: string | null;
    },
  ): Promise<void> {
    await this.setHandledBy(ctx.callId, `ai_agent:${agent.id}`);
    await query(`UPDATE calls SET ai_agent_id = $1 WHERE id = $2`, [agent.id, ctx.callId]);

    await this.safeAnswer(ctx.channel);
    // Hand the channel + agent config to the AI engine; the dialplan bridges
    // RTP into the engine's AudioSocket. We set vars the dialplan reads.
    // AI_UUID is the key the [aipbx-ai] dialplan context streams to AudioSocket
    // as the first frame; it MUST equal the call_uuid we register with the
    // engine (ctx.callId) so the engine matches this audio stream to the agent.
    await this.setVar(ctx.channel, 'AI_UUID', ctx.callId);
    await this.setVar(ctx.channel, 'AIPBX_CALL_ID', ctx.callId);
    await this.setVar(ctx.channel, 'AIPBX_AGENT_ID', agent.id);
    await this.setVar(ctx.channel, 'AIPBX_TENANT', ctx.tenantId);

    await this.ctx.aiEngine.notifyCall({
      callId: ctx.callId,
      channelId: ctx.channel.id,
      tenantId: ctx.tenantId,
      agent,
      callerNumber: ctx.callerNumber,
      did: ctx.did,
    });

    // Continue into the [aipbx-ai] dialplan context that bridges to the engine.
    try {
      await ctx.channel.continueInDialplan({ context: 'aipbx-ai', extension: 's', priority: 1 });
    } catch (err) {
      logger.warn({ err: (err as Error).message }, 'continueInDialplan to aipbx-ai failed');
    }
    await this.markAnswered(ctx.callId);
  }

  private async routeToIvr(
    ivr: IvrMenuRow,
    ctx: {
      tenantId: string;
      callId: string;
      channel: AriChannel;
      dialed: string;
      callerNumber: string | null;
      did: string | null;
    },
  ): Promise<void> {
    await this.setHandledBy(ctx.callId, `ivr:${ivr.number}`);
    await this.safeAnswer(ctx.channel);
    await this.markAnswered(ctx.callId);

    // Play greeting (TTS prompt is rendered by AI engine / dialplan; here we
    // play an uploaded audio key if present, else a TTS-marker sound).
    const media = ivr.greeting_audio
      ? `sound:${ivr.greeting_audio}`
      : 'sound:vm-enter-num-to-call';
    await this.safePlay(ctx.channel, media);

    // Collect a single DTMF digit; the ChannelDtmfReceived handler resolves it.
    this.dtmfBuffers.set(ctx.channel.id, '');
    const digit = await this.waitForDtmf(ctx.channel.id, (ivr.timeout || 5) * 1000);
    const option = digit ? ivr.options?.[digit] : undefined;

    if (option) {
      const next = await resolveDestination(ctx.tenantId, option.type, option.id);
      return this.dispatch(next, ctx);
    }
    // Timeout / invalid → configured fallback or hangup.
    const fb = digit
      ? { type: ivr.invalid_dest_type, id: ivr.invalid_dest_id }
      : { type: ivr.timeout_dest_type, id: ivr.timeout_dest_id };
    if (fb.type) {
      const next = await resolveDestination(ctx.tenantId, fb.type, fb.id);
      return this.dispatch(next, ctx);
    }
    await ctx.channel.hangup().catch(() => undefined);
    await this.markEnded(ctx.callId, 'ivr-no-input', 'abandoned');
  }

  private async routeToQueue(
    queueId: string,
    queueNumber: string,
    ctx: { tenantId: string; callId: string; channel: AriChannel },
  ): Promise<void> {
    await this.setHandledBy(ctx.callId, `queue:${queueNumber}`);
    await query(`UPDATE calls SET queue_id = $1, status = 'in-progress' WHERE id = $2`, [
      queueId,
      ctx.callId,
    ]);
    await this.safeAnswer(ctx.channel);

    // Put the caller into a holding bridge with MOH, then attempt to connect to
    // the first available (unpaused) member. A production queue would loop with
    // strategy + wrapup; this connects to the first member as a baseline.
    const client = this.requireClient();
    const bridgeId = `queue-${queueId}`;
    let bridge;
    try {
      bridge = await client.bridges.get({ bridgeId }).catch(async () =>
        client.bridges.create({ type: 'holding', bridgeId }),
      );
      await bridge.addChannel({ channel: ctx.channel.id });
    } catch (err) {
      logger.warn({ err: (err as Error).message }, 'queue bridge add failed');
    }

    await this.events.emit(ctx.tenantId, 'queue.stats', {
      queueId,
      event: 'enqueue',
      callId: ctx.callId,
    });

    const member = await queryOne<{ extension: string; sip_username: string }>(
      `SELECT qm.extension, e.sip_username
       FROM queue_members qm
       JOIN extensions e ON e.tenant_id = $1 AND e.extension = qm.extension
       WHERE qm.queue_id = $2 AND qm.paused = false
       ORDER BY qm.penalty ASC LIMIT 1`,
      [ctx.tenantId, queueId],
    );
    if (member) {
      await this.originateAndBridge(ctx.channel, `PJSIP/${member.sip_username}`, 30);
    }
  }

  private async routeToRingGroup(
    rg: import('../types/db.js').RingGroupRow,
    ctx: { tenantId: string; callId: string; channel: AriChannel },
  ): Promise<void> {
    await this.setHandledBy(ctx.callId, `ring_group:${rg.number}`);
    await this.safeAnswer(ctx.channel);

    // Resolve member extensions → sip_usernames; ringall = originate all and
    // bridge the first to answer. Baseline: try members sequentially.
    const members = await query<{ extension: string; sip_username: string }>(
      `SELECT extension, sip_username FROM extensions
       WHERE tenant_id = $1 AND extension = ANY($2::text[])`,
      [ctx.tenantId, rg.members],
    );
    for (const m of members.rows) {
      const answered = await this.originateAndBridge(
        ctx.channel,
        `PJSIP/${m.sip_username}`,
        rg.ring_timeout,
      );
      if (answered) return;
      if (rg.strategy === 'ringall') break; // ringall handled in one pass below
    }
    // Failover.
    if (rg.fail_dest_type) {
      const next = await resolveDestination(ctx.tenantId, rg.fail_dest_type, rg.fail_dest_id);
      return this.dispatch(next, { ...ctx, dialed: rg.number, callerNumber: null, did: null });
    }
    await ctx.channel.hangup().catch(() => undefined);
    await this.markEnded(ctx.callId, 'ring-group-no-answer', 'no-answer');
  }

  private async routeToVoicemail(
    mailbox: string,
    ctx: { tenantId: string; callId: string; channel: AriChannel },
  ): Promise<void> {
    await this.setHandledBy(ctx.callId, `voicemail:${mailbox}`);
    await this.safeAnswer(ctx.channel);
    await this.safePlay(ctx.channel, 'sound:vm-intro');
    // Record the message; on StasisEnd the recording is finalized by the
    // dialplan/AMI side which writes the voicemails row + s3 upload. Here we
    // start an ARI recording as the capture mechanism.
    try {
      await ctx.channel.record({
        name: `vm-${ctx.callId}`,
        format: 'wav',
        maxDurationSeconds: 120,
        beep: true,
        ifExists: 'overwrite',
      });
    } catch (err) {
      logger.warn({ err: (err as Error).message }, 'voicemail record failed');
    }
    await query(`UPDATE calls SET status = 'in-progress' WHERE id = $1`, [ctx.callId]);
    // The voicemails table row + email notification are created by the
    // post-record pipeline (see services/email + routes). TODO: wire MonitorStop.
  }

  // ---- Lifecycle persistence ---------------------------------------------

  private async createCallRecord(p: {
    tenantId: string;
    channel: AriChannel;
    direction: CallRow['direction'];
    did: string | null;
    toNumber: string;
    fromNumber: string | null;
    fromName: string | null;
  }): Promise<string> {
    const id = randomUUID();
    await query(
      `INSERT INTO calls (id, tenant_id, channel_id, linkedid, direction, from_number, from_name, to_number, did, status)
       VALUES ($1,$2,$3,$3,$4,$5,$6,$7,$8,'ringing')`,
      [id, p.tenantId, p.channel.id, p.direction, p.fromNumber, p.fromName, p.toNumber, p.did],
    );
    return id;
  }

  private async markAnswered(callId: string): Promise<void> {
    const row = await queryOne<CallRow>(
      `UPDATE calls SET status = 'answered', answered_at = now(),
         ring_seconds = EXTRACT(EPOCH FROM (now() - started_at))::int
       WHERE id = $1 AND answered_at IS NULL RETURNING *`,
      [callId],
    );
    if (row) {
      await this.events.emit(row.tenant_id, 'call.updated', { callId, status: 'answered' });
    }
  }

  private async markEnded(
    callId: string,
    cause: string,
    disposition: string,
  ): Promise<void> {
    const row = await queryOne<CallRow>(
      `UPDATE calls SET status = 'ended', ended_at = now(),
         hangup_cause = $2, disposition = COALESCE(disposition, $3),
         talk_seconds = CASE WHEN answered_at IS NOT NULL
           THEN EXTRACT(EPOCH FROM (now() - answered_at))::int ELSE 0 END
       WHERE id = $1 AND ended_at IS NULL RETURNING *`,
      [callId, cause, disposition],
    );
    if (!row) return;
    await this.events.emit(row.tenant_id, 'call.ended', {
      callId,
      disposition: row.disposition,
      talkSeconds: row.talk_seconds,
    });
    // Request an AI post-call summary if this was an AI-handled call.
    if (row.ai_agent_id) {
      const summary = await this.ctx.aiEngine.requestSummary(callId);
      if (summary) {
        await query(
          `UPDATE calls SET summary = $2, sentiment = $3, sentiment_score = $4 WHERE id = $1`,
          [callId, summary.summary, summary.sentiment, summary.sentimentScore],
        );
      }
    }
  }

  private async onStasisEnd(channelId: string): Promise<void> {
    this.dtmfBuffers.delete(channelId);
    const call = await queryOne<CallRow>(`SELECT * FROM calls WHERE channel_id = $1`, [channelId]);
    if (call && call.status !== 'ended') {
      await this.markEnded(call.id, call.hangup_cause ?? 'normal', call.disposition ?? 'answered');
    }
  }

  private async onHangup(channelId: string, cause?: number): Promise<void> {
    const call = await queryOne<CallRow>(`SELECT * FROM calls WHERE channel_id = $1`, [channelId]);
    if (call) {
      await this.markEnded(call.id, cause ? `cause-${cause}` : 'hangup', call.disposition ?? 'answered');
    }
  }

  private async onStateChange(channel: AriChannel): Promise<void> {
    if (channel.state === 'Up') {
      const call = await queryOne<CallRow>(`SELECT id FROM calls WHERE channel_id = $1`, [channel.id]);
      if (call) await this.markAnswered(call.id);
    }
  }

  private onDtmf(e: ChannelDtmfReceivedEvent): void {
    const buf = this.dtmfBuffers.get(e.channel.id);
    if (buf !== undefined) this.dtmfBuffers.set(e.channel.id, buf + e.digit);
  }

  private async onDeviceState(e: DeviceStateChangeEvent): Promise<void> {
    // device name like "PJSIP/1001" → sip_username "1001"
    const name = e.device_state.name;
    const sip = name.includes('/') ? name.split('/')[1] : name;
    const state = mapDeviceState(e.device_state.state);
    const ext = await queryOne<{ tenant_id: string }>(
      `SELECT tenant_id FROM extensions WHERE sip_username = $1`,
      [sip],
    );
    if (!ext) return;
    await query(
      `INSERT INTO endpoint_status (sip_username, state, last_seen)
       VALUES ($1, $2, now())
       ON CONFLICT (sip_username) DO UPDATE SET state = EXCLUDED.state, last_seen = now()`,
      [sip, state],
    );
    await setPresence(ext.tenant_id, sip, state);
  }

  // ---- Call-control actions (used by REST) --------------------------------

  async originate(p: {
    tenantId: string;
    endpoint: string; // e.g. PJSIP/1001 or PJSIP/trunk_xxx/+1555...
    callerId?: string;
    context?: string;
    extension?: string;
    variables?: Record<string, string>;
  }): Promise<{ channelId: string; callId: string }> {
    const client = this.requireClient();
    const channel = await client.channels.originate({
      endpoint: p.endpoint,
      app: this.ctx.config.ari.app,
      appArgs: p.extension ?? '',
      callerId: p.callerId,
      variables: { AIPBX_TENANT: p.tenantId, ...(p.variables ?? {}) },
    });
    const callId = await this.createCallRecord({
      tenantId: p.tenantId,
      channel,
      direction: 'outbound',
      did: null,
      toNumber: p.extension ?? p.endpoint,
      fromNumber: p.callerId ?? null,
      fromName: null,
    });
    await this.events.emit(p.tenantId, 'call.started', { callId, channelId: channel.id, direction: 'outbound' });
    return { channelId: channel.id, callId };
  }

  async hangup(channelId: string): Promise<void> {
    await this.requireClient().channels.hangup({ channelId });
  }

  async hold(channelId: string, on: boolean): Promise<void> {
    const client = this.requireClient();
    if (on) await client.channels.hold({ channelId });
    else await client.channels.unhold({ channelId });
  }

  async sendDtmf(channelId: string, dtmf: string): Promise<void> {
    await this.requireClient().channels.sendDTMF({ channelId, dtmf });
  }

  async startRecording(channelId: string, callId: string): Promise<string> {
    const name = `rec-${callId}-${Date.now()}`;
    await this.requireClient().channels.record({
      channelId,
      name,
      format: 'wav',
      ifExists: 'overwrite',
    });
    return name;
  }

  async stopRecording(name: string): Promise<void> {
    // ari-client exposes recordings.stop; we model it loosely.
    const client = this.requireClient() as unknown as {
      recordings?: { stop(o: { recordingName: string }): Promise<void> };
    };
    await client.recordings?.stop({ recordingName: name });
  }

  /** Blind transfer: redirect the channel to another extension/destination. */
  async transfer(channelId: string, tenantId: string, destination: string): Promise<void> {
    const channel = await this.requireClient().channels.get({ channelId });
    const target = await resolveInternalNumber(tenantId, destination);
    if (target.type === 'extension' && target.extension) {
      await this.originateTo(channel, target.extension.extension, tenantId);
    } else {
      await channel.continueInDialplan({ context: 'aipbx-internal', extension: destination, priority: 1 });
    }
  }

  // ---- Bridging helpers ---------------------------------------------------

  /**
   * Originate a leg to `endpoint`, and on answer bridge it with the caller.
   * Returns true if the new leg answered within the ring window.
   */
  private async originateAndBridge(
    caller: AriChannel,
    endpoint: string,
    ringTimeout: number,
  ): Promise<boolean> {
    const client = this.requireClient();
    let leg: AriChannel;
    try {
      leg = await client.channels.originate({
        endpoint,
        app: this.ctx.config.ari.app,
        timeout: ringTimeout,
        callerId: caller.caller?.number,
      });
    } catch (err) {
      logger.warn({ err: (err as Error).message, endpoint }, 'originate failed');
      return false;
    }

    const answered = await this.waitForUp(leg.id, ringTimeout * 1000);
    if (!answered) {
      await client.channels.hangup({ channelId: leg.id }).catch(() => undefined);
      return false;
    }
    try {
      const bridge = await client.bridges.create({ type: 'mixing' });
      await bridge.addChannel({ channel: caller.id });
      await bridge.addChannel({ channel: leg.id });
      const call = await queryOne<CallRow>(`SELECT id FROM calls WHERE channel_id = $1`, [caller.id]);
      if (call) await this.markAnswered(call.id);
      return true;
    } catch (err) {
      logger.warn({ err: (err as Error).message }, 'bridge failed');
      return false;
    }
  }

  private async originateTo(caller: AriChannel, number: string, tenantId: string): Promise<void> {
    const target = await resolveInternalNumber(tenantId, number);
    if (target.type === 'extension' && target.extension) {
      await this.originateAndBridge(caller, `PJSIP/${target.extension.sip_username}`, 25);
    } else {
      await caller.continueInDialplan({ context: 'aipbx-internal', extension: number, priority: 1 });
    }
  }

  // ---- Small async utilities ----------------------------------------------

  private async waitForUp(channelId: string, timeoutMs: number): Promise<boolean> {
    const client = this.requireClient();
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      try {
        const ch = await client.channels.get({ channelId });
        if (ch.state === 'Up') return true;
      } catch {
        return false; // channel gone
      }
      await sleep(300);
    }
    return false;
  }

  private async waitForDtmf(channelId: string, timeoutMs: number): Promise<string | null> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const buf = this.dtmfBuffers.get(channelId);
      if (buf && buf.length > 0) return buf[0]!;
      await sleep(150);
    }
    return null;
  }

  private async channelVar(channel: AriChannel, name: string): Promise<string | null> {
    try {
      const client = this.requireClient() as unknown as {
        channels: { getChannelVar(o: { channelId: string; variable: string }): Promise<{ value: string }> };
      };
      const res = await client.channels.getChannelVar({ channelId: channel.id, variable: name });
      return res.value || null;
    } catch {
      return null;
    }
  }

  /**
   * Derive the tenant from the CALLING channel. The PJSIP channel name is
   * `PJSIP/<sip_username>-<seq>`; sip_username is globally unique, so this is
   * the correct multi-tenant signal. We deliberately do NOT fall back to the
   * caller's extension number — that collides across tenants.
   */
  private async tenantFromChannel(channel: AriChannel): Promise<string | null> {
    const sipUser = sipUserFromChannelName(channel.name);
    if (!sipUser) return null;
    const ext = await resolveExtensionBySipUser(sipUser);
    return ext?.tenant_id ?? null;
  }

  /**
   * Enforce the tenant's concurrent-call ceiling (plan limit). Counts calls in
   * flight for the tenant; returns true if a new call is allowed.
   */
  private async withinConcurrencyLimit(tenantId: string): Promise<boolean> {
    const row = await queryOne<{ active: string; max_concurrent_calls: number }>(
      `SELECT
         (SELECT count(*) FROM calls
            WHERE tenant_id = $1 AND status NOT IN ('ended')) AS active,
         t.max_concurrent_calls
       FROM tenants t WHERE t.id = $1`,
      [tenantId],
    );
    if (!row) return false;
    return Number(row.active) < row.max_concurrent_calls;
  }

  /** Whether the tenant exists and is active (not suspended). */
  private async tenantActive(tenantId: string): Promise<boolean> {
    const row = await queryOne<{ is_active: boolean }>(
      `SELECT is_active FROM tenants WHERE id = $1`,
      [tenantId],
    );
    return row?.is_active === true;
  }

  /** Best-effort "all circuits busy" tone before rejecting a call. */
  private async safePlayBusy(channel: AriChannel): Promise<void> {
    try {
      await channel.answer?.();
      await channel.play?.({ media: 'sound:congestion' });
    } catch {
      /* ignore — we're hanging up anyway */
    }
  }

  private async setVar(channel: AriChannel, variable: string, value: string): Promise<void> {
    try {
      await channel.setChannelVar({ variable, value });
    } catch (err) {
      logger.debug({ err: (err as Error).message, variable }, 'setChannelVar failed');
    }
  }

  private async safeAnswer(channel: AriChannel): Promise<void> {
    try {
      await channel.answer();
    } catch (err) {
      logger.debug({ err: (err as Error).message }, 'answer failed');
    }
  }

  private async safePlay(channel: AriChannel, media: string): Promise<void> {
    try {
      await channel.play({ media });
    } catch (err) {
      logger.debug({ err: (err as Error).message, media }, 'play failed');
    }
  }

  private async setHandledBy(callId: string, handledBy: string): Promise<void> {
    await query(`UPDATE calls SET handled_by = $2 WHERE id = $1`, [callId, handledBy]);
  }

  async stop(): Promise<void> {
    try {
      this.client?.stop?.();
    } catch {
      /* ignore */
    }
    this.client = null;
  }
}

function mapDeviceState(state: string): string {
  switch (state.toUpperCase()) {
    case 'NOT_INUSE':
      return 'available';
    case 'INUSE':
      return 'inuse';
    case 'BUSY':
      return 'busy';
    case 'RINGING':
    case 'RINGINUSE':
      return 'ringing';
    case 'UNAVAILABLE':
    case 'INVALID':
      return 'unavailable';
    default:
      return 'unavailable';
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// Local alias so the file's row typings stay readable.
type CallRowDirection = CallRow['direction'];
export type { CallRowDirection };
