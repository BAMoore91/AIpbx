import { Phone, PhoneOff } from 'lucide-react';
import { useSoftphoneStore } from '@/store/softphoneStore';
import { answerCall, rejectCall } from './sipEngine';

export function IncomingCallPopup() {
  const { incomingCall } = useSoftphoneStore();
  if (!incomingCall) return null;

  return (
    <div className="fixed top-4 right-4 z-50 w-72 bg-white dark:bg-surface-800 rounded-2xl shadow-elevated ring-1 ring-emerald-400 overflow-hidden animate-slide-in-right">
      <div className="bg-gradient-to-r from-emerald-600 to-teal-600 px-4 py-3">
        <p className="text-xs font-semibold text-emerald-100 uppercase tracking-wide">Incoming Call</p>
        <p className="text-base font-bold text-white mt-0.5">
          {incomingCall.displayName ?? incomingCall.from}
        </p>
        {incomingCall.displayName && (
          <p className="text-xs text-emerald-200">{incomingCall.from}</p>
        )}
      </div>

      {/* Pulse animation */}
      <div className="px-4 py-4 flex items-center justify-center gap-6">
        <div className="flex flex-col items-center gap-1">
          <button
            onClick={rejectCall}
            className="w-14 h-14 rounded-full bg-red-500 hover:bg-red-600 text-white flex items-center justify-center shadow-lg transition-transform active:scale-95"
          >
            <PhoneOff size={22} />
          </button>
          <span className="text-xs text-surface-500">Decline</span>
        </div>

        <div className="flex flex-col items-center gap-1">
          <button
            onClick={answerCall}
            className="w-14 h-14 rounded-full bg-emerald-500 hover:bg-emerald-600 text-white flex items-center justify-center shadow-lg animate-ring transition-transform active:scale-95"
          >
            <Phone size={22} />
          </button>
          <span className="text-xs text-surface-500">Answer</span>
        </div>
      </div>
    </div>
  );
}
