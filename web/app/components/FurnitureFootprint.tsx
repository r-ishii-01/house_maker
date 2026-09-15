'use client';
// 配置図・カタログ・サンプルで共用する家具の平面形状。中心原点のX/Z（SVGではX/Y）をメートルで描く。
import { catalogItem, type FurnitureKind } from '../lib/model';

export function FurnitureFootprint({
  kind,
  color = '#88998d',
}: {
  kind: FurnitureKind;
  color?: string;
}) {
  const { width: w, depth: d } = catalogItem(kind);
  const rounded = kind === 'round-dining-table' || kind === 'stool';
  const seating =
    kind === 'sofa' ||
    kind === 'loveseat' ||
    kind === 'armchair' ||
    kind === 'chair';
  const bed = kind === 'bed' || kind === 'single-bed';
  // 細部も共有寸法に比例させ、家具の外形をはみ出さずに種類を識別できるようにする。
  return (
    <g
      fill={color}
      stroke="#54605c"
      strokeWidth=".025"
      data-furniture-kind={kind}
    >
      {kind === 'plant' ? (
        <>
          <circle r={w / 2} opacity=".65" />
          <circle r={w / 4} />
          <path
            d={`M ${-w * 0.3} 0 H ${w * 0.3} M 0 ${-d * 0.3} V ${d * 0.3}`}
          />
        </>
      ) : rounded ? (
        <>
          {/* 円卓とスツールは矩形を重ねず、共有幅・奥行きを外径とする円形の占有面を描く。 */}
          <ellipse rx={w / 2} ry={d / 2} />
          <ellipse rx={w * 0.41} ry={d * 0.41} fill="none" opacity=".55" />
          {kind === 'stool' &&
            [0, 120, 240].map((angle) => (
              <circle
                key={angle}
                cx={Math.cos((angle * Math.PI) / 180) * w * 0.26}
                cy={Math.sin((angle * Math.PI) / 180) * d * 0.26}
                r={w * 0.025}
                fill="#54605c"
                stroke="none"
              />
            ))}
        </>
      ) : kind === 'floor-lamp' ? (
        <>
          {/* ライトは傘の外周・中心・骨を描き、円形の座面やテーブルと見分けられるようにする。 */}
          <ellipse rx={w / 2} ry={d / 2} />
          <ellipse
            rx={w * 0.36}
            ry={d * 0.36}
            fill="#fff9df"
            fillOpacity=".72"
          />
          <path
            d={`M ${-w * 0.32} ${-d * 0.32} L ${w * 0.32} ${d * 0.32} M ${w * 0.32} ${-d * 0.32} L ${-w * 0.32} ${d * 0.32}`}
            strokeWidth=".015"
          />
          <circle r={Math.min(w, d) * 0.13} fill="#fff9df" />
        </>
      ) : kind === 'office-chair' ? (
        <>
          {/* キャスターを外径内に収め、配置判定の幅・奥行きより大きく見えることを防ぐ。 */}
          {[0, 72, 144, 216, 288].map((angle) => {
            const rad = ((angle - 90) * Math.PI) / 180;
            const x = Math.cos(rad) * w * 0.43;
            const y = Math.sin(rad) * d * 0.43;
            return (
              <g key={angle}>
                <path d={`M 0 0 L ${x} ${y}`} strokeWidth=".035" />
                <circle
                  cx={x}
                  cy={y}
                  r={Math.min(w, d) * 0.045}
                  fill="#54605c"
                />
              </g>
            );
          })}
          <rect
            x={-w * 0.3}
            y={-d * 0.22}
            width={w * 0.6}
            height={d * 0.55}
            rx={w * 0.1}
          />
          <rect
            x={-w * 0.33}
            y={-d * 0.43}
            width={w * 0.66}
            height={d * 0.19}
            rx={w * 0.06}
          />
          <path
            d={`M ${-w * 0.39} ${-d * 0.15} V ${d * 0.19} M ${w * 0.39} ${-d * 0.15} V ${d * 0.19}`}
            strokeWidth=".04"
            strokeLinecap="round"
          />
        </>
      ) : (
        <>
          <rect
            x={-w / 2}
            y={-d / 2}
            width={w}
            height={d}
            rx={
              kind === 'ottoman'
                ? Math.min(w, d) * 0.15
                : kind.includes('table')
                  ? Math.min(w, d) * 0.16
                  : 0.05
            }
          />
          {seating && (
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
              {/* 3人掛けは2本、2人掛けは1本の境界で座面数を表す。 */}
              {(kind === 'sofa'
                ? [-w / 6, w / 6]
                : kind === 'loveseat'
                  ? [0]
                  : []
              ).map((x) => (
                <path key={x} d={`M ${x} ${-d / 4} V ${d / 2}`} />
              ))}
            </>
          )}
          {kind === 'ottoman' && (
            <>
              <rect
                x={-w * 0.38}
                y={-d * 0.36}
                width={w * 0.76}
                height={d * 0.72}
                rx={d * 0.1}
                fill="none"
                opacity=".65"
              />
              <path
                d={`M ${-w * 0.06} 0 H ${w * 0.06} M 0 ${-d * 0.06} V ${d * 0.06}`}
                strokeWidth=".015"
              />
            </>
          )}
          {bed && (
            <>
              {/* ベッド幅に応じて枕の幅を分配する。単身用は中央に1個、ダブルは左右に2個配置する。 */}
              {Array.from(
                { length: kind === 'single-bed' ? 1 : 2 },
                (_, index) => {
                  const count = kind === 'single-bed' ? 1 : 2;
                  const pillowWidth = (w - 0.2 - (count - 1) * 0.1) / count;
                  return (
                    <rect
                      key={index}
                      x={-w / 2 + 0.1 + index * (pillowWidth + 0.1)}
                      y={-d / 2 + 0.12}
                      width={pillowWidth}
                      height={d * 0.19}
                      rx=".08"
                      fill="#f9faf7"
                    />
                  );
                },
              )}
              <path d={`M ${-w / 2} ${-d / 6} H ${w / 2}`} />
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
              d={`M ${-w / 6} ${-d / 2} V ${d / 2} M ${w / 6} ${-d / 2} V ${d / 2}`}
            />
          )}
          {kind === 'television' && (
            <path
              d={`M ${-w / 2 + 0.1} 0 H ${w / 2 - 0.1}`}
              strokeWidth=".07"
            />
          )}
          {kind === 'side-table' && (
            <rect
              x={-w * 0.35}
              y={-d * 0.35}
              width={w * 0.7}
              height={d * 0.7}
              rx={Math.min(w, d) * 0.06}
              fill="none"
              opacity=".6"
            />
          )}
          {kind === 'nightstand' && (
            <>
              <path d={`M ${-w / 2} ${d * 0.08} H ${w / 2}`} />
              <path
                d={`M ${-w * 0.15} ${d * 0.29} H ${w * 0.15}`}
                strokeWidth=".035"
                strokeLinecap="round"
              />
            </>
          )}
          {kind === 'wardrobe' && (
            <>
              <path d={`M 0 ${-d / 2} V ${d / 2}`} />
              <path
                d={`M ${-w * 0.065} ${d * 0.09} V ${d * 0.32} M ${w * 0.065} ${d * 0.09} V ${d * 0.32}`}
                strokeWidth=".035"
                strokeLinecap="round"
              />
            </>
          )}
          {kind === 'dresser' && (
            <>
              {/* 引き出しの境界と各段の取手を示し、同じ矩形の収納でも用途を読み取れるようにする。 */}
              <path
                d={`M ${-w / 2} ${-d / 6} H ${w / 2} M ${-w / 2} ${d / 6} H ${w / 2}`}
              />
              {[-d / 3, 0, d / 3].map((y) => (
                <path
                  key={y}
                  d={`M ${-w * 0.12} ${y} H ${w * 0.12}`}
                  strokeWidth=".03"
                  strokeLinecap="round"
                />
              ))}
            </>
          )}
          {kind === 'kitchen-island' && (
            <>
              {/* 天板の内縁とシンク・コンロを寸法内へ描き、通常のダイニングテーブルと区別する。 */}
              <rect
                x={-w * 0.46}
                y={-d * 0.43}
                width={w * 0.92}
                height={d * 0.86}
                rx=".035"
                fill="#f3f0e7"
                fillOpacity=".75"
              />
              <rect
                x={-w * 0.38}
                y={-d * 0.27}
                width={w * 0.32}
                height={d * 0.54}
                rx=".045"
                fill="#dce4e4"
              />
              <circle cx={-w * 0.22} r=".025" fill="#54605c" />
              {[-d * 0.2, d * 0.2].map((y) => (
                <circle key={y} cx={w * 0.24} cy={y} r={d * 0.13} fill="none" />
              ))}
            </>
          )}
        </>
      )}
    </g>
  );
}
