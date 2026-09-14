// 2Dと3Dの共通モデル。単位はメートル、床はX/Z平面、回転角は度で統一する。
export type FurnitureKind =
  | 'sofa'
  | 'armchair'
  | 'coffee-table'
  | 'dining-table'
  | 'chair'
  | 'bed'
  | 'desk'
  | 'bookshelf'
  | 'plant'
  | 'television';
export interface Room {
  id: string;
  name: string;
  x: number;
  z: number;
  width: number;
  depth: number;
  color: string;
}
export interface Wall {
  id: string;
  x1: number;
  z1: number;
  x2: number;
  z2: number;
  height: number;
  thickness: number;
}
// 部屋の辺は形状変更に追従するID参照、追加壁はその壁IDで固定する。
export type DoorHost =
  | { kind: 'room'; id: string; side: 'north' | 'east' | 'south' | 'west' }
  | { kind: 'wall'; id: string };
export interface Door {
  id: string;
  host: DoorHost;
  // offsetは壁始点から開口始点までのm。吊元と開く側を分け、4通りの片開きを表現する。
  offset: number;
  width: number;
  height: number;
  hinge: 'start' | 'end';
  // SVG Y = 床面Z。+1は壁の進行方向に対する法線(-uz, ux)側。
  swing: 1 | -1;
}
export interface PlacedFurniture {
  id: string;
  kind: FurnitureKind;
  x: number;
  z: number;
  rotation: number;
  color: string;
}
export interface PlanDocument {
  name: string;
  rooms: Room[];
  walls: Wall[];
  doors: Door[];
  furniture: PlacedFurniture[];
}
export interface FurnitureDefinition {
  kind: FurnitureKind;
  name: string;
  category: string;
  width: number;
  depth: number;
  height: number;
  color: string;
}
// 追加時と保存復元時で同じ上限を使い、保存できた文書が復元できない状態を防ぐ。
export const PLAN_LIMITS = {
  rooms: 100,
  walls: 200,
  doors: 200,
  furniture: 500,
};
// 実際に作図・保存できる敷地の上限。表示倍率とは分離し、大きい住宅でも10 cm単位で編集する。
export const BOARD = { width: 40, depth: 30 };

// 原点を固定した表示範囲（m）。小さいプランは従来の16×12 mを保ち、部屋と壁の外側に2 mの余白を取る。
// 2Dの保存復元時と3Dの台座・視点で共用し、敷地を広げてもサンプルが極端に小さくならないようにする。
export function getPlanDisplayBounds(plan: PlanDocument): {
  width: number;
  depth: number;
} {
  let width = 16;
  let depth = 12;
  for (const room of plan.rooms) {
    width = Math.max(width, room.x + room.width + 2);
    depth = Math.max(depth, room.z + room.depth + 2);
  }
  for (const wall of plan.walls) {
    width = Math.max(width, wall.x1 + 2, wall.x2 + 2);
    depth = Math.max(depth, wall.z1 + 2, wall.z2 + 2);
  }
  return {
    width: Math.min(BOARD.width, width),
    depth: Math.min(BOARD.depth, depth),
  };
}
export const FURNITURE_CATALOG: FurnitureDefinition[] = [
  {
    kind: 'sofa',
    name: '3人掛けソファ',
    category: 'リビング',
    width: 2.4,
    depth: 0.95,
    height: 0.85,
    color: '#728c7d',
  },
  {
    kind: 'armchair',
    name: 'ラウンジチェア',
    category: 'リビング',
    width: 0.85,
    depth: 0.85,
    height: 0.85,
    color: '#bd8c62',
  },
  {
    kind: 'coffee-table',
    name: 'ローテーブル',
    category: 'リビング',
    width: 1.2,
    depth: 0.6,
    height: 0.4,
    color: '#a88057',
  },
  {
    kind: 'television',
    name: 'テレビボード',
    category: 'リビング',
    width: 1.8,
    depth: 0.4,
    height: 1.15,
    color: '#525a60',
  },
  {
    kind: 'dining-table',
    name: 'ダイニングテーブル',
    category: 'ダイニング',
    width: 1.6,
    depth: 0.85,
    height: 0.74,
    color: '#b2926b',
  },
  {
    kind: 'chair',
    name: 'ダイニングチェア',
    category: 'ダイニング',
    width: 0.5,
    depth: 0.55,
    height: 0.85,
    color: '#b2926b',
  },
  {
    kind: 'bed',
    name: 'ダブルベッド',
    category: 'ベッドルーム',
    width: 1.6,
    depth: 2.1,
    height: 0.9,
    color: '#b9c4d4',
  },
  {
    kind: 'desk',
    name: 'ワークデスク',
    category: 'ワークスペース',
    width: 1.4,
    depth: 0.65,
    height: 0.74,
    color: '#b2926b',
  },
  {
    kind: 'bookshelf',
    name: 'オープンシェルフ',
    category: 'ワークスペース',
    width: 1.2,
    depth: 0.35,
    height: 1.8,
    color: '#a88057',
  },
  {
    kind: 'plant',
    name: 'インドアグリーン',
    category: 'リビング',
    width: 0.65,
    depth: 0.65,
    height: 1.25,
    color: '#4f7b55',
  },
];
export const catalogItem = (kind: FurnitureKind) =>
  FURNITURE_CATALOG.find((item) => item.kind === kind)!;
