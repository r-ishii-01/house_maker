'use client';
// カタログ・間取り・3D・寸法入力を結び、検証を通った編集だけを共通ストアへ確定する。
import {
  lazy,
  Suspense,
  useEffect,
  useState,
  useSyncExternalStore,
} from 'react';
import {
  Box,
  Grid2X2,
  PanelsTopLeft,
  MousePointer2,
  SquareDashed,
  Minus,
  Undo2,
  Redo2,
  Plus,
  Save,
  RotateCw,
  Trash2,
  Move,
  Layers3,
  Ruler,
  CircleHelp,
  ArrowUpRight,
  Check,
  Armchair,
  X,
  ChevronRight,
  Leaf,
  Home,
  Maximize2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Switch } from '@/components/ui/switch';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from '@/components/ui/alert-dialog';
import FloorPlan, { FurnitureFootprint, type Tool } from './FloorPlan';
import {
  BOARD,
  PLAN_LIMITS,
  FURNITURE_CATALOG,
  catalogItem,
  createInitialPlan,
  fitsFurniture,
  normalizeRotation,
  parsePlan,
  roomIsValid,
  type FurnitureKind,
  type PlacedFurniture,
  type Room,
  type Wall,
} from '../lib/model';
import { useEditor } from '../lib/store';

// 大きな3Dライブラリは必要になった段階で取得し、2D編集の初期表示を妨げない。
const Scene3D = lazy(() => import('./Scene3D'));
// SSRのHTMLが操作可能になったことを、ブラウザ検証からも確認できるようにする。
const subscribeToHydration = () => () => {};
const STORAGE_KEY = 'housemaker.plan.v1';
const COLORS = [
  '#728c7d',
  '#b9c4d4',
  '#bd8c62',
  '#b2926b',
  '#525a60',
  '#ece7db',
];
type ViewMode = 'split' | '2d' | '3d';

function NumericField({
  label,
  value,
  unit = 'm',
  min = 0,
  max = 16,
  step = 0.1,
  onChange,
}: {
  label: string;
  value: number;
  unit?: string;
  min?: number;
  max?: number;
  step?: number;
  onChange: (value: number) => void;
}) {
  // 入力途中の空文字を許容し、blur/Enter時に有限数と範囲を確認して確定する。
  const [draft, setDraft] = useState(String(value));
  // 親から確定値が変わったときだけ入力中の値を同期する。通常のキー入力では同期しない。
  const [previousValue, setPreviousValue] = useState(value);
  if (previousValue !== value) {
    setPreviousValue(value);
    setDraft(String(value));
  }
  const commit = () => {
    const numeric = Number(draft);
    if (
      draft.trim() &&
      Number.isFinite(numeric) &&
      numeric >= min &&
      numeric <= max
    )
      onChange(numeric);
    setDraft(String(value));
  };
  return (
    <label className="numeric-field">
      <span>{label}</span>
      <span className="number-input">
        <input
          type="number"
          aria-label={label}
          min={min}
          max={max}
          step={step}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === 'Enter') event.currentTarget.blur();
          }}
        />
        <span>{unit}</span>
      </span>
    </label>
  );
}

