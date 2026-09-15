'use client';
/* oxlint-disable jsx-a11y/prefer-tag-over-role -- SVG内にはHTMLのbutton/imgを置けないため、図形へARIAの意味を付与する。 */
/* oxlint-disable jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/no-noninteractive-tabindex -- 図面は画像として説明しつつ、扉配置・表示移動モードではフォーカス可能なSVG操作面として矢印とEnterを受け取る。 */
// SVG座標を実寸のX/Z座標に変換し、ポインター操作の確定時だけ共有状態を更新する。
import { useId, useRef, useState, type PointerEvent } from 'react';
import { FurnitureFootprint } from './FurnitureFootprint';
// 既存のカタログ・サンプルからの参照を維持し、描画実装だけを専用ファイルへ集約する。
export { FurnitureFootprint } from './FurnitureFootprint';
import {
  BOARD,
  catalogItem,
  clamp,
  snap,
  findDoorPlacement,
  getDoorGeometry,
  getWallDoorOpenings,
  type Door,
  type FurnitureKind,
  type PlanDocument,
  type PlacedFurniture,
} from '../lib/model';
export type Tool = 'select' | 'room' | 'wall' | 'furniture' | 'door';
// 表示枠もメートル単位。親画面が保持し、編集でSVGが再生成されても視点を維持する。
export type PlanView = { x: number; z: number; width: number; depth: number };
type Point = { x: number; z: number };
type Gesture = {
  start: Point;
  end: Point;
  item?: PlacedFurniture;
  offset?: Point;
  door?: Door;
  placingDoor?: boolean;
  pan?: { view: PlanView; inverse: DOMMatrix };
  pointerId: number;
};
interface Props {
  plan: PlanDocument;
  selectedId: string | null;
  tool: Tool;
  pending: FurnitureKind | null;
  view: PlanView;
  panning: boolean;
  onViewChange: (view: PlanView) => void;
  onSelect: (id: string | null) => void;
  onPlace: (point: Point) => void;
  onRoom: (bounds: {
    x: number;
    z: number;
    width: number;
    depth: number;
  }) => void;
  onWall: (start: Point, end: Point) => void;
  onMove: (id: string, point: Point) => void;
  onDoor: (door: Door | null) => void;
  onDoorMove: (door: Door | null) => void;
}

// 扉は共有幾何から開口・吊元・開いたリーフを描く。SVGのY軸は図面のZ軸に対応する。
function DoorFootprint({
  plan,
  door,
  selected = false,
}: {
  plan: PlanDocument;
  door: Door;
  selected?: boolean;
}) {
  const geometry = getDoorGeometry(plan, door);
  if (!geometry) return null;
  const { start, end, hinge, leafEnd } = geometry;
  const closedEnd = door.hinge === 'start' ? end : start;
  // 吊元が終点側の場合は閉じた扉の向きが反転するため、円弧の回転方向も反転する。
  const sweep =
    (door.hinge === 'start' ? door.swing : -door.swing) === 1 ? 1 : 0;
  const arc = `M ${closedEnd.x} ${closedEnd.z} A ${door.width} ${door.width} 0 0 ${sweep} ${leafEnd.x} ${leafEnd.z}`;
  const color = selected ? '#238779' : '#745535';
  return (
    <g fill="none" stroke={color} strokeWidth={selected ? 0.065 : 0.045}>
      {/* 透明な太線で開口とリーフを掴めるようにし、小さい画面でも線の狙い打ちを不要にする。 */}
      <path
        d={`M ${start.x} ${start.z} L ${end.x} ${end.z} M ${hinge.x} ${hinge.z} L ${leafEnd.x} ${leafEnd.z}`}
        stroke="transparent"
        strokeWidth=".3"
      />
      <path data-door-arc={door.id || undefined} d={arc} strokeWidth=".025" />
      <line
        data-door-leaf={door.id || undefined}
        x1={hinge.x}
        y1={hinge.z}
        x2={leafEnd.x}
        y2={leafEnd.z}
      />
      <circle cx={hinge.x} cy={hinge.z} r=".05" fill={color} stroke="none" />
      {selected && (
        <path
          d={`M ${start.x} ${start.z} L ${end.x} ${end.z}`}
          strokeWidth=".025"
          strokeDasharray=".06 .04"
        />
      )}
    </g>
  );
}

