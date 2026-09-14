// 実際のWebGLへ渡された視点行列を観測し、カメラの平行移動と回転を入力操作から検証する。
import {
  test as base,
  expect,
  type Locator,
  type Page,
} from '@playwright/test';

// 見た目が変わっていても未処理例外を見逃さず、成功した最終画面も証跡へ残す。
const test = base.extend<{ runtimeErrors: void }>({
  runtimeErrors: [
    async ({ page }, use, testInfo) => {
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      page.on('console', (message) => {
        if (message.type() === 'error') errors.push(message.text());
      });
      await use();
      if (errors.length) {
        await testInfo.attach('camera-page-errors', {
          body: JSON.stringify(errors, null, 2),
          contentType: 'application/json',
        });
      }
      expect(errors, 'カメラ操作中に未処理例外が発生しないこと').toEqual([]);
      if (testInfo.status === 'passed') {
        await testInfo.attach('camera-final-preview', {
          body: await sceneRegion(page).screenshot(),
          contentType: 'image/png',
        });
      }
    },
    { auto: true },
  ],
});

type CameraView = number[];

const sceneRegion = (page: Page) =>
  page.getByRole('region', { name: '3Dプレビュー', exact: true });

async function openScene(page: Page) {
  await page.goto('/');
  await expect(page.locator('main')).toHaveAttribute('data-ready', 'true');
  await expect(sceneRegion(page).locator('[data-scene-state]')).toHaveAttribute(
    'data-scene-state',
    'ready',
  );
  const canvas = sceneRegion(page).locator('canvas');
  await expect(canvas).toBeVisible();
  return canvas;
}

// WebGLの標準APIだけで、直近に家を描いたシェーダーのviewMatrixを読み取る。
// アプリ状態やOrbitControlsへ書き込まず、実描画に使用されたカメラの向き・位置を比較する。
async function readCameraView(canvas: Locator): Promise<CameraView> {
  return canvas.evaluate(async (element) => {
    // 描画フレームが進んでいない同値サンプルを、慣性収束と誤認しないようにする。
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => resolve()),
    );
    const gl = (element as HTMLCanvasElement).getContext('webgl2');
    if (!gl || gl.isContextLost())
      throw new Error('WebGLの描画が停止しています。');
    const program = gl.getParameter(gl.CURRENT_PROGRAM) as WebGLProgram | null;
    if (!program) throw new Error('描画済みシェーダーがありません。');
    const location = gl.getUniformLocation(program, 'viewMatrix');
    if (!location) throw new Error('描画済みの視点行列を読み取れません。');
    const matrix = gl.getUniform(program, location) as Float32Array;
    return Array.from(matrix);
  });
}

// 慣性が収束してから比較し、操作後の数フレームだけを測って回転を見逃すことを防ぐ。
async function settledCameraView(canvas: Locator): Promise<CameraView> {
  let previous = await readCameraView(canvas);
  let steadySamples = 0;
  await expect
    .poll(
      async () => {
        const current = await readCameraView(canvas);
        const change = Math.max(
          ...current.map((value, index) => Math.abs(value - previous[index])),
        );
        steadySamples = change < 0.00002 ? steadySamples + 1 : 0;
        previous = current;
        return steadySamples;
      },
      {
        message: 'カメラの慣性移動が収束すること',
        intervals: [150],
        // ソフトウェアWebGLでは慣性減衰に実測15秒以上かかるため、精度は保って上限だけ延ばす。
        timeout: 30_000,
      },
    )
    .toBeGreaterThanOrEqual(3);
  return previous;
}

// 列優先の4×4視点行列のうち、3×3の回転部分と最後の列の移動部分を独立に比較する。
const rotationDifference = (before: CameraView, after: CameraView) =>
  Math.max(
    ...[0, 1, 2, 4, 5, 6, 8, 9, 10].map((index) =>
      Math.abs(after[index] - before[index]),
    ),
  );
const translationDifference = (before: CameraView, after: CameraView) =>
  Math.hypot(...[12, 13, 14].map((index) => after[index] - before[index]));

