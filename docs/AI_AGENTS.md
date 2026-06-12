# AIpbx — AI Voice Agents

## What Is an AI Voice Agent?

An AI voice agent in AIpbx is a programmable phone endpoint powered by a large language model. From the telephony perspective it is a PJSIP extension that Asterisk can dial like any other extension. From the software perspective it is a real-time bidirectional audio pipeline:

```
Asterisk AudioSocket → ai-engine → STT → LLM → TTS → AudioSocket → Asterisk
```

Agents can:
- Answer inbound calls and converse naturally in any language.
- Execute tools (transfer, SMS, CRM lookup, ticket creation) mid-conversation.
- Consult a knowledge base for accurate answers.
- Hand off to a human agent when needed.
- Summarize every call with sentiment analysis after hangup.

---

## Creating an Agent

### Via the Web UI

Navigate to **Settings → AI Agents → New Agent**. Fill in the fields described below.

### Via the REST API

```bash
curl -X POST https://DOMAIN/api/ai-agents \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Front Desk",
    "number": "9000",
    "role": "receptionist",
    "model": "claude-opus-4-8",
    "systemPrompt": "You are the receptionist for Acme Corp...",
    "greeting": "Thank you for calling Acme. How can I help you?",
    "voiceId": "21m00Tcm4TlvDq8ikWAM",
    "interruptible": true,
    "fallbackDestType": "extension",
    "fallbackDestId": "1001"
  }'
```

Route a DID to the agent:

```bash
curl -X PUT https://DOMAIN/api/did-numbers/$DID_ID \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"destType": "ai_agent", "destId": "$AGENT_ID"}'
```

---

## Field Reference

| Field                | Type     | Description                                                        |
|----------------------|----------|--------------------------------------------------------------------|
| `name`               | string   | Display name (not spoken to callers)                               |
| `number`             | string   | Internal dialable extension (e.g. "9000")                          |
| `role`               | enum     | receptionist \| sales \| support \| survey \| outbound             |
| `model`              | string   | LLM model ID (see Model Selection below)                           |
| `systemPrompt`       | string   | Full persona and instruction prompt                                |
| `greeting`           | string   | First spoken line when call is answered                            |
| `voiceId`            | string   | TTS voice ID (ElevenLabs or Azure voice name)                      |
| `sttProvider`        | enum     | deepgram \| openai \| whisper-local                                |
| `ttsProvider`        | enum     | elevenlabs \| openai \| azure \| piper-local                       |
| `language`           | string   | BCP-47 language code (e.g. "en", "es", "fr")                      |
| `temperatureEffort`  | enum     | low \| medium \| high — maps to Claude's extended thinking effort  |
| `interruptible`      | boolean  | Whether the caller can barge-in and interrupt the agent            |
| `maxTurns`           | integer  | Maximum conversation turns before forced handoff (default: 40)     |
| `endKeywords`        | string[] | Phrases that trigger graceful call end                             |
| `tools`              | JSON     | Tool definitions the LLM can invoke                                |
| `knowledgeBaseId`    | UUID     | Knowledge base to inject context from                              |
| `fallbackDestType`   | enum     | extension \| queue \| voicemail — handoff target type              |
| `fallbackDestId`     | string   | Extension number, queue number, or voicemail extension             |

---

## Model Selection

AIpbx uses Claude (Anthropic) as the LLM brain by default. The model choice significantly affects response quality and latency.

### claude-opus-4-8 (default)

- **Best for**: Complex reasoning, nuanced multi-turn conversations, tool use with dependencies, sensitive customer interactions (support, sales qualification).
- **Latency**: First audio token ~350–500 ms after end-of-speech.
- **Cost**: Higher per-token cost.
- **Recommended when**: Call quality and reasoning depth matter more than raw latency.

### claude-haiku-4-5 (low-latency)

- **Best for**: High-volume inbound (reception, IVR replacement), simple Q&A, survey collection, appointment reminders.
- **Latency**: First audio token ~150–250 ms after end-of-speech.
- **Cost**: Significantly lower per-token cost.
- **Recommended when**: Call volume is high, conversations are structured, and 200 ms of extra perceived responsiveness improves caller satisfaction.

