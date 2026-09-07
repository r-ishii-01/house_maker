'use client';

/**
 * 2Dエディターと同じメートル単位のプランを、外部アセットを使わずに立体化するビュー。
 * 家具の中心座標・寸法・角度を共有するため、2Dでの変更がそのまま3Dに反映される。
 */
import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { useThree } from '@react-three/fiber';
import { PerspectiveCamera } from 'three';
import SceneCanvas, { SceneFallback } from './SceneCanvas';
import { OrbitControls, RoundedBox } from '@react-three/drei';
import { FURNITURE_CATALOG } from '../lib/model';
import type {
  FurnitureKind,
  PlanDocument,
  PlacedFurniture,
  Room,
  Wall,
} from '../lib/model';

type Scene3DProps = {
  plan: PlanDocument;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  wallMode: 'full' | 'cutaway';
};

// 縦長の分割ビューでも建物全体が画面に入るよう、狭い側の視野角からカメラ距離を決める。
function CameraFraming() {
  const { camera, size } = useThree();
  const halfVerticalFov = (39 * Math.PI) / 360;
  const halfHorizontalFov = Math.atan(
    (Math.tan(halfVerticalFov) * size.width) / Math.max(size.height, 1),
  );
  const distance =
    (10 / Math.sin(Math.min(halfVerticalFov, halfHorizontalFov))) * 1.04;
  useEffect(() => {
    const directionLength = Math.hypot(11, 18, 15);
    camera.position.set(
      8 + (11 / directionLength) * distance,
      (18 / directionLength) * distance,
      6 + (15 / directionLength) * distance,
    );
    camera.lookAt(8, 0, 6);
    // 細長い表示領域ではカメラが遠ざかるので、建物が遠方クリップ面で消えない距離も確保する。
    // Three.jsのカメラはR3Fが保持する可変オブジェクトであり、Reactの値とは別に投影行列を更新する。
    if (camera instanceof PerspectiveCamera)
      // oxlint-disable-next-line react/react-compiler -- R3Fの公開APIでカメラの投影を更新する。
      camera.far = Math.max(150, distance * 2 + 30);
    camera.updateProjectionMatrix();
  }, [camera, distance]);
  return (
    <OrbitControls
      makeDefault
      target={[8, 0, 6]}
      enableDamping
      dampingFactor={0.075}
      minDistance={8}
      maxDistance={Math.max(100, distance * 1.5)}
      minPolarAngle={0.12}
      maxPolarAngle={Math.PI / 2.12}
    />
  );
}

type Vector3 = [number, number, number];
type SolidProps = {
  position: Vector3;
  size: Vector3;
  color: string;
  radius?: number;
  rotation?: Vector3;
  roughness?: number;
};

const WOOD = '#b99672';
const DARK_WOOD = '#745842';
const LINEN = '#eee7d9';
const ACCENT = '#c7794e';

/** 角の小さな丸みで、単純な箱にも家具らしい光の縁を付ける。 */
function Solid({
  position,
  size,
  color,
  radius = 0.018,
  rotation,
  roughness = 0.78,
}: SolidProps) {
  return (
    <RoundedBox
      args={size}
      radius={Math.min(radius, Math.min(...size) / 2.1)}
      smoothness={2}
      position={position}
      rotation={rotation}
      castShadow
      receiveShadow
    >
      <meshStandardMaterial color={color} roughness={roughness} />
    </RoundedBox>
  );
}