export default function HousePlanner() {
  const hydrated = useSyncExternalStore(
    subscribeToHydration,
    () => true,
    () => false,
  );
  const { plan, past, future, selectedId, setSelected, commit, undo, redo } =
    useEditor();
  const [view, setView] = useState<ViewMode>('split');
  const [tool, setTool] = useState<Tool>('select');
  const [pending, setPending] = useState<FurnitureKind | null>(null);
  const [wallMode, setWallMode] = useState<'full' | 'cutaway'>('cutaway');
  const [notice, setNotice] = useState(
    '家具を選んで、間取りの中に置いてみましょう。',
  );
  const [saved, setSaved] = useState<string | null>(null);
  const [resetOpen, setResetOpen] = useState(false);
  const [category, setCategory] = useState('すべて');
  const [cameraKey, setCameraKey] = useState(0);
  const [canvasRevision, setCanvasRevision] = useState(0);
  const selectedFurniture = plan.furniture.find(
    (item) => item.id === selectedId,
  );
  const selectedRoom = plan.rooms.find((room) => room.id === selectedId);
  const selectedWall = plan.walls.find((wall) => wall.id === selectedId);
  const area = plan.rooms.reduce(
    (total, room) => total + room.width * room.depth,
    0,
  );
  const currentSerialized = JSON.stringify(plan);

  useEffect(() => {
    // 端末保存は起動後だけ読み込み、SSRの初期HTMLとの不一致を防ぐ。
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const restored = parsePlan(raw);
      if (restored) {
        useEditor.setState({
          plan: restored,
          past: [],
          future: [],
          selectedId: null,
        }); // oxlint-disable-next-line react/react-compiler -- ブラウザ保存領域との起動時同期は意図的な副作用。
        setSaved(JSON.stringify(restored));
        setNotice('このブラウザに保存した間取りを開きました。');
      } else
        setNotice(
          '保存データを読み込めなかったため、サンプル間取りを開きました。',
        );
    } catch {
      setNotice(
        'このブラウザでは保存を利用できません。間取りの編集は可能です。',
      );
    }
  }, []);

  const chooseTool = (next: Tool) => {
    setTool(next);
    setPending(null);
    setCanvasRevision((revision) => revision + 1);
    if (next !== 'select')
      setView((current) => (current === '3d' ? 'split' : current));
    setNotice(
      next === 'room'
        ? '空いている場所をドラッグして部屋を作成します。最小サイズは1 × 1 mです。'
        : next === 'wall'
          ? '間取り上をドラッグして、間仕切り壁を引きます。'
          : '家具をドラッグして移動。部屋や家具をクリックすると詳細を編集できます。',
    );
  };
  const selectObject = (id: string | null) => {
    setSelected(id);
    setTool('select');
    setPending(null);
  };

  const updateFurniture = (id: string, changes: Partial<PlacedFurniture>) => {
    const item = plan.furniture.find((entry) => entry.id === id);
    if (!item) return;
    const updated = { ...item, ...changes };
    if (!fitsFurniture(plan, updated)) {
      setNotice('家具全体が部屋に収まる位置・角度を指定してください。');
      return;
    }
    commit({
      ...plan,
      furniture: plan.furniture.map((entry) =>
        entry.id === id ? updated : entry,
      ),
    });
    setNotice(`${catalogItem(item.kind).name}の変更を2D・3Dに反映しました。`);
  };
  const updateRoom = (id: string, changes: Partial<Room>) => {
    const room = plan.rooms.find((entry) => entry.id === id);
    if (!room) return;
    const updated = { ...room, ...changes };
    if (!roomIsValid(plan, updated)) {
      setNotice(
        '部屋が重ならないよう、敷地内で1 m以上の寸法を指定してください。',
      );
      return;
    }
    // 部屋を移動するときは、その部屋の家具も同じ差分だけ移動する。
    const furniture = plan.furniture.map((item) =>
      fitsFurniture({ ...plan, rooms: [room] }, item)
        ? {
            ...item,
            x: Number((item.x + updated.x - room.x).toFixed(8)),
            z: Number((item.z + updated.z - room.z).toFixed(8)),
          }
        : item,
    );
    const next = {
      ...plan,
      rooms: plan.rooms.map((entry) => (entry.id === id ? updated : entry)),
      furniture,
    };
    if (!furniture.every((item) => fitsFurniture(next, item))) {
      setNotice(
        '家具がはみ出すため変更できません。先に家具を移動してください。',
      );
      return;
    }
    commit(next);
    setNotice('部屋の変更を2D・3Dに反映しました。');
  };
  const updateWall = (id: string, changes: Partial<Wall>) =>
    commit({
      ...plan,
      walls: plan.walls.map((wall) =>
        wall.id === id ? { ...wall, ...changes } : wall,
      ),
    });
  const addRoom = (bounds: {
    x: number;
    z: number;
    width: number;
    depth: number;
  }) => {
    if (plan.rooms.length >= PLAN_LIMITS.rooms) {
      setNotice('部屋は100個まで作成できます。');
      return;
    }
    const room: Room = {
      id: crypto.randomUUID(),
      name: `部屋 ${plan.rooms.length + 1}`,
      color: '#eee6d8',
      ...bounds,
    };
    if (!roomIsValid(plan, room)) {
      setNotice(
        '部屋は1 × 1 m以上で、他の部屋と重ならない場所に作成してください。',
      );
      return;
    }
    commit({ ...plan, rooms: [...plan.rooms, room] });
    selectObject(room.id);
    setNotice('部屋を作成しました。右のプロパティで名前や寸法を編集できます。');
  };
  const addWall = (
    start: { x: number; z: number },
    end: { x: number; z: number },
  ) => {
    if (plan.walls.length >= PLAN_LIMITS.walls) {
      setNotice('壁は200本まで作成できます。');
      return;
    }
    if (Math.hypot(end.x - start.x, end.z - start.z) < 0.2) {
      setNotice('壁は20 cm以上の長さで引いてください。');
      return;
    }
    const wall: Wall = {
      id: crypto.randomUUID(),
      x1: start.x,
      z1: start.z,
      x2: end.x,
      z2: end.z,
      height: 2.6,
      thickness: 0.15,
    };
    commit({ ...plan, walls: [...plan.walls, wall] });
    selectObject(wall.id);
    setNotice('間仕切り壁を追加しました。');
  };
  const addFurniture = (position: { x: number; z: number }) => {
    if (!pending) return;
    if (plan.furniture.length >= PLAN_LIMITS.furniture) {
      setNotice('家具は500個まで配置できます。');
      return;
    }
    const definition = catalogItem(pending);
    const item: PlacedFurniture = {
      id: crypto.randomUUID(),
      kind: pending,
      ...position,
      rotation: 0,
      color: definition.color,
    };
    if (!fitsFurniture(plan, item)) {
      setNotice('家具全体が収まるように、部屋の内側をクリックしてください。');
      return;
    }
    commit({ ...plan, furniture: [...plan.furniture, item] });
    selectObject(item.id);
    setNotice(`${definition.name}を配置しました。3Dでも位置を確認できます。`);
  };
  const removeSelection = () => {
    if (!selectedId) return;
    // 部屋削除時は含まれる家具も同時に削除し、浮いた家具が保存されるのを防ぐ。
    const furniture = plan.furniture.filter(
      (item) =>
        item.id !== selectedId &&
        !(
          selectedRoom &&
          fitsFurniture({ ...plan, rooms: [selectedRoom] }, item)
        ),
    );
    commit({
      ...plan,
      rooms: plan.rooms.filter((room) => room.id !== selectedId),
      walls: plan.walls.filter((wall) => wall.id !== selectedId),
      furniture,
    });
    setSelected(null);
    setNotice(
      '選択したオブジェクトを削除しました。「元に戻す」で復元できます。',
    );
  };
  const save = () => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(plan));
      setSaved(JSON.stringify(plan));
      setNotice(
        'このブラウザに間取りを保存しました。次回も続きから編集できます。',
      );
    } catch {
      setNotice(
        '保存できませんでした。ブラウザの保存領域やプライベートモードの設定を確認してください。',
      );
    }
  };
  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      // 入力欄やモーダル内では、文字編集用のキーを横取りしない。
      const target = event.target as HTMLElement;
      if (
        target.closest(
          'input, textarea, select, [contenteditable="true"], [role="dialog"], [role="alertdialog"]',
        )
      )
        return;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        if (event.shiftKey) redo();
        else undo();
      } else if (
        (event.metaKey || event.ctrlKey) &&
        event.key.toLowerCase() === 's'
      ) {
        event.preventDefault();
        save();
      } else if (event.key === 'Escape') {
        chooseTool('select');
        setSelected(null);
      } else if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault();
        removeSelection();
      } else if (event.key.toLowerCase() === 'r' && selectedFurniture)
        updateFurniture(selectedFurniture.id, {
          rotation: normalizeRotation(selectedFurniture.rotation + 90),
        });
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  });
  const beginFurniture = (kind: FurnitureKind) => {
    setCanvasRevision((revision) => revision + 1);
    setPending(kind);
    setTool('furniture');
    if (view === '3d') setView('split');
    setNotice(
      `${catalogItem(kind).name}：間取りの中をクリックして配置。Escでキャンセル。`,
    );
  };

  return (
    <main className="studio" data-ready={hydrated}>
      <header className="main-header">
        <div className="brand" aria-label="Housemaker">
          <span className="brand-mark">
            <Box size={23} strokeWidth={1.7} />
          </span>
          <span>
            housemaker<span className="brand-dot">.</span>
          </span>
        </div>
        <div className="project-title">
          <span className="header-divider" />
          <input
            aria-label="プロジェクト名"
            value={plan.name}
            maxLength={60}
            onChange={(event) => commit({ ...plan, name: event.target.value })}
          />
          <span className="project-tag">1F</span>
        </div>
        <div className="header-actions">
          <span className="save-state">
            <span
              className={
                saved === currentSerialized ? 'status-dot saved' : 'status-dot'
              }
            />
            {saved === currentSerialized ? '保存済み' : '編集中'}
          </span>
          <Button
            variant="ghost"
            className="new-button"
            onClick={() => setResetOpen(true)}
          >
            <Plus />
            新規作成
          </Button>
          <Button className="save-button" onClick={save}>
            <Save />
            保存<span className="save-suffix">する</span>
          </Button>
        </div>
      </header>

      <div className="studio-body">
        <aside className="catalog-panel" aria-label="家具カタログ">
          <div className="panel-heading">
            <div>
              <span className="eyebrow">COLLECTION</span>
              <h2>家具を置く</h2>
            </div>
            <span className="count-pill">10</span>
          </div>
          <p className="panel-intro">家具を選んで、間取りをクリック。</p>
          <Tabs
            value={category}
            onValueChange={(value) => setCategory(String(value))}
            className="category-tabs"
          >
            <TabsList aria-label="家具カテゴリー" className="category-list">
              {[
                'すべて',
                'リビング',
                'ダイニング',
                'ベッドルーム',
                'ワークスペース',
              ].map((item) => (
                <TabsTrigger key={item} value={item}>
                  {item}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
          <div className="catalog-grid">
            {FURNITURE_CATALOG.filter(
              (item) => category === 'すべて' || item.category === category,
            ).map((item) => (
              <button
                className={`catalog-card ${pending === item.kind ? 'is-pending' : ''}`}
                key={item.kind}
                onClick={() => beginFurniture(item.kind)}
                aria-label={`${item.name}を配置`}
                aria-pressed={pending === item.kind}
              >
                <span className="furniture-preview">
                  <svg viewBox="-1.5 -1.35 3 2.7" aria-hidden="true">
                    <FurnitureFootprint kind={item.kind} color={item.color} />
                  </svg>
                  <span className="catalog-add">
                    {pending === item.kind ? (
                      <Check size={13} />
                    ) : (
                      <Plus size={13} />
                    )}
                  </span>
                </span>
                <span className="furniture-name">{item.name}</span>
                <span className="furniture-size">
                  {Math.round(item.width * 100)} ×{' '}
                  {Math.round(item.depth * 100)} cm
                </span>
              </button>
            ))}
          </div>
          <div className="catalog-footer">
            <Leaf size={18} />
            <span>
              家具は実寸で表示
              <br />
              <strong>サイズは幅 × 奥行き</strong>
            </span>
          </div>
        </aside>

        <section className="workspace" aria-label="ハウスモデリング作業領域">
          <div className="workspace-toolbar">
            <div className="floor-title">
              <Layers3 size={17} />
              <strong>1階</strong>
              <span>{area.toFixed(1)} m²</span>
            </div>
            <Tabs
              value={view}
              onValueChange={(value) => setView(value as ViewMode)}
            >
              <TabsList className="view-tabs" aria-label="表示モード">
                <TabsTrigger value="2d">
                  <Grid2X2 />
                  間取り
                </TabsTrigger>
                <TabsTrigger value="split">
                  <PanelsTopLeft />
                  2D + 3D
                </TabsTrigger>
                <TabsTrigger value="3d">
                  <Box />
                  3D
                </TabsTrigger>
              </TabsList>
            </Tabs>
            <div className="history-buttons">
              <Button
                size="icon"
                variant="ghost"
                aria-label="元に戻す"
                title="元に戻す（⌘/Ctrl + Z）"
                disabled={!past.length}
                onClick={undo}
              >
                <Undo2 />
              </Button>
              <Button
                size="icon"
                variant="ghost"
                aria-label="やり直す"
                title="やり直す（⌘/Ctrl + Shift + Z）"
                disabled={!future.length}
                onClick={redo}
              >
                <Redo2 />
              </Button>
            </div>
          </div>
          <div className={`viewports view-${view}`}>
            {view !== '3d' && (
              <section className="viewport plan-viewport" aria-label="2D間取り">
                <div className="viewport-title">
                  <span>
                    <span className="view-number">01</span>FLOOR PLAN
                  </span>
                  <span className="view-label">間取り</span>
                </div>
                <div className="drawing-tools" aria-label="作図ツール">
                  <Button
                    aria-label="選択ツール"
                    title="選択・家具の移動"
                    variant="ghost"
                    className={tool === 'select' ? 'active-tool' : ''}
                    onClick={() => chooseTool('select')}
                  >
                    <MousePointer2 />
                    <span>選択</span>
                  </Button>
                  <Button
                    aria-label="部屋ツール"
                    title="ドラッグして部屋を作成"
                    variant="ghost"
                    className={tool === 'room' ? 'active-tool' : ''}
                    onClick={() => chooseTool('room')}
                  >
                    <SquareDashed />
                    <span>部屋</span>
                  </Button>
                  <Button
                    aria-label="壁ツール"
                    title="ドラッグして壁を作成"
                    variant="ghost"
                    className={tool === 'wall' ? 'active-tool' : ''}
                    onClick={() => chooseTool('wall')}
                  >
                    <Minus />
                    <span>壁</span>
                  </Button>
                </div>
                <div className="plan-canvas">
                  <FloorPlan
                    key={`${canvasRevision}-${currentSerialized}`}
                    plan={plan}
                    selectedId={selectedId}
                    tool={tool}
                    pending={pending}
                    onSelect={selectObject}
                    onPlace={addFurniture}
                    onRoom={addRoom}
                    onWall={addWall}
                    onMove={(id, position) => updateFurniture(id, position)}
                  />
                </div>
                <div className="viewport-footer">
                  <span>
                    <Ruler size={14} />
                    グリッド 50 cm · スナップ 10 cm
                  </span>
                  <span className="north-mark">N ↑</span>
                </div>
                {pending && (
                  <div className="placement-banner">
                    <Armchair size={16} />
                    {catalogItem(pending).name}を配置
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      aria-label="配置をキャンセル"
                      onClick={() => chooseTool('select')}
                    >
                      <X />
                    </Button>
                  </div>
                )}
              </section>
            )}
            {view !== '2d' && (
              <section
                className="viewport scene-viewport"
                aria-label="3Dプレビュー"
              >
                <div className="viewport-title">
                  <span>
                    <span className="view-number">02</span>3D PREVIEW
                  </span>
                  <span className="live-badge">
                    <span />
                    LIVE
                  </span>
                </div>
                <div className="scene-canvas">
                  <Suspense
                    fallback={
                      <div className="scene-loading">
                        <Box />
                        3Dビューを準備しています…
                      </div>
                    }
                  >
                    <Scene3D
                      key={cameraKey}
                      plan={plan}
                      selectedId={selectedId}
                      onSelect={selectObject}
                      wallMode={wallMode}
                    />
                  </Suspense>
                </div>
                <div className="scene-controls">
                  <label htmlFor="cutaway-walls">
                    <Switch
                      id="cutaway-walls"
                      aria-label="壁を低く表示"
                      checked={wallMode === 'cutaway'}
                      onCheckedChange={(checked) =>
                        setWallMode(checked ? 'cutaway' : 'full')
                      }
                    />
                    <span>壁を低く表示</span>
                  </label>
                  <Button
                    variant="outline"
                    size="icon"
                    aria-label="視点をリセット"
                    title="視点をリセット"
                    onClick={() => setCameraKey((key) => key + 1)}
                  >
                    <Maximize2 />
                  </Button>
                </div>
                <div className="viewport-footer">
                  <span>
                    <Move size={14} />
                    ドラッグで回転 · ホイールでズーム
                  </span>
                  <span>透視図</span>
                </div>
              </section>
            )}
          </div>
          <footer className="status-bar">
            <output className="status-message" aria-live="polite">
              <span className="status-dot saved" />
              {notice}
            </output>
            <span className="object-count">
              {plan.rooms.length} 部屋<span>·</span>
              {plan.furniture.length} 家具
            </span>
          </footer>
        </section>

        <aside className="inspector-panel" aria-label="プロパティ">
          <div className="panel-heading">
            <div>
              <span className="eyebrow">PROPERTIES</span>
              <h2>
                {selectedFurniture
                  ? '家具の詳細'
                  : selectedRoom
                    ? '部屋の詳細'
                    : selectedWall
                      ? '壁の詳細'
                      : 'プランの概要'}
              </h2>
            </div>
            <Ruler size={19} />
          </div>
          {selectedFurniture ? (
            <>
              <div className="selection-preview">
                <svg viewBox="-1.8 -1.5 3.6 3" aria-hidden="true">
                  <g transform={`rotate(${selectedFurniture.rotation})`}>
                    <FurnitureFootprint
                      kind={selectedFurniture.kind}
                      color={selectedFurniture.color}
                    />
                  </g>
                </svg>
                <span className="selection-badge">選択中</span>
              </div>
              <div className="selection-title">
                <h3>{catalogItem(selectedFurniture.kind).name}</h3>
                <span>{catalogItem(selectedFurniture.kind).category}</span>
              </div>
              <div className="inspector-section">
                <h4>位置</h4>
                <div className="field-grid">
                  <NumericField
                    label="X 座標"
                    value={selectedFurniture.x}
                    max={BOARD.width}
                    onChange={(x) =>
                      updateFurniture(selectedFurniture.id, { x })
                    }
                  />
                  <NumericField
                    label="Z 座標"
                    value={selectedFurniture.z}
                    max={BOARD.depth}
                    onChange={(z) =>
                      updateFurniture(selectedFurniture.id, { z })
                    }
                  />
                </div>
              </div>
              <div className="inspector-section">
                <h4>向き</h4>
                <div className="rotation-row">
                  <NumericField
                    label="回転角度"
                    unit="°"
                    max={359}
                    step={15}
                    value={selectedFurniture.rotation}
                    onChange={(rotation) =>
                      updateFurniture(selectedFurniture.id, {
                        rotation: normalizeRotation(rotation),
                      })
                    }
                  />
                  <Button
                    variant="outline"
                    aria-label="90度回転"
                    onClick={() =>
                      updateFurniture(selectedFurniture.id, {
                        rotation: normalizeRotation(
                          selectedFurniture.rotation + 90,
                        ),
                      })
                    }
                  >
                    <RotateCw />
                    90°
                  </Button>
                </div>
              </div>
              <div className="inspector-section">
                <h4>カラー</h4>
                <div className="color-swatches">
                  {COLORS.map((color) => (
                    <button
                      key={color}
                      className={
                        selectedFurniture.color === color ? 'selected' : ''
                      }
                      style={{ background: color }}
                      aria-label={`家具の色 ${color}`}
                      aria-pressed={selectedFurniture.color === color}
                      onClick={() =>
                        updateFurniture(selectedFurniture.id, { color })
                      }
                    >
                      {selectedFurniture.color === color && <Check size={14} />}
                    </button>
                  ))}
                </div>
              </div>
              <div className="dimension-card">
                <Ruler size={17} />
                <div>
                  <span>幅 × 奥行き × 高さ</span>
                  <strong>
                    {Math.round(
                      catalogItem(selectedFurniture.kind).width * 100,
                    )}{' '}
                    ×{' '}
                    {Math.round(
                      catalogItem(selectedFurniture.kind).depth * 100,
                    )}{' '}
                    ×{' '}
                    {Math.round(
                      catalogItem(selectedFurniture.kind).height * 100,
                    )}{' '}
                    cm
                  </strong>
                </div>
              </div>
            </>
          ) : selectedRoom ? (
            <>
              <div className="inspector-section">
                <label className="text-field">
                  部屋の名前
                  <input
                    aria-label="部屋の名前"
                    value={selectedRoom.name}
                    maxLength={40}
                    onChange={(event) =>
                      updateRoom(selectedRoom.id, { name: event.target.value })
                    }
                  />
                </label>
                <div className="room-size-display">
                  {(selectedRoom.width * selectedRoom.depth).toFixed(1)}
                  <span>m²</span>
                </div>
              </div>
              <div className="inspector-section">
                <h4>サイズ</h4>
                <div className="field-grid">
                  <NumericField
                    label="部屋の幅"
                    min={1}
                    max={BOARD.width}
                    value={selectedRoom.width}
                    onChange={(width) => updateRoom(selectedRoom.id, { width })}
                  />
                  <NumericField
                    label="部屋の奥行き"
                    min={1}
                    max={BOARD.depth}
                    value={selectedRoom.depth}
                    onChange={(depth) => updateRoom(selectedRoom.id, { depth })}
                  />
                </div>
              </div>
              <div className="inspector-section">
                <h4>位置</h4>
                <div className="field-grid">
                  <NumericField
                    label="部屋のX座標"
                    value={selectedRoom.x}
                    onChange={(x) => updateRoom(selectedRoom.id, { x })}
                  />
                  <NumericField
                    label="部屋のZ座標"
                    max={BOARD.depth}
                    value={selectedRoom.z}
                    onChange={(z) => updateRoom(selectedRoom.id, { z })}
                  />
                </div>
              </div>
              <div className="inspector-section">
                <h4>床のカラー</h4>
                <div className="color-swatches">
                  {['#eee6d8', '#e4e9ed', '#e7eadf', '#dbd1c4', '#ecdcdc'].map(
                    (color) => (
                      <button
                        key={color}
                        className={
                          selectedRoom.color === color ? 'selected' : ''
                        }
                        style={{ background: color }}
                        aria-label={`床の色 ${color}`}
                        aria-pressed={selectedRoom.color === color}
                        onClick={() => updateRoom(selectedRoom.id, { color })}
                      >
                        {selectedRoom.color === color && <Check size={14} />}
                      </button>
                    ),
                  )}
                </div>
              </div>
              <p className="inspector-note">
                部屋を移動すると、室内の家具も一緒に移動します。
              </p>
            </>
          ) : selectedWall ? (
            <>
              <div className="inspector-section">
                <h4>壁のサイズ</h4>
                <div className="room-size-display">
                  {Math.hypot(
                    selectedWall.x2 - selectedWall.x1,
                    selectedWall.z2 - selectedWall.z1,
                  ).toFixed(1)}
                  <span>m</span>
                </div>
                <NumericField
                  label="壁の高さ"
                  min={0.2}
                  max={4}
                  value={selectedWall.height}
                  onChange={(height) => updateWall(selectedWall.id, { height })}
                />
                <NumericField
                  label="壁の厚さ"
                  min={0.05}
                  max={0.5}
                  step={0.05}
                  value={selectedWall.thickness}
                  onChange={(thickness) =>
                    updateWall(selectedWall.id, { thickness })
                  }
                />
              </div>
              <p className="inspector-note">
                高さの確認には、3Dビューの「壁を低く表示」をオフにします。
              </p>
            </>
          ) : (
            <>
              <div className="plan-summary">
                <span className="summary-icon">
                  <Home size={27} strokeWidth={1.4} />
                </span>
                <span>延床面積</span>
                <div>
                  {area.toFixed(1)}
                  <span>m²</span>
                </div>
                <p>1フロア · {plan.rooms.length}部屋</p>
              </div>
              <div className="inspector-section room-list">
                <h4>
                  部屋一覧<span>{plan.rooms.length}</span>
                </h4>
                {plan.rooms.map((room) => (
                  <button key={room.id} onClick={() => selectObject(room.id)}>
                    <span
                      className="room-color"
                      style={{ background: room.color }}
                    />
                    <span>
                      {room.name}
                      <small>{(room.width * room.depth).toFixed(1)} m²</small>
                    </span>
                    <ChevronRight size={15} />
                  </button>
                ))}
                {!plan.rooms.length && (
                  <p className="inspector-note">
                    「部屋」ツールで空いている場所をドラッグして、最初の部屋を作成します。
                  </p>
                )}
              </div>
              <div className="quick-guide">
                <span className="eyebrow">FLOOR PLAN</span>
                <h3>間取りの編集</h3>
                <p>
                  空いている場所をドラッグして、
                  <br />
                  新しい部屋を追加できます。
                </p>
                <Button variant="ghost" onClick={() => chooseTool('room')}>
                  部屋を追加する
                  <ArrowUpRight size={15} />
                </Button>
              </div>
            </>
          )}
          {selectedId && (
            <div className="delete-section">
              {selectedRoom && (
                <p>部屋を削除すると、室内の家具も削除されます。</p>
              )}
              <Button variant="destructive" onClick={removeSelection}>
                <Trash2 />
                選択した{selectedRoom ? '部屋' : selectedWall ? '壁' : '家具'}
                を削除
              </Button>
            </div>
          )}
          <div className="inspector-help">
            <Dialog>
              <DialogTrigger render={<Button variant="ghost" />}>
                <CircleHelp />
                操作ガイド
              </DialogTrigger>
              <DialogContent className="help-dialog">
                <DialogTitle>間取りをつくる、4つの操作</DialogTitle>
                <DialogDescription>
                  間取りと3Dビューは、同じプランを表示しています。
                </DialogDescription>
                <ol>
                  <li>
                    <strong>部屋を描く</strong>
                    「部屋」ツールでドラッグ。右側で名前や寸法を調整できます。
                  </li>
                  <li>
                    <strong>家具を置く</strong>
                    左の家具を選び、部屋の内側をクリックします。
                  </li>
                  <li>
                    <strong>配置を調整する</strong>
                    家具をドラッグして移動。右側で座標・回転角・色を変更します。
                  </li>
                  <li>
                    <strong>3Dで確認する</strong>
                    ドラッグで回転、ホイールでズーム。壁の高さを切り替えて確認できます。
                  </li>
                </ol>
                <p>
                  ⌘ / Ctrl + Z：元に戻す
                  <br />
                  R：選択した家具を90°回転
                  <br />
                  Delete：削除 · Esc：選択・配置を解除
                </p>
                <p>「保存する」でこのブラウザに保存します。</p>
              </DialogContent>
            </Dialog>
          </div>
        </aside>
      </div>
      <AlertDialog open={resetOpen} onOpenChange={setResetOpen}>
        <AlertDialogContent>
          <AlertDialogTitle>新しい間取りを作成</AlertDialogTitle>
          <AlertDialogDescription>
            編集中のプランを空にします。作成後も「元に戻す」で現在のプランを復元できます。
          </AlertDialogDescription>
          <AlertDialogFooter>
            <AlertDialogCancel>キャンセル</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                commit({
                  name: '新しい住まい',
                  rooms: [],
                  walls: [],
                  furniture: [],
                });
                setSelected(null);
                chooseTool('room');
                setResetOpen(false);
              }}
            >
              空のプランを作成
            </AlertDialogAction>
          </AlertDialogFooter>
          <Button
            variant="ghost"
            onClick={() => {
              commit(createInitialPlan());
              setSelected(null);
              chooseTool('select');
              setResetOpen(false);
            }}
          >
            サンプル間取りに戻す
          </Button>
        </AlertDialogContent>
      </AlertDialog>
    </main>
  );
}