**Switching models per agent** is supported — you can run the front desk on Haiku and the sales bot on Opus simultaneously.

```json
{
  "model": "claude-haiku-4-5",
  "temperatureEffort": "low"
}
```

---

## System Prompt Design

The system prompt is the most important configuration for an AI agent. It defines the agent's persona, knowledge, capabilities, and behavioral constraints.

### Structure

```
[Identity]
You are [Name], the [role] for [Company Name].

[Core responsibilities]
Your job is to...

[Specific knowledge]
Business hours: ...
Main products/services: ...
Key contact extensions: ...

[Behavioral rules]
- Always confirm caller's name and phone number before transferring.
- Never quote prices — route pricing questions to sales (extension 1001).
- If the caller is frustrated, de-escalate before attempting to resolve.
- Keep responses to 2 sentences or fewer unless more detail is requested.

[Available actions]
You can: transfer calls, take messages, check availability, create tickets.
You cannot: access account information, process payments.

[Escalation trigger]
If the caller explicitly asks for a human, use the transfer_call tool immediately.
```

### Receptionist Example

```
You are Aria, the AI front desk assistant for Acme Corp.

Your responsibilities:
- Greet callers and identify their needs.
- Answer questions about office hours (Mon–Fri 9–6 PM Eastern), location (123 Main St, Boston), and general services.
- Transfer callers to the right team:
  * Sales → extension 1001
  * Support → extension 1002  
  * Billing → extension 1003
  * Management → extension 1004
- Take messages when staff are unavailable, collecting name, phone number, and purpose.

Keep responses concise — callers are on the phone. Never fabricate company information.
If unsure, say "Let me connect you with someone who can help."
```

### Sales Agent Example

```
You are Jordan, an AI sales assistant for Acme Corp.

Your goal is to qualify inbound leads and book discovery calls.

Qualification questions (ask naturally, not as a checklist):
1. What problem are you trying to solve?
2. What's your team size and current solution?
3. What's your timeline for making a change?
4. Are you the decision maker or is someone else involved?

When a lead is qualified (clear need + timeline + budget authority): use book_appointment tool.
When unqualified: offer resources and a follow-up email.
Never pressure. Always be helpful first.

Pricing: Do not quote specific prices. Say "pricing depends on your configuration — our team will walk you through that on the discovery call."
```

### Support Agent Example

```
You are Sam, an AI support agent for Acme Corp software.

You have access to our knowledge base with troubleshooting guides and FAQs.
Always check the knowledge base before asking the caller for details.

Process:
1. Identify the product and issue.
2. Search knowledge base for a solution.
3. Walk the caller through the fix step by step.
4. If unresolved after 2 attempts, create a support ticket and transfer to Tier-2 (extension 1005).
5. Always get the caller's name, email, and account ID before escalating.

Tone: Patient, clear, technical when needed. Avoid jargon with non-technical callers.
```

---

## Greeting Design

The `greeting` is spoken immediately when the call connects (before the caller says anything). Good greetings are:

- **Short**: Under 2 sentences.
- **Branded**: Include the company name.
- **Clear about AI**: Callers should know they're talking to an AI or assistant (regulations in some jurisdictions require this).
- **Inviting**: End with an open question.

```
"Thank you for calling Acme Corp. I'm Aria, your AI assistant — how can I help you today?"
```

```
"Acme support, this is Sam. What can I help you with?"
```

---

## Voice Selection

### ElevenLabs (default, recommended)

High-quality neural TTS with emotion. Requires `ELEVENLABS_API_KEY`.

| Voice ID                     | Name     | Character                    |
|------------------------------|----------|------------------------------|
| `21m00Tcm4TlvDq8ikWAM`       | Rachel   | Professional, neutral female |
| `ErXwobaYiN019PkySvjV`       | Antoni   | Professional male            |
| `VR6AewLTigWG4xSOukaG`       | Arnold   | Authoritative male           |
| `pNInz6obpgDQGcFmaJgB`       | Adam     | Conversational male          |
| `yoZ06aMxZJJ28mfd3POQ`       | Sam      | Casual, friendly             |