/** 全家具を幅・高さ・奥行きが1のローカル空間で作り、最後に実寸へ拡大する。 */
function FurnitureShape({
  kind,
  color,
}: {
  kind: FurnitureKind;
  color: string;
}) {
  if (kind === 'sofa' || kind === 'armchair') {
    const seats = kind === 'sofa' ? 3 : 1;
    return (
      <group>
        {[-0.37, 0.37].flatMap((x) =>
          [-0.33, 0.33].map((z) => (
            <Solid
              key={`${x}-${z}`}
              position={[x, 0.1, z]}
              size={[0.065, 0.2, 0.075]}
              color={DARK_WOOD}
            />
          )),
        )}
        <Solid
          position={[0, 0.27, 0]}
          size={[0.98, 0.24, 0.95]}
          color={color}
          radius={0.065}
        />
        <Solid
          position={[0, 0.68, -0.36]}
          size={[0.97, 0.64, 0.23]}
          color={color}
          radius={0.065}
        />
        {[-0.435, 0.435].map((x) => (
          <Solid
            key={x}
            position={[x, 0.51, 0]}
            size={[0.13, 0.44, 0.94]}
            color={color}
            radius={0.05}
          />
        ))}
        {Array.from({ length: seats }, (_, index) => {
          const width = 0.73 / seats;
          const x = -0.365 + width * (index + 0.5);
          return (
            <group key={index}>
              <Solid
                position={[x, 0.43, 0.075]}
                size={[width - 0.014, 0.18, 0.67]}
                color={color}
                radius={0.04}
              />
              <Solid
                position={[x, 0.72, -0.23]}
                size={[width - 0.02, 0.39, 0.14]}
                color={color}
                radius={0.04}
                rotation={[-0.12, 0, 0]}
              />
            </group>
          );
        })}
        <Solid
          position={[-0.24, 0.62, 0.05]}
          size={[kind === 'sofa' ? 0.14 : 0.3, 0.3, 0.14]}
          color={LINEN}
          radius={0.04}
          rotation={[0.1, 0.12, -0.14]}
        />
      </group>
    );
  }

  if (kind === 'coffee-table' || kind === 'dining-table') {
    const coffee = kind === 'coffee-table';
    return (
      <group>
        <Solid
          position={[0, 0.925, 0]}
          size={[1, 0.15, 1]}
          color={color}
          radius={0.055}
          roughness={0.57}
        />
        {[-0.35, 0.35].flatMap((x) =>
          [-0.34, 0.34].map((z) => (
            <Solid
              key={`${x}-${z}`}
              position={[x, 0.435, z]}
              size={[0.07, 0.87, 0.07]}
              color={WOOD}
              rotation={[z * 0.09, 0, -x * 0.07]}
            />
          )),
        )}
        {coffee && (
          <group>
            <Solid
              position={[-0.16, 1.025, 0.06]}
              size={[0.24, 0.035, 0.31]}
              color="#eee8d9"
              radius={0.008}
              rotation={[0, -0.15, 0]}
            />
            <Solid
              position={[-0.13, 1.06, 0.07]}
              size={[0.2, 0.03, 0.26]}
              color="#8c9b86"
              radius={0.005}
              rotation={[0, 0.04, 0]}
            />
            <mesh position={[0.25, 1.06, -0.18]} castShadow>
              <cylinderGeometry args={[0.055, 0.055, 0.1, 20]} />
              <meshStandardMaterial color="#eee5d5" roughness={0.5} />
            </mesh>
          </group>
        )}
      </group>
    );
  }

  if (kind === 'chair') {
    return (
      <group>
        {[-0.34, 0.34].flatMap((x) =>
          [-0.32, 0.32].map((z) => (
            <Solid
              key={`${x}-${z}`}
              position={[x, 0.26, z]}
              size={[0.075, 0.52, 0.075]}
              color={WOOD}
            />
          )),
        )}
        <Solid
          position={[0, 0.51, 0]}
          size={[0.98, 0.11, 0.92]}
          color={color}
          radius={0.045}
        />
        {[-0.36, 0.36].map((x) => (
          <Solid
            key={x}
            position={[x, 0.75, -0.37]}
            size={[0.07, 0.45, 0.075]}
            color={WOOD}
          />
        ))}
        <Solid
          position={[0, 0.855, -0.37]}
          size={[0.94, 0.29, 0.1]}
          color={color}
          radius={0.045}
        />
      </group>
    );
  }

  if (kind === 'bed') {
    return (
      <group>
        <Solid
          position={[0, 0.16, 0]}
          size={[1, 0.27, 0.99]}
          color={WOOD}
          radius={0.02}
        />
        <Solid
          position={[0, 0.38, 0.02]}
          size={[0.97, 0.23, 0.93]}
          color={LINEN}
          radius={0.055}
        />
        <Solid
          position={[0, 0.64, -0.46]}
          size={[1, 0.72, 0.085]}
          color={color}
          radius={0.03}
        />
        <Solid
          position={[0, 0.515, 0.19]}
          size={[0.99, 0.085, 0.57]}
          color={color}
          radius={0.035}
        />
        <Solid
          position={[0, 0.563, -0.04]}
          size={[0.99, 0.025, 0.12]}
          color="#e1d6bf"
          radius={0.012}
        />
        {[-0.235, 0.235].map((x) => (
          <Solid
            key={x}
            position={[x, 0.55, -0.27]}
            size={[0.39, 0.13, 0.2]}
            color="#faf6ec"
            radius={0.045}
          />
        ))}
      </group>
    );
  }

  if (kind === 'desk') {
    return (
      <group>
        <Solid
          position={[0, 0.925, 0]}
          size={[1, 0.1, 1]}
          color={color}
          radius={0.025}
        />
        <Solid
          position={[0.32, 0.455, -0.02]}
          size={[0.3, 0.88, 0.85]}
          color={WOOD}
        />
        {[-0.34, 0.34].map((z) => (
          <Solid
            key={z}
            position={[-0.42, 0.43, z]}
            size={[0.055, 0.86, 0.06]}
            color={DARK_WOOD}
          />
        ))}
        {[0.3, 0.56, 0.8].map((y) => (
          <group key={y}>
            <Solid
              position={[0.32, y, 0.416]}
              size={[0.267, 0.205, 0.022]}
              color={color}
              radius={0.008}
            />
            <Solid
              position={[0.32, y + 0.02, 0.435]}
              size={[0.08, 0.018, 0.015]}
              color={DARK_WOOD}
              radius={0.004}
            />
          </group>
        ))}
        <Solid
          position={[-0.13, 0.988, 0.02]}
          size={[0.32, 0.022, 0.31]}
          color="#aeb6b2"
          radius={0.007}
        />
        <Solid
          position={[-0.13, 1.11, -0.12]}
          size={[0.32, 0.23, 0.025]}
          color="#37443f"
          radius={0.012}
          rotation={[-0.14, 0, 0]}
        />
      </group>
    );
  }

  if (kind === 'bookshelf') {
    const bookColors = ['#849983', '#d5b493', '#d8d1bd', '#a36751', '#78898c'];
    return (
      <group>
        <Solid position={[0, 0.5, -0.45]} size={[1, 1, 0.065]} color={color} />
        {[-0.47, 0.47].map((x) => (
          <Solid
            key={x}
            position={[x, 0.5, 0]}
            size={[0.06, 1, 1]}
            color={color}
          />
        ))}
        {[0.035, 0.27, 0.51, 0.75, 0.98].map((y) => (
          <Solid
            key={y}
            position={[0, y, 0]}
            size={[1, 0.04, 1]}
            color={color}
          />
        ))}
        {[0.29, 0.53, 0.77].flatMap((y, shelf) =>
          Array.from({ length: 6 }, (_, index) => {
            const height = 0.12 + ((index * 3 + shelf) % 4) * 0.017;
            return (
              <Solid
                key={`${shelf}-${index}`}
                position={[-0.35 + index * 0.105, y + height / 2, 0.16]}
                size={[0.07, height, 0.5]}
                color={bookColors[(index + shelf) % bookColors.length]}
                radius={0.004}
                rotation={[0, 0, index === 5 ? -0.12 : 0]}
              />
            );
          }),
        )}
        <Solid
          position={[0.15, 0.13, 0.05]}
          size={[0.4, 0.15, 0.7]}
          color="#b1a48b"
          radius={0.012}
        />
      </group>
    );
  }

  if (kind === 'plant') {
    return (
      <group>
        <mesh position={[0, 0.18, 0]} castShadow receiveShadow>
          <cylinderGeometry args={[0.32, 0.235, 0.36, 24]} />
          <meshStandardMaterial color={color} roughness={0.85} />
        </mesh>
        <mesh position={[0, 0.365, 0]}>
          <cylinderGeometry args={[0.285, 0.285, 0.014, 24]} />
          <meshStandardMaterial color="#544534" />
        </mesh>
        <mesh position={[0, 0.57, 0]} castShadow>
          <cylinderGeometry args={[0.021, 0.034, 0.46, 8]} />
          <meshStandardMaterial color="#59664a" />
        </mesh>
        {/* 葉を決定的に配置し、再描画時に形が変わる乱数の使用を避ける。 */}
        {Array.from({ length: 9 }, (_, index) => {
          const angle = index * 2.4;
          const radius = index > 5 ? 0.14 : 0.24;
          return (
            <mesh
              key={index}
              position={[
                Math.cos(angle) * radius,
                0.58 + index * 0.037,
                Math.sin(angle) * radius,
              ]}
              rotation={[0.2, angle, index % 2 ? -0.48 : 0.48]}
              scale={[0.18, 0.22, 0.1]}
              castShadow
            >
              <sphereGeometry args={[1, 12, 10]} />
              <meshStandardMaterial
                color={index % 3 === 0 ? '#64816a' : '#45684c'}
                roughness={0.9}
              />
            </mesh>
          );
        })}
      </group>
    );
  }

  // テレビの画面も色付きの面で生成し、画像や動画の取得を不要にする。
  return (
    <group>
      <Solid
        position={[0, 0.625, 0]}
        size={[1, 0.75, 0.15]}
        color={color}
        radius={0.015}
        roughness={0.48}
      />
      <Solid
        position={[0, 0.628, 0.081]}
        size={[0.94, 0.67, 0.012]}
        color="#253e3c"
        radius={0.005}
        roughness={0.24}
      />
      <Solid
        position={[0, 0.625, -0.03]}
        size={[0.43, 0.3, 0.23]}
        color={color}
        radius={0.025}
      />
      {[-0.3, 0.3].map((x) => (
        <Solid
          key={x}
          position={[x, 0.135, 0]}
          size={[0.045, 0.24, 0.45]}
          color="#3e423e"
          rotation={[0, 0, x]}
        />
      ))}
    </group>
  );
}

