import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Loader2, CheckCircle2, Phone, ShieldCheck, ArrowRight } from 'lucide-react';
import { Modal } from './Modal';
import { Input, Select, Toggle } from './FormFields';
import { Badge } from './Badge';
import { toast } from 'react-hot-toast';
import {
  twilioApi,
  type TwilioVerifyResult,
  type TwilioConnectResult,
} from '@/lib/api';

interface Props {
  open: boolean;
  onClose: () => void;
  onConnected: () => void;
}

type Step = 'creds' | 'review' | 'done';

const DEST_TYPES = [
  { value: 'ai_agent', label: 'AI Receptionist' },
  { value: 'ivr', label: 'IVR / Auto-attendant' },
  { value: 'queue', label: 'Call Queue' },
  { value: 'ring_group', label: 'Ring Group' },
  { value: 'extension', label: 'Extension' },
  { value: 'voicemail', label: 'Voicemail' },
];

/**
 * One-click Twilio Elastic SIP Trunk setup. Enter an Account SID + key; we
 * validate, show the numbers we'll import, then auto-provision the trunk
 * (origination + termination + DIDs + outbound route + PJSIP) on confirm.
 */
export function TwilioConnectModal({ open, onClose, onConnected }: Props) {
  const [step, setStep] = useState<Step>('creds');
  const [accountSid, setAccountSid] = useState('');
  const [authToken, setAuthToken] = useState('');
  const [label, setLabel] = useState('Twilio');
  const [transport, setTransport] = useState<'udp' | 'tls'>('udp');
  const [importNumbers, setImportNumbers] = useState(true);
  const [defaultDestType, setDefaultDestType] = useState('ai_agent');
  const [defaultDestId, setDefaultDestId] = useState('');
  const [verified, setVerified] = useState<TwilioVerifyResult | null>(null);
  const [result, setResult] = useState<TwilioConnectResult | null>(null);

  const reset = () => {
    setStep('creds');
    setAccountSid('');
    setAuthToken('');
    setVerified(null);
    setResult(null);
  };

  const close = () => {
    reset();
    onClose();
  };

  const verify = useMutation({
    mutationFn: () => twilioApi.verify({ accountSid: accountSid.trim(), authToken: authToken.trim() }),
    onSuccess: (data) => {
      setVerified(data);
      setStep('review');
    },
    onError: (e: any) => toast.error(e?.response?.data?.error?.message ?? 'Verification failed'),
  });

  const connect = useMutation({
    mutationFn: () =>
      twilioApi.connect({
        accountSid: accountSid.trim(),
        authToken: authToken.trim(),
        label: label.trim() || 'Twilio',
        transport,
        importNumbers,
        defaultDestType,
        defaultDestId: defaultDestId.trim() || null,
      }),
    onSuccess: (data) => {
      setResult(data);
      setStep('done');
      toast.success('Twilio trunk connected');
      onConnected();
    },
    onError: (e: any) => toast.error(e?.response?.data?.error?.message ?? 'Connection failed'),
  });

  return (
    <Modal open={open} onClose={close} title="Connect Twilio SIP Trunk" size="lg">
      {step === 'creds' && (
        <div className="space-y-4">
          <p className="text-sm text-surface-500">
            Paste your Twilio <strong>Account SID</strong> and <strong>Auth Token</strong> (Console →
            Account Info). We'll create an Elastic SIP Trunk, point it at this PBX, and import your
            numbers automatically. Credentials are used once and never stored.
          </p>
          <Input
            label="Account SID"
            placeholder="ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
            value={accountSid}
            onChange={(e) => setAccountSid(e.target.value)}
            autoComplete="off"
          />
          <Input
            label="Auth Token"
            type="password"
            placeholder="your auth token"
            value={authToken}
            onChange={(e) => setAuthToken(e.target.value)}
            autoComplete="off"
          />
          <Input label="Label" value={label} onChange={(e) => setLabel(e.target.value)} />
          <div className="flex justify-end gap-2 pt-2">
            <button className="btn-secondary" onClick={close}>Cancel</button>
            <button
              className="btn-primary inline-flex items-center gap-2"
              onClick={() => verify.mutate()}
              disabled={!accountSid || !authToken || verify.isPending}
            >
              {verify.isPending ? <Loader2 size={16} className="animate-spin" /> : <ShieldCheck size={16} />}
              Verify & continue
            </button>
          </div>
        </div>
      )}

      {step === 'review' && verified && (
        <div className="space-y-4">
          <div className="flex items-center gap-2 text-sm">
            <CheckCircle2 size={18} className="text-emerald-500" />
            <span>
              Connected to <strong>{verified.account.friendlyName}</strong>
              <Badge variant="success" className="ml-2">{verified.account.status}</Badge>
            </span>
          </div>

          <div>
            <div className="text-sm font-medium mb-1">
              {verified.numbers.length} phone number{verified.numbers.length === 1 ? '' : 's'} found
            </div>
            <div className="max-h-40 overflow-auto rounded-lg border border-surface-200 dark:border-surface-700 divide-y divide-surface-100 dark:divide-surface-800">
              {verified.numbers.length === 0 && (
                <div className="p-3 text-sm text-surface-500">No numbers on this account yet.</div>
              )}
              {verified.numbers.map((n) => (
                <div key={n.sid} className="flex items-center gap-2 p-2 text-sm">
                  <Phone size={14} className="text-primary-400" />
                  <span className="font-mono">{n.phoneNumber}</span>
                  <span className="text-surface-500">{n.friendlyName}</span>
                  {!n.voice && <Badge variant="warning" className="ml-auto">no voice</Badge>}
                </div>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Select
              label="Inbound calls go to"
              value={defaultDestType}
              onChange={(e) => setDefaultDestType(e.target.value)}
              options={DEST_TYPES}
            />
            <Input
              label="Destination ID / number (optional)"
              placeholder="e.g. AI agent id or extension"
              value={defaultDestId}
              onChange={(e) => setDefaultDestId(e.target.value)}
            />
          </div>
          <div className="grid grid-cols-2 gap-3 items-center">
            <Select
              label="Transport"
              value={transport}
              onChange={(e) => setTransport(e.target.value as 'udp' | 'tls')}
              options={[
                { value: 'udp', label: 'UDP (5060)' },
                { value: 'tls', label: 'TLS (5061, encrypted)' },
              ]}
            />
            <Toggle label="Import & route numbers" checked={importNumbers} onChange={setImportNumbers} />
          </div>

          <div className="flex justify-between gap-2 pt-2">
            <button className="btn-secondary" onClick={() => setStep('creds')}>Back</button>
            <button
              className="btn-primary inline-flex items-center gap-2"
              onClick={() => connect.mutate()}
              disabled={connect.isPending}
            >
              {connect.isPending ? <Loader2 size={16} className="animate-spin" /> : <ArrowRight size={16} />}
              Provision trunk
            </button>
          </div>
        </div>
      )}

      {step === 'done' && result && (
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <CheckCircle2 size={22} className="text-emerald-500" />
            <span className="text-lg font-medium">Trunk connected</span>
          </div>
          <dl className="text-sm space-y-1">
            <Row k="Numbers imported" v={String(result.numbersImported)} />
            <Row k="Termination URI" v={result.terminationUri} mono />
            <Row k="Origination target" v={result.originationTarget} mono />
            <Row k="Twilio trunk SID" v={result.twilioTrunkSid} mono />
          </dl>
          <p className="text-sm text-surface-500">
            Inbound calls to your numbers now reach this PBX, and outbound calls route through Twilio.
            You can refine per-number routing under Routing → DIDs.
          </p>
          <div className="flex justify-end pt-2">
            <button className="btn-primary" onClick={close}>Done</button>
          </div>
        </div>
      )}
    </Modal>
  );
}

function Row({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-surface-500">{k}</dt>
      <dd className={mono ? 'font-mono text-xs truncate max-w-[60%]' : ''}>{v}</dd>
    </div>
  );
}
