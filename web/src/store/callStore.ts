import { create } from 'zustand';
import type { LiveCall, QueueStats } from '@/lib/types';

interface CallState {
  activeCalls: LiveCall[];
  queueStats: Record<string, QueueStats>;
  // Actions
  setActiveCalls: (calls: LiveCall[]) => void;
  addOrUpdateCall: (call: LiveCall) => void;
  removeCall: (id: string) => void;
  updateQueueStats: (stats: QueueStats) => void;
}

export const useCallStore = create<CallState>((set) => ({
  activeCalls: [],
  queueStats: {},

  setActiveCalls: (calls) => set({ activeCalls: calls }),

  addOrUpdateCall: (call) =>
    set((state) => {
      const existing = state.activeCalls.findIndex((c) => c.id === call.id);
      if (existing >= 0) {
        const updated = [...state.activeCalls];
        updated[existing] = call;
        return { activeCalls: updated };
      }
      return { activeCalls: [...state.activeCalls, call] };
    }),

  removeCall: (id) =>
    set((state) => ({
      activeCalls: state.activeCalls.filter((c) => c.id !== id),
    })),

  updateQueueStats: (stats) =>
    set((state) => ({
      queueStats: { ...state.queueStats, [stats.queue_id]: stats },
    })),
}));
