// UIを描画せずにZustandの公開操作を呼び、編集・選択・履歴の整合性を確認する。
import { beforeEach, describe, expect, it } from 'vitest';
import {
  createInitialPlan,
  type Door,
  type PlanDocument,
} from '../app/lib/model';
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

// 安定した扉IDと壁への参照を履歴に保持し、復元後に別の扉として扱われないことを確認する。
function roomDoor(): Door {
  return {
    id: 'door-living',
    host: { kind: 'room', id: 'living', side: 'north' },
    offset: 1,
    width: 0.9,
    height: 2,
    hinge: 'start',
    swing: 1,
  };
}

describe('扉の履歴と選択', () => {
  it('扉の追加・幅と開き方の編集・削除を元のIDと壁参照でUndo/Redoする', () => {
    const initial = useEditor.getState().plan;
    const door = roomDoor();
    const added = { ...initial, doors: [door] };
    const changed = {
      ...added,
      doors: [
        {
          ...door,
          offset: 2,
          width: 1.2,
          height: 2.1,
          hinge: 'end' as const,
          swing: -1 as const,
        },
      ],
    };
    const deleted = { ...changed, doors: [] };
    for (const plan of [added, changed, deleted])
      useEditor.getState().commit(plan);
    expect(useEditor.getState().past).toHaveLength(3);
    for (const plan of [changed, added, initial]) {
      useEditor.getState().undo();
      expect(useEditor.getState().plan).toEqual(plan);
    }
    for (const plan of [added, changed, deleted]) {
      useEditor.getState().redo();
      expect(useEditor.getState().plan).toEqual(plan);
    }
  });

  it('選択中の扉が消える確定操作で選択を解除し、Undoでは扉だけを復元する', () => {
    const door = roomDoor();
    useEditor
      .getState()
      .commit({ ...useEditor.getState().plan, doors: [door] });
    useEditor.getState().setSelected(door.id);
    useEditor.getState().commit({ ...useEditor.getState().plan, doors: [] });
    expect(useEditor.getState().selectedId).toBeNull();
    useEditor.getState().undo();
    expect(useEditor.getState().plan.doors).toEqual([door]);
    expect(useEditor.getState().selectedId).toBeNull();
  });

  it('扉が存在する間は他の編集を確定してもその選択を維持する', () => {
    const door = roomDoor();
    useEditor
      .getState()
      .commit({ ...useEditor.getState().plan, doors: [door] });
    useEditor.getState().setSelected(door.id);
    useEditor.getState().commit(rename('扉のある家'));
    expect(useEditor.getState().selectedId).toBe(door.id);
    expect(useEditor.getState().plan.doors).toEqual([door]);
  });

  it('ホスト壁と扉を同時に削除した1操作をまとめて復元する', () => {
    const wall = {
      id: 'door-wall',
      x1: 3,
      z1: 5,
      x2: 8,
      z2: 5,
      height: 2.4,
      thickness: 0.1,
    };
    const door = {
      ...roomDoor(),
      host: { kind: 'wall' as const, id: wall.id },
    };
    const before = {
      ...useEditor.getState().plan,
      walls: [wall],
      doors: [door],
    };
    useEditor.setState({ plan: before, selectedId: door.id });
    // UIの連動削除が渡す完成文書を使い、履歴が壁と扉の間で分割されないことを検証する。
    useEditor.getState().commit({ ...before, walls: [], doors: [] });
    expect(useEditor.getState().past).toEqual([before]);
    expect(useEditor.getState().selectedId).toBeNull();
    useEditor.getState().undo();
    expect(useEditor.getState().plan).toEqual(before);
    useEditor.getState().redo();
    expect(useEditor.getState().plan.walls).toEqual([]);
    expect(useEditor.getState().plan.doors).toEqual([]);
  });
});
