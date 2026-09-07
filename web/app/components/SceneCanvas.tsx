'use client';

// GPUの準備・破棄をDOM側で管理し、非同期の初期化失敗も空白ではなく再試行可能な案内に変える。
import {
  Component,
  Suspense,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import type { ErrorInfo, ReactNode } from 'react';
import { createRoot, events, extend, useFrame } from '@react-three/fiber';
import type { RootStore } from '@react-three/fiber';
import * as THREE from 'three';

// Canvas組み込み部品からcreateRootへ移るため、標準のThree.js要素とポインターイベントを明示登録する。
extend({
  AmbientLight: THREE.AmbientLight,
  BoxGeometry: THREE.BoxGeometry,
  BufferAttribute: THREE.BufferAttribute,
  BufferGeometry: THREE.BufferGeometry,
  Color: THREE.Color,
  CylinderGeometry: THREE.CylinderGeometry,
  DirectionalLight: THREE.DirectionalLight,
  ExtrudeGeometry: THREE.ExtrudeGeometry,
  Group: THREE.Group,
  HemisphereLight: THREE.HemisphereLight,
  LineBasicMaterial: THREE.LineBasicMaterial,
  LineLoop: THREE.LineLoop,
  Mesh: THREE.Mesh,
  MeshBasicMaterial: THREE.MeshBasicMaterial,
  MeshStandardMaterial: THREE.MeshStandardMaterial,
  PlaneGeometry: THREE.PlaneGeometry,
  SphereGeometry: THREE.SphereGeometry,
});

export function SceneFallback({
  loading = false,
  onRetry,
}: {
  loading?: boolean;
  onRetry?: () => void;
}) {
  return (
    <output className="scene-fallback">
      {loading ? (
        '3Dビューを準備しています…'
      ) : (
        <>
          <strong>3Dビューを表示できませんでした</strong>
          <span>
            ブラウザーの3D描画を開始できませんでした。再試行しても表示されない場合は、ブラウザーのグラフィックアクセラレーションを有効にしてください。
          </span>
          <span>間取りの編集と保存は、そのまま続けられます。</span>
          {onRetry && (
            <button type="button" onClick={onRetry}>
              3Dを再試行
            </button>
          )}
        </>
      )}
    </output>
  );
}

// 3DはReact DOMとは別の描画ルートなので、内部エラーをコールバックで外の案内に伝える。
class SceneRenderBoundary extends Component<
  { children: ReactNode; onError: (error: unknown) => void },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: Error, _info: ErrorInfo) {
    this.props.onError(error);
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

function FirstFrame({ onReady }: { onReady: () => void }) {
  const reported = useRef(false);
  useFrame(() => {
    if (!reported.current) {
      reported.current = true;
      onReady();
    }
  });
  return null;
}

export default function SceneCanvas({
  children,
  onPointerMissed,
}: {
  children: ReactNode;
  onPointerMissed: () => void;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const latest = useRef({ children, onPointerMissed });
  const renderRef = useRef<(() => void) | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [failed, setFailed] = useState(false);
  const [ready, setReady] = useState(false);

  // 編集ごとにGPUを作り直さず、既存の3Dルートへ最新の家具・部屋だけを渡す。
  useLayoutEffect(() => {
    latest.current = { children, onPointerMissed };
    renderRef.current?.();
  }, [children, onPointerMissed]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    // R3Fの破棄は遅延するため、再試行やStrictModeでも古いGPU破棄が新しいcanvasに触れないようにする。
    const canvas = document.createElement('canvas');
    canvas.style.display = 'block';
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    host.appendChild(canvas);
    let disposed = false;
    let failedThisAttempt = false;
    let renderer: THREE.WebGLRenderer | undefined;
    let root: ReturnType<typeof createRoot> | undefined;
    let store: RootStore | undefined;

    const fail = (error: unknown) => {
      if (disposed || failedThisAttempt) return;
      failedThisAttempt = true;
      // 状態と入力データは失わず、描画停止の理由だけを開発者コンソールへ残す。
      console.warn('[Housemaker] 3D描画を停止しました。', error);
      store?.getState().setFrameloop('never');
      setFailed(true);
    };
    const onLost = (event: Event) => {
      event.preventDefault();
      fail(new Error('WebGL context lost'));
    };
    canvas.addEventListener('webglcontextlost', onLost);

    const measure = () => {
      const bounds = host.getBoundingClientRect();
      return {
        width: Math.max(1, bounds.width),
        height: Math.max(1, bounds.height),
        top: bounds.top,
        left: bounds.left,
      };
    };
    const resize = () => {
      if (!store || disposed) return;
      const size = measure();
      store.getState().setSize(size.width, size.height, size.top, size.left);
    };
    const observer = new ResizeObserver(resize);
    observer.observe(host);

    const start = async () => {
      try {
        // 高性能GPUを強制せず、通常設定で取得できなければアンチエイリアスなしでもう一度試す。
        // 調査用canvasを増やさず、実際に描画するcanvasでWebGL2の可否を確認する。
        const context =
          canvas.getContext('webgl2', {
            alpha: false,
            antialias: true,
            powerPreference: 'default',
          }) ??
          canvas.getContext('webgl2', {
            alpha: false,
            antialias: false,
            powerPreference: 'default',
          });
        if (!context) throw new Error('WebGL2 context could not be created');
        renderer = new THREE.WebGLRenderer({ canvas, context, alpha: false });
        // renderer生成に失敗した場合は、未初期化のR3Fルートを残さない。
        root = createRoot(canvas);
        await root.configure({
          gl: renderer,
          events,
          shadows: 'percentage',
          dpr: [1, 1.65],
          camera: { position: [19, 18, 21], fov: 39, near: 0.1, far: 150 },
          size: measure(),
          onPointerMissed: () => latest.current.onPointerMissed(),
        });
        if (disposed || failedThisAttempt) return;
        const render = () => {
          if (!root || disposed || failedThisAttempt) return;
          store = root.render(
            <SceneRenderBoundary onError={fail}>
              <Suspense fallback={null}>
                {latest.current.children}
                <FirstFrame
                  onReady={() => {
                    if (!disposed && !failedThisAttempt) setReady(true);
                  }}
                />
              </Suspense>
            </SceneRenderBoundary>,
          );
        };
        renderRef.current = render;
        render();
        resize();
      } catch (error) {
        fail(error);
      }
    };
    void start();
    return () => {
      disposed = true;
      renderRef.current = null;
      observer.disconnect();
      canvas.removeEventListener('webglcontextlost', onLost);
      root?.unmount();
      // DOMはすぐ撤去し、イベントやWebGLリソースも世代ごとに解放する。
      renderer?.dispose();
      canvas.remove();
    };
  }, [attempt]);

  return (
    <div
      className="scene-surface"
      data-scene-state={failed ? 'failed' : ready ? 'ready' : 'loading'}
    >
      <div
        ref={hostRef}
        className="scene-surface-host"
        style={{ visibility: failed ? 'hidden' : 'visible' }}
      />
      {(failed || !ready) && (
        <SceneFallback
          loading={!failed}
          onRetry={() => {
            setFailed(false);
            setReady(false);
            setAttempt((value) => value + 1);
          }}
        />
      )}
    </div>
  );
}