/** 選択枠は家具と同じ回転に追従するので、配置面積が分かりやすい。 */
function SelectionOutline({
  width,
  depth,
  color = ACCENT,
}: {
  width: number;
  depth: number;
  color?: string;
}) {
  const points = useMemo(
    () =>
      new Float32Array([
        -width / 2,
        0.032,
        -depth / 2,
        width / 2,
        0.032,
        -depth / 2,
        width / 2,
        0.032,
        depth / 2,
        -width / 2,
        0.032,
        depth / 2,
      ]),
    [width, depth],
  );
  return (
    <group>
      <lineLoop>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[points, 3]} />
        </bufferGeometry>
        <lineBasicMaterial color={color} depthTest={false} />
      </lineLoop>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.019, 0]}>
        <planeGeometry args={[width, depth]} />
        <meshBasicMaterial
          color={color}
          transparent
          opacity={0.085}
          depthWrite={false}
        />
      </mesh>
    </group>
  );
}

function Furniture({
  item,
  selected,
  onSelect,
}: {
  item: PlacedFurniture;
  selected: boolean;
  onSelect: Scene3DProps['onSelect'];
}) {
  const definition = FURNITURE_CATALOG.find(
    (entry) => entry.kind === item.kind,
  );
  if (!definition) return null;
  return (
    <group
      position={[item.x, 0.045, item.z]}
      rotation={[0, (-item.rotation * Math.PI) / 180, 0]}
      onClick={(event) => {
        event.stopPropagation();
        onSelect(item.id);
      }}
    >
      {selected && (
        <SelectionOutline
          width={definition.width + 0.16}
          depth={definition.depth + 0.16}
        />
      )}
      <group scale={[definition.width, definition.height, definition.depth]}>
        <FurnitureShape
          kind={item.kind}
          color={item.color || definition.color}
        />
      </group>
    </group>
  );
}

