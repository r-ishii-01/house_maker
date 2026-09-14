// 扉の壁への拘束、共有壁の開口、保存互換性を実寸の座標で検証する。
import { describe, expect, it } from 'vitest';
import {
  createInitialPlan,
  parsePlan,
  doorIsValid,
  findDoorPlacement,
  getDoorGeometry,
  getDoorWall,
  getWallDoorOpenings,
  type Door,
  type PlanDocument,
} from '../app/lib/model';

function fixture(): PlanDocument {
  return {
    name: '扉の検証',
    rooms: [
      { id: 'a', name: 'A', x: 1, z: 1, width: 4, depth: 4, color: '#eeeeee' },
      { id: 'b', name: 'B', x: 5, z: 1, width: 4, depth: 4, color: '#eeeeee' },
    ],
    walls: [],
    doors: [],
    furniture: [],
  };
}
function door(changes: Partial<Door> = {}): Door {
  return {
    id: 'door-a',
    host: { kind: 'room', id: 'a', side: 'east' },
    offset: 1,
    width: 0.9,
    height: 2,
    hinge: 'start',
    swing: 1,
    ...changes,
  };
}

describe('扉の配置と座標', () => {
  it('部屋の共有壁にスナップし、壁から離れたクリックには配置しない', () => {
    expect(findDoorPlacement(fixture(), { x: 5.1, z: 2.5 })).toMatchObject({
      host: { kind: 'room', id: 'a', side: 'east' },
      width: 0.9,
    });
    expect(findDoorPlacement(fixture(), { x: 3, z: 3 })).toBeNull();
    expect(findDoorPlacement(fixture(), { x: NaN, z: 3 })).toBeNull();
  });
  it('壁方向と吊元を使い、90度開いた扉の座標を両ビューへ渡す', () => {
    expect(getDoorGeometry(fixture(), door())).toMatchObject({
      angle: 90,
      start: { x: 5, z: 2 },
      end: { x: 5, z: 2.9 },
      hinge: { x: 5, z: 2 },
      leafEnd: { x: 4.1, z: 2 },
    });
    expect(
      getDoorGeometry(fixture(), door({ hinge: 'end', swing: -1 })),
    ).toMatchObject({ hinge: { x: 5, z: 2.9 }, leafEnd: { x: 5.9, z: 2.9 } });
  });
  it('斜めの追加壁でも距離をmで計算する', () => {
    const plan = fixture();
    plan.walls.push({
      id: 'diagonal',
      x1: 1,
      z1: 1,
      x2: 4,
      z2: 5,
      height: 2.6,
      thickness: 0.15,
    });
    const item = door({
      host: { kind: 'wall', id: 'diagonal' },
      offset: 1,
      width: 1,
    });
    expect(doorIsValid(plan, item)).toBe(true);
    const geometry = getDoorGeometry(plan, item)!;
    expect(geometry.start.x).toBeCloseTo(1.6);
    expect(geometry.start.z).toBeCloseTo(1.8);
    expect(geometry.leafEnd.x).toBeCloseTo(0.8);
    expect(geometry.leafEnd.z).toBeCloseTo(2.4);
  });
  it('部屋を動かすと所属する扉も追従し、縮小で壁を超える扉を拒否する', () => {
    const plan = fixture();
    plan.rooms[0].x = 2;
    expect(getDoorGeometry(plan, door())?.start.x).toBe(6);
    plan.rooms[0].depth = 1.5;
    expect(doorIsValid(plan, door())).toBe(false);
  });
});

describe('扉の入力制約と壁の開口', () => {
  it('T字の共有壁や交差する間仕切りで開口が塞がれる配置を拒否する', () => {
    const plan = createInitialPlan();
    expect(
      doorIsValid(
        plan,
        door({
          host: { kind: 'room', id: 'living', side: 'east' },
          offset: 3.6,
        }),
      ),
    ).toBe(false);
    const crossing = fixture();
    crossing.walls.push({
      id: 'crossing',
      x1: 4,
      z1: 2.5,
      x2: 7,
      z2: 2.5,
      height: 2.6,
      thickness: 0.15,
    });
    expect(doorIsValid(crossing, door())).toBe(false);
    expect(doorIsValid(crossing, door({ offset: 2 }))).toBe(true);
  });
  it.each([
    { offset: -1 },
    { offset: 3.5 },
    { width: 0 },
    { width: 2 },
    { height: 0 },
    { height: 2.6 },
    { width: NaN },
    { offset: Infinity },
    { swing: 0 },
    { hinge: 'invalid' },
    { host: { kind: 'room', id: 'missing', side: 'east' } },
  ])('不正な扉 %j を拒否する', (changes) => {
    expect(doorIsValid(fixture(), door(changes as Partial<Door>))).toBe(false);
  });
  it('低い壁や短い壁には設置できない', () => {
    const plan = fixture();
    plan.walls.push({
      id: 'short',
      x1: 2,
      z1: 2,
      x2: 2.5,
      z2: 2,
      height: 1,
      thickness: 0.15,
    });
    expect(
      doorIsValid(
        plan,
        door({ host: { kind: 'wall', id: 'short' }, offset: 0.1 }),
      ),
    ).toBe(false);
  });
  it('隣室側から重ねた扉も拒否し、両室の壁を同じ位置で開口する', () => {
    const plan = fixture();
    plan.doors.push(door());
    const otherSide = door({
      id: 'door-b',
      host: { kind: 'room', id: 'b', side: 'west' },
    });
    expect(doorIsValid(plan, otherSide)).toBe(false);
    expect(doorIsValid(plan, { ...otherSide, offset: 2 })).toBe(true);
    const wall = getDoorWall(plan, otherSide.host)!;
    expect(getWallDoorOpenings(plan, wall)).toEqual([
      { door: door(), start: 1, end: 1.9 },
    ]);
    // 逆方向に引いた追加壁でも、壁の始点からの位置に変換する。
    expect(
      getWallDoorOpenings(plan, { ...wall, z1: 5, z2: 1 })[0],
    ).toMatchObject({ start: 2.1, end: 3 });
  });
});

describe('扉データの復元', () => {
  it('扉のない旧保存を空の扉配列へ移行する', () => {
    const { doors: _doors, ...legacy } = createInitialPlan();
    expect(parsePlan(JSON.stringify(legacy))).toEqual({ ...legacy, doors: [] });
  });
  it('扉の設定を保存して読み戻す', () => {
    const plan = fixture();
    plan.doors = [door({ hinge: 'end', swing: -1 })];
    expect(parsePlan(JSON.stringify(plan))).toEqual(plan);
  });
  it('壊れた扉配列、存在しない壁、重複ID、重なりを拒否する', () => {
    for (const doors of [
      null,
      {},
      [null],
      [door({ host: { kind: 'wall', id: 'missing' } })],
      [door({ id: 'a' })],
      [door(), door({ id: 'second' })],
    ]) {
      expect(parsePlan(JSON.stringify({ ...fixture(), doors }))).toBeNull();
    }
  });
});
