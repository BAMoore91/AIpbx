import { create } from 'zustand';

export type SoftphoneRegistrationState = 'unregistered' | 'registering' | 'registered' | 'failed';
export type CallState = 'idle' | 'ringing_in' | 'ringing_out' | 'active' | 'held' | 'transferring';

export interface ActiveCall {
  id: string;
  remoteIdentity: string;
  displayName?: string;
  direction: 'inbound' | 'outbound';
  state: CallState;
  startedAt: Date;
  isMuted: boolean;
  isOnHold: boolean;
}

interface SoftphoneState {
  registrationState: SoftphoneRegistrationState;
  currentCall: ActiveCall | null;
  incomingCall: { from: string; displayName?: string } | null;
  dialerOpen: boolean;
  // Actions
  setRegistrationState: (state: SoftphoneRegistrationState) => void;
  setCurrentCall: (call: ActiveCall | null) => void;
  updateCurrentCall: (updates: Partial<ActiveCall>) => void;
  setIncomingCall: (call: { from: string; displayName?: string } | null) => void;
  setDialerOpen: (open: boolean) => void;
}

export const useSoftphoneStore = create<SoftphoneState>((set) => ({
  registrationState: 'unregistered',
  currentCall: null,
  incomingCall: null,
  dialerOpen: false,

  setRegistrationState: (registrationState) => set({ registrationState }),

  setCurrentCall: (currentCall) => set({ currentCall }),

  updateCurrentCall: (updates) =>
    set((state) => ({
      currentCall: state.currentCall
        ? { ...state.currentCall, ...updates }
        : null,
    })),

  setIncomingCall: (incomingCall) => set({ incomingCall }),

  setDialerOpen: (dialerOpen) => set({ dialerOpen }),
}));
