import { useState, useEffect, useRef } from 'react';
import {
  Phone, PhoneOff, Mic, MicOff, Pause, Play,
  Delete, ArrowLeftRight, X,
} from 'lucide-react';
import { clsx } from 'clsx';
import { useSoftphoneStore } from '@/store/softphoneStore';
import { useAuthStore } from '@/store/authStore';
import { extensionsApi } from '@/lib/api';
import {
  initSoftphone, stopSoftphone, placeCall, hangupCall,
  toggleMute, toggleHold, sendDTMF, blindTransfer,
} from './sipEngine';
import type { Extension } from '@/lib/types';

const DTMF_KEYS = ['1','2','3','4','5','6','7','8','9','*','0','#'];

function formatDuration(startedAt: Date): string {
  const secs = Math.floor((Date.now() - startedAt.getTime()) / 1000);
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function SoftphoneWidget() {
  const { dialerOpen, setDialerOpen, registrationState, currentCall } = useSoftphoneStore();
  const { user } = useAuthStore();
  const [dialInput, setDialInput] = useState('');
  const [transferTarget, setTransferTarget] = useState('');
  const [showTransfer, setShowTransfer] = useState(false);
  const [extension, setExtension] = useState<Extension | null>(null);
  const [duration, setDuration] = useState('0:00');
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Load user extension and register
  useEffect(() => {
    if (!user) return;
    extensionsApi
      .list({ per_page: 100 })
      .then((res) => {
        const ext = res.data.find((e) => e.user_id === user.id && e.type === 'webrtc');
        if (ext) {
          setExtension(ext);
          initSoftphone(ext);
        }
      })
      .catch(() => null);
    return () => stopSoftphone();
  }, [user]);

  // Duration timer
  useEffect(() => {
    if (currentCall?.state === 'active' && currentCall.startedAt) {
      timerRef.current = setInterval(() => {
        setDuration(formatDuration(currentCall.startedAt));
      }, 1000);
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
      setDuration('0:00');
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [currentCall?.state, currentCall?.startedAt]);

  const handleDial = () => {
    if (!dialInput.trim() || !extension) return;
    placeCall(dialInput.trim(), extension);
  };

  const handleDTMF = (key: string) => {
    if (currentCall) {
      sendDTMF(key);
    } else {
      setDialInput((prev) => prev + key);
    }
  };

  const handleTransfer = () => {
    if (!transferTarget.trim()) return;
    blindTransfer(transferTarget.trim());
    setShowTransfer(false);
    setTransferTarget('');
  };

  if (!dialerOpen) return null;

  return (
    <div className="fixed bottom-4 right-4 z-40 w-72 bg-white dark:bg-surface-800 rounded-2xl shadow-elevated ring-1 ring-surface-200 dark:ring-surface-700 overflow-hidden animate-slide-in-right">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 bg-surface-900 dark:bg-surface-950">
        <div className="flex items-center gap-2">
          <Phone size={14} className="text-accent-400" />
          <span className="text-sm font-semibold text-white">Softphone</span>
          {extension && (
            <span className="text-xs text-surface-400">Ext {extension.extension}</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <span className={clsx(
            'w-2 h-2 rounded-full',
            registrationState === 'registered' ? 'bg-emerald-400' :
            registrationState === 'registering' ? 'bg-amber-400 animate-pulse' :
            'bg-red-400'
          )} />
          <button onClick={() => setDialerOpen(false)} className="text-surface-400 hover:text-white">
            <X size={14} />
          </button>
        </div>
      </div>

      {/* Active call display */}
      {currentCall && (
        <div className="px-4 py-3 bg-primary-50 dark:bg-primary-900/20 border-b border-primary-100 dark:border-primary-800">
          <p className="text-sm font-semibold text-primary-800 dark:text-primary-200">
            {currentCall.displayName ?? currentCall.remoteIdentity}
          </p>
          <p className="text-xs text-primary-600 dark:text-primary-400 tabular-nums">
            {currentCall.state === 'ringing_out' ? 'Calling…' :
             currentCall.state === 'held' ? 'On hold' :
             duration}
          </p>
          {currentCall.isMuted && (
            <span className="text-2xs text-amber-600 font-medium">MUTED</span>
          )}
        </div>
      )}

      {/* Dial input */}
      <div className="px-4 pt-3 pb-2">
        <div className="flex items-center gap-2">
          <input
            type="tel"
            value={dialInput}
            onChange={(e) => setDialInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && !currentCall && handleDial()}
            placeholder="Enter number…"
            className="input flex-1 text-center font-mono text-lg tracking-widest"
          />
          {dialInput && (
            <button
              onClick={() => setDialInput((p) => p.slice(0, -1))}
              className="btn-ghost btn-icon"
            >
              <Delete size={16} />
            </button>
          )}
        </div>
      </div>

      {/* Keypad */}
      <div className="px-4 pb-3 grid grid-cols-3 gap-1.5">
        {DTMF_KEYS.map((key) => (
          <button
            key={key}
            onClick={() => handleDTMF(key)}
            className="h-10 rounded-lg bg-surface-100 dark:bg-surface-700 text-surface-800 dark:text-surface-200 font-semibold text-sm hover:bg-surface-200 dark:hover:bg-surface-600 active:scale-95 transition-all"
          >
            {key}
          </button>
        ))}
      </div>

      {/* Transfer panel */}
      {showTransfer && (
        <div className="px-4 pb-3 flex gap-2">
          <input
            type="tel"
            value={transferTarget}
            onChange={(e) => setTransferTarget(e.target.value)}
            placeholder="Transfer to…"
            className="input flex-1 text-sm"
          />
          <button onClick={handleTransfer} className="btn-primary btn-sm">
            Xfer
          </button>
          <button onClick={() => setShowTransfer(false)} className="btn-secondary btn-sm">
            <X size={12} />
          </button>
        </div>
      )}

      {/* Controls */}
      <div className="px-4 pb-4 flex items-center justify-center gap-3">
        {currentCall ? (
          <>
            <button
              onClick={() => toggleMute()}
              className={clsx(
                'softphone-btn',
                currentCall.isMuted ? 'softphone-btn-active' : 'softphone-btn-muted'
              )}
              title="Mute"
            >
              {currentCall.isMuted ? <MicOff size={16} /> : <Mic size={16} />}
            </button>
            <button
              onClick={() => hangupCall()}
              className="softphone-btn softphone-btn-red"
              title="Hang up"
            >
              <PhoneOff size={18} />
            </button>
            <button
              onClick={() => toggleHold()}
              className={clsx(
                'softphone-btn',
                currentCall.isOnHold ? 'softphone-btn-active' : 'softphone-btn-muted'
              )}
              title={currentCall.isOnHold ? 'Resume' : 'Hold'}
            >
              {currentCall.isOnHold ? <Play size={16} /> : <Pause size={16} />}
            </button>
            <button
              onClick={() => setShowTransfer(!showTransfer)}
              className="softphone-btn softphone-btn-muted"
              title="Transfer"
            >
              <ArrowLeftRight size={16} />
            </button>
          </>
        ) : (
          <button
            onClick={handleDial}
            disabled={!dialInput.trim() || registrationState !== 'registered'}
            className="softphone-btn softphone-btn-green disabled:opacity-40"
            title="Call"
          >
            <Phone size={18} />
          </button>
        )}
      </div>
    </div>
  );
}
