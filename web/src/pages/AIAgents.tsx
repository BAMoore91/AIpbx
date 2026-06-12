import { useState, useRef, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  Plus, Pencil, Trash2, Brain, Send, Bot, User,
  ChevronRight, Sparkles, TestTube, X,
} from 'lucide-react';
import { aiAgentsApi, knowledgeBasesApi } from '@/lib/api';
import { DataTable, Column } from '@/components/DataTable';
import { Modal } from '@/components/Modal';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { Input, Select, Textarea, Toggle } from '@/components/FormFields';
import { Badge } from '@/components/Badge';
import { toast } from 'react-hot-toast';
import type { AIAgent, AIModel } from '@/lib/types';
import { clsx } from 'clsx';

const AI_MODELS: Array<{ value: AIModel; label: string; description: string }> = [
  { value: 'claude-opus-4-8', label: 'Claude Opus 4', description: 'Most powerful — complex reasoning' },
  { value: 'claude-sonnet-4-6', label: 'Claude Sonnet 4', description: 'Balanced performance & speed' },
  { value: 'claude-haiku-4-5', label: 'Claude Haiku 4', description: 'Fastest — low-latency conversations' },
];

const STT_PROVIDERS = [
  { value: 'deepgram', label: 'Deepgram' },
  { value: 'whisper', label: 'Whisper (OpenAI)' },
  { value: 'google', label: 'Google Speech' },
];

const TTS_PROVIDERS = [
  { value: 'elevenlabs', label: 'ElevenLabs' },
  { value: 'deepgram', label: 'Deepgram' },
  { value: 'google', label: 'Google TTS' },
  { value: 'aws', label: 'AWS Polly' },
];

const LANGUAGES = [
  { value: 'en-US', label: 'English (US)' },
  { value: 'en-GB', label: 'English (UK)' },
  { value: 'es-ES', label: 'Spanish' },
  { value: 'fr-FR', label: 'French' },
  { value: 'de-DE', label: 'German' },
  { value: 'pt-BR', label: 'Portuguese (BR)' },
];

const toolsSchema = z.object({
  lookup_caller: z.boolean(),
  book_appointment: z.boolean(),
  send_sms: z.boolean(),
  transfer_call: z.boolean(),
  take_message: z.boolean(),
  check_availability: z.boolean(),
});

const schema = z.object({
  name: z.string().min(1, 'Required'),
  number: z.string().optional(),
  role: z.string().min(1, 'Required'),
  model: z.enum(['claude-opus-4-8', 'claude-haiku-4-5', 'claude-sonnet-4-6']),
  system_prompt: z.string().min(10, 'System prompt must be at least 10 characters'),
  greeting: z.string().min(1, 'Required'),
  voice_id: z.string().optional(),
  stt_provider: z.enum(['deepgram', 'whisper', 'google']),
  tts_provider: z.enum(['elevenlabs', 'deepgram', 'google', 'aws']),
  language: z.string().min(1, 'Required'),
  temperature_effort: z.coerce.number().min(0).max(1),
  interruptible: z.boolean(),
  max_turns: z.coerce.number().min(1).max(100),
  knowledge_base_id: z.string().optional(),
  is_active: z.boolean(),
  tools: toolsSchema,
});
type AgentFormData = z.infer<typeof schema>;

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
}

