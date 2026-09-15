// 新しい家具種類が保存復元と実寸による配置判定を通り、既存の家具へ化けないことを確認する。
import { describe, expect, it } from 'vitest';
import { fitsFurniture, furnitureBounds, parsePlan } from '../app/lib/model';

const addedKinds = [
  'loveseat',
  'ottoman',
  'side-table',
  'round-dining-table',
  'stool',
  'single-bed',
  'nightstand',
  'wardrobe',
  'dresser',
  'office-chair',
  'floor-lamp',
  'kitchen-island',
] as const;

// 保存データは外部境界なので文字列のkindを使い、TypeScript型の追加だけでは試験が成功しないようにする。
function savedPlan(kind: string) {
  return {
    name: '家具の保存検証',
    rooms: [
      {
        id: 'room',
        name: '居室',
        x: 2,
        z: 2,
        width: 12,
        depth: 10,
        color: '#eee6d8',
      },
    ],
    walls: [],
    doors: [],
    furniture: [
      { id: 'item', kind, x: 8, z: 7, rotation: 90, color: '#b2926b' },
    ],
  };
}

describe('追加家具の保存と実寸', () => {
  it.each(addedKinds)('%sは種類・回転・色を保って再読込できる', (kind) => {
    const document = savedPlan(kind);
    const restored = parsePlan(JSON.stringify(document));
    expect(restored).toEqual(document);
    expect(parsePlan(JSON.stringify(restored))).toEqual(document);
  });

  it('シングルベッドは90度回転すると幅2.1m・奥行1mで壁際の配置を判定する', () => {
    const restored = parsePlan(JSON.stringify(savedPlan('single-bed')));
    expect(restored).not.toBeNull();
    if (!restored) return;
    const item = restored.furniture[0];
    expect(furnitureBounds(item).width).toBeCloseTo(2.1);
    expect(furnitureBounds(item).depth).toBeCloseTo(1);
    expect(fitsFurniture(restored, { ...item, x: 3.05, z: 2.5 })).toBe(true);
    expect(fitsFurniture(restored, { ...item, x: 3.04, z: 2.5 })).toBe(false);
  });

  it('丸テーブルも斜め回転時には占有領域を保守的に判定し、部屋の外へ保存しない', () => {
    const document = savedPlan('round-dining-table');
    expect(parsePlan(JSON.stringify(document))).not.toBeNull();
    document.furniture[0] = {
      ...document.furniture[0],
      x: 2.6,
      z: 2.6,
      rotation: 45,
    };
    // 直径1.1mのカタログ外接矩形は45度で約1.56m幅となるため、この中心では壁を越える。
    expect(parsePlan(JSON.stringify(document))).toBeNull();
  });
});