export const snap = (value: number) => Math.round(value * 10) / 10;
export const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));
export const normalizeRotation = (angle: number) => ((angle % 360) + 360) % 360;

// 回転後の外接矩形を計算し、見た目と同じ領域で配置の可否を判定する。
export function furnitureBounds(
  item: Pick<PlacedFurniture, 'kind' | 'rotation'>,
) {
  const definition = catalogItem(item.kind);
  const rad = (item.rotation * Math.PI) / 180;
  return {
    width:
      Math.abs(Math.cos(rad)) * definition.width +
      Math.abs(Math.sin(rad)) * definition.depth,
    depth:
      Math.abs(Math.sin(rad)) * definition.width +
      Math.abs(Math.cos(rad)) * definition.depth,
  };
}
export function fitsFurniture(
  plan: PlanDocument,
  item: PlacedFurniture,
): boolean {
  const b = furnitureBounds(item);
  return (
    Number.isFinite(item.x) &&
    Number.isFinite(item.z) &&
    Number.isFinite(item.rotation) &&
    plan.rooms.some(
      (room) =>
        item.x - b.width / 2 >= room.x - 0.0001 &&
        item.x + b.width / 2 <= room.x + room.width + 0.0001 &&
        item.z - b.depth / 2 >= room.z - 0.0001 &&
        item.z + b.depth / 2 <= room.z + room.depth + 0.0001,
    )
  );
}

// 部屋同士は接してよいが、面積が重なる配置は拒否する。ドラッグ中の不正な寸法もここで遮断する。
export function roomIsValid(plan: PlanDocument, room: Room): boolean {
  if (
    ![room.x, room.z, room.width, room.depth].every(Number.isFinite) ||
    room.width < 1 ||
    room.depth < 1 ||
    room.x < 0 ||
    room.z < 0 ||
    room.x + room.width > BOARD.width ||
    room.z + room.depth > BOARD.depth
  )
    return false;
  return !plan.rooms.some(
    (other) =>
      other.id !== room.id &&
      room.x < other.x + other.width - 0.0001 &&
      room.x + room.width > other.x + 0.0001 &&
      room.z < other.z + other.depth - 0.0001 &&
      room.z + room.depth > other.z + 0.0001,
  );
}

// 自動生成される部屋外周も追加壁と同じ形へ変換する。南北辺はX増加、東西辺はZ増加。
export function getDoorWall(plan: PlanDocument, host: DoorHost): Wall | null {
  if (!host || typeof host.id !== 'string') return null;
  if (host.kind === 'wall')
    return plan.walls.find((wall) => wall.id === host.id) ?? null;
  if (host.kind !== 'room') return null;
  const room = plan.rooms.find((item) => item.id === host.id);
  if (!room || !['north', 'east', 'south', 'west'].includes(host.side))
    return null;
  const horizontal = host.side === 'north' || host.side === 'south';
  const x = room.x + (host.side === 'east' ? room.width : 0);
  const z = room.z + (host.side === 'south' ? room.depth : 0);
  return {
    id: `room-boundary:${room.id}:${host.side}`,
    x1: x,
    z1: z,
    x2: x + (horizontal ? room.width : 0),
    z2: z + (horizontal ? 0 : room.depth),
    height: 2.6,
    thickness: 0.14,
  };
}