type RoomBoundary = {
  axis: 'x' | 'z';
  coordinate: number;
  start: number;
  end: number;
};

/** 同一直線上の部屋の辺を結合し、隣接する部屋の共有壁を二重に描かない。 */
function getRoomBoundaries(rooms: Room[]): RoomBoundary[] {
  const groups = new Map<string, RoomBoundary[]>();
  const add = (
    axis: RoomBoundary['axis'],
    coordinate: number,
    start: number,
    end: number,
  ) => {
    const key = `${axis}:${Math.round(coordinate * 1000)}`;
    const list = groups.get(key) ?? [];
    list.push({ axis, coordinate, start, end });
    groups.set(key, list);
  };
  for (const room of rooms) {
    add('x', room.z, room.x, room.x + room.width);
    add('x', room.z + room.depth, room.x, room.x + room.width);
    add('z', room.x, room.z, room.z + room.depth);
    add('z', room.x + room.width, room.z, room.z + room.depth);
  }
  const boundaries: RoomBoundary[] = [];
  for (const edges of groups.values()) {
    const sorted = edges.sort((a, b) => a.start - b.start);
    let current = { ...sorted[0] };
    for (const edge of sorted.slice(1)) {
      if (edge.start <= current.end + 0.001)
        current.end = Math.max(current.end, edge.end);
      else {
        boundaries.push(current);
        current = { ...edge };
      }
    }
    boundaries.push(current);
  }
  return boundaries;
}

