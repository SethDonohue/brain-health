import { create } from 'zustand'
import type { ActivityKey, CaffeineLog, PlannedSession, SessionLog, TabKey } from './domain/types'

export type Tab = TabKey

export type Sheet =
  | { kind: 'log'; planned?: PlannedSession; activity?: ActivityKey; edit?: SessionLog }
  | { kind: 'move'; planned: PlannedSession }
  | { kind: 'restPick'; weekStart: string; candidates: string[] }
  | { kind: 'settings' }
  | { kind: 'sleepLog'; night: string }
  | { kind: 'bedtime' }
  | { kind: 'drinks' }
  | { kind: 'drinkEdit'; log: CaffeineLog }

export interface Toast {
  id: number
  message: string
  action?: { label: string; run: () => void }
  secondary?: { label: string; run: () => void }
}

interface UiState {
  tab: Tab
  sheets: Sheet[]
  toast?: Toast
  setTab: (t: Tab) => void
  open: (s: Sheet) => void
  close: () => void
  showToast: (t: Omit<Toast, 'id'>) => void
  clearToast: () => void
}

let toastSeq = 0

export const useUi = create<UiState>((set) => ({
  tab: 'today',
  sheets: [],
  setTab: (tab) => set({ tab }),
  open: (s) => set((st) => ({ sheets: [...st.sheets, s] })),
  close: () => set((st) => ({ sheets: st.sheets.slice(0, -1) })),
  showToast: (t) => set({ toast: { ...t, id: ++toastSeq } }),
  clearToast: () => set({ toast: undefined }),
}))