// 2Dの円弧と3Dの扉板が同じ位置に開くよう、世界座標の両端と吊元を一度だけ計算する。
export function getDoorGeometry(plan: PlanDocument, door: Door) {
  const wall = getDoorWall(plan, door.host);
  if (!wall) return null;
  const dx = wall.x2 - wall.x1;
  const dz = wall.z2 - wall.z1;
  const length = Math.hypot(dx, dz);
  if (!Number.isFinite(length) || length < 0.01) return null;
  const ux = dx / length,
    uz = dz / length;
  const start = {
    x: wall.x1 + ux * door.offset,
    z: wall.z1 + uz * door.offset,
  };
  const end = { x: start.x + ux * door.width, z: start.z + uz * door.width };
  const hinge = door.hinge === 'end' ? end : start;
  return {
    wall,
    length,
    angle: (Math.atan2(dz, dx) * 180) / Math.PI,
    start,
    end,
    hinge,
    leafEnd: {
      x: hinge.x - uz * door.width * door.swing,
      z: hinge.z + ux * door.width * door.swing,
    },
  };
}

// 所属IDではなく物理座標で照合し、隣室側・逆向きの追加壁にも同じ開口を設ける。
export function getWallDoorOpenings(plan: PlanDocument, wall: Wall) {
  const length = Math.hypot(wall.x2 - wall.x1, wall.z2 - wall.z1);
  if (length < 0.01) return [];
  const ux = (wall.x2 - wall.x1) / length,
    uz = (wall.z2 - wall.z1) / length;
  const openings: { door: Door; start: number; end: number }[] = [];
  for (const door of plan.doors) {
    const geometry = getDoorGeometry(plan, door);
    if (!geometry) continue;
    const points = [geometry.start, geometry.end];
    if (
      points.some(
        (p) => Math.abs((p.x - wall.x1) * uz - (p.z - wall.z1) * ux) > 0.001,
      )
    )
      continue;
    const positions = points.map(
      (p) => (p.x - wall.x1) * ux + (p.z - wall.z1) * uz,
    );
    const start = Math.max(0, Math.min(...positions));
    const end = Math.min(length, Math.max(...positions));
    if (end - start > 0.001) openings.push({ door, start, end });
  }
  return openings.sort((a, b) => a.start - b.start);
}

// 共有壁の照合と配置候補を同じ一覧から作り、部屋外周の一辺だけが検証から漏れることを防ぐ。
function doorHosts(plan: PlanDocument): DoorHost[] {
  return [
    ...plan.walls.map((wall): DoorHost => ({ kind: 'wall', id: wall.id })),
    ...plan.rooms.flatMap((room) =>
      (['north', 'east', 'south', 'west'] as const).map(
        (side): DoorHost => ({ kind: 'room', id: room.id, side }),
      ),
    ),
  ];
}

// 保存・配置・プロパティ変更で同じ制約を使う。枠のため両端と扉間に10cmの余白を残す。
export function doorIsValid(plan: PlanDocument, door: Door): boolean {
  if (
    !door ||
    ![door.offset, door.width, door.height].every(Number.isFinite) ||
    door.width < 0.6 ||
    door.width > 1.8 ||
    door.height < 1.8 ||
    door.height > 2.6 ||
    !['start', 'end'].includes(door.hinge) ||
    (door.swing !== 1 && door.swing !== -1)
  )
    return false;
  const geometry = getDoorGeometry(plan, door);
  if (
    !geometry ||
    door.offset < 0.1 - 0.0001 ||
    door.offset + door.width > geometry.length - 0.1 + 0.0001 ||
    door.height > geometry.wall.height - 0.1 + 0.0001
  )
    return false;
  // T字・十字の接続壁が開口を横切ると3Dに壁が残る。線分の交点をmへ射影し、厚み分も検証する。
  const ux = (geometry.wall.x2 - geometry.wall.x1) / geometry.length;
  const uz = (geometry.wall.z2 - geometry.wall.z1) / geometry.length;
  for (const host of doorHosts(plan)) {
    const other = getDoorWall(plan, host)!;
    const otherLength = Math.hypot(other.x2 - other.x1, other.z2 - other.z1);
    if (otherLength < 0.01) continue;
    const vx = (other.x2 - other.x1) / otherLength;
    const vz = (other.z2 - other.z1) / otherLength;
    const cross = ux * vz - uz * vx;
    // 同一直線の共有壁はgetWallDoorOpeningsで一緒に開口するため、遮る壁としては扱わない。
    if (Math.abs(cross) < 0.0001) continue;
    const dx = other.x1 - geometry.wall.x1;
    const dz = other.z1 - geometry.wall.z1;
    const along = (dx * vz - dz * vx) / cross;
    const across = (dx * uz - dz * ux) / cross;
    const padding = other.thickness / (2 * Math.abs(cross));
    if (
      across >= -0.001 &&
      across <= otherLength + 0.001 &&
      along + padding > door.offset + 0.0001 &&
      along - padding < door.offset + door.width - 0.0001
    )
      return false;
  }
  return !getWallDoorOpenings(plan, geometry.wall).some(
    (opening) =>
      opening.door.id !== door.id &&
      door.offset < opening.end + 0.1 - 0.0001 &&
      door.offset + door.width > opening.start - 0.1 + 0.0001,
  );
}

