// UIを描画せずにZustandの公開操作を呼び、編集・選択・履歴の整合性を確認する。
import { beforeEach, describe, expect, it } from 'vitest';
import { createInitialPlan, type PlanDocument } from '../app/lib/model';
import { useEditor } from '../app/lib/store';

// 各テストで履歴と選択を初期化し、同じストアを使うテスト同士の干渉を防ぐ。
beforeEach(() => {
  useEditor.setState({
    plan: createInitialPlan(),
    past: [],
    future: [],
    selectedId: null,
  });
});

function rename(name: string): PlanDocument {
  return { ...useEditor.getState().plan, name };
}

describe('編集履歴', () => {
  it('家具の移動をUndoで戻し、Redoで再適用する', () => {
    const initial = useEditor.getState().plan;
    const next = {
      ...initial,
      furniture: initial.furniture.map((item, index) =>
        index === 0 ? { ...item, x: item.x + 0.1 } : item,
      ),
    };
    useEditor.getState().commit(next);
    expect(useEditor.getState().plan).toEqual(next);
    expect(useEditor.getState().past).toEqual([initial]);

    useEditor.getState().undo();
    expect(useEditor.getState().plan).toEqual(initial);
    expect(useEditor.getState().past).toEqual([]);
    expect(useEditor.getState().future).toEqual([next]);

    useEditor.getState().redo();
    expect(useEditor.getState().plan).toEqual(next);
    expect(useEditor.getState().past).toEqual([initial]);
    expect(useEditor.getState().future).toEqual([]);
  });

  it('複数回のUndoとRedoでも編集順序を維持する', () => {
    const original = useEditor.getState().plan.name;
    for (const name of ['A', 'B', 'C'])
      useEditor.getState().commit(rename(name));
    for (const expected of ['B', 'A', original]) {
      useEditor.getState().undo();
      expect(useEditor.getState().plan.name).toBe(expected);
    }
    for (const expected of ['A', 'B', 'C']) {
      useEditor.getState().redo();
      expect(useEditor.getState().plan.name).toBe(expected);
    }
  });

  it('Undo後に新しい編集を行うと、以前のRedoの分岐を破棄する', () => {
    for (const name of ['A', 'B', 'C'])
      useEditor.getState().commit(rename(name));
    useEditor.getState().undo();
    useEditor.getState().commit(rename('D'));
    expect(useEditor.getState().future).toEqual([]);
    useEditor.getState().redo();
    expect(useEditor.getState().plan.name).toBe('D');
    useEditor.getState().undo();
    expect(useEditor.getState().plan.name).toBe('B');
  });

  it('同じ内容の確定操作は履歴を増やさず、Redoも失わない', () => {
    const original = useEditor.getState().plan;
    useEditor.getState().commit(rename('変更後'));
    useEditor.getState().undo();
    const future = useEditor.getState().future;
    // ドラッグして元の場所へ戻す場合と同じく、新しいオブジェクトでも値が同じなら変更扱いにしない。
    useEditor
      .getState()
      .commit(JSON.parse(JSON.stringify(original)) as PlanDocument);
    expect(useEditor.getState().past).toEqual([]);
    expect(useEditor.getState().future).toEqual(future);
    useEditor.getState().redo();
    expect(useEditor.getState().plan.name).toBe('変更後');
  });

  it('履歴のないUndo/Redoは現在の間取りを変更しない', () => {
    const initial = useEditor.getState();
    useEditor.getState().undo();
    useEditor.getState().redo();
    expect(useEditor.getState()).toBe(initial);
  });

  it('履歴を最新100件まで保持し、範囲を超えるUndoは無操作になる', () => {
    for (let index = 1; index <= 105; index++)
      useEditor.getState().commit(rename(String(index)));
    expect(useEditor.getState().past).toHaveLength(100);
    for (let index = 0; index < 100; index++) useEditor.getState().undo();
    expect(useEditor.getState().plan.name).toBe('5');
    expect(useEditor.getState().past).toHaveLength(0);
    expect(useEditor.getState().future).toHaveLength(100);
    useEditor.getState().undo();
    expect(useEditor.getState().plan.name).toBe('5');
    for (let index = 0; index < 100; index++) useEditor.getState().redo();
    expect(useEditor.getState().plan.name).toBe('105');
    expect(useEditor.getState().past).toHaveLength(100);
    expect(useEditor.getState().future).toHaveLength(0);
  });
});

describe('選択状態と履歴の分離', () => {
  it('選択変更だけでは間取りや履歴が変化しない', () => {
    const original = useEditor.getState().plan;
    useEditor.getState().setSelected(original.furniture[0].id);
    expect(useEditor.getState().selectedId).toBe(original.furniture[0].id);
    expect(useEditor.getState().plan).toBe(original);
    expect(useEditor.getState().past).toEqual([]);
    expect(useEditor.getState().future).toEqual([]);
  });

  it('Undo/Redoで存在しなくなる可能性のある選択を解除する', () => {
    const selectedId = useEditor.getState().plan.furniture[0].id;
    useEditor.getState().commit(rename('変更後'));
    useEditor.getState().setSelected(selectedId);
    useEditor.getState().undo();
    expect(useEditor.getState().selectedId).toBeNull();
    useEditor.getState().setSelected(selectedId);
    useEditor.getState().redo();
    expect(useEditor.getState().selectedId).toBeNull();
  });
});
