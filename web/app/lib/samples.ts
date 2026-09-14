// 住まい方の異なる編集可能なサンプルを供給する。座標・寸法はm、家具の回転は度、床面はX/Z。
// カタログには説明だけを公開し、読み込みのたびに全要素を生成して編集がひな形へ漏れるのを防ぐ。
import {
  catalogItem,
  createInitialPlan,
  type Door,
  type DoorHost,
  type FurnitureKind,
  type PlanDocument,
  type Room,
} from './model';

export const SAMPLE_PLANS = [
  {
    id: 'airy-home',
    name: '光がつながる家',
    category: 'ワークスペース',
    description:
      '広いリビングと独立した仕事部屋。いつものサンプルを自由にアレンジ。',
  },
  {
    id: 'compact-studio',
    name: 'ひとり暮らしのワンルーム',
    category: 'ワンルーム',
    description:
      '30 m²にベッド・ソファ・デスクをまとめた、コンパクトな住まい。',
  },
  {
    id: 'cozy-1ldk',
    name: 'ふたり暮らしの1LDK',
    category: '1LDK',
    description:
      '寝室を分けてくつろげる間取り。玄関・収納からリビングにつながります。',
  },
  {
    id: 'family-2ldk',
    name: '暮らしやすい2LDK',
    category: '2LDK',
    description:
      'リビングを中心に2つの個室へ。寝室と子ども部屋の配置を試せます。',
  },
  {
    id: 'family-3ldk',
    name: '家族で暮らす3LDK',
    category: '3LDK',
    description:
      '3つの寝室と大きなリビング。家族それぞれの家具配置を考えられます。',
  },
  {
    id: 'courtyard-house',
    name: '庭にひらくL字の家',
    category: 'L字型',
    description:
      '建物のくぼみに外の余白を残した平屋。寝室と仕事部屋を離しています。',
  },
] as const;

export type SamplePlanId = (typeof SAMPLE_PLANS)[number]['id'];
type FurnitureSpec = [
  kind: FurnitureKind,
  x: number,
  z: number,
  rotation?: number,
];
type RoomSide = Extract<DoorHost, { kind: 'room' }>['side'];
type DoorSpec = [
  roomId: string,
  side: RoomSide,
  offset: number,
  swing?: Door['swing'],
];
const FLOOR = '#eee6d8';
const BEDROOM = '#e4e9ed';
const WORKSPACE = '#e7eadf';
const ENTRANCE = '#ede6df';

// 部屋の左上を原点にした矩形を明記する。辺を揃え、部屋同士の重なりと共有壁の隙間を防ぐ。
function room(
  id: string,
  name: string,
  x: number,
  z: number,
  width: number,
  depth: number,
  color = FLOOR,
): Room {
  return { id, name, x, z, width, depth, color };
}

// 家具寸法・色は実際の編集カタログに合わせる。扉は共有壁のT字接続を避けた開口始点を指定する。
function composeSample(
  id: SamplePlanId,
  rooms: Room[],
  furniture: FurnitureSpec[],
  doors: DoorSpec[],
): PlanDocument {
  return {
    name: SAMPLE_PLANS.find((sample) => sample.id === id)!.name,
    rooms,
    walls: [],
    furniture: furniture.map(([kind, x, z, rotation = 0], index) => ({
      id: `${id}-furniture-${index + 1}`,
      kind,
      x,
      z,
      rotation,
      color: catalogItem(kind).color,
    })),
    doors: doors.map(([roomId, side, offset, swing = 1], index) => ({
      id: `${id}-door-${index + 1}`,
      host: { kind: 'room', id: roomId, side },
      offset,
      width: 0.9,
      height: 2,
      hinge: 'start',
      swing,
    })),
  };
}

