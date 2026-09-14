'use client';

/**
 * 共有モデルの開口と開閉方向から、外部モデルを使わずに木製扉と枠を描く。
 * 座標と寸法はメートル。図面の x/z を水平面、Three.js の Y を高さとして扱う。
 */
import { getDoorGeometry } from '../lib/model';
import type { Door, PlanDocument } from '../lib/model';

type Door3DProps = {
  plan: PlanDocument;
  door: Door;
  selected: boolean;
  wallMode: 'full' | 'cutaway';
  onSelect: (id: string | null) => void;
};

type DoorPartProps = {
  position: [number, number, number];
  size: [number, number, number];
  color: string;
  metal?: boolean;
};

// 箱形部材は React 管理の geometry/material とし、削除時のリソース破棄を R3F に任せる。
function DoorPart({ position, size, color, metal = false }: DoorPartProps) {
  return (
    <mesh position={position} castShadow receiveShadow>
      <boxGeometry args={size} />
      <meshStandardMaterial
        color={color}
        roughness={metal ? 0.3 : 0.72}
        metalness={metal ? 0.72 : 0}
      />
    </mesh>
  );
}

export default function Door3D({
  plan,
  door,
  selected,
  wallMode,
  onSelect,
}: Door3DProps) {
  const geometry = getDoorGeometry(plan, door);
  if (!geometry) return null;

  const { wall, start, hinge, leafEnd, angle } = geometry;
  const wallHeight =
    wallMode === 'cutaway' ? Math.min(wall.height, 0.55) : wall.height;
  const height = Math.min(door.height, wallHeight);
  if (height <= 0) return null;

  const frameWidth = 0.045;
  const leafThickness = 0.045;
  const frameDepth = wall.thickness + 0.035;
  const wood = selected ? '#cc8a56' : '#b88c61';
  const frameColor = selected ? '#dba373' : '#a97d55';
  // SVG の正角は +z 方向へ回るため、Three.js では Y 回転の符号を反転する。
  // 蝶番と葉先を共有計算から使うことで、壁の向き・左右勝手・開く側を 2D と一致させる。
  const leafAngle = -Math.atan2(leafEnd.z - hinge.z, leafEnd.x - hinge.x);
  const handleHeight = Math.min(1.02, door.height / 2);
  const headerHeight = Math.min(frameWidth, wallHeight - door.height);

  return (
    <group
      name={`door-${door.id}`}
      onClick={(event) => {
        event.stopPropagation();
        onSelect(door.id);
      }}
    >
      <group
        position={[start.x, 0.04, start.z]}
        rotation={[0, (-angle * Math.PI) / 180, 0]}
      >
        {/* 枠は開口の外側に置き、共有寸法どおりの開口幅と扉板の幅を確保する。 */}
        {[-frameWidth / 2, door.width + frameWidth / 2].map((x) => (
          <DoorPart
            key={x}
            position={[x, height / 2, 0]}
            size={[frameWidth, height, frameDepth]}
            color={frameColor}
          />
        ))}
        {/* cutaway で切断面より高い上枠を残すと視界を遮るため、実際の壁高で切り取る。 */}
        {headerHeight > 0.001 && (
          <DoorPart
            position={[door.width / 2, door.height + headerHeight / 2, 0]}
            size={[door.width + frameWidth * 2, headerHeight, frameDepth]}
            color={frameColor}
          />
        )}
      </group>
      <group position={[hinge.x, 0.04, hinge.z]} rotation={[0, leafAngle, 0]}>
        <DoorPart
          position={[door.width / 2, height / 2, 0]}
          size={[door.width, height, leafThickness]}
          color={wood}
        />
        {/* 全高では控えめな鏡板を付け、断面表示では部材を上へ移動せず非表示にする。 */}
        {height > 1.35 &&
          [-1, 1].map((side) => (
            <DoorPart
              key={`panel-${side}`}
              position={[
                door.width / 2,
                height / 2 + 0.1,
                side * (leafThickness / 2 + 0.003),
              ]}
              size={[Math.max(0.1, door.width - 0.18), height - 0.42, 0.006]}
              color={selected ? '#d49b6d' : '#c2976c'}
            />
          ))}
        {handleHeight + 0.08 < height &&
          [-1, 1].map((side) => (
            <group key={`handle-${side}`}>
              <DoorPart
                position={[door.width - 0.1, handleHeight, side * 0.033]}
                size={[0.045, 0.11, 0.02]}
                color="#786a56"
                metal
              />
              <DoorPart
                position={[door.width - 0.1, handleHeight, side * 0.061]}
                size={[0.025, 0.025, 0.06]}
                color="#c8b998"
                metal
              />
              <DoorPart
                position={[door.width - 0.145, handleHeight, side * 0.085]}
                size={[0.11, 0.025, 0.025]}
                color="#c8b998"
                metal
              />
            </group>
          ))}
        {selected && (
          <mesh position={[door.width / 2, height / 2, 0]}>
            <boxGeometry
              args={[door.width + 0.018, height + 0.018, leafThickness + 0.018]}
            />
            <meshBasicMaterial color="#d17a42" wireframe />
          </mesh>
        )}
      </group>
    </group>
  );
}