// ─── Test Chat Panel ──────────────────────────────────────────────────────────
function TestChatPanel({ agent, onClose }: { agent: AIAgent; onClose: () => void }) {
  const [messages, setMessages] = useState<ChatMessage[]>([
    { role: 'assistant', content: agent.greeting, timestamp: new Date() },
  ]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const send = async () => {
    if (!input.trim() || sending) return;
    const userMsg: ChatMessage = { role: 'user', content: input.trim(), timestamp: new Date() };
    const history = messages.map(m => ({ role: m.role, content: m.content }));
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setSending(true);

    try {
      const result = await aiAgentsApi.test(agent.id, input.trim(), history);
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: result.reply,
        timestamp: new Date(),
      }]);
    } catch {
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: '⚠️ Error: Could not reach the AI engine. Check API connectivity.',
        timestamp: new Date(),
      }]);
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="fixed inset-y-0 right-0 w-full max-w-md bg-white dark:bg-surface-800 shadow-elevated border-l border-surface-200 dark:border-surface-700 flex flex-col z-40 animate-slide-in-right">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-surface-200 dark:border-surface-700 bg-surface-50 dark:bg-surface-900">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-primary-500 to-accent-500 flex items-center justify-center">
            <Bot size={14} className="text-white" />
          </div>
          <div>
            <p className="text-sm font-semibold text-surface-900 dark:text-surface-100">{agent.name}</p>
            <p className="text-xs text-surface-400">{AI_MODELS.find(m => m.value === agent.model)?.label} · Test mode</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setMessages([{ role: 'assistant', content: agent.greeting, timestamp: new Date() }])}
            className="btn-ghost btn-sm text-xs"
            title="Reset conversation"
          >
            Reset
          </button>
          <button onClick={onClose} className="btn-ghost btn-icon"><X size={16} /></button>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {messages.map((msg, i) => (
          <div key={i} className={clsx('flex gap-2', msg.role === 'user' && 'flex-row-reverse')}>
            <div className={clsx(
              'w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5',
              msg.role === 'assistant'
                ? 'bg-gradient-to-br from-primary-500 to-accent-500'
                : 'bg-surface-200 dark:bg-surface-700'
            )}>
              {msg.role === 'assistant' ? <Bot size={12} className="text-white" /> : <User size={12} className="text-surface-600" />}
            </div>
            <div className={clsx(
              'max-w-[80%] rounded-2xl px-3 py-2 text-sm',
              msg.role === 'assistant'
                ? 'bg-surface-100 dark:bg-surface-700 text-surface-800 dark:text-surface-200 rounded-tl-sm'
                : 'bg-primary-600 text-white rounded-tr-sm'
            )}>
              <p className="whitespace-pre-wrap">{msg.content}</p>
              <p className={clsx('text-2xs mt-1', msg.role === 'assistant' ? 'text-surface-400' : 'text-primary-200')}>
                {msg.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </p>
            </div>
          </div>
        ))}
        {sending && (
          <div className="flex gap-2">
            <div className="w-7 h-7 rounded-full bg-gradient-to-br from-primary-500 to-accent-500 flex items-center justify-center flex-shrink-0">
              <Bot size={12} className="text-white" />
            </div>
            <div className="bg-surface-100 dark:bg-surface-700 rounded-2xl rounded-tl-sm px-3 py-2">
              <div className="flex gap-1 items-center h-4">
                {[0,1,2].map(i => (
                  <span key={i} className="w-1.5 h-1.5 rounded-full bg-surface-400 animate-bounce" style={{ animationDelay: `${i * 0.15}s` }} />
                ))}
              </div>
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="p-3 border-t border-surface-200 dark:border-surface-700">
        <div className="flex items-center gap-2 bg-surface-50 dark:bg-surface-700 rounded-xl border border-surface-200 dark:border-surface-600 px-3 py-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && (e.preventDefault(), send())}
            placeholder="Type a message to test the agent…"
            className="flex-1 bg-transparent text-sm text-surface-800 dark:text-surface-200 placeholder-surface-400 outline-none"
            disabled={sending}
          />
          <button
            onClick={send}
            disabled={!input.trim() || sending}
            className="w-8 h-8 rounded-lg bg-primary-600 flex items-center justify-center text-white disabled:opacity-40 hover:bg-primary-700 transition-colors"
          >
            <Send size={14} />
          </button>
        </div>
        <p className="text-2xs text-surface-400 text-center mt-1.5">
          Testing against live AI engine · Ext {agent.number ?? 'N/A'}
        </p>
      </div>
    </div>
  );
}

// ─── Agent Builder Modal ──────────────────────────────────────────────────────
function AgentBuilderModal({
  open, onClose, editing, onSave, saving,
}: {
  open: boolean;
  onClose: () => void;
  editing: AIAgent | null;
  onSave: (d: AgentFormData) => void;
  saving: boolean;
}) {
  const [builderTab, setBuilderTab] = useState<'core' | 'voice' | 'tools' | 'advanced'>('core');

  const { data: kbsData } = useQuery({
    queryKey: ['knowledge-bases-list'],
    queryFn: () => knowledgeBasesApi.list({ per_page: 100 }),
    enabled: open,
  });

  const { register, handleSubmit, reset, setValue, watch, formState: { errors } } = useForm<AgentFormData>({
    resolver: zodResolver(schema),
    defaultValues: {
      model: 'claude-opus-4-8',
      stt_provider: 'deepgram',
      tts_provider: 'elevenlabs',
      language: 'en-US',
      temperature_effort: 0.7,
      interruptible: true,
      max_turns: 20,
      is_active: true,
      tools: {
        lookup_caller: true,
        book_appointment: false,
        send_sms: false,
        transfer_call: true,
        take_message: true,
        check_availability: false,
      },
    },
  });

  useEffect(() => {
    if (open) {
      if (editing) {
        reset({ ...editing });
      } else {
        reset({
          model: 'claude-opus-4-8',
          stt_provider: 'deepgram',
          tts_provider: 'elevenlabs',
          language: 'en-US',
          temperature_effort: 0.7,
          interruptible: true,
          max_turns: 20,
          is_active: true,
          tools: { lookup_caller: true, book_appointment: false, send_sms: false, transfer_call: true, take_message: true, check_availability: false },
        });
      }
      setBuilderTab('core');
    }
  }, [open, editing, reset]);

  const selectedModel = watch('model');
  const interruptible = watch('interruptible');
  const isActive = watch('is_active');
  const tools = watch('tools');

  const tabs = [
    { id: 'core' as const, label: 'Core' },
    { id: 'voice' as const, label: 'Voice & STT' },
    { id: 'tools' as const, label: 'Tools' },
    { id: 'advanced' as const, label: 'Advanced' },
  ];

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={editing ? `Edit: ${editing.name}` : 'New AI Agent'}
      size="2xl"
      footer={
        <>
          <button className="btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn-primary" onClick={handleSubmit(onSave)} disabled={saving}>
            {saving ? 'Saving…' : editing ? 'Save Changes' : 'Create Agent'}
          </button>
        </>
      }
    >
      {/* Builder Tabs */}
      <div className="flex gap-1 mb-5 border-b border-surface-200 dark:border-surface-700 -mx-6 px-6">
        {tabs.map(t => (
          <button
            key={t.id}
            onClick={() => setBuilderTab(t.id)}
            className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              builderTab === t.id
                ? 'border-primary-500 text-primary-600 dark:text-primary-400'
                : 'border-transparent text-surface-500 hover:text-surface-700'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {builderTab === 'core' && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <Input label="Agent Name" placeholder="Sales Assistant" error={errors.name?.message} {...register('name')} />
            <Input label="Extension / DID" placeholder="9001" {...register('number')} />
          </div>
          <Input label="Role / Persona" placeholder="A friendly sales assistant for Acme Corp" error={errors.role?.message} {...register('role')} />

          {/* Model picker */}
          <div>
            <label className="label">AI Model</label>
            <div className="grid grid-cols-3 gap-2 mt-1">
              {AI_MODELS.map(m => (
                <button
                  key={m.value}
                  type="button"
                  onClick={() => setValue('model', m.value)}
                  className={clsx(
                    'p-3 rounded-xl border-2 text-left transition-all',
                    selectedModel === m.value
                      ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/20'
                      : 'border-surface-200 dark:border-surface-700 hover:border-surface-300 dark:hover:border-surface-600'
                  )}
                >
                  <div className="flex items-center justify-between mb-1">
                    <Sparkles size={12} className={selectedModel === m.value ? 'text-primary-500' : 'text-surface-400'} />
                    {selectedModel === m.value && (
                      <ChevronRight size={12} className="text-primary-500" />
                    )}
                  </div>
                  <p className="text-xs font-semibold text-surface-800 dark:text-surface-200">{m.label}</p>
                  <p className="text-2xs text-surface-500 mt-0.5">{m.description}</p>
                </button>
              ))}
            </div>
          </div>

          <Textarea
            label="System Prompt"
            placeholder="You are a helpful assistant for Acme Corp. Your job is to answer customer questions about products, schedule appointments, and provide support. Be professional, empathetic, and concise."
            rows={5}
            error={errors.system_prompt?.message}
            {...register('system_prompt')}
          />
          <Textarea
            label="Greeting Message"
            placeholder="Thank you for calling Acme Corp. I'm your AI assistant. How can I help you today?"
            rows={2}
            error={errors.greeting?.message}
            {...register('greeting')}
          />

          <Select
            label="Knowledge Base"
            placeholder="— No knowledge base —"
            options={(kbsData?.data ?? []).map(kb => ({ value: kb.id, label: kb.name }))}
            {...register('knowledge_base_id')}
          />
        </div>
      )}

      {builderTab === 'voice' && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <Select label="STT Provider" options={STT_PROVIDERS} {...register('stt_provider')} />
            <Select label="TTS Provider" options={TTS_PROVIDERS} {...register('tts_provider')} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Select label="Language" options={LANGUAGES} {...register('language')} />
            <Input label="Voice ID" placeholder="elevenlabs-voice-id" hint="Provider-specific voice identifier" {...register('voice_id')} />
          </div>
          <Toggle
            label="Interruptible"
            description="Allow callers to interrupt the agent mid-sentence"
            checked={interruptible}
            onChange={(v) => setValue('interruptible', v)}
          />
        </div>
      )}

      {builderTab === 'tools' && (
        <div className="space-y-3">
          <p className="text-sm text-surface-600 dark:text-surface-400 mb-3">
            Enable tools the agent can use during conversations. Each tool calls back to your API.
          </p>
          {[
            { key: 'lookup_caller' as const, label: 'Caller Lookup', description: 'Look up caller info by phone number in your CRM' },
            { key: 'book_appointment' as const, label: 'Book Appointment', description: 'Schedule appointments via calendar API' },
            { key: 'send_sms' as const, label: 'Send SMS', description: 'Send follow-up SMS after the call' },
            { key: 'transfer_call' as const, label: 'Transfer Call', description: 'Transfer to a human agent when needed' },
            { key: 'take_message' as const, label: 'Take Message', description: 'Record a message for callback' },
            { key: 'check_availability' as const, label: 'Check Availability', description: 'Check agent or resource availability' },
          ].map(tool => (
            <div key={tool.key} className="flex items-center justify-between p-3 rounded-xl bg-surface-50 dark:bg-surface-700/50 border border-surface-200 dark:border-surface-700">
              <div>
                <p className="text-sm font-medium text-surface-800 dark:text-surface-200">{tool.label}</p>
                <p className="text-xs text-surface-500">{tool.description}</p>
              </div>
              <Toggle
                label=""
                checked={tools?.[tool.key] ?? false}
                onChange={(v) => setValue(`tools.${tool.key}`, v)}
              />
            </div>
          ))}
        </div>
      )}

      {builderTab === 'advanced' && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Input
                label="Temperature / Effort"
                type="number"
                step="0.1"
                min="0"
                max="1"
                hint="0 = focused, 1 = creative"
                error={errors.temperature_effort?.message}
                {...register('temperature_effort')}
              />
            </div>
            <Input
              label="Max Turns"
              type="number"
              min="1"
              max="100"
              hint="Max conversation exchanges"
              error={errors.max_turns?.message}
              {...register('max_turns')}
            />
          </div>
          <Toggle
            label="Active"
            description="Enable this agent to receive calls"
            checked={isActive}
            onChange={(v) => setValue('is_active', v)}
          />
        </div>
      )}
    </Modal>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────
export default function AIAgents() {
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [builderOpen, setBuilderOpen] = useState(false);
  const [editing, setEditing] = useState<AIAgent | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<AIAgent | null>(null);
  const [testAgent, setTestAgent] = useState<AIAgent | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['ai-agents', page],
    queryFn: () => aiAgentsApi.list({ page, per_page: 20 }),
  });

  const upsert = useMutation({
    mutationFn: (d: AgentFormData) => editing ? aiAgentsApi.update(editing.id, d) : aiAgentsApi.create(d),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ai-agents'] });
      setBuilderOpen(false);
      setEditing(null);
      toast.success(editing ? 'Agent updated' : 'Agent created');
    },
    onError: () => toast.error('Save failed'),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => aiAgentsApi.delete(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['ai-agents'] }); setDeleteTarget(null); toast.success('Agent deleted'); },
  });

  const columns: Column<AIAgent>[] = [
    {
      key: 'name',
      header: 'Agent',
      sortable: true,
      render: (r) => (
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-primary-500 to-accent-500 flex items-center justify-center flex-shrink-0">
            <Bot size={16} className="text-white" />
          </div>
          <div>
            <p className="font-semibold text-surface-800 dark:text-surface-200">{r.name}</p>
            <p className="text-xs text-surface-400 truncate max-w-[200px]">{r.role}</p>
          </div>
        </div>
      ),
    },
    {
      key: 'model',
      header: 'Model',
      render: (r) => (
        <Badge variant="primary">{AI_MODELS.find(m => m.value === r.model)?.label ?? r.model}</Badge>
      ),
    },
    { key: 'number', header: 'Ext/DID', render: (r) => r.number ? <span className="font-mono text-sm">{r.number}</span> : <span className="text-surface-400">—</span> },
    {
      key: 'is_active',
      header: 'Status',
      render: (r) => <Badge variant={r.is_active ? 'success' : 'neutral'}>{r.is_active ? 'Active' : 'Disabled'}</Badge>,
    },
    {
      key: 'tools',
      header: 'Tools',
      render: (r) => {
        const count = Object.values(r.tools ?? {}).filter(Boolean).length;
        return <Badge variant="info">{count} enabled</Badge>;
      },
    },
    {
      key: 'knowledge_base_id',
      header: 'KB',
      render: (r) => r.knowledge_base_id
        ? <Badge variant="accent">Linked</Badge>
        : <span className="text-surface-400 text-xs">—</span>,
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-surface-900 dark:text-surface-100 flex items-center gap-2">
            <Brain size={20} className="text-primary-500" /> AI Agents
          </h1>
          <p className="text-sm text-surface-500 mt-0.5">
            Conversational AI agents for automated call handling
          </p>
        </div>
        <button
          className="btn-primary"
          onClick={() => { setEditing(null); setBuilderOpen(true); }}
        >
          <Plus size={16} /> New Agent
        </button>
      </div>

      <DataTable
        columns={columns}
        data={data?.data ?? []}
        loading={isLoading}
        total={data?.total ?? 0}
        page={page}
        perPage={20}
        onPageChange={setPage}
        emptyMessage="No AI agents configured. Create your first one!"
        actions={(row) => (
          <>
            <button
              className="btn-ghost btn-sm text-xs flex items-center gap-1 text-accent-600 dark:text-accent-400"
              onClick={() => setTestAgent(row)}
              title="Test chat"
            >
              <TestTube size={13} /> Test
            </button>
            <button
              className="btn-ghost btn-icon btn-sm"
              onClick={() => { setEditing(row); setBuilderOpen(true); }}
            >
              <Pencil size={14} />
            </button>
            <button
              className="btn-ghost btn-icon btn-sm text-danger"
              onClick={() => setDeleteTarget(row)}
            >
              <Trash2 size={14} />
            </button>
          </>
        )}
      />

      <AgentBuilderModal
        open={builderOpen}
        onClose={() => { setBuilderOpen(false); setEditing(null); }}
        editing={editing}
        onSave={(d) => upsert.mutate(d)}
        saving={upsert.isPending}
      />

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => deleteTarget && deleteMut.mutate(deleteTarget.id)}
        title="Delete AI Agent"
        message={`Delete agent "${deleteTarget?.name}"? Calls routed to this agent will fail.`}
        loading={deleteMut.isPending}
      />

      {testAgent && (
        <TestChatPanel agent={testAgent} onClose={() => setTestAgent(null)} />
      )}
    </div>
  );
}
