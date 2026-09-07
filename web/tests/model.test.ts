// 2Dと3Dが共有するモデルの境界条件と、端末保存データの読込時の検証を確認する。
import { describe, expect, it } from 'vitest';
import {
  BOARD,
  FURNITURE_CATALOG,
  createInitialPlan,
  fitsFurniture,
  furnitureBounds,
  normalizeRotation,
  parsePlan,
  roomIsValid,
  type PlanDocument,
  type PlacedFurniture,
  type Room,
} from '../app/lib/model';

// 原点を使うと境界までの距離が明確になるため、サンプルとは別に最小限の間取りを作る。
function fixture(): PlanDocument {
  return {
    name: '検証用の家',
    rooms: [
      {
        id: 'room-a',
        name: '部屋A',
        x: 0,
        z: 0,
        width: 4,
        depth: 4,
        color: '#eee6d8',
      },
    ],
    walls: [],
    furniture: [],
  };
}

function sofa(overrides: Partial<PlacedFurniture> = {}): PlacedFurniture {
  return {
    id: 'sofa-a',
    kind: 'sofa',
    x: 2,
    z: 2,
    rotation: 0,
    color: '#728c7d',
    ...overrides,
  };
}

function adjacentRoom(overrides: Partial<Room> = {}): Room {
  return {
    id: 'room-b',
    name: '部屋B',
    x: 4,
    z: 0,
    width: 2,
    depth: 2,
    color: '#e4e9ed',
    ...overrides,
  };
}

describe('サンプル間取り', () => {
  it('すべての部屋と家具が有効で、保存して読み戻せる', () => {
    const plan = createInitialPlan();
    const ids = [...plan.rooms, ...plan.walls, ...plan.furniture].map(
      (item) => item.id,
    );
    expect(plan.rooms.length).toBeGreaterThan(0);
    expect(plan.furniture.length).toBeGreaterThan(0);
    expect(new Set(ids).size).toBe(ids.length);
    expect(plan.rooms.every((room) => roomIsValid(plan, room))).toBe(true);
    expect(plan.furniture.every((item) => fitsFurniture(plan, item))).toBe(
      true,
    );
    expect(parsePlan(JSON.stringify(plan))).toEqual(plan);
  });

  it('新規作成した間取りは過去の編集に影響されない', () => {
    const edited = createInitialPlan();
    edited.rooms[0].name = '編集済み';
    edited.furniture[0].x = -100;
    const fresh = createInitialPlan();
    expect(fresh.rooms[0].name).not.toBe('編集済み');
    expect(fitsFurniture(fresh, fresh.furniture[0])).toBe(true);
  });

  it('家具カタログは一意の種類と正の寸法を持つ', () => {
    expect(new Set(FURNITURE_CATALOG.map((item) => item.kind)).size).toBe(
      FURNITURE_CATALOG.length,
    );
    for (const item of FURNITURE_CATALOG) {
      expect(
        [item.width, item.depth, item.height].every(
          (size) => Number.isFinite(size) && size > 0,
        ),
      ).toBe(true);
    }
  });
});

