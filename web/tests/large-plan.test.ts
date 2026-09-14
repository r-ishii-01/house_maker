// 40m×30mへ拡張した敷地で、旧範囲外の編集・保存と新しい境界の拒否を検証する。
import { beforeEach, describe, expect, it } from 'vitest';
import {
  fitsFurniture,
  getPlanDisplayBounds,
  createInitialPlan,
  parsePlan,
  roomIsValid,
  type PlanDocument,
} from '../app/lib/model';
import { useEditor } from '../app/lib/store';

// 旧上限の16m×12mから完全に離れた部屋に壁と回転家具を置き、偶然旧範囲内になるケースを避ける。
function largePlan(): PlanDocument {
  return {
    name: '大きな住まい',
    rooms: [
      {
        id: 'large-room',
        name: '広間',
        x: 20,
        z: 15,
        width: 20,
        depth: 15,
        color: '#eee6d8',
      },
    ],
    walls: [
      {
        id: 'large-wall',
        x1: 20,
        z1: 30,
        x2: 40,
        z2: 30,
        height: 2.6,
        thickness: 0.1,
      },
    ],
    doors: [],
    furniture: [
      {
        id: 'large-sofa',
        kind: 'sofa',
        x: 35,
        z: 25,
        rotation: 90,
        color: '#728c7d',
      },
    ],
  };
}

beforeEach(() => {
  useEditor.setState({
    plan: largePlan(),
    past: [],
    future: [],
    selectedId: null,
  });
});

describe('大きな間取りの敷地と保存', () => {
  it('40m×30mの端に接する部屋と壁、旧上限外の回転家具をそのまま保存復元できる', () => {
    const plan = largePlan();
    expect(roomIsValid(plan, plan.rooms[0])).toBe(true);
    expect(fitsFurniture(plan, plan.furniture[0])).toBe(true);
    expect(parsePlan(JSON.stringify(plan))).toEqual(plan);
  });

  it.each([
    { label: '東', x: 20.01 },
    { label: '南', z: 15.01 },
    { label: '西', x: -0.01 },
    { label: '北', z: -0.01 },
    { label: '幅', width: 20.01 },
    { label: '奥行き', depth: 15.01 },
  ])(
    '$label側で部屋が新上限を1cm越えると編集と保存読込の両方で拒否する',
    ({ label: _label, ...change }) => {
      const plan = largePlan();
      const room = { ...plan.rooms[0], ...change };
      expect(roomIsValid(plan, room)).toBe(false);
      expect(parsePlan(JSON.stringify({ ...plan, rooms: [room] }))).toBeNull();
    },
  );

  it.each([
    { x1: 40.01 },
    { x2: 40.01 },
    { z1: 30.01 },
    { z2: 30.01 },
    { x1: -0.01 },
    { z1: -0.01 },
  ])('追加壁の端点が新しい敷地から外れる保存データ %j を拒否する', (change) => {
    const plan = largePlan();
    expect(
      parsePlan(
        JSON.stringify({ ...plan, walls: [{ ...plan.walls[0], ...change }] }),
      ),
    ).toBeNull();
  });

  it('新上限に接した回転家具を許可し、1cmはみ出す家具を拒否する', () => {
    const plan = largePlan();
    // 90度回転したソファはX方向0.95m、Z方向2.4mなので東南の端点は厳密に40mと30mになる。
    const edge = { ...plan.furniture[0], x: 39.525, z: 28.8 };
    expect(fitsFurniture(plan, edge)).toBe(true);
    expect(
      parsePlan(JSON.stringify({ ...plan, furniture: [edge] })),
    ).not.toBeNull();
    for (const outside of [
      { ...edge, x: edge.x + 0.01 },
      { ...edge, z: edge.z + 0.01 },
    ]) {
      expect(fitsFurniture(plan, outside)).toBe(false);
      expect(
        parsePlan(JSON.stringify({ ...plan, furniture: [outside] })),
      ).toBeNull();
    }
  });
});

describe('旧上限外の家具の編集履歴', () => {
  it('移動と回転を別々にUndo・Redoし、各段階を保存復元できる', () => {
    const initial = largePlan();
    const moved = {
      ...initial,
      furniture: [{ ...initial.furniture[0], x: 36, z: 26 }],
    };
    const rotated = {
      ...moved,
      furniture: [{ ...moved.furniture[0], rotation: 180 }],
    };
    // 公開ストア操作を使い、履歴と保存境界を跨いでもメートル座標・角度が失われないことを確かめる。
    useEditor.getState().commit(moved);
    useEditor.getState().commit(rotated);
    for (const expected of [moved, initial]) {
      useEditor.getState().undo();
      expect(useEditor.getState().plan).toEqual(expected);
      expect(parsePlan(JSON.stringify(useEditor.getState().plan))).toEqual(
        expected,
      );
    }
    for (const expected of [moved, rotated]) {
      useEditor.getState().redo();
      expect(useEditor.getState().plan).toEqual(expected);
      expect(parsePlan(JSON.stringify(useEditor.getState().plan))).toEqual(
        expected,
      );
    }
  });
});

describe('プラン内容に合わせた初期表示範囲', () => {
  it('空プランと既存サンプルは従来の16m×12m表示を保つ', () => {
    expect(
      getPlanDisplayBounds({
        ...largePlan(),
        rooms: [],
        walls: [],
        furniture: [],
      }),
    ).toEqual({ width: 16, depth: 12 });
    expect(getPlanDisplayBounds(createInitialPlan())).toEqual({
      width: 16,
      depth: 12,
    });
  });

  it('遠くの部屋の右下端に2mの余白を加える', () => {
    const plan = largePlan();
    expect(
      getPlanDisplayBounds({
        ...plan,
        rooms: [{ ...plan.rooms[0], width: 7, depth: 5 }],
        walls: [],
        furniture: [],
      }),
    ).toEqual({ width: 29, depth: 22 });
  });

  it('部屋がなくても追加壁の始点と終点を両方含める', () => {
    // 始点が東、終点が南の壁にして、一方の端点だけを使った範囲計算を検出する。
    const plan = largePlan();
    expect(
      getPlanDisplayBounds({
        ...plan,
        rooms: [],
        furniture: [],
        walls: [{ ...plan.walls[0], x1: 32, z1: 15, x2: 20, z2: 25 }],
      }),
    ).toEqual({ width: 34, depth: 27 });
  });

  it('端に接する大きなプランでは余白を敷地上限の40m×30mに収める', () => {
    expect(getPlanDisplayBounds(largePlan())).toEqual({ width: 40, depth: 30 });
  });
});