function RoomFloor({
  room,
  selected,
  onSelect,
}: {
  room: Room;
  selected: boolean;
  onSelect: Scene3DProps['onSelect'];
}) {
  const plankCount = Math.ceil(room.depth / 0.34);
  return (
    <group
      position={[room.x + room.width / 2, 0, room.z + room.depth / 2]}
      onClick={(event) => {
        event.stopPropagation();
        onSelect(room.id);
      }}
    >
      <mesh receiveShadow position={[0, -0.005, 0]}>
        <boxGeometry args={[room.width, 0.08, room.depth]} />
        <meshStandardMaterial
          color={room.color || '#d5bc97'}
          roughness={0.88}
        />
      </mesh>
      {/* 細い継ぎ目でフローリングの縮尺を表現する。テクスチャ通信は発生しない。 */}
      {Array.from({ length: Math.max(0, plankCount - 1) }, (_, index) => {
        const z = -room.depth / 2 + (index + 1) * 0.34;
        if (z >= room.depth / 2) return null;
        return (
          <mesh key={index} position={[0, 0.037, z]} receiveShadow>
            <boxGeometry args={[room.width, 0.002, 0.008]} />
            <meshStandardMaterial color="#937e61" transparent opacity={0.15} />
          </mesh>
        );
      })}
      {selected && (
        <group position={[0, 0.018, 0]}>
          <SelectionOutline width={room.width - 0.1} depth={room.depth - 0.1} />
        </group>
      )}
    </group>
  );
}

function CustomWall({
  wall,
  mode,
  selected,
  onSelect,
}: {
  wall: Wall;
  mode: Scene3DProps['wallMode'];
  selected: boolean;
  onSelect: Scene3DProps['onSelect'];
}) {
  const length = Math.hypot(wall.x2 - wall.x1, wall.z2 - wall.z1);
  if (length < 0.01) return null;
  const height = mode === 'cutaway' ? Math.min(wall.height, 0.55) : wall.height;
  return (
    <group
      position={[
        (wall.x1 + wall.x2) / 2,
        height / 2 + 0.04,
        (wall.z1 + wall.z2) / 2,
      ]}
      rotation={[0, -Math.atan2(wall.z2 - wall.z1, wall.x2 - wall.x1), 0]}
      onClick={(event) => {
        event.stopPropagation();
        onSelect(wall.id);
      }}
    >
      <Solid
        position={[0, 0, 0]}
        size={[length, height, wall.thickness]}
        color={selected ? '#d8a37d' : '#efece4'}
        radius={0.012}
      />
    </group>
  );
}