describe('家具の回転と配置境界', () => {
  it('90度回転では幅と奥行きを入れ替える', () => {
    const before = furnitureBounds(sofa());
    const after = furnitureBounds(sofa({ rotation: 90 }));
    expect(after.width).toBeCloseTo(before.depth, 10);
    expect(after.depth).toBeCloseTo(before.width, 10);
  });

  it('45度回転では四隅を含む外接矩形を使う', () => {
    // 2.4m × 0.95mのソファを45度回すと、幅・奥行きともに約2.369mになる。
    const bounds = furnitureBounds(sofa({ rotation: 45 }));
    const expected = (2.4 + 0.95) / Math.sqrt(2);
    expect(bounds.width).toBeCloseTo(expected, 10);
    expect(bounds.depth).toBeCloseTo(expected, 10);
  });

  it.each([0, 45, 90, 180, 270])(
    '%i度回転した家具を四辺に接して配置できる',
    (rotation) => {
      const plan = fixture();
      const item = sofa({ rotation });
      const bounds = furnitureBounds(item);
      // 左上・右下の両隅で確認し、すべての辺が判定に使われていることを確かめる。
      expect(
        fitsFurniture(plan, {
          ...item,
          x: bounds.width / 2,
          z: bounds.depth / 2,
        }),
      ).toBe(true);
      expect(
        fitsFurniture(plan, {
          ...item,
          x: 4 - bounds.width / 2,
          z: 4 - bounds.depth / 2,
        }),
      ).toBe(true);
    },
  );

  it.each([
    { label: '左', x: 0.4, z: 2 },
    { label: '右', x: 3.6, z: 2 },
    { label: '上', x: 2, z: 1.1 },
    { label: '下', x: 2, z: 2.9 },
  ])('90度回転後に$label側が部屋から出る配置を拒否する', ({ x, z }) => {
    expect(fitsFurniture(fixture(), sofa({ rotation: 90, x, z }))).toBe(false);
  });

  it('中心が部屋内でも、斜め回転後に角がはみ出す配置は拒否する', () => {
    const plan = fixture();
    expect(fitsFurniture(plan, sofa({ x: 2, z: 0.6, rotation: 0 }))).toBe(true);
    expect(fitsFurniture(plan, sofa({ x: 2, z: 0.6, rotation: 45 }))).toBe(
      false,
    );
  });

  it('1つの部屋に収まらず隣室にまたがる家具は配置できない', () => {
    const plan = fixture();
    plan.rooms.push(adjacentRoom({ depth: 4 }));
    expect(fitsFurniture(plan, sofa({ x: 4 }))).toBe(false);
  });

  it('部屋がなければ家具を配置できない', () => {
    expect(fitsFurniture({ ...fixture(), rooms: [] }, sofa())).toBe(false);
  });

  it.each(['x', 'z', 'rotation'] as const)(
    '%sが非有限の家具は拒否する',
    (field) => {
      for (const value of [NaN, Infinity, -Infinity]) {
        expect(fitsFurniture(fixture(), sofa({ [field]: value }))).toBe(false);
      }
    },
  );

  it.each([
    [-90, 270],
    [450, 90],
    [720, 0],
    [-720, 0],
  ])('角度%i度を%i度に正規化する', (input, expected) => {
    expect(normalizeRotation(input)).toBe(expected);
  });
});

describe('部屋の寸法と重なり', () => {
  it('辺または角が接する部屋を許可する', () => {
    expect(roomIsValid(fixture(), adjacentRoom())).toBe(true);
    expect(roomIsValid(fixture(), adjacentRoom({ z: 4 }))).toBe(true);
  });

  it('わずかでも面積が重なる部屋を拒否する', () => {
    expect(roomIsValid(fixture(), adjacentRoom({ x: 3.99 }))).toBe(false);
    expect(roomIsValid(fixture(), adjacentRoom({ x: 1, z: 1 }))).toBe(false);
  });

  it('既存の部屋を自分自身との重なりとして扱わない', () => {
    const plan = fixture();
    expect(roomIsValid(plan, { ...plan.rooms[0], x: 1 })).toBe(true);
    plan.rooms.push(adjacentRoom());
    expect(roomIsValid(plan, { ...plan.rooms[0], x: 1 })).toBe(false);
  });

  it('敷地の端に接する1m四方の部屋は有効で、敷地外は拒否する', () => {
    const plan = { ...fixture(), rooms: [] };
    const room = adjacentRoom({
      x: BOARD.width - 1,
      z: BOARD.depth - 1,
      width: 1,
      depth: 1,
    });
    expect(roomIsValid(plan, room)).toBe(true);
    expect(roomIsValid(plan, { ...room, x: room.x + 0.01 })).toBe(false);
    expect(roomIsValid(plan, { ...room, z: room.z + 0.01 })).toBe(false);
    expect(roomIsValid(plan, { ...room, x: -0.01 })).toBe(false);
    expect(roomIsValid(plan, { ...room, z: -0.01 })).toBe(false);
  });

  it.each(['width', 'depth'] as const)(
    '%sが1m未満の部屋を拒否する',
    (field) => {
      for (const value of [0.99, 0, -1]) {
        expect(roomIsValid(fixture(), adjacentRoom({ [field]: value }))).toBe(
          false,
        );
      }
    },
  );

  it.each(['x', 'z', 'width', 'depth'] as const)(
    '%sが非有限の部屋を拒否する',
    (field) => {
      for (const value of [NaN, Infinity, -Infinity]) {
        expect(roomIsValid(fixture(), adjacentRoom({ [field]: value }))).toBe(
          false,
        );
      }
    },
  );
});