async function dragScene(
  page: Page,
  canvas: Locator,
  button: 'left' | 'right' = 'left',
  shift = false,
) {
  const box = await canvas.boundingBox();
  if (!box) throw new Error('3Dキャンバスの表示範囲がありません。');
  // 中央のモデルを避け、HTMLの上部・下部ツールに重ならない位置から水平にドラッグする。
  const start = { x: box.x + box.width * 0.25, y: box.y + box.height * 0.3 };
  await page.mouse.move(start.x, start.y);
  if (shift) await page.keyboard.down('Shift');
  try {
    await page.mouse.down({ button });
    await page.mouse.move(start.x + 85, start.y, { steps: 12 });
    await page.mouse.up({ button });
  } finally {
    if (shift) await page.keyboard.up('Shift');
  }
}

// CDPの入力経路で実際のタッチイベントを発生させ、指間距離を固定してピンチと横移動を区別する。
async function touchGesture(
  page: Page,
  canvas: Locator,
  fingers: 1 | 2,
  pinch = false,
) {
  const box = await canvas.boundingBox();
  if (!box) throw new Error('3Dキャンバスの表示範囲がありません。');
  const session = await page.context().newCDPSession(page);
  const points = Array.from({ length: fingers }, (_, index) => ({
    id: index + 1,
    x: box.x + box.width * 0.25 + index * 60,
    y: box.y + box.height * 0.3,
  }));
  try {
    await session.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: points,
    });
    for (let step = 1; step <= 8; step++) {
      await session.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        // ピンチでは左右の指を対称に広げ、視点の向きを変えずにカメラが近づくことを測る。
        touchPoints: points.map((point, index) => ({
          ...point,
          x: point.x + (pinch ? (index === 0 ? -1 : 1) * step * 4 : step * 10),
        })),
      });
    }
    await session.send('Input.dispatchTouchEvent', {
      type: 'touchEnd',
      touchPoints: [],
    });
  } finally {
    await session.detach();
  }
}

function expectPan(before: CameraView, after: CameraView) {
  // 1cm以上移動し、回転行列は単精度の誤差範囲で一致することを要求する。
  expect(
    translationDifference(before, after),
    '実際の視点が平行移動すること',
  ).toBeGreaterThan(0.01);
  expect(
    rotationDifference(before, after),
    '平行移動でカメラの向きが変わらないこと',
  ).toBeLessThan(0.0001);
}

test('移動モードの左ドラッグは向きを保って横移動し、回転モードへ戻すと回転する', async ({
  page,
}, testInfo) => {
  const canvas = await openScene(page);
  const move = sceneRegion(page).getByRole('button', {
    name: '視点を移動',
    exact: true,
  });
  const rotate = sceneRegion(page).getByRole('button', {
    name: '視点を回転',
    exact: true,
  });
  await expect(move).toHaveAttribute('aria-pressed', 'false');
  await expect(rotate).toHaveAttribute('aria-pressed', 'true');
  await move.click();
  await expect(move).toHaveAttribute('aria-pressed', 'true');
  await expect(rotate).toHaveAttribute('aria-pressed', 'false');
  const initial = await settledCameraView(canvas);
  await dragScene(page, canvas);
  const translated = await settledCameraView(canvas);
  expectPan(initial, translated);
  await testInfo.attach('camera-translated-preview', {
    body: await sceneRegion(page).screenshot(),
    contentType: 'image/png',
  });
  await rotate.click();
  await expect(rotate).toHaveAttribute('aria-pressed', 'true');
  await dragScene(page, canvas);
  const rotated = await settledCameraView(canvas);
  expect(
    rotationDifference(translated, rotated),
    '回転モードの左ドラッグで向きが変わること',
  ).toBeGreaterThan(0.01);
  await testInfo.attach('camera-pan-and-orbit', {
    body: JSON.stringify({ initial, translated, rotated }, null, 2),
    contentType: 'application/json',
  });
});