const subscribeToClient = () => () => {};

export default function Scene3D({
  plan,
  selectedId,
  onSelect,
  wallMode,
}: Scene3DProps) {
  // SSRではfalse、ブラウザではtrueを返し、Canvasだけをハイドレーション後に作成する。
  const mounted = useSyncExternalStore(
    subscribeToClient,
    () => true,
    () => false,
  );
  const boundaries = useMemo(() => getRoomBoundaries(plan.rooms), [plan.rooms]);

  const wallHeight = wallMode === 'cutaway' ? 0.55 : 2.6;

  if (!mounted) return <SceneFallback loading />;

  return (
    <section
      aria-label={`${plan.name}の3D表示。ドラッグで回転、ホイールで拡大縮小、家具をクリックして選択。`}
      style={{ width: '100%', height: '100%', minHeight: 280 }}
    >
      <SceneCanvas onPointerMissed={() => onSelect(null)}>
        <color attach="background" args={['#eeeee7']} />
        {/* 霧は使わず、ズームや画面比率によって家と家具が背景色へ消えることを防ぐ。 */}
        <ambientLight intensity={1.1} />
        <hemisphereLight args={['#fffaf0', '#bac3b3', 1.5]} />
        <directionalLight
          position={[6, 16, 4]}
          intensity={2.25}
          castShadow
          shadow-mapSize={[2048, 2048]}
          shadow-camera-left={-14}
          shadow-camera-right={14}
          shadow-camera-top={14}
          shadow-camera-bottom={-14}
          shadow-normalBias={0.045}
          shadow-bias={-0.0002}
        />
        <directionalLight
          position={[-9, 7, -5]}
          intensity={0.7}
          color="#e6eef0"
        />
        <mesh
          receiveShadow
          rotation={[-Math.PI / 2, 0, 0]}
          position={[8, -0.29, 6]}
        >
          <planeGeometry args={[180, 180]} />
          <meshStandardMaterial color="#eeeee7" roughness={1} />
        </mesh>
        <Solid
          position={[8, -0.135, 6]}
          size={[16.3, 0.28, 12.3]}
          color="#deded3"
          radius={0.1}
        />
        {plan.rooms.map((room) => (
          <RoomFloor
            key={room.id}
            room={room}
            selected={selectedId === room.id}
            onSelect={onSelect}
          />
        ))}
        {boundaries.map((wall) => {
          const length = wall.end - wall.start;
          if (length < 0.01) return null;
          const horizontal = wall.axis === 'x';
          return (
            <group
              key={`${wall.axis}-${wall.coordinate}-${wall.start}`}
              position={
                horizontal
                  ? [(wall.start + wall.end) / 2, 0, wall.coordinate]
                  : [wall.coordinate, 0, (wall.start + wall.end) / 2]
              }
            >
              <Solid
                position={[0, wallHeight / 2 + 0.035, 0]}
                size={
                  horizontal
                    ? [length + 0.14, wallHeight, 0.14]
                    : [0.14, wallHeight, length + 0.14]
                }
                color="#f4f1e8"
                radius={0.015}
              />
              <Solid
                position={[0, 0.083, 0]}
                size={
                  horizontal
                    ? [length + 0.15, 0.085, 0.165]
                    : [0.165, 0.085, length + 0.15]
                }
                color="#dfdbcc"
                radius={0.004}
              />
            </group>
          );
        })}
        {plan.walls.map((wall) => (
          <CustomWall
            key={wall.id}
            wall={wall}
            mode={wallMode}
            selected={selectedId === wall.id}
            onSelect={onSelect}
          />
        ))}
        {plan.furniture.map((item) => (
          <Furniture
            key={item.id}
            item={item}
            selected={selectedId === item.id}
            onSelect={onSelect}
          />
        ))}
        <CameraFraming />
      </SceneCanvas>
    </section>
  );
}