describe('破損した保存データの検証', () => {
  it.each(['', '{', 'null', '[]', '{}', '"文字列"'])(
    '無効なJSONまたは文書構造 %j を安全に拒否する',
    (raw) => {
      expect(parsePlan(raw)).toBeNull();
    },
  );

  it('部屋・家具・壁のどの種類でもIDが重複していると拒否する', () => {
    const plan = fixture();
    plan.furniture.push(sofa({ id: plan.rooms[0].id }));
    expect(parsePlan(JSON.stringify(plan))).toBeNull();
  });

  it('未知の家具種類・不正な色・null要素を拒否する', () => {
    // 保存領域は利用者や旧バージョンでも書き換えられるため、TypeScriptの型に依存せず検証する。
    const invalidItems = [
      { ...sofa(), kind: 'unknown-furniture' },
      { ...sofa(), color: 'url(javascript:alert(1))' },
      null,
    ];
    for (const item of invalidItems) {
      expect(
        parsePlan(JSON.stringify({ ...fixture(), furniture: [item] })),
      ).toBeNull();
    }
  });

  it('家具の座標が文字列またはnullの場合は拒否する', () => {
    for (const x of ['2', null]) {
      expect(
        parsePlan(
          JSON.stringify({ ...fixture(), furniture: [{ ...sofa(), x }] }),
        ),
      ).toBeNull();
    }
  });

  it('JSONの巨大な指数から生じるInfinityも拒否する', () => {
    const raw = JSON.stringify({ ...fixture(), furniture: [sofa()] }).replace(
      '"rotation":0',
      '"rotation":1e400',
    );
    expect(parsePlan(raw)).toBeNull();
  });

  it('JSON化によりnullに変わったNaN/Infinityの座標を拒否する', () => {
    for (const x of [NaN, Infinity, -Infinity]) {
      expect(
        parsePlan(JSON.stringify({ ...fixture(), furniture: [sofa({ x })] })),
      ).toBeNull();
    }
  });

  it('重なった部屋や部屋からはみ出す家具を含む保存データを拒否する', () => {
    const overlap = fixture();
    overlap.rooms.push(adjacentRoom({ x: 3.5 }));
    expect(parsePlan(JSON.stringify(overlap))).toBeNull();
    expect(
      parsePlan(JSON.stringify({ ...fixture(), furniture: [sofa({ x: 0 })] })),
    ).toBeNull();
  });

  it('有効な壁は読み込み、長さ・厚さ・高さ・座標が不正な壁は拒否する', () => {
    const wall = {
      id: 'wall-a',
      x1: 0,
      z1: 0,
      x2: 4,
      z2: 0,
      height: 2.4,
      thickness: 0.1,
    };
    const plan = { ...fixture(), walls: [wall] };
    expect(parsePlan(JSON.stringify(plan))).toEqual(plan);
    for (const invalid of [
      { x2: 0 },
      { thickness: 0 },
      { thickness: 0.6 },
      { height: 0.1 },
      { height: 4.1 },
      { x1: -1 },
      { z2: BOARD.depth + 1 },
      { height: Infinity },
    ]) {
      expect(
        parsePlan(
          JSON.stringify({ ...plan, walls: [{ ...wall, ...invalid }] }),
        ),
      ).toBeNull();
    }
  });

  it('配列の上限を超える保存データを拒否する', () => {
    // 他の検証に引っかからない要素を作り、保存データ量の上限そのものを確認する。
    const manyRooms = Array.from({ length: 101 }, (_, index) => ({
      ...adjacentRoom(),
      id: `room-${index}`,
      x: index % 16,
      z: Math.floor(index / 16),
      width: 1,
      depth: 1,
    }));
    const manyFurniture = Array.from({ length: 501 }, (_, index) =>
      sofa({ id: `sofa-${index}` }),
    );
    const manyWalls = Array.from({ length: 201 }, (_, index) => ({
      id: `wall-${index}`,
      x1: 0,
      z1: 0,
      x2: 4,
      z2: 0,
      height: 2.4,
      thickness: 0.1,
    }));
    expect(
      parsePlan(JSON.stringify({ ...fixture(), rooms: manyRooms })),
    ).toBeNull();
    expect(
      parsePlan(JSON.stringify({ ...fixture(), furniture: manyFurniture })),
    ).toBeNull();
    expect(
      parsePlan(JSON.stringify({ ...fixture(), walls: manyWalls })),
    ).toBeNull();
  });
});