// クリック位置を開口中心として最寄りの壁へ射影する。壁から35cm以上離れた入力は拒否する。
export function findDoorPlacement(
  plan: PlanDocument,
  point: { x: number; z: number },
  template?: Door,
): Door | null {
  if (![point.x, point.z].every(Number.isFinite)) return null;
  const hosts = doorHosts(plan);
  const candidates: { door: Door; distance: number }[] = [];
  for (const host of hosts) {
    const wall = getDoorWall(plan, host)!;
    const length = Math.hypot(wall.x2 - wall.x1, wall.z2 - wall.z1);
    if (length < 0.01) continue;
    const ux = (wall.x2 - wall.x1) / length,
      uz = (wall.z2 - wall.z1) / length;
    const projection = (point.x - wall.x1) * ux + (point.z - wall.z1) * uz;
    const onSegment = clamp(projection, 0, length);
    const distance = Math.hypot(
      point.x - wall.x1 - ux * onSegment,
      point.z - wall.z1 - uz * onSegment,
    );
    if (distance > 0.35) continue;
    const width = template?.width ?? 0.9;
    if (length < width + 0.2 - 0.0001) continue;
    const door: Door = {
      id: '',
      width,
      height: 2,
      hinge: 'start',
      swing: 1,
      ...template,
      host,
      // 10cm刻みへの丸め後にも壁端の余白を守り、短い壁への配置を破損させない。
      offset: clamp(snap(projection - width / 2), 0.1, length - width - 0.1),
    };
    if (doorIsValid(plan, door)) candidates.push({ door, distance });
  }
  candidates.sort((a, b) => a.distance - b.distance);
  return candidates[0]?.door ?? null;
}