// プランごとに新しい配列とネストしたhostを生成する。履歴・保存が別の読み込みへ影響しない。
export function createSamplePlan(id: SamplePlanId): PlanDocument {
  switch (id) {
    case 'airy-home':
      // 起動時の既存サンプルとの互換性を保ち、同じ名前で別の配置を読み込まない。
      return createInitialPlan();
    case 'compact-studio':
      return composeSample(
        id,
        [room('studio', '居室', 2, 2, 6, 5)],
        [
          ['bed', 6.6, 3.4],
          ['sofa', 3.5, 3],
          ['coffee-table', 3.5, 4.3],
          ['desk', 6.5, 6.35],
          ['chair', 6.5, 5.5, 180],
          ['plant', 2.55, 6.35],
        ],
        [['studio', 'south', 1.6, -1]],
      );
    case 'cozy-1ldk':
      return composeSample(
        id,
        [
          room('living', 'リビング・ダイニング', 2, 2, 5, 6),
          room('bedroom', '寝室', 7, 2, 4, 4, BEDROOM),
          room('entrance', '玄関・収納', 7, 6, 4, 2, ENTRANCE),
        ],
        [
          ['sofa', 4, 3],
          ['coffee-table', 4, 4.4],
          ['dining-table', 4.5, 6.3],
          ['chair', 4, 5.4],
          ['chair', 5, 7.2, 180],
          ['bed', 9, 3.6],
          ['bookshelf', 10.3, 5.5],
          ['plant', 8, 7.3],
        ],
        [
          ['living', 'east', 1.4],
          ['living', 'east', 4.4],
          ['entrance', 'east', 0.5],
        ],
      );
    case 'family-2ldk':
      return composeSample(
        id,
        [
          room('living', 'リビング・ダイニング', 2, 2, 6, 7),
          room('bedroom', '寝室', 8, 2, 4, 3.5, BEDROOM),
          room('children', '子ども部屋', 8, 5.5, 4, 3.5, '#f0e2db'),
        ],
        [
          ['sofa', 4.3, 3.1],
          ['coffee-table', 4.3, 4.6],
          ['plant', 7.3, 2.7],
          ['dining-table', 6, 7],
          ['chair', 5.5, 6.1],
          ['chair', 6.5, 6.1],
          ['chair', 5.5, 7.9, 180],
          ['chair', 6.5, 7.9, 180],
          ['bed', 10, 3.7],
          ['bed', 10.6, 7.5],
          ['desk', 9, 5.9],
          ['chair', 9, 6.8, 180],
        ],
        [
          ['living', 'east', 1.3],
          ['living', 'east', 4.8],
          ['living', 'south', 1.2, -1],
        ],
      );
    case 'family-3ldk':
      return composeSample(
        id,
        [
          room('living', 'リビング・ダイニング', 2, 2, 7, 8),
          room('bedroom', '主寝室', 9, 2, 5, 3, BEDROOM),
          room('children-a', '子ども部屋 A', 9, 5, 5, 2.5, '#f0e2db'),
          room('children-b', '子ども部屋 B', 9, 7.5, 5, 2.5, WORKSPACE),
        ],
        [
          ['sofa', 5.2, 3.1],
          ['coffee-table', 5.2, 4.6],
          ['armchair', 7.6, 4.1, 90],
          ['plant', 2.7, 2.7],
          ['dining-table', 5, 7.7],
          ['chair', 4.5, 6.8],
          ['chair', 5.5, 6.8],
          ['chair', 4.5, 8.6, 180],
          ['chair', 5.5, 8.6, 180],
          ['bed', 12, 3.5],
          ['bookshelf', 10.3, 2.4],
          ['bed', 12.4, 6.25],
          ['desk', 10, 7],
          ['chair', 10, 6.1, 180],
          ['bed', 12.4, 8.75],
          ['desk', 10, 9.4],
          ['chair', 10, 8.5, 180],
        ],
        [
          ['living', 'east', 0.9],
          ['living', 'east', 3.4],
          ['living', 'east', 5.9],
          ['living', 'south', 1.4, -1],
        ],
      );
    case 'courtyard-house':
      return composeSample(
        id,
        [
          room('living', 'リビング・ダイニング', 2, 2, 7, 5),
          room('bedroom', '寝室', 9, 2, 4, 5, BEDROOM),
          room('office', 'ワークスペース', 2, 7, 4, 4, WORKSPACE),
          room('entrance', '玄関', 6, 7, 3, 2, ENTRANCE),
        ],
        [
          ['sofa', 4.1, 3.1],
          ['coffee-table', 4.1, 4.5],
          ['dining-table', 7.2, 5.3],
          ['chair', 6.7, 4.4],
          ['chair', 7.7, 6.2, 180],
          ['plant', 2.7, 6.3],
          ['bed', 11, 3.6],
          ['bookshelf', 12.3, 6.5],
          ['desk', 4, 10.3],
          ['chair', 4, 9.3, 180],
          ['bookshelf', 2.6, 9.6, 90],
          ['armchair', 4.9, 8.4],
          ['plant', 7.2, 8.5],
        ],
        [
          ['living', 'east', 1.5],
          ['living', 'south', 1.5],
          ['living', 'south', 4.8],
          ['entrance', 'east', 0.5],
        ],
      );
  }
}
