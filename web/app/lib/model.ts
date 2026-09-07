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
export const PLAN_LIMITS = { rooms: 100, walls: 200, furniture: 500 };
export const BOARD = { width: 16, depth: 12 };
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
    const validColor = (value: unknown) =>
      typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value);
    if (
      !plan ||
      typeof plan.name !== 'string' ||
      !Array.isArray(plan.rooms) ||
      !Array.isArray(plan.walls) ||
      !Array.isArray(plan.furniture) ||
      plan.rooms.length > PLAN_LIMITS.rooms ||
      plan.walls.length > PLAN_LIMITS.walls ||
      plan.furniture.length > PLAN_LIMITS.furniture
    )
      return null;
    const ids = [...plan.rooms, ...plan.walls, ...plan.furniture].map(
      (item) => item?.id,
    );
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
    return plan;
  } catch {
    return null;
  }
}