test('移動した視点は選択と壁切替で保たれ、リセットと横長リサイズで中央へ戻る', async ({
  page,
}, testInfo) => {
  const canvas = await openScene(page);
  await sceneRegion(page)
    .getByRole('button', { name: '視点を移動', exact: true })
    .click();
  const initial = await settledCameraView(canvas);
  await dragScene(page, canvas);
  const translated = await settledCameraView(canvas);
  expectPan(initial, translated);
  await page
    .getByRole('button', { name: '3人掛けソファを選択', exact: true })
    .press('Enter');
  const selected = await settledCameraView(canvas);
  expect(
    translationDifference(translated, selected),
    '家具選択で視点が戻らないこと',
  ).toBeLessThan(0.001);
  expect(rotationDifference(translated, selected)).toBeLessThan(0.0001);
  // ラベル結合で読み上げ名が重複するため、3D領域内の一意な壁スイッチを操作する。
  await sceneRegion(page).getByRole('switch').uncheck();
  const wallsChanged = await settledCameraView(canvas);
  expect(
    translationDifference(translated, wallsChanged),
    '壁表示の切替で視点が戻らないこと',
  ).toBeLessThan(0.001);
  expect(rotationDifference(translated, wallsChanged)).toBeLessThan(0.0001);
  await sceneRegion(page)
    .getByRole('button', { name: '視点をリセット', exact: true })
    .click();
  await expect(sceneRegion(page).locator('[data-scene-state]')).toHaveAttribute(
    'data-scene-state',
    'ready',
  );
  const reset = await settledCameraView(sceneRegion(page).locator('canvas'));
  expect(
    translationDifference(initial, reset),
    '明示的なリセットで初期位置へ戻ること',
  ).toBeLessThan(0.001);
  expect(rotationDifference(initial, reset)).toBeLessThan(0.0001);
  // 横長同士では全体表示の距離が同じでも、リサイズに応じて注視点を戻す必要がある。
  await page.getByRole('tab', { name: '3D', exact: true }).click();
  await page.setViewportSize({ width: 1800, height: 1000 });
  const wideCanvas = sceneRegion(page).locator('canvas');
  const wideView = await settledCameraView(wideCanvas);
  const wideBox = await wideCanvas.boundingBox();
  expect(wideBox!.width).toBeGreaterThan(wideBox!.height);
  await dragScene(page, wideCanvas);
  expectPan(wideView, await settledCameraView(wideCanvas));
  await page.setViewportSize({ width: 1700, height: 1000 });
  const resized = await settledCameraView(wideCanvas);
  // プラン中心(8m, 0m, 6m)を視点行列で変換し、画面中央の光軸上にあることを確認する。
  expect(Math.abs(resized[0] * 8 + resized[8] * 6 + resized[12])).toBeLessThan(
    0.001,
  );
  expect(Math.abs(resized[1] * 8 + resized[9] * 6 + resized[13])).toBeLessThan(
    0.001,
  );
  expect(
    rotationDifference(initial, resized),
    'リサイズ後も初期の見下ろす向きと一致すること',
  ).toBeLessThan(0.0001);
  await testInfo.attach('camera-retained-and-reset', {
    body: JSON.stringify(
      { initial, translated, selected, wallsChanged, reset, resized },
      null,
      2,
    ),
    contentType: 'application/json',
  });
});

test('回転モードでも右ドラッグとShift付き左ドラッグの横移動を維持する', async ({
  page,
}) => {
  const canvas = await openScene(page);
  const initial = await settledCameraView(canvas);
  await dragScene(page, canvas, 'right');
  const rightPan = await settledCameraView(canvas);
  expectPan(initial, rightPan);
  await dragScene(page, canvas, 'left', true);
  expectPan(rightPan, await settledCameraView(canvas));
});

test.describe('タッチによる視点操作', () => {
  test.use({ hasTouch: true });

  test('移動モードの1本指と回転モードの2本指で横移動でき、ピンチで拡大できる', async ({
    page,
  }, testInfo) => {
    const canvas = await openScene(page);
    await sceneRegion(page)
      .getByRole('button', { name: '視点を移動', exact: true })
      .click();
    const initial = await settledCameraView(canvas);
    await touchGesture(page, canvas, 1);
    const oneFinger = await settledCameraView(canvas);
    expectPan(initial, oneFinger);
    await sceneRegion(page)
      .getByRole('button', { name: '視点を回転', exact: true })
      .click();
    await touchGesture(page, canvas, 2);
    const twoFingers = await settledCameraView(canvas);
    expectPan(oneFinger, twoFingers);
    await touchGesture(page, canvas, 2, true);
    const pinched = await settledCameraView(canvas);
    // 指を広げると被写体へ近づくため、視点行列の奥行き移動成分が増える。
    expect(
      pinched[14] - twoFingers[14],
      '2本指を広げるとズームインすること',
    ).toBeGreaterThan(0.1);
    expect(rotationDifference(twoFingers, pinched)).toBeLessThan(0.0001);
    await testInfo.attach('camera-touch-pan', {
      body: JSON.stringify(
        { initial, oneFinger, twoFingers, pinched },
        null,
        2,
      ),
      contentType: 'application/json',
    });
  });
});
