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

  /** Tell the engine to take over a channel with a given agent's config. */
  async notifyCall(input: NotifyCallInput): Promise<void> {
    await this.post('/calls', {
      call_id: input.callId,
      channel_id: input.channelId,
      tenant_id: input.tenantId,
      caller_number: input.callerNumber,
      did: input.did,
      agent: {
        id: input.agent.id,
        name: input.agent.name,
        role: input.agent.role,
        model: input.agent.model,
        system_prompt: input.agent.system_prompt,
        greeting: input.agent.greeting,
        voice_id: input.agent.voice_id,
        stt_provider: input.agent.stt_provider,
        tts_provider: input.agent.tts_provider,
        language: input.agent.language,
        temperature_effort: input.agent.temperature_effort,
        interruptible: input.agent.interruptible,
        max_turns: input.agent.max_turns,
        end_keywords: input.agent.end_keywords,
        tools: input.agent.tools,
        knowledge_base_id: input.agent.knowledge_base_id,
      },
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