export function createInitialPlan(): PlanDocument {
  // 起動直後から両ビューの関係を試せる、編集可能なサンプル間取り。
  return {
    name: '光がつながる家',
    rooms: [
      {
        id: 'living',
        name: 'リビング・ダイニング',
        x: 2,
        z: 2,
        width: 7,
        depth: 8,
        color: '#eee6d8',
      },
      {
        id: 'bedroom',
        name: 'ベッドルーム',
        x: 9,
        z: 2,
        width: 5,
        depth: 4,
        color: '#e4e9ed',
      },
      {
        id: 'office',
        name: 'ワークスペース',
        x: 9,
        z: 6,
        width: 5,
        depth: 4,
        color: '#e7eadf',
      },
    ],
    walls: [],
    doors: [],
    furniture: [
      {
        id: 'sofa-1',
        kind: 'sofa',
        x: 5.2,
        z: 3.1,
        rotation: 0,
        color: '#728c7d',
      },
      {
        id: 'table-1',
        kind: 'coffee-table',
        x: 5.2,
        z: 4.6,
        rotation: 0,
        color: '#a88057',
      },
      {
        id: 'armchair-1',
        kind: 'armchair',
        x: 7.6,
        z: 4.1,
        rotation: 90,
        color: '#bd8c62',
      },
      {
        id: 'plant-1',
        kind: 'plant',
        x: 2.7,
        z: 2.7,
        rotation: 0,
        color: '#4f7b55',
      },
      {
        id: 'dining-1',
        kind: 'dining-table',
        x: 5,
        z: 7.7,
        rotation: 0,
        color: '#b2926b',
      },
      {
        id: 'chair-1',
        kind: 'chair',
        x: 4.5,
        z: 6.8,
        rotation: 0,
        color: '#b2926b',
      },
      {
        id: 'chair-2',
        kind: 'chair',
        x: 5.5,
        z: 6.8,
        rotation: 0,
        color: '#b2926b',
      },
      {
        id: 'chair-3',
        kind: 'chair',
        x: 4.5,
        z: 8.6,
        rotation: 180,
        color: '#b2926b',
      },
      {
        id: 'chair-4',
        kind: 'chair',
        x: 5.5,
        z: 8.6,
        rotation: 180,
        color: '#b2926b',
      },
      {
        id: 'bed-1',
        kind: 'bed',
        x: 11.6,
        z: 3.65,
        rotation: 0,
        color: '#b9c4d4',
      },
      {
        id: 'desk-1',
        kind: 'desk',
        x: 11.4,
        z: 6.8,
        rotation: 0,
        color: '#b2926b',
      },
      {
        id: 'chair-5',
        kind: 'chair',
        x: 11.4,
        z: 7.6,
        rotation: 180,
        color: '#728c7d',
      },
      {
        id: 'shelf-1',
        kind: 'bookshelf',
        x: 13.5,
        z: 8.5,
        rotation: 90,
        color: '#a88057',
      },
    ],
  };
}

// 外部から読み込む端末保存データも、既知の型と有限の座標だけ受け付ける。
export function parsePlan(raw: string): PlanDocument | null {
  try {
    const plan = JSON.parse(raw) as PlanDocument;
    // v1保存には扉配列がない。明示的なnull等は破損として扱い、未定義だけ移行する。
    if (
      plan &&
      typeof plan === 'object' &&
      !Array.isArray(plan) &&
      plan.doors === undefined
    )
      plan.doors = [];
    const validColor = (value: unknown) =>
      typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value);
    if (
      !plan ||
      typeof plan.name !== 'string' ||
      !Array.isArray(plan.rooms) ||
      !Array.isArray(plan.walls) ||
      !Array.isArray(plan.doors) ||
      !Array.isArray(plan.furniture) ||
      plan.rooms.length > PLAN_LIMITS.rooms ||
      plan.walls.length > PLAN_LIMITS.walls ||
      plan.doors.length > PLAN_LIMITS.doors ||
      plan.furniture.length > PLAN_LIMITS.furniture
    )
      return null;
    const ids = [
      ...plan.rooms,
      ...plan.walls,
      ...plan.doors,
      ...plan.furniture,
    ].map((item) => item?.id);
    if (
      ids.some((id) => typeof id !== 'string') ||
      new Set(ids).size !== ids.length
    )
      return null;
    if (
      !plan.rooms.every(
        (room) =>
          typeof room.name === 'string' &&
          validColor(room.color) &&
          roomIsValid(plan, room),
      )
    )
      return null;
    if (
      !plan.furniture.every(
        (item) =>
          FURNITURE_CATALOG.some((entry) => entry.kind === item.kind) &&
          validColor(item.color) &&
          fitsFurniture(plan, item),
      )
    )
      return null;
    if (
      !plan.walls.every(
        (wall) =>
          [
            wall.x1,
            wall.z1,
            wall.x2,
            wall.z2,
            wall.height,
            wall.thickness,
          ].every(Number.isFinite) &&
          wall.x1 >= 0 &&
          wall.x2 >= 0 &&
          wall.x1 <= BOARD.width &&
          wall.x2 <= BOARD.width &&
          wall.z1 >= 0 &&
          wall.z2 >= 0 &&
          wall.z1 <= BOARD.depth &&
          wall.z2 <= BOARD.depth &&
          wall.height >= 0.2 &&
          wall.height <= 4 &&
          wall.thickness >= 0.05 &&
          wall.thickness <= 0.5 &&
          Math.hypot(wall.x2 - wall.x1, wall.z2 - wall.z1) >= 0.2,
      )
    )
      return null;
    if (!plan.doors.every((door) => doorIsValid(plan, door))) return null;
    return plan;
  } catch {
    return null;
  }
}
