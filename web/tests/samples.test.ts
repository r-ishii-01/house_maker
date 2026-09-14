// サンプルの完成済み文書が保存・配置制約を満たし、編集がテンプレートへ漏れないことを検証する。
import { describe, expect, it } from 'vitest';
import {
  createInitialPlan,
  doorIsValid,
  fitsFurniture,
  parsePlan,
  roomIsValid,
} from '../app/lib/model';
import {
  SAMPLE_PLANS,
  createSamplePlan,
  type SamplePlanId,
} from '../app/lib/samples';

// 面積は仕様のm²を固定し、生成処理と同じ定数から期待値を作らない。
const examples: { id: SamplePlanId; name: string; area: number }[] = [
  { id: 'airy-home', name: '光がつながる家', area: 96 },
  { id: 'compact-studio', name: 'ひとり暮らしのワンルーム', area: 30 },
  { id: 'cozy-1ldk', name: 'ふたり暮らしの1LDK', area: 54 },
  { id: 'family-2ldk', name: '暮らしやすい2LDK', area: 70 },
  { id: 'family-3ldk', name: '家族で暮らす3LDK', area: 96 },
  { id: 'courtyard-house', name: '庭にひらくL字の家', area: 77 },
];

describe('選べるサンプル間取り', () => {
  it('ギャラリーの全選択肢がそれぞれの完成済み間取りを読み込む', () => {
    expect(SAMPLE_PLANS.map(({ id }) => id).sort()).toEqual(
      examples.map(({ id }) => id).sort(),
    );
    for (const entry of SAMPLE_PLANS) {
      expect(entry.category.trim()).not.toBe('');
      expect(entry.description.trim()).not.toBe('');
      expect(createSamplePlan(entry.id).name).toBe(entry.name);
    }
  });

  it.each(examples)(
    '$name は有効な寸法・参照を保って保存復元できる',
    ({ id, name, area }) => {
      const plan = createSamplePlan(id);
      expect(plan.name).toBe(name);
      expect(
        plan.rooms.reduce((sum, room) => sum + room.width * room.depth, 0),
      ).toBeCloseTo(area);
      expect(plan.furniture.length).toBeGreaterThan(0);
      if (id !== 'airy-home') expect(plan.doors.length).toBeGreaterThan(0);

      // 種別をまたぐID衝突や孤立した扉参照は選択・削除・復元を壊すため、完成文書全体で確認する。
      const ids = [
        ...plan.rooms,
        ...plan.walls,
        ...plan.furniture,
        ...plan.doors,
      ].map((item) => item.id);
      expect(ids.every((value) => value.length > 0)).toBe(true);
      expect(new Set(ids).size).toBe(ids.length);
      for (const room of plan.rooms)
        expect(roomIsValid(plan, room), room.id).toBe(true);
      for (const item of plan.furniture)
        expect(fitsFurniture(plan, item), item.id).toBe(true);
      for (const door of plan.doors) {
        const hosts = door.host.kind === 'room' ? plan.rooms : plan.walls;
        expect(
          hosts.some((host) => host.id === door.host.id),
          door.id,
        ).toBe(true);
        expect(doorIsValid(plan, door), door.id).toBe(true);
      }
      expect(parsePlan(JSON.stringify(plan))).toEqual(plan);
    },
  );

  it('選択肢は名前だけでなく部屋の構成も異なり、L字には外接矩形内の庭がある', () => {
    // 名前・IDを取り除いて比較し、同じ形に別のラベルだけを付ける誤実装を検出する。
    const shapes = examples.map(({ id }) =>
      JSON.stringify(
        createSamplePlan(id)
          .rooms.map(({ x, z, width, depth }) => [x, z, width, depth])
          .sort((a, b) => a[0] - b[0] || a[1] - b[1]),
      ),
    );
    expect(new Set(shapes).size).toBe(examples.length);
    const courtyard = createSamplePlan('courtyard-house');
    const minX = Math.min(...courtyard.rooms.map((room) => room.x));
    const maxX = Math.max(
      ...courtyard.rooms.map((room) => room.x + room.width),
    );
    const minZ = Math.min(...courtyard.rooms.map((room) => room.z));
    const maxZ = Math.max(
      ...courtyard.rooms.map((room) => room.z + room.depth),
    );
    expect((maxX - minX) * (maxZ - minZ)).toBeGreaterThan(77);
  });

  it.each(examples)(
    '$name の部屋・家具・扉の編集が次の読込と別サンプルへ漏れない',
    ({ id }) => {
      const unchanged = examples.map((entry) => createSamplePlan(entry.id));
      const edited = createSamplePlan(id);
      edited.name = '編集済みの家';
      edited.rooms[0].name = '編集済みの部屋';
      edited.rooms[0].width = 99;
      edited.furniture[0].x = -100;
      if (edited.doors[0]) {
        // 配列と要素だけの浅いコピーではhost参照が共有されるため、最深部の参照も変更する。
        edited.doors[0].host.id = '存在しない壁';
        edited.doors[0].offset = -1;
      }
      if (edited.walls[0]) edited.walls[0].height = -1;
      edited.rooms.pop();
      edited.furniture.pop();
      edited.doors.pop();
      expect(examples.map((entry) => createSamplePlan(entry.id))).toEqual(
        unchanged,
      );
    },
  );

  it('光がつながる家は従来の初期状態と同じ文書を提供する', () => {
    expect(createSamplePlan('airy-home')).toEqual(createInitialPlan());
  });
});
