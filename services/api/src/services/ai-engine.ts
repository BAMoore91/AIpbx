import { logger } from '../logger.js';
import type { AiAgentRow } from '../types/db.js';

/**
 * HTTP client for the Python AI engine. The API tells the engine which
 * ai_agent should handle a Stasis call (the dialplan bridges audio via the
 * engine's AudioSocket server). After hangup the API can request a post-call
 * summary/sentiment.
 */
export interface NotifyCallInput {
  callId: string; // our generated calls.id UUID
  channelId: string; // Asterisk channel uniqueid
  tenantId: string;
  agent: AiAgentRow;
  callerNumber: string | null;
  did: string | null;
}

export interface PostCallSummary {
  summary: string | null;
  sentiment: 'positive' | 'neutral' | 'negative' | null;
  sentimentScore: number | null;
}

export class AiEngineClient {
  constructor(private readonly baseUrl: string) {}

  private async post<T>(path: string, body: unknown): Promise<T | null> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    try {
      const res = await fetch(`${this.baseUrl}${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (!res.ok) {
        logger.warn({ path, status: res.status }, 'ai-engine non-2xx');
        return null;
      }
      return (await res.json()) as T;
    } catch (err) {
      logger.warn({ err, path }, 'ai-engine request failed');
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Tell the engine to take over a channel with a given agent.
   * Contract (matches ai-engine RegisterCall): the engine keys the upcoming
   * AudioSocket connection by `call_uuid` (streamed by the dialplan as the
   * first frame) and loads the full agent config from its own DB by `agent_id`.
   * `call_uuid` MUST equal the value the dialplan passes to AudioSocket — the
   * API sets channel var AI_UUID to this same callId before continuing.
   */
  async notifyCall(input: NotifyCallInput): Promise<void> {
    await this.post('/calls', {
      call_uuid: input.callId,
      agent_id: input.agent.id,
      tenant_id: input.tenantId,
      channel_id: input.channelId,
      caller_number: input.callerNumber,
      did: input.did,
    });
  }

  /** Ask the engine to end / clean up an AI call. */
  async endCall(callId: string): Promise<void> {
    await this.post(`/calls/${callId}/end`, {});
  }

  async requestSummary(callId: string): Promise<PostCallSummary | null> {
    return this.post<PostCallSummary>(`/calls/${callId}/summary`, {});
  }
}
