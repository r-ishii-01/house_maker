'use client';
/* oxlint-disable jsx-a11y/prefer-tag-over-role -- SVG内にはHTMLのbutton/imgを置けないため、図形へARIAの意味を付与する。 */
// SVG座標を実寸のX/Z座標に変換し、ポインター操作の確定時だけ共有状態を更新する。
import { useRef, useState, type PointerEvent } from 'react';
import {
  BOARD,
  catalogItem,
  clamp,
  snap,
  type FurnitureKind,
  type PlanDocument,
  type PlacedFurniture,
} from '../lib/model';
export type Tool = 'select' | 'room' | 'wall' | 'furniture';
type Point = { x: number; z: number };
type Gesture = {
  start: Point;
  end: Point;
  item?: PlacedFurniture;
  offset?: Point;
};
interface Props {
  plan: PlanDocument;
  selectedId: string | null;
  tool: Tool;
  pending: FurnitureKind | null;
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
}

// 家具の平面図は3Dと同じカタログ寸法で描き、配置する前から占有面積を伝える。
export function FurnitureFootprint({
  kind,
  color = '#88998d',
}: {
  kind: FurnitureKind;
  color?: string;
}) {
  const { width: w, depth: d } = catalogItem(kind);
  return (
    <g fill={color} stroke="#54605c" strokeWidth=".025">
      {kind === 'plant' ? (
        <>
          <circle r={w / 2} fill={color} opacity=".65" />
          <circle r={w / 4} />
          <path d="M-.2 0H.2M0-.2V.2" />
        </>
      ) : (
        <>
          <rect
            x={-w / 2}
            y={-d / 2}
            width={w}
            height={d}
            rx={kind.includes('table') ? 0.12 : 0.05}
          />
          {(kind === 'sofa' || kind === 'armchair' || kind === 'chair') && (
            <>
              <rect
                x={-w / 2 + 0.05}
                y={-d / 2 + 0.04}
                width={w - 0.1}
                height={d * 0.2}
                rx=".03"
                fill="white"
                fillOpacity=".18"
              />
              {kind === 'sofa' && (
                <path
                  d={`M${-w / 6} ${-d / 4}V${d / 2}M${w / 6} ${-d / 4}V${d / 2}`}
                />
              )}
            </>
          )}
          {kind === 'bed' && (
            <>
              <rect
                x={-w / 2 + 0.1}
                y={-d / 2 + 0.12}
                width={w / 2 - 0.15}
                height=".4"
                rx=".08"
                fill="#f9faf7"
              />
              <rect
                x=".05"
                y={-d / 2 + 0.12}
                width={w / 2 - 0.15}
                height=".4"
                rx=".08"
                fill="#f9faf7"
              />
              <path d={`M${-w / 2} ${-d / 6}H${w / 2}`} />
            </>
          )}
          {kind === 'desk' && (
            <rect
              x="-.25"
              y="-.2"
              width=".5"
              height=".3"
              rx=".02"
              fill="#e1e6e3"
            />
          )}
          {kind === 'bookshelf' && (
            <path
              d={`M${-w / 6} ${-d / 2}V${d / 2}M${w / 6} ${-d / 2}V${d / 2}`}
            />
          )}
          {kind === 'television' && (
            <path d={`M${-w / 2 + 0.1} 0H${w / 2 - 0.1}`} strokeWidth=".07" />
          )}
        </>
      )}
    </g>
  );
}

export default function FloorPlan({
  plan,
  selectedId,
  tool,
  pending,
  onSelect,
  onPlace,
  onRoom,
  onWall,
  onMove,
}: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [gesture, setGesture] = useState<Gesture | null>(null);
  const [cursor, setCursor] = useState<Point | null>(null);
  // getScreenCTMは余白・スクロール・レスポンシブ縮小を含むため、画面サイズに依存せず正確に変換できる。
  const point = (event: PointerEvent<SVGSVGElement>): Point => {
    const matrix = svgRef.current?.getScreenCTM();
    const p = matrix
      ? new DOMPoint(event.clientX, event.clientY).matrixTransform(
          matrix.inverse(),
        )
      : { x: 0, y: 0 };
    return {
      x: snap(clamp(p.x, 0, BOARD.width)),
      z: snap(clamp(p.y, 0, BOARD.depth)),
    };
  };
  const down = (event: PointerEvent<SVGSVGElement>) => {
    if (event.button !== 0) return;
    const p = point(event);
    if (tool === 'furniture') {
      onPlace(p);
      return;
    }
    const id = (event.target as Element)
      .closest('[data-object]')
      ?.getAttribute('data-object');
    if (tool === 'select') {
      onSelect(id ?? null);
      const item = plan.furniture.find((furniture) => furniture.id === id);
      if (!item) return;
      setGesture({
        start: p,
        end: p,
        item,
        offset: { x: item.x - p.x, z: item.z - p.z },
      });
    } else setGesture({ start: p, end: p });
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const move = (event: PointerEvent<SVGSVGElement>) => {
    const p = point(event);
    setCursor(p);
    if (gesture) setGesture({ ...gesture, end: p });
  };
  const up = (event: PointerEvent<SVGSVGElement>) => {
    if (!gesture) return;
    const end = point(event);
    if (gesture.item && gesture.offset)
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
      className={`floor-plan tool-${tool}`}
      viewBox="-.8 -.8 17.6 13.6"
      role="img"
      aria-label="間取り編集キャンバス。部屋ツールでドラッグして部屋を作成。家具を選び、部屋の中をクリックして配置。"
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={() => setGesture(null)}
      onLostPointerCapture={() => setGesture(null)}
      onPointerLeave={() => {
        if (!gesture) setCursor(null);
      }}
    >
      <defs>
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
      <rect width="16" height="12" fill="url(#major-grid)" />
      {Array.from({ length: 9 }, (_, i) => (
        <text
          key={i}
          x={i * 2}
          y="-.28"
          className="ruler-label"
          textAnchor="middle"
        >
          {i * 2}
        </text>
      ))}
      {Array.from({ length: 7 }, (_, i) => (
        <text
          key={i}
          x="-.3"
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
          tabIndex={0}
          role="button"
          aria-pressed={selectedId === room.id}
          aria-label={`${room.name}を選択`}
          onKeyDown={(event) => {
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
            tabIndex={0}
            role="button"
            aria-pressed={selectedId === item.id}
            aria-label={`${definition.name}を選択`}
            onKeyDown={(event) => {
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
      {gesture &&
        !gesture.item &&
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
      {pending && cursor && tool === 'furniture' && (
        <g
          transform={`translate(${cursor.x} ${cursor.z})`}
          opacity=".6"
          pointerEvents="none"
        >
          <FurnitureFootprint kind={pending} />
        </g>
      )}
    </svg>
  );
}