Latency: First audio ~100 ms (streaming enabled).

### OpenAI TTS

Good quality, slightly lower latency than ElevenLabs. Set `TTS_PROVIDER=openai`. Uses `OPENAI_API_KEY`.

### Azure TTS (enterprise)

Best for compliance-sensitive deployments where data must stay in a specific Azure region. Set `TTS_PROVIDER=azure`. Uses `AZURE_TTS_KEY` and `AZURE_TTS_REGION`.

### piper-local (on-premise)

Open-source TTS running on the droplet. Zero external API calls, lowest cost, acceptable quality. Latency is ~50–150 ms depending on droplet size.

---

## Tools

Tools let the AI agent take actions during a call. The agent calls tools autonomously based on the conversation — no explicit commands from the caller are needed.

### Built-in Tools

These tools are implemented by the ai-engine and activated by including them in the `tools` array:

#### transfer_call

Transfer the call to a human extension or queue.

```json
{
  "name": "transfer_call",
  "description": "Transfer the caller to a human agent or department",
  "parameters": {
    "type": "object",
    "properties": {
      "destination": {
        "type": "string",
        "description": "Extension number or queue number to transfer to (e.g. '1001', '200')"
      },
      "reason": {
        "type": "string",
        "description": "Brief reason for transfer, announced to the receiving agent"
      }
    },
    "required": ["destination"]
  }
}
```

#### send_sms

Send an SMS to the caller (requires SMS/messaging trunk).

```json
{
  "name": "send_sms",
  "description": "Send an SMS message to the caller's phone number",
  "parameters": {
    "type": "object",
    "properties": {
      "message": {
        "type": "string",
        "description": "The SMS message text (max 160 chars)"
      }
    },
    "required": ["message"]
  }
}
```

#### take_message

Record a message for a specific extension.

```json
{
  "name": "take_message",
  "description": "Record a message to be delivered to a team member",
  "parameters": {
    "type": "object",
    "properties": {
      "for_extension": { "type": "string" },
      "caller_name": { "type": "string" },
      "caller_number": { "type": "string" },
      "message": { "type": "string" },
      "callback_time": { "type": "string", "description": "Best time to call back" }
    },
    "required": ["for_extension", "caller_name", "message"]
  }
}
```

#### end_call

Gracefully end the call.

```json
{
  "name": "end_call",
  "description": "End the call politely after saying goodbye",
  "parameters": {
    "type": "object",
    "properties": {
      "farewell_message": {
        "type": "string",
        "description": "Optional farewell to speak before hanging up"
      }
    }
  }
}
```

### Custom Tools (Webhooks)

For tools that require external API calls (CRM lookup, appointment booking, ticket creation), define the tool schema in the `tools` array and configure a webhook URL in the agent's `settings.tool_webhook_url`. The ai-engine will POST tool calls to that URL and inject the response into the conversation context.

```json
{
  "name": "lookup_account",
  "description": "Look up a customer account by phone number",
  "parameters": {
    "type": "object",
    "properties": {
      "phone_number": { "type": "string", "description": "E.164 phone number" }
    },
    "required": ["phone_number"]
  }
}
```

Webhook payload from ai-engine:
```json
{
  "tool": "lookup_account",
  "callId": "uuid",
  "agentId": "uuid",
  "arguments": { "phone_number": "+15551234567" }
}
```

Expected response (200):
```json
{
  "result": "Account found: John Doe, Plan: Pro, Status: Active, Last contact: 2024-01-10"
}
```

---

## Knowledge Bases

A knowledge base stores documents the agent can reference to answer questions accurately.

### Creating a Knowledge Base

```bash
# Create KB
KB=$(curl -sX POST https://DOMAIN/api/knowledge-bases \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"name": "Product FAQ", "description": "Answers to common product questions"}')

KB_ID=$(echo $KB | jq -r .id)

# Upload a document
curl -X POST https://DOMAIN/api/knowledge-bases/$KB_ID/documents \
  -H "Authorization: Bearer $TOKEN" \
  -F "file=@faq.pdf" \
  -F "title=Product FAQ"
```

### Attaching to an Agent