export default function FloorPlan({
  plan,
  selectedId,
  tool,
  pending,
  view,
  panning,
  onViewChange,
  onSelect,
  onPlace,
  onRoom,
  onWall,
  onMove,
  onDoor,
  onDoorMove,
}: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const viewClipId = useId();
  const [gesture, setGesture] = useState<Gesture | null>(null);
  const [cursor, setCursor] = useState<Point | null>(null);
  // 敷地外へ開くリーフも表示する。確定プランだけを参照し、ドラッグ中にCTMが動いて座標が跳ねるのを避ける。
  const viewBounds = {
    left: view.x - 0.8,
    top: view.z - 0.8,
    right: view.x + view.width + 0.8,
    bottom: view.z + view.depth + 0.8,
  };
  for (const door of plan.doors) {
    const geometry = getDoorGeometry(plan, door);
    if (!geometry) continue;
    // 表示枠から離れた扉で全体が縮小しないよう、開口が現在の表示範囲と交わる扉だけを含める。
    if (
      Math.max(geometry.start.x, geometry.end.x) < view.x ||
      Math.min(geometry.start.x, geometry.end.x) > view.x + view.width ||
      Math.max(geometry.start.z, geometry.end.z) < view.z ||
      Math.min(geometry.start.z, geometry.end.z) > view.z + view.depth
    )
      continue;
    const closedEnd = door.hinge === 'start' ? geometry.end : geometry.start;
    const closed = {
      x: closedEnd.x - geometry.hinge.x,
      z: closedEnd.z - geometry.hinge.z,
    };
    const opened = {
      x: geometry.leafEnd.x - geometry.hinge.x,
      z: geometry.leafEnd.z - geometry.hinge.z,
    };
    const points = [geometry.start, geometry.end, geometry.leafEnd];
    // 斜め壁の90度円弧は両端の外へ膨らむ。両半径との内積が非負の軸方向だけが掃引範囲内の極値になる。
    for (const direction of [
      { x: 1, z: 0 },
      { x: 0, z: 1 },
      { x: -1, z: 0 },
      { x: 0, z: -1 },
    ]) {
      if (
        direction.x * closed.x + direction.z * closed.z >= -1e-8 &&
        direction.x * opened.x + direction.z * opened.z >= -1e-8
      ) {
        points.push({
          x: geometry.hinge.x + direction.x * door.width,
          z: geometry.hinge.z + direction.z * door.width,
        });
      }
    }
    for (const p of points) {
      viewBounds.left = Math.min(viewBounds.left, p.x - 0.2);
      viewBounds.top = Math.min(viewBounds.top, p.z - 0.2);
      viewBounds.right = Math.max(viewBounds.right, p.x + 0.2);
      viewBounds.bottom = Math.max(viewBounds.bottom, p.z + 0.2);
    }
  }
  // 開口中心と掴んだ点との差分を維持し、リーフ先端からドラッグしても扉が跳ねないようにする。
  const movedDoor = (active: Gesture, end: Point) => {
    if (!active.door || !active.offset) return null;
    if (end.x === active.start.x && end.z === active.start.z)
      return active.door;
    return findDoorPlacement(
      plan,
      {
        x: end.x + active.offset.x,
        z: end.z + active.offset.z,
      },
      active.door,
    );
  };
  const doorDraft = gesture?.door ? movedDoor(gesture, gesture.end) : null;
  // 一時プレビューは派生値とし、Zustandの確定プランやUndo履歴にはpointerupまで書き込まない。
  const previewDoors = plan.doors.map((door) =>
    door.id === gesture?.door?.id && doorDraft ? doorDraft : door,
  );
  const previewPlan = { ...plan, doors: previewDoors };
  const placementPreview =
    !panning && tool === 'door' && cursor
      ? findDoorPlacement(plan, cursor)
      : null;
  // 同じ物理位置に重なる追加壁も消せるよう、開口の覆い幅は該当する壁の最大厚さに合わせる。
  const openingThickness = new Map<string, number>();
  for (const wall of plan.walls) {
    for (const { door } of getWallDoorOpenings(previewPlan, wall)) {
      openingThickness.set(
        door.id,
        Math.max(openingThickness.get(door.id) ?? 0, wall.thickness),
      );
    }
  }
  // getScreenCTMは余白・スクロール・レスポンシブ縮小を含むため、画面サイズに依存せず正確に変換できる。
  const point = (event: PointerEvent<SVGSVGElement>): Point => {
    const matrix = svgRef.current?.getScreenCTM();
    const p = matrix
      ? new DOMPoint(event.clientX, event.clientY).matrixTransform(
          matrix.inverse(),
        )
      : { x: 0, y: 0 };
    // 外向きの扉リーフは敷地外にも存在するため、掴んだ位置を端へ丸めるとドラッグ差分が歪む。
    // 扉は開始点・終点を丸めず差分を保持する。5cm境界で独立に丸めると移動量が10cmずれるため、確定候補だけスナップする。
    const draggingDoor =
      gesture?.door ||
      (tool === 'select' && (event.target as Element).closest('[data-door]'));
    return {
      x: draggingDoor ? p.x : snap(clamp(p.x, 0, BOARD.width)),
      z: draggingDoor ? p.y : snap(clamp(p.y, 0, BOARD.depth)),
    };
  };
  const down = (event: PointerEvent<SVGSVGElement>) => {
    // 別の指やペンが現在のドラッグを上書きして、別ポインタのupで確定しないようにする。
    if (event.button !== 0 || gesture) return;
    // viewBoxと画面の縦横比が違う場合の余白もSVG内なので、吸着前の実座標で表示枠外の操作を除外する。
    const matrix = svgRef.current?.getScreenCTM();
    if (!matrix) return;
    const inverse = matrix.inverse();
    const origin = new DOMPoint(event.clientX, event.clientY).matrixTransform(
      inverse,
    );
    if (
      !Number.isFinite(origin.x) ||
      !Number.isFinite(origin.y) ||
      origin.x < viewBounds.left ||
      origin.x > viewBounds.right ||
      origin.y < viewBounds.top ||
      origin.y > viewBounds.bottom
    )
      return;
    if (panning) {
      // パン中は選択や配置より先に処理する。開始時の逆行列を固定し、viewBox変更の累積誤差を防ぐ。
      const start = { x: origin.x, z: origin.y };
      setGesture({
        start,
        end: start,
        pan: { view, inverse },
        pointerId: event.pointerId,
      });
      event.currentTarget.setPointerCapture(event.pointerId);
      return;
    }
    const p = point(event);
    if (tool === 'furniture') {
      onPlace(p);
      return;
    }
    if (tool === 'door') {
      setGesture({
        start: p,
        end: p,
        placingDoor: true,
        pointerId: event.pointerId,
      });
      event.currentTarget.setPointerCapture(event.pointerId);
      return;
    }
    const id = (event.target as Element)
      .closest('[data-object]')
      ?.getAttribute('data-object');
    if (tool === 'select') {
      onSelect(id ?? null);
      const door = plan.doors.find((entry) => entry.id === id);
      const geometry = door && getDoorGeometry(plan, door);
      if (door && geometry) {
        setGesture({
          start: p,
          end: p,
          door,
          offset: {
            x: (geometry.start.x + geometry.end.x) / 2 - p.x,
            z: (geometry.start.z + geometry.end.z) / 2 - p.z,
          },
          pointerId: event.pointerId,
        });
        event.currentTarget.setPointerCapture(event.pointerId);
        return;
      }
      const item = plan.furniture.find((furniture) => furniture.id === id);
      if (!item) return;
      setGesture({
        start: p,
        end: p,
        item,
        offset: { x: item.x - p.x, z: item.z - p.z },
        pointerId: event.pointerId,
      });
    } else setGesture({ start: p, end: p, pointerId: event.pointerId });
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const move = (event: PointerEvent<SVGSVGElement>) => {
    if (gesture && event.pointerId !== gesture.pointerId) return;
    if (gesture?.pan) {
      // 表示移動にはスナップを適用せず、敷地内へ表示枠だけを制限する。保存データ・履歴は変更しない。
      const current = new DOMPoint(
        event.clientX,
        event.clientY,
      ).matrixTransform(gesture.pan.inverse);
      if (!Number.isFinite(current.x) || !Number.isFinite(current.y)) return;
      const origin = gesture.pan.view;
      onViewChange({
        ...origin,
        x: clamp(
          origin.x + gesture.start.x - current.x,
          0,
          BOARD.width - origin.width,
        ),
        z: clamp(
          origin.z + gesture.start.z - current.y,
          0,
          BOARD.depth - origin.depth,
        ),
      });
      return;
    }
    if (panning) return;
    const p = point(event);
    setCursor(p);
    if (gesture) setGesture({ ...gesture, end: p });
  };
  const up = (event: PointerEvent<SVGSVGElement>) => {
    if (!gesture || event.pointerId !== gesture.pointerId) return;
    if (gesture.pan) {
      setGesture(null);
      if (event.currentTarget.hasPointerCapture(event.pointerId))
        event.currentTarget.releasePointerCapture(event.pointerId);
      return;
    }
    const end = point(event);
    if (gesture.placingDoor) onDoor(findDoorPlacement(plan, end));
    else if (gesture.door) onDoorMove(movedDoor(gesture, end));
    else if (gesture.item && gesture.offset)
      onMove(gesture.item.id, {
        x: snap(end.x + gesture.offset.x),
        z: snap(end.z + gesture.offset.z),
      });
    else if (tool === 'room')
      onRoom({
        x: Math.min(gesture.start.x, end.x),
        z: Math.min(gesture.start.z, end.z),
        width: snap(Math.abs(end.x - gesture.start.x)),
        depth: snap(Math.abs(end.z - gesture.start.z)),
      });
    else if (tool === 'wall') onWall(gesture.start, end);
    setGesture(null);
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
  };
  return (
    <svg
      ref={svgRef}
      className={`floor-plan tool-${tool}${panning ? ' is-panning' : ''}`}
      viewBox={`${viewBounds.left} ${viewBounds.top} ${viewBounds.right - viewBounds.left} ${viewBounds.bottom - viewBounds.top}`}
      role="img"
      tabIndex={panning || tool === 'door' ? 0 : undefined}
      aria-label={`間取り編集キャンバス。${panning ? '表示移動モード。ドラッグまたは矢印キーで表示を移動。Shiftと矢印キーで5 m移動。Escapeで作図に戻ります。' : `部屋ツールでドラッグして部屋を作成。扉ツールで壁をクリックして扉を配置。家具を選び、部屋の中をクリックして配置。${tool === 'door' ? `扉の配置は矢印キーで10 cm、Shiftと矢印キーで50 cm移動、Enterで配置、Escapeでキャンセル。配置位置 X ${(cursor?.x ?? view.x + view.width / 2).toFixed(1)} m、Z ${(cursor?.z ?? view.z + view.depth / 2).toFixed(1)} m。` : ''}`}`}
      onFocus={(event) => {
        if (
          !panning &&
          tool === 'door' &&
          event.target === event.currentTarget &&
          !cursor
        )
          setCursor({ x: view.x + view.width / 2, z: view.z + view.depth / 2 });
      }}
      onKeyDown={(event) => {
        // パンモードでは図形の選択キーを無効にし、矢印で表示だけを動かしてマウスなしでも敷地へ到達できる。
        if (panning) {
          if (gesture) return;
          const distance = event.shiftKey ? 5 : 1;
          const direction: Record<string, Point> = {
            ArrowLeft: { x: -distance, z: 0 },
            ArrowRight: { x: distance, z: 0 },
            ArrowUp: { x: 0, z: -distance },
            ArrowDown: { x: 0, z: distance },
          };
          if (direction[event.key]) {
            event.preventDefault();
            onViewChange({
              ...view,
              x: clamp(
                view.x + direction[event.key].x,
                0,
                BOARD.width - view.width,
              ),
              z: clamp(
                view.z + direction[event.key].z,
                0,
                BOARD.depth - view.depth,
              ),
            });
          }
          return;
        }
        // 図面自体にフォーカスした配置操作だけを扱い、家具や扉の選択キーを横取りしない。
        if (tool !== 'door' || event.target !== event.currentTarget || gesture)
          return;
        const current = cursor ?? {
          x: view.x + view.width / 2,
          z: view.z + view.depth / 2,
        };
        const step = event.shiftKey ? 0.5 : 0.1;
        const direction: Record<string, Point> = {
          ArrowLeft: { x: -step, z: 0 },
          ArrowRight: { x: step, z: 0 },
          ArrowUp: { x: 0, z: -step },
          ArrowDown: { x: 0, z: step },
        };
        if (direction[event.key]) {
          // ブラウザのスクロールを抑え、マウスと同じ10 cmグリッド上で安全に敷地内へ制限する。
          event.preventDefault();
          setCursor({
            x: snap(clamp(current.x + direction[event.key].x, 0, BOARD.width)),
            z: snap(clamp(current.z + direction[event.key].z, 0, BOARD.depth)),
          });
        } else if (event.key === 'Enter') {
          event.preventDefault();
          onDoor(findDoorPlacement(plan, current));
        }
      }}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={(event) => {
        if (event.pointerId === gesture?.pointerId) setGesture(null);
      }}
      onLostPointerCapture={(event) => {
        if (event.pointerId === gesture?.pointerId) setGesture(null);
      }}
      onPointerLeave={() => {
        // キーボード配置中の位置はマウスが図面から離れても保持する。
        if (!gesture && document.activeElement !== svgRef.current)
          setCursor(null);
      }}
    >
      <defs>
        {/* SVGの余白へ敷地や目盛が漏れないよう、外向き扉を含む実際の表示枠で全描画を切り取る。 */}
        <clipPath id={viewClipId} clipPathUnits="userSpaceOnUse">
          <rect
            x={viewBounds.left}
            y={viewBounds.top}
            width={viewBounds.right - viewBounds.left}
            height={viewBounds.bottom - viewBounds.top}
          />
        </clipPath>
        <pattern
          id="minor-grid"
          width=".5"
          height=".5"
          patternUnits="userSpaceOnUse"
        >
          <path
            d="M.5 0H0V.5"
            fill="none"
            stroke="#e3e8e9"
            strokeWidth=".015"
          />
        </pattern>
        <pattern
          id="major-grid"
          width="2"
          height="2"
          patternUnits="userSpaceOnUse"
        >
          <rect width="2" height="2" fill="url(#minor-grid)" />
          <path d="M2 0H0V2" fill="none" stroke="#d2dadc" strokeWidth=".022" />
        </pattern>
      </defs>
      <g clipPath={`url(#${viewClipId})`}>
        <rect
          width={BOARD.width}
          height={BOARD.depth}
          fill="url(#major-grid)"
        />
        {Array.from({ length: Math.floor(BOARD.width / 2) + 1 }, (_, i) => (
          <text
            key={i}
            x={i * 2}
            y={view.z - 0.28}
            className="ruler-label"
            textAnchor="middle"
          >
            {i * 2}
          </text>
        ))}
        {Array.from({ length: Math.floor(BOARD.depth / 2) + 1 }, (_, i) => (
          <text
            key={i}
            x={view.x - 0.3}
            y={i * 2 + 0.07}
            className="ruler-label"
            textAnchor="end"
          >
            {i * 2}
          </text>
        ))}
        {plan.rooms.map((room) => (
          <g
            key={room.id}
            data-object={room.id}
            tabIndex={panning ? -1 : 0}
            role="button"
            aria-pressed={selectedId === room.id}
            aria-label={`${room.name}を選択`}
            onKeyDown={(event) => {
              if (panning) return;
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                onSelect(room.id);
              }
            }}
          >
            <rect
              x={room.x}
              y={room.z}
              width={room.width}
              height={room.depth}
              fill={room.color}
              stroke={selectedId === room.id ? '#348177' : '#425158'}
              strokeWidth={selectedId === room.id ? 0.11 : 0.1}
            />
            <text
              x={room.x + room.width / 2}
              y={room.z + room.depth - 0.7}
              textAnchor="middle"
              className="room-label"
            >
              {room.name}
            </text>
            <text
              x={room.x + room.width / 2}
              y={room.z + room.depth - 0.35}
              textAnchor="middle"
              className="room-area"
            >
              {(room.width * room.depth).toFixed(1)} m²
            </text>
            {selectedId === room.id && (
              <>
                <text
                  x={room.x + room.width / 2}
                  y={room.z - 0.2}
                  textAnchor="middle"
                  className="dimension-label"
                >
                  {room.width.toFixed(1)} m
                </text>
                <text
                  x={room.x + room.width + 0.2}
                  y={room.z + room.depth / 2}
                  className="dimension-label"
                >
                  {room.depth.toFixed(1)} m
                </text>
              </>
            )}
          </g>
        ))}
        {plan.walls.map((wall) => (
          <line
            key={wall.id}
            data-object={wall.id}
            x1={wall.x1}
            y1={wall.z1}
            x2={wall.x2}
            y2={wall.z2}
            stroke={selectedId === wall.id ? '#348177' : '#425158'}
            strokeWidth={wall.thickness}
            strokeLinecap="square"
          />
        ))}
        {/* 全ての部屋境界と追加壁の後で覆うため、共通壁の二重描画でも開口が塞がれない。 */}
        {previewDoors.map((door) => {
          const geometry = getDoorGeometry(previewPlan, door);
          if (!geometry) return null;
          const room =
            door.host.kind === 'room'
              ? plan.rooms.find((entry) => entry.id === door.host.id)
              : plan.rooms.find((entry) => {
                  const x = (geometry.start.x + geometry.end.x) / 2;
                  const z = (geometry.start.z + geometry.end.z) / 2;
                  return (
                    x >= entry.x &&
                    x <= entry.x + entry.width &&
                    z >= entry.z &&
                    z <= entry.z + entry.depth
                  );
                });
          return (
            <line
              key={door.id}
              data-door-opening={door.id}
              x1={geometry.start.x}
              y1={geometry.start.z}
              x2={geometry.end.x}
              y2={geometry.end.z}
              stroke={room?.color ?? '#fff'}
              strokeWidth={
                Math.max(
                  geometry.wall.thickness,
                  openingThickness.get(door.id) ?? 0,
                  0.14,
                ) + 0.02
              }
              pointerEvents="none"
            />
          );
        })}
        {plan.furniture.map((item) => {
          const moving = gesture?.item?.id === item.id && gesture.offset;
          const x = moving ? gesture.end.x + gesture.offset!.x : item.x;
          const z = moving ? gesture.end.z + gesture.offset!.z : item.z;
          const definition = catalogItem(item.kind);
          return (
            <g
              key={item.id}
              data-object={item.id}
              transform={`translate(${x} ${z}) rotate(${item.rotation})`}
              className="plan-furniture"
              tabIndex={panning ? -1 : 0}
              role="button"
              aria-pressed={selectedId === item.id}
              aria-label={`${definition.name}を選択`}
              onKeyDown={(event) => {
                if (panning) return;
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  onSelect(item.id);
                }
              }}
            >
              <FurnitureFootprint kind={item.kind} color={item.color} />
              {selectedId === item.id && (
                <rect
                  x={-definition.width / 2 - 0.09}
                  y={-definition.depth / 2 - 0.09}
                  width={definition.width + 0.18}
                  height={definition.depth + 0.18}
                  fill="none"
                  stroke="#238779"
                  strokeWidth=".045"
                  strokeDasharray=".1 .05"
                />
              )}
            </g>
          );
        })}
        {previewDoors.map((door, index) => (
          <g
            key={door.id}
            data-object={door.id}
            data-door={door.id}
            className="plan-door"
            tabIndex={panning ? -1 : 0}
            role="button"
            aria-label={`扉 ${index + 1}を選択`}
            aria-pressed={selectedId === door.id}
            onKeyDown={(event) => {
              if (panning) return;
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                onSelect(door.id);
              }
            }}
          >
            <DoorFootprint
              plan={previewPlan}
              door={door}
              selected={selectedId === door.id}
            />
          </g>
        ))}
        {gesture &&
          !gesture.pan &&
          !gesture.item &&
          !gesture.door &&
          !gesture.placingDoor &&
          (tool === 'room' ? (
            <rect
              x={Math.min(gesture.start.x, gesture.end.x)}
              y={Math.min(gesture.start.z, gesture.end.z)}
              width={Math.abs(gesture.end.x - gesture.start.x)}
              height={Math.abs(gesture.end.z - gesture.start.z)}
              fill="#58b3a733"
              stroke="#238779"
              strokeWidth=".06"
              strokeDasharray=".15 .08"
            />
          ) : (
            <line
              x1={gesture.start.x}
              y1={gesture.start.z}
              x2={gesture.end.x}
              y2={gesture.end.z}
              stroke="#238779"
              strokeWidth=".15"
            />
          ))}
        {!panning && pending && cursor && tool === 'furniture' && (
          <g
            transform={`translate(${cursor.x} ${cursor.z})`}
            opacity=".6"
            pointerEvents="none"
          >
            <FurnitureFootprint kind={pending} />
          </g>
        )}
        {placementPreview && (
          <g opacity=".6" pointerEvents="none">
            <DoorFootprint plan={plan} door={placementPreview} selected />
          </g>
        )}
        {((!panning && tool === 'door' && cursor && !placementPreview) ||
          (gesture?.door && !doorDraft)) && (
          <g pointerEvents="none" stroke="#b34b41" strokeWidth=".055">
            <circle
              cx={cursor?.x ?? gesture!.end.x}
              cy={cursor?.z ?? gesture!.end.z}
              r=".16"
              fill="#fff"
            />
            <path
              d={`M ${(cursor?.x ?? gesture!.end.x) - 0.1} ${(cursor?.z ?? gesture!.end.z) + 0.1} l .2 -.2`}
            />
          </g>
        )}
        {!panning && tool === 'door' && cursor && (
          <text
            x={view.x + view.width / 2}
            y={view.z + view.depth + 0.5}
            textAnchor="middle"
            className="dimension-label"
            pointerEvents="none"
            aria-live="polite"
          >
            X {cursor.x.toFixed(1)} m / Z {cursor.z.toFixed(1)} m — 矢印で移動 ·
            Enterで配置
          </text>
        )}
      </g>
    </svg>
  );
}
