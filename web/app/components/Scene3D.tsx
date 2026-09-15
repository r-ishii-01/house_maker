'use client';

/**
 * 2Dエディターと同じメートル単位のプランを、外部アセットを使わずに立体化するビュー。
 * 家具と扉の座標・寸法・角度を共有し、部屋境界と追加壁にも同じ開口を反映する。
 * 図面の水平・垂直座標をThree.jsのX/Z、高さをYへ対応させ、表示範囲から台座と視点を導く。
 */
import {
  useEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
  type ComponentRef,
} from 'react';
import { useThree } from '@react-three/fiber';
import { MOUSE, Object3D, PerspectiveCamera, TOUCH } from 'three';
import SceneCanvas, { SceneFallback } from './SceneCanvas';
import Door3D from './Door3D';
import { OrbitControls, RoundedBox } from '@react-three/drei';
import {
  FURNITURE_CATALOG,
  getPlanDisplayBounds,
  getWallDoorOpenings,
} from '../lib/model';
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
  cameraMode: 'rotate' | 'pan';
};

// 縦長の分割ビューでも建物全体が画面に入るよう、狭い側の視野角からカメラ距離を決める。
function CameraFraming({
  cameraMode,
  width,
  depth,
}: {
  cameraMode: Scene3DProps['cameraMode'];
  width: number;
  depth: number;
}) {
  const { camera, size } = useThree();
  const controls = useRef<ComponentRef<typeof OrbitControls>>(null);
  const halfVerticalFov = (39 * Math.PI) / 360;
  const halfHorizontalFov = Math.atan(
    (Math.tan(halfVerticalFov) * size.width) / Math.max(size.height, 1),
  );
  // 原点からの表示範囲を囲む半径を使う。16×12mでは半径10mとなり、既存の視点を維持する。
  const radius = Math.hypot(width, depth) / 2;
  const centerX = width / 2;
  const centerZ = depth / 2;
  const distance =
    (radius / Math.sin(Math.min(halfVerticalFov, halfHorizontalFov))) * 1.04;
  // oxlint-disable-next-line react/react-compiler -- R3Fが所有する可変カメラとControlsを公開APIで同期する。
  useEffect(() => {
    const directionLength = Math.hypot(11, 18, 15);
    camera.position.set(
      centerX + (11 / directionLength) * distance,
      (18 / directionLength) * distance,
      centerZ + (15 / directionLength) * distance,
    );
    camera.lookAt(centerX, 0, centerZ);
    // リサイズや表示寸法の変更だけで全体表示へ戻し、注視点をメートル単位の表示中央へ揃える。
    // 寸法が同じ選択・家具移動・壁表示・操作モード変更では、利用者が移動した視点を保つ。
    controls.current?.target.set(centerX, 0, centerZ);
    controls.current?.update();
    // 細長い表示領域ではカメラが遠ざかるので、建物が遠方クリップ面で消えない距離も確保する。
    // Three.jsのカメラはR3Fが保持する可変オブジェクトであり、Reactの値とは別に投影行列を更新する。
    if (camera instanceof PerspectiveCamera)
      // oxlint-disable-next-line react/react-compiler -- R3Fの公開APIでカメラの投影を更新する。
      camera.far = Math.max(150, distance * 2 + 30);
    camera.updateProjectionMatrix();
  }, [camera, centerX, centerZ, distance, size.width, size.height]);
  return (
    <OrbitControls
      ref={controls}
      makeDefault
      target={[centerX, 0, centerZ]}
      // 画面に沿った上下左右の移動にし、左ドラッグと1本指の操作を同じモードへ揃える。
      enablePan
      screenSpacePanning
      mouseButtons={{
        LEFT: cameraMode === 'pan' ? MOUSE.PAN : MOUSE.ROTATE,
        MIDDLE: MOUSE.DOLLY,
        RIGHT: MOUSE.PAN,
      }}
      touches={{
        ONE: cameraMode === 'pan' ? TOUCH.PAN : TOUCH.ROTATE,
        TWO: TOUCH.DOLLY_PAN,
      }}
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

/**
 * 家具本体をX/Zが[-0.5, 0.5]、Yが[0, 1]のローカル空間で作り、最後に実寸へ拡大する。
 * 正面は+Z。席数・収納の面・円形の天板を変え、同じ選択処理のまま種類を見分けられるようにする。
 */
function FurnitureShape({
  kind,
  color,
}: {
  kind: FurnitureKind;
  color: string;
}) {
  if (kind === 'sofa' || kind === 'loveseat' || kind === 'armchair') {
    // 幅の違いを縮尺だけに任せず、座面の区切りも実際の席数へ揃える。
    const seats = kind === 'sofa' ? 3 : kind === 'loveseat' ? 2 : 1;
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
          size={[kind === 'armchair' ? 0.3 : 0.14, 0.3, 0.14]}
          color={LINEN}
          radius={0.04}
          rotation={[0.1, 0.12, -0.14]}
        />
      </group>
    );
  }

  if (
    kind === 'coffee-table' ||
    kind === 'dining-table' ||
    kind === 'side-table'
  ) {
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
              // 小型のサイドテーブルは直脚にし、接地面を実寸のY=0へ合わせる。
              rotation={
                kind === 'side-table' ? undefined : [z * 0.09, 0, -x * 0.07]
              }
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

  if (kind === 'ottoman') {
    return (
      <group>
        {[-0.35, 0.35].flatMap((x) =>
          [-0.33, 0.33].map((z) => (
            <Solid
              key={`${x}-${z}`}
              position={[x, 0.1, z]}
              size={[0.09, 0.2, 0.09]}
              color={DARK_WOOD}
            />
          )),
        )}
        <Solid
          position={[0, 0.4, 0]}
          size={[0.95, 0.44, 0.95]}
          color={color}
          radius={0.07}
        />
        {/* 背もたれを付けず、厚いクッションと下台の継ぎ目でスツールと区別する。 */}
        <Solid
          position={[0, 0.78, 0]}
          size={[1, 0.44, 1]}
          color={color}
          radius={0.09}
        />
      </group>
    );
  }

  if (kind === 'round-dining-table' || kind === 'stool') {
    const stool = kind === 'stool';
    // 円柱の半径0.5を幅・奥行きの両方へ拡大し、2Dの円形フットプリントに一致させる。
    return (
      <group>
        <mesh position={[0, stool ? 0.91 : 0.95, 0]} castShadow receiveShadow>
          <cylinderGeometry args={[0.5, 0.5, stool ? 0.18 : 0.1, 40]} />
          <meshStandardMaterial color={color} roughness={0.64} />
        </mesh>
        {stool ? (
          [-0.28, 0.28].flatMap((x) =>
            [-0.28, 0.28].map((z) => (
              <Solid
                key={`${x}-${z}`}
                position={[x, 0.415, z]}
                size={[0.09, 0.83, 0.09]}
                color={WOOD}
              />
            )),
          )
        ) : (
          <group>
            <mesh position={[0, 0.465, 0]} castShadow receiveShadow>
              <cylinderGeometry args={[0.075, 0.1, 0.87, 24]} />
              <meshStandardMaterial color={WOOD} roughness={0.65} />
            </mesh>
            <mesh position={[0, 0.025, 0]} castShadow receiveShadow>
              <cylinderGeometry args={[0.3, 0.34, 0.05, 32]} />
              <meshStandardMaterial color={WOOD} roughness={0.65} />
            </mesh>
          </group>
        )}
      </group>
    );
  }

  if (kind === 'nightstand' || kind === 'dresser' || kind === 'wardrobe') {
    const wardrobe = kind === 'wardrobe';
    const rows = kind === 'nightstand' ? [0.325, 0.725] : [0.235, 0.52, 0.805];
    // 本体・前板・取手を同じ寸法内に収める。+Z側の面で扉収納と引出収納を描き分ける。
    return (
      <group>
        {[-0.39, 0.39].flatMap((x) =>
          [-0.34, 0.34].map((z) => (
            <Solid
              key={`${x}-${z}`}
              position={[x, 0.055, z]}
              size={[0.075, 0.11, 0.09]}
              color={DARK_WOOD}
            />
          )),
        )}
        <Solid
          position={[0, 0.535, -0.035]}
          size={[0.98, 0.87, 0.89]}
          color={color}
          radius={0.012}
        />
        <Solid
          position={[0, 0.975, 0]}
          size={[1, 0.05, 1]}
          color={color}
          radius={0.012}
        />
        <Solid
          position={[0, 0.535, 0.418]}
          size={[0.955, 0.835, 0.018]}
          color={DARK_WOOD}
          radius={0.004}
        />
        {wardrobe
          ? [-0.242, 0.242].map((x) => (
              <group key={x}>
                <Solid
                  position={[x, 0.54, 0.445]}
                  size={[0.465, 0.805, 0.05]}
                  color={color}
                  radius={0.006}
                />
                <Solid
                  position={[Math.sign(x) * 0.065, 0.53, 0.485]}
                  size={[0.026, 0.11, 0.03]}
                  color={DARK_WOOD}
                  radius={0.006}
                />
              </group>
            ))
          : rows.map((y) => (
              <group key={y}>
                <Solid
                  position={[0, y, 0.445]}
                  size={[0.94, kind === 'nightstand' ? 0.365 : 0.255, 0.05]}
                  color={color}
                  radius={0.006}
                />
                <Solid
                  position={[0, y + 0.035, 0.485]}
                  size={[0.2, 0.024, 0.03]}
                  color={DARK_WOOD}
                  radius={0.006}
                />
              </group>
            ))}
      </group>
    );
  }

  if (kind === 'office-chair') {
    return (
      <group>
        {/* 5本脚とキャスターは中心から半径0.5以内に収め、回転後も配置寸法を越えない。 */}
        {Array.from({ length: 5 }, (_, index) => {
          const angle = (index * Math.PI * 2) / 5;
          return (
            <group key={index} rotation={[0, angle, 0]}>
              <Solid
                position={[0, 0.105, 0.205]}
                size={[0.07, 0.055, 0.41]}
                color="#424a47"
              />
              <mesh
                position={[0, 0.0475, 0.405]}
                rotation={[0, 0, Math.PI / 2]}
                castShadow
                receiveShadow
              >
                <cylinderGeometry args={[0.0475, 0.0475, 0.075, 12]} />
                <meshStandardMaterial color="#343b37" roughness={0.75} />
              </mesh>
            </group>
          );
        })}
        <mesh position={[0, 0.28, 0]} castShadow>
          <cylinderGeometry args={[0.045, 0.06, 0.34, 16]} />
          <meshStandardMaterial
            color="#6d7670"
            metalness={0.3}
            roughness={0.45}
          />
        </mesh>
        <Solid
          position={[0, 0.44, 0.04]}
          size={[0.83, 0.12, 0.86]}
          color={color}
          radius={0.06}
        />
        <Solid
          position={[0, 0.715, -0.39]}
          size={[0.13, 0.45, 0.07]}
          color="#424a47"
        />
        <Solid
          position={[0, 0.77, -0.345]}
          size={[0.8, 0.46, 0.18]}
          color={color}
          radius={0.065}
        />
        {[-0.46, 0.46].map((x) => (
          <group key={x}>
            <Solid
              position={[x, 0.52, 0.04]}
              size={[0.055, 0.26, 0.07]}
              color="#424a47"
            />
            <Solid
              position={[x, 0.65, 0.04]}
              size={[0.08, 0.06, 0.5]}
              color={color}
              radius={0.02}
            />
          </group>
        ))}
      </group>
    );
  }

  if (kind === 'floor-lamp') {
    return (
      <group>
        <mesh position={[0, 0.0175, 0]} castShadow receiveShadow>
          <cylinderGeometry args={[0.34, 0.36, 0.035, 32]} />
          <meshStandardMaterial color={DARK_WOOD} roughness={0.6} />
        </mesh>
        <mesh position={[0, 0.45, 0]} castShadow>
          <cylinderGeometry args={[0.026, 0.035, 0.84, 16]} />
          <meshStandardMaterial color={WOOD} roughness={0.65} />
        </mesh>
        {/* 発光用ライトは増やさず、明るい布色の傘で照明器具を表現する。 */}
        <mesh position={[0, 0.87, 0]} castShadow receiveShadow>
          <cylinderGeometry args={[0.33, 0.5, 0.26, 40]} />
          <meshStandardMaterial color={color} roughness={0.94} />
        </mesh>
      </group>
    );
  }

  if (kind === 'kitchen-island') {
    return (
      <group>
        <Solid
          position={[0, 0.06, -0.025]}
          size={[0.88, 0.12, 0.78]}
          color={DARK_WOOD}
        />
        <Solid
          position={[0, 0.5, -0.025]}
          size={[0.96, 0.82, 0.87]}
          color={WOOD}
          radius={0.01}
        />
        <Solid
          position={[0, 0.95, 0]}
          size={[1, 0.08, 1]}
          color={color}
          radius={0.018}
          roughness={0.38}
        />
        {/* 2Dと同じ左シンク・右2口の配置。天板をY=0.99にし、薄い設備も全高1以内へ収める。 */}
        <Solid
          position={[-0.22, 0.991, 0]}
          size={[0.28, 0.002, 0.5]}
          color="#718483"
          radius={0.001}
          roughness={0.3}
        />
        {[-0.37, -0.07].map((x) => (
          <Solid
            key={x}
            position={[x, 0.995, 0]}
            size={[0.02, 0.01, 0.54]}
            color="#b8c4c0"
            radius={0.003}
            roughness={0.25}
          />
        ))}
        {[-0.26, 0.26].map((z) => (
          <Solid
            key={z}
            position={[-0.22, 0.995, z]}
            size={[0.28, 0.01, 0.02]}
            color="#b8c4c0"
            radius={0.003}
            roughness={0.25}
          />
        ))}
        {/* 実寸の幅は奥行きの2倍なので、X半径をZの半分にして拡大後のコンロを正円にする。 */}
        {[-0.2, 0.2].map((z) => (
          <mesh
            key={z}
            position={[0.24, 0.995, z]}
            scale={[0.065, 1, 0.13]}
            castShadow
            receiveShadow
          >
            <cylinderGeometry args={[1, 1, 0.01, 32]} />
            <meshStandardMaterial color="#35433d" roughness={0.36} />
          </mesh>
        ))}
        {/* 天板下は引出3段と開き戸2枚。取手まで奥行き1以内に収める。 */}
        {[0.23, 0.485, 0.74].map((y) => (
          <group key={y}>
            <Solid
              position={[-0.315, y, 0.423]}
              size={[0.29, 0.23, 0.035]}
              color={LINEN}
              radius={0.006}
            />
            <Solid
              position={[-0.315, y + 0.05, 0.465]}
              size={[0.14, 0.02, 0.045]}
              color={DARK_WOOD}
              radius={0.005}
            />
          </group>
        ))}
        {[0, 0.315].map((x) => (
          <group key={x}>
            <Solid
              position={[x, 0.485, 0.423]}
              size={[0.29, 0.74, 0.035]}
              color={LINEN}
              radius={0.006}
            />
            <Solid
              position={[x - 0.085, 0.75, 0.465]}
              size={[0.02, 0.13, 0.045]}
              color={DARK_WOOD}
              radius={0.005}
            />
          </group>
        ))}
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

  if (kind === 'bed' || kind === 'single-bed') {
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
          position={[0, 0.64, kind === 'single-bed' ? -0.4575 : -0.46]}
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
        {/* 単床は中央の枕1つ、既存のダブルベッドは枕2つを維持する。 */}
        {(kind === 'single-bed' ? [0] : [-0.235, 0.235]).map((x) => (
          <Solid
            key={x}
            position={[x, 0.55, -0.27]}
            size={[kind === 'single-bed' ? 0.68 : 0.39, 0.13, 0.2]}
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

  if (kind === 'television') {
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

  // 種類を追加して描画を忘れた場合は型検査を失敗させ、別の家具で代用されるのを防ぐ。
  const unsupportedKind: never = kind;
  throw new Error(`未対応の家具です: ${String(unsupportedKind)}`);
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

/**
 * 部屋境界と追加壁を共通の壁ローカル X 軸へ変換し、開口端点で壁と幅木を分割する。
 * 扉の所属ではなく物理的に重なる区間を使うため、部屋間の共有壁にも穴が通る。
 */
function WallWithOpenings({
  plan,
  wall,
  mode,
  automatic = false,
  selected,
  onSelect,
}: {
  plan: PlanDocument;
  wall: Wall;
  mode: Scene3DProps['wallMode'];
  automatic?: boolean;
  selected: boolean;
  onSelect: Scene3DProps['onSelect'];
}) {
  const length = Math.hypot(wall.x2 - wall.x1, wall.z2 - wall.z1);
  if (length < 0.01) return null;
  const height = mode === 'cutaway' ? Math.min(wall.height, 0.55) : wall.height;
  const openings = getWallDoorOpenings(plan, wall);
  // 高さの違う開口が重なる場合も、各小区間の最大開口高を引いて重複した壁を残さない。
  const points = [
    ...new Set([
      0,
      length,
      ...openings.flatMap(({ start, end }) => [start, end]),
    ]),
  ].sort((a, b) => a - b);
  const wallColor = selected ? '#d8a37d' : automatic ? '#f4f1e8' : '#efece4';
  return (
    <group
      position={[wall.x1, 0.04, wall.z1]}
      rotation={[0, -Math.atan2(wall.z2 - wall.z1, wall.x2 - wall.x1), 0]}
      onClick={
        automatic
          ? undefined
          : (event) => {
              event.stopPropagation();
              onSelect(wall.id);
            }
      }
    >
      {points.slice(0, -1).map((start, index) => {
        const end = points[index + 1];
        if (end - start < 0.001) return null;
        const midpoint = (start + end) / 2;
        const openingHeight = Math.max(
          0,
          ...openings
            .filter(
              (opening) => opening.start < midpoint && opening.end > midpoint,
            )
            .map(({ door }) => door.height),
        );
        const bottom = Math.min(openingHeight, height);
        const solidHeight = height - bottom;
        // 自動壁の両端だけ厚みの半分を延ばして角を閉じ、開口の端には延長しない。
        const from =
          start - (automatic && index === 0 && openingHeight === 0 ? 0.07 : 0);
        const to =
          end +
          (automatic && index === points.length - 2 && openingHeight === 0
            ? 0.07
            : 0);
        return (
          <group key={`${start}-${end}`}>
            {solidHeight > 0.001 && (
              <Solid
                position={[(from + to) / 2, bottom + solidHeight / 2, 0]}
                size={[to - from, solidHeight, wall.thickness]}
                color={wallColor}
                radius={0.012}
              />
            )}
            {automatic && openingHeight === 0 && (
              <Solid
                position={[(from + to) / 2, 0.0425, 0]}
                size={[to - from, 0.085, wall.thickness + 0.025]}
                color="#dfdbcc"
                radius={0.004}
              />
            )}
          </group>
        );
      })}
    </group>
  );
}

const subscribeToClient = () => () => {};

export default function Scene3D({
  plan,
  selectedId,
  onSelect,
  wallMode,
  cameraMode,
}: Scene3DProps) {
  // SSRではfalse、ブラウザではtrueを返し、Canvasだけをハイドレーション後に作成する。
  const mounted = useSyncExternalStore(
    subscribeToClient,
    () => true,
    () => false,
  );
  const boundaries = useMemo(() => getRoomBoundaries(plan.rooms), [plan.rooms]);
  const { width, depth } = getPlanDisplayBounds(plan);
  const centerX = width / 2;
  const centerZ = depth / 2;
  const radius = Math.hypot(width, depth) / 2;
  // 光源と対象を同じ中心から置き、広い間取りでも光の方向を保って影を領域全体へ届ける。
  // targetはシーンに追加してワールド座標を更新する。GPU資源を持たないObject3Dを再利用する。
  const lightTarget = useMemo(() => new Object3D(), []);
  const lightScale = radius / 10;
  const shadowExtent = radius + 4;

  if (!mounted) return <SceneFallback loading />;

  return (
    <section
      aria-label={`${plan.name}の3D表示。ドラッグで${cameraMode === 'pan' ? '移動' : '回転'}、右ドラッグで移動、ホイールで拡大縮小、家具や扉をクリックして選択。`}
      style={{ width: '100%', height: '100%', minHeight: 280 }}
    >
      <SceneCanvas onPointerMissed={() => onSelect(null)}>
        <color attach="background" args={['#eeeee7']} />
        {/* 霧は使わず、ズームや画面比率によって家と家具が背景色へ消えることを防ぐ。 */}
        <ambientLight intensity={1.1} />
        <hemisphereLight args={['#fffaf0', '#bac3b3', 1.5]} />
        <primitive object={lightTarget} position={[centerX, 0, centerZ]} />
        <directionalLight
          position={[
            centerX + 6 * lightScale,
            16 * lightScale,
            centerZ + 4 * lightScale,
          ]}
          target={lightTarget}
          intensity={2.25}
          castShadow
          shadow-mapSize={[2048, 2048]}
          shadow-camera-left={-shadowExtent}
          shadow-camera-right={shadowExtent}
          shadow-camera-top={shadowExtent}
          shadow-camera-bottom={-shadowExtent}
          shadow-camera-far={Math.max(50, radius * 4)}
          // 影カメラは範囲プロパティの変更だけでは投影が更新されないため、Reactの更新時に同期する。
          onUpdate={(light) => light.shadow.camera.updateProjectionMatrix()}
          shadow-normalBias={0.045}
          shadow-bias={-0.0002}
        />
        <directionalLight
          position={[centerX - 9, 7, centerZ - 5]}
          target={lightTarget}
          intensity={0.7}
          color="#e6eef0"
        />
        <mesh
          receiveShadow
          rotation={[-Math.PI / 2, 0, 0]}
          position={[centerX, -0.29, centerZ]}
        >
          <planeGeometry args={[180, 180]} />
          <meshStandardMaterial color="#eeeee7" roughness={1} />
        </mesh>
        <Solid
          position={[centerX, -0.135, centerZ]}
          size={[width + 0.3, 0.28, depth + 0.3]}
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
        {boundaries.map((boundary) => {
          const horizontal = boundary.axis === 'x';
          // 境界は常に x または z の増加方向へ向け、共有モデルと同じ開口距離に変換する。
          const wall: Wall = {
            id: `boundary-${boundary.axis}-${boundary.coordinate}-${boundary.start}`,
            x1: horizontal ? boundary.start : boundary.coordinate,
            z1: horizontal ? boundary.coordinate : boundary.start,
            x2: horizontal ? boundary.end : boundary.coordinate,
            z2: horizontal ? boundary.coordinate : boundary.end,
            height: 2.6,
            thickness: 0.14,
          };
          return (
            <WallWithOpenings
              key={wall.id}
              plan={plan}
              wall={wall}
              mode={wallMode}
              automatic
              selected={false}
              onSelect={onSelect}
            />
          );
        })}
        {plan.walls.map((wall) => (
          <WallWithOpenings
            key={wall.id}
            plan={plan}
            wall={wall}
            mode={wallMode}
            selected={selectedId === wall.id}
            onSelect={onSelect}
          />
        ))}
        {plan.doors.map((door) => (
          <Door3D
            key={door.id}
            plan={plan}
            door={door}
            wallMode={wallMode}
            selected={selectedId === door.id}
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
        <CameraFraming cameraMode={cameraMode} width={width} depth={depth} />
      </SceneCanvas>
    </section>
  );
}