```bash
curl -X PUT https://DOMAIN/api/ai-agents/$AGENT_ID \
  -H "Authorization: Bearer $TOKEN" \
  -d "{\"knowledgeBaseId\": \"$KB_ID\"}"
```

### How It Works

When an agent receives a call, the ai-engine performs a semantic search over the KB documents using the caller's query. Relevant chunks are injected into the LLM context window as a `<knowledge>` block. The agent cites this information in its responses. This pattern reduces hallucinations and keeps the agent accurate on proprietary company information.

---

## Barge-In / Interruption

When `interruptible: true` (default), the agent supports barge-in:

1. ai-engine maintains a parallel VAD (Voice Activity Detection) thread monitoring the AudioSocket audio stream.
2. When caller speech is detected while the agent is speaking, an interrupt signal is sent.
3. The in-flight TTS stream is stopped.
4. The in-flight LLM generation is cancelled (streaming aborted).
5. The new caller speech is passed to STT.
6. The LLM responds to the new input.

This creates a natural conversational flow where callers do not have to wait for the agent to finish speaking.

Set `interruptible: false` for survey agents or agents reading legally required disclosures that must not be interrupted.

---

## Human Handoff

When the agent determines a human is needed (via tool call, keyword match, or `maxTurns` exceeded):

1. Agent speaks: "Let me connect you with [name/department]. Please hold."
2. `transfer_call` tool executes → ARI bridge transfers the Asterisk channel.
3. Receiving agent (extension 1001) gets a screen-pop via WebSocket event with:
   - Caller name and number
   - AI summary of the conversation so far
   - Sentiment score
4. If the receiving extension is unavailable: fallback to `fallbackDestType/Id`.
5. If all fallbacks are unavailable: the call goes to voicemail.

### Escalation via Keywords

Add escalation phrases to `endKeywords` or handle them in the system prompt. If the caller says "let me talk to a human" or "agent", include an instruction in the system prompt:

```
If the caller asks for a human agent, immediately call the transfer_call tool with destination='1001'.
```

---

## Call Recording and Transcription

- Recording is controlled by the `call_recording` field on the **extension** that the agent uses (or the AI agent's own recording setting).
- All AI agent calls are automatically transcribed via STT during the call.
- The full transcript (turn-by-turn) is stored in the `transcripts` table.
- After call end, Claude generates a one-paragraph summary stored in `calls.summary`.
- Sentiment (positive/neutral/negative) is detected and stored in `calls.sentiment`.

---

## Testing Agents

### Trigger a Test Call via API

```bash
curl -X POST https://DOMAIN/api/calls \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "from": "1001",
    "to": "9000",
    "callerId": "+15551234567"
  }'
```

This originates an internal call from extension 1001 to the AI agent on 9000. Pick up extension 1001 to converse with the agent.

### Monitor in Real-Time

Connect to the WebSocket to see live agent utterances:

```javascript
const ws = new WebSocket('wss://DOMAIN/ws?token=' + accessToken);
ws.onmessage = (e) => {
  const event = JSON.parse(e.data);
  if (event.type === 'agent.utterance') {
    console.log(`[${event.data.role}]: ${event.data.text}`);
  }
};
```

---

## Voice UX Best Practices

**Keep responses short**: Callers are not reading — they're listening. Target 1–3 sentences per turn. Use the system prompt to enforce this.

**Confirm before acting**: Before transferring or taking a message, confirm with the caller:  
"I'll connect you to our support team now — is that okay?"

**Handle silence gracefully**: If the caller doesn't respond, the agent should prompt once ("Are you still there?") and then gracefully end the call.

**Avoid lists**: "Your options are: one, sales; two, support; three, billing" is hard to follow by ear. Use: "You can reach sales, support, or billing — which would you like?"

**Error recovery**: If STT fails (noisy line, accent), have the agent ask for clarification politely, not repeat the exact same question.

**Language matching**: Set `language` to match your primary caller base. Deepgram and ElevenLabs support 30+ languages. Claude handles multilingual conversations natively.

**Test with real phones**: Desktop browser testing does not replicate cellular audio quality, background noise, or latency. Always test with actual phone calls before going live.
