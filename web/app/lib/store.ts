'use client';
// 編集結果を1か所で保持し、2Dと3Dに同じスナップショットを配信する。
import { create } from 'zustand';
import { createInitialPlan, type PlanDocument } from './model';
interface EditorState {
  plan: PlanDocument;
  past: PlanDocument[];
  future: PlanDocument[];
  selectedId: string | null;
  setSelected: (id: string | null) => void;
  commit: (next: PlanDocument) => void;
  undo: () => void;
  redo: () => void;
}
export const useEditor = create<EditorState>((set) => ({
  plan: createInitialPlan(),
  past: [],
  future: [],
  selectedId: null,
  setSelected: (selectedId) => set({ selectedId }),
  // 履歴を100操作に制限し、ドラッグ完了などの確定操作ごとに1件だけ保存する。
  commit: (next) =>
    set((state) =>
      JSON.stringify(next) === JSON.stringify(state.plan)
        ? state
        : {
            plan: next,
            past: [...state.past, state.plan].slice(-100),
            future: [],
          },
    ),
  undo: () =>
    set((state) =>
      state.past.length
        ? {
            plan: state.past[state.past.length - 1],
            past: state.past.slice(0, -1),
            future: [state.plan, ...state.future],
            selectedId: null,
          }
        : state,
    ),
  redo: () =>
    set((state) =>
      state.future.length
        ? {
            plan: state.future[0],
            past: [...state.past, state.plan].slice(-100),
            future: state.future.slice(1),
            selectedId: null,
          }
        : state,
    ),
}));
