'use client';
// サンプルの比較と仮選択を担う。確定プランは保持せず、使用ボタンを押したときだけ親へIDを渡す。
import { useId, useRef, useState, type RefObject } from 'react';
import { Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog';
import { FurnitureFootprint } from './FloorPlan';
import { getDoorGeometry, type PlanDocument } from '../lib/model';
import {
  SAMPLE_PLANS,
  createSamplePlan,
  type SamplePlanId,
} from '../lib/samples';

// 比較用の読み取り専用データは表示のたびに生成し直さず、編集ストアの文書とも共有しない。
const previews = SAMPLE_PLANS.map((sample) => ({
  ...sample,
  plan: createSamplePlan(sample.id),
}));

function SamplePreview({ plan }: { plan: PlanDocument }) {
  const doors = plan.doors.flatMap((door) => {
    const geometry = getDoorGeometry(plan, door);
    return geometry ? [{ door, geometry }] : [];
  });
  // サムネイルもX/Zのメートル座標をSVGのX/Yへ対応させる。扉の回転範囲を含む余白を取り、開き側を切らない。
  const points = [
    ...plan.rooms.flatMap((room) => [
      { x: room.x, z: room.z },
      { x: room.x + room.width, z: room.z + room.depth },
    ]),
    ...plan.walls.flatMap((wall) => [
      { x: wall.x1, z: wall.z1 },
      { x: wall.x2, z: wall.z2 },
    ]),
    ...doors.flatMap(({ door, geometry }) => [
      { x: geometry.hinge.x - door.width, z: geometry.hinge.z - door.width },
      { x: geometry.hinge.x + door.width, z: geometry.hinge.z + door.width },
    ]),
  ];
  const minX = points.length ? Math.min(...points.map((point) => point.x)) : 0;
  const minZ = points.length ? Math.min(...points.map((point) => point.z)) : 0;
  const width = Math.max(1, ...points.map((point) => point.x - minX));
  const depth = Math.max(1, ...points.map((point) => point.z - minZ));
  return (
    <svg
      className="sample-preview"
      viewBox={`${minX - 0.5} ${minZ - 0.5} ${width + 1} ${depth + 1}`}
      aria-hidden="true"
      focusable="false"
    >
      {plan.rooms.map((room) => (
        <rect
          key={room.id}
          x={room.x}
          y={room.z}
          width={room.width}
          height={room.depth}
          fill={room.color}
          stroke="#63736c"
          strokeWidth=".09"
        />
      ))}
      {plan.walls.map((wall) => (
        <line
          key={wall.id}
          x1={wall.x1}
          y1={wall.z1}
          x2={wall.x2}
          y2={wall.z2}
          stroke="#63736c"
          strokeWidth={wall.thickness}
        />
      ))}
      {plan.furniture.map((item) => (
        <g
          key={item.id}
          transform={`translate(${item.x} ${item.z}) rotate(${item.rotation})`}
        >
          <FurnitureFootprint kind={item.kind} color={item.color} />
        </g>
      ))}
      {doors.map(({ door, geometry }) => {
        const { start, end, hinge, leafEnd } = geometry;
        const closedEnd = door.hinge === 'start' ? end : start;
        // 終点側の吊元では円弧の向きを反転し、編集画面と同じ開閉方向を表示する。
        const sweep =
          (door.hinge === 'start' ? door.swing : -door.swing) === 1 ? 1 : 0;
        return (
          <g key={door.id} fill="none" stroke="#745535" strokeWidth=".06">
            <path
              d={`M ${start.x} ${start.z} L ${end.x} ${end.z}`}
              stroke="white"
              strokeWidth={geometry.wall.thickness + 0.04}
            />
            <path
              d={`M ${closedEnd.x} ${closedEnd.z} A ${door.width} ${door.width} 0 0 ${sweep} ${leafEnd.x} ${leafEnd.z}`}
              strokeWidth=".035"
            />
            <line x1={hinge.x} y1={hinge.z} x2={leafEnd.x} y2={leafEnd.z} />
          </g>
        );
      })}
    </svg>
  );
}

export default function SamplePlanPicker({
  open,
  onOpenChange,
  onLoad,
  returnFocusRef,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onLoad: (id: SamplePlanId) => void;
  returnFocusRef: RefObject<HTMLButtonElement | null>;
}) {
  // ラジオ選択はダイアログ内の一時状態。Escやキャンセルではストアも保存データも変更しない。
  const [selectedId, setSelectedId] = useState<SamplePlanId>('airy-home');
  const selectedRadioRef = useRef<HTMLInputElement>(null);
  const groupId = useId();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="sample-picker"
        showCloseButton={false}
        initialFocus={selectedRadioRef}
        finalFocus={returnFocusRef}
        onKeyDownCapture={(event) => {
          // 文字入力のない選択画面では標準Undo/Redoを止め、背面で直前に編集した入力欄へ履歴が作用するのを防ぐ。
          const key = event.key.toLowerCase();
          if ((event.metaKey || event.ctrlKey) && (key === 'z' || key === 'y'))
            event.preventDefault();
        }}
      >
        <div className="sample-picker-header">
          <DialogTitle>サンプル間取りを選ぶ</DialogTitle>
          <DialogDescription>
            暮らしに近い間取りから、家具や部屋を自由に編集できます。
          </DialogDescription>
        </div>
        {/* fieldset内部の匿名ボックスにスクロールを任せず、外側でSVGも確実に切り取りフッターを守る。 */}
        <div className="sample-picker-scroll">
          <fieldset className="sample-picker-grid">
            <legend className="sr-only">使いたいサンプル間取り</legend>
            {previews.map((sample) => {
              const selected = sample.id === selectedId;
              const area = sample.plan.rooms.reduce(
                (total, room) => total + room.width * room.depth,
                0,
              );
              const nameId = `${groupId}-${sample.id}-name`;
              const descriptionId = `${groupId}-${sample.id}-description`;
              return (
                <label
                  key={sample.id}
                  className="sample-card"
                  data-selected={selected}
                >
                  {/* ネイティブラジオによりTab/矢印/Spaceで選べる。選択中の入力に初期フォーカスを置く。 */}
                  <input
                    ref={selected ? selectedRadioRef : undefined}
                    className="sample-card-radio"
                    type="radio"
                    name={`${groupId}-sample-plan`}
                    value={sample.id}
                    checked={selected}
                    aria-labelledby={nameId}
                    aria-describedby={descriptionId}
                    onChange={() => setSelectedId(sample.id)}
                  />
                  <SamplePreview plan={sample.plan} />
                  <span className="sample-card-body">
                    <span className="sample-card-heading">
                      <span className="sample-card-name" id={nameId}>
                        {sample.name}
                      </span>
                      {selected && (
                        <span className="sample-card-check" aria-hidden="true">
                          <Check size={14} />
                        </span>
                      )}
                    </span>
                    <span id={descriptionId}>
                      <span className="sample-card-category">
                        {sample.category}
                      </span>
                      <span className="sample-card-meta">
                        {Number(area.toFixed(1))} m² /{' '}
                        {sample.plan.rooms.length}
                        部屋
                      </span>
                      <span className="sample-card-description">
                        {sample.description}
                      </span>
                    </span>
                  </span>
                </label>
              );
            })}
          </fieldset>
        </div>
        <div className="sample-picker-footer">
          <p className="sample-picker-hint">
            現在の間取りを置き換えます。「元に戻す」で復元できます。保存は「保存する」で行います。
          </p>
          <div className="sample-picker-actions">
            <DialogClose render={<Button variant="outline" />}>
              キャンセル
            </DialogClose>
            <Button onClick={() => onLoad(selectedId)}>この間取りを使う</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
