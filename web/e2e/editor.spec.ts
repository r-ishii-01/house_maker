// 実際の入力・描画・保存を一連の操作で検証し、画面と保存結果の食い違いを検出する。
import {
  test as base,
  expect,
  type Locator,
  type Page,
} from '@playwright/test';
import { PerspectiveCamera, Vector3 } from 'three';

type FloorPoint = { x: number; z: number };

// どのシナリオでもページ例外を収集し、表示だけ成功して内部で失敗している状態を見逃さない。
const test = base.extend<{ runtimeErrors: void }>({
  runtimeErrors: [
    async ({ page }, use, testInfo) => {
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await use();
      if (errors.length) {
        await testInfo.attach('page-errors', {
          body: JSON.stringify(errors, null, 2),
          contentType: 'application/json',
        });
      }
      expect(errors, '画面操作中に未処理のJavaScript例外がないこと').toEqual(
        [],
      );
    },
    { auto: true },
  ],
});

const floorCanvas = (page: Page) =>
  page.getByRole('img', { name: /^間取り編集キャンバス/ });
const sofa = (page: Page) =>
  page.getByRole('button', { name: '3人掛けソファを選択', exact: true });

// SVGの実際の変換行列から画面座標を求め、余白や画面サイズによるドラッグ位置のずれを防ぐ。
async function screenPoint(page: Page, position: FloorPoint) {
  const canvas = floorCanvas(page);
  await canvas.scrollIntoViewIfNeeded();
  return canvas.evaluate((element, point) => {
    const matrix = (element as SVGSVGElement).getScreenCTM();
    if (!matrix) throw new Error('SVGの画面変換行列を取得できませんでした。');
    const result = new DOMPoint(point.x, point.z).matrixTransform(matrix);
    return { x: result.x, y: result.y };
  }, position);
}

async function clickFloor(page: Page, position: FloorPoint) {
  const point = await screenPoint(page, position);
  await page.mouse.click(point.x, point.y);
}

async function dragFloor(page: Page, start: FloorPoint, end: FloorPoint) {
  const from = await screenPoint(page, start);
  const to = await screenPoint(page, end);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 8 });
  await page.mouse.up();
}

// 数値欄はEnterで確定する仕様なので、入力値だけでなく確定後の表示値も確認する。
async function setNumber(page: Page, name: string, value: string) {
  const field = page.getByRole('spinbutton', { name, exact: true });
  await field.fill(value);
  await field.press('Enter');
  await expect(field).toHaveValue(value);
}

async function active3DCanvas(page: Page): Promise<Locator> {
  const region = page.getByRole('region', {
    name: '3Dプレビュー',
    exact: true,
  });
  const canvas = region.locator('canvas');
  await expect(canvas).toBeVisible();
  await expect
    .poll(
      () =>
        canvas.evaluate((element) => {
          const context = (element as HTMLCanvasElement).getContext('webgl2');
          return (
            !!context &&
            !context.isContextLost() &&
            context.drawingBufferWidth > 0 &&
            context.drawingBufferHeight > 0
          );
        }),
      { message: '実際に利用可能なWebGLコンテキストが作成されること' },
    )
    .toBe(true);
  // Canvas内の代替テキストはDOMに残るため、個数ではなく非表示であることを確認する。
  await expect(
    region.getByText('3Dビューを表示できませんでした', { exact: true }),
  ).toBeHidden();
  return canvas;
}

// 初期カメラの透視投影をテスト側で計算し、3Dメッシュを通常のポインター操作で選択する。
// アプリ内部のストアやThree.jsシーンへの書込みは行わず、利用者と同じクリック経路を通す。
async function clickSofaIn3D(page: Page, position: FloorPoint) {
  const canvas = await active3DCanvas(page);
  await canvas.scrollIntoViewIfNeeded();
  await canvas.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      }),
  );
  const box = await canvas.boundingBox();
  if (!box) throw new Error('3Dキャンバスの表示範囲を取得できませんでした。');
  const camera = new PerspectiveCamera(39, box.width / box.height, 0.1, 150);
  // 縦長・横長のどちらでも全体を収めるカメラの距離に合わせて、可視位置を計算する。
  const halfVerticalFov = (39 * Math.PI) / 360;
  const halfHorizontalFov = Math.atan(
    (Math.tan(halfVerticalFov) * box.width) / box.height,
  );
  const distance =
    (10 / Math.sin(Math.min(halfVerticalFov, halfHorizontalFov))) * 1.04;
  const directionLength = Math.hypot(11, 18, 15);
  camera.position.set(
    8 + (11 / directionLength) * distance,
    (18 / directionLength) * distance,
    6 + (15 / directionLength) * distance,
  );
  camera.lookAt(8, 0, 6);
  camera.updateMatrixWorld();
  const projected = new Vector3(position.x, 0.45, position.z).project(camera);
  expect(Math.abs(projected.x)).toBeLessThan(1);
  expect(Math.abs(projected.y)).toBeLessThan(1);
  await page.mouse.click(
    box.x + ((projected.x + 1) * box.width) / 2,
    box.y + ((1 - projected.y) * box.height) / 2,
  );
}

async function openEmptyPlan(page: Page) {
  await page.getByRole('button', { name: '新規作成', exact: true }).click();
  const dialog = page.getByRole('alertdialog');
  await expect(dialog).toBeVisible();
  await dialog
    .getByRole('button', { name: '空のプランを作成', exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  await expect(
    page.getByRole('textbox', { name: 'プロジェクト名' }),
  ).toHaveValue('新しい住まい');
  await expect(floorCanvas(page).getByRole('button')).toHaveCount(0);
}

test('サンプルの間取りと家具を2D・WebGLの3Dで表示できる', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('main')).toHaveAttribute('data-ready', 'true');
  await expect(page.getByLabel('Housemaker', { exact: true })).toBeVisible();
  await expect(floorCanvas(page)).toBeVisible();
  await expect(
    page.getByRole('button', {
      name: 'リビング・ダイニングを選択',
      exact: true,
    }),
  ).toBeVisible();
  await expect(sofa(page)).toBeVisible();
  await active3DCanvas(page);
  await expect(
    page.getByRole('tab', { name: '2D + 3D', exact: true }),
  ).toHaveAttribute('aria-selected', 'true');

  // 単独表示へ切り替えても、もう一方のビューへ戻れることを確認する。
  await page.getByRole('tab', { name: '間取り', exact: true }).click();
  await expect(
    page.getByRole('region', { name: '3Dプレビュー', exact: true }),
  ).toHaveCount(0);
  await expect(floorCanvas(page)).toBeVisible();
  await page.getByRole('tab', { name: '3D', exact: true }).click();
  await active3DCanvas(page);
  await expect(floorCanvas(page)).toHaveCount(0);
});

test('空のプランに部屋と家具を作成し、2D・3Dで選択して保存後も復元できる', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.locator('main')).toHaveAttribute('data-ready', 'true');
  await openEmptyPlan(page);
  await page.getByRole('button', { name: '部屋ツール', exact: true }).click();
  await dragFloor(page, { x: 2, z: 2 }, { x: 12, z: 10 });
  await expect(
    page.getByRole('spinbutton', { name: '部屋の幅', exact: true }),
  ).toHaveValue('10');
  await expect(
    page.getByRole('spinbutton', { name: '部屋の奥行き', exact: true }),
  ).toHaveValue('8');
  await page
    .getByRole('textbox', { name: '部屋の名前', exact: true })
    .fill('家族のリビング');
  await expect(
    page.getByRole('button', { name: '家族のリビングを選択', exact: true }),
  ).toBeVisible();

  await page
    .getByRole('button', { name: '3人掛けソファを配置', exact: true })
    .click();
  await clickFloor(page, { x: 7, z: 5 });
  await expect(sofa(page)).toHaveAttribute('aria-pressed', 'true');
  // ドラッグで確定した移動も共通の座標に反映される。
  await dragFloor(page, { x: 7, z: 5 }, { x: 7.5, z: 5.5 });
  await expect(sofa(page)).toHaveAttribute(
    'transform',
    'translate(7.5 5.5) rotate(0)',
  );
  await setNumber(page, 'X 座標', '7.3');
  await setNumber(page, 'Z 座標', '5.3');
  await setNumber(page, '回転角度', '90');
  await expect(sofa(page)).toHaveAttribute(
    'transform',
    'translate(7.3 5.3) rotate(90)',
  );

  // 2Dで選んだ家具が3D表示でも選択状態を維持し、3Dで選び直すと2Dの選択枠へ戻る。
  await page.getByRole('tab', { name: '3D', exact: true }).click();
  await expect(
    page.getByRole('spinbutton', { name: 'X 座標', exact: true }),
  ).toHaveValue('7.3');
  await page.keyboard.press('Escape');
  await expect(
    page.getByRole('heading', { name: 'プランの概要', exact: true }),
  ).toBeVisible();
  await clickSofaIn3D(page, { x: 7.3, z: 5.3 });
  await expect(
    page.getByRole('heading', { name: '家具の詳細', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('spinbutton', { name: '回転角度', exact: true }),
  ).toHaveValue('90');
  await page.getByRole('tab', { name: '2D + 3D', exact: true }).click();
  await expect(sofa(page)).toHaveAttribute('aria-pressed', 'true');

  // 追加壁も2Dで作図し、高さ・厚さを変更できる。
  await page.getByRole('button', { name: '壁ツール', exact: true }).click();
  await dragFloor(page, { x: 3, z: 9 }, { x: 9, z: 9 });
  await expect(
    page.getByRole('heading', { name: '壁の詳細', exact: true }),
  ).toBeVisible();
  await setNumber(page, '壁の高さ', '3');
  await setNumber(page, '壁の厚さ', '0.2');
  await page.getByRole('switch').uncheck();
  await expect(page.getByRole('switch')).not.toBeChecked();

  await page
    .getByRole('textbox', { name: 'プロジェクト名' })
    .fill('家族の住まい');
  await page.getByRole('button', { name: /^保存/ }).click();
  await expect(
    page
      .getByRole('status')
      .filter({ hasText: 'このブラウザに間取りを保存しました。' }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole('textbox', { name: 'プロジェクト名' }),
  ).toHaveValue('家族の住まい');
  await expect(
    page.getByRole('button', { name: '家族のリビングを選択', exact: true }),
  ).toBeVisible();
  await expect(sofa(page)).toHaveCount(1);
  await expect(sofa(page)).toHaveAttribute(
    'transform',
    'translate(7.3 5.3) rotate(90)',
  );
  await sofa(page).press('Enter');
  await expect(
    page.getByRole('spinbutton', { name: 'X 座標', exact: true }),
  ).toHaveValue('7.3');
  await expect(
    page.getByRole('spinbutton', { name: 'Z 座標', exact: true }),
  ).toHaveValue('5.3');
  await expect(
    page.getByRole('spinbutton', { name: '回転角度', exact: true }),
  ).toHaveValue('90');
  await active3DCanvas(page);
});

test('部屋名の変更とドラッグ中断で家具を動かさず、家具の削除をUndo・Redoできる', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.locator('main')).toHaveAttribute('data-ready', 'true');
  const bed = page.getByRole('button', {
    name: 'ダブルベッドを選択',
    exact: true,
  });
  await expect(bed).toBeVisible();
  const originalBed = await bed.getAttribute('transform');

  // サンプルのベッドは10cm単位に揃わない座標を持つため、名前変更による誤った丸めも検出できる。
  await page
    .getByRole('button', { name: 'ベッドルームを選択', exact: true })
    .press('Enter');
  await page
    .getByRole('textbox', { name: '部屋の名前', exact: true })
    .fill('主寝室');
  await expect(
    page.getByRole('button', { name: '主寝室を選択', exact: true }),
  ).toBeVisible();
  await expect(bed).toHaveAttribute('transform', originalBed!);

  const originalSofa = await sofa(page).getAttribute('transform');
  const from = await screenPoint(page, { x: 5.2, z: 3.1 });
  const to = await screenPoint(page, { x: 6.2, z: 4.1 });
  // 入力欄のフォーカスを外してからドラッグし、Escapeをアプリの操作として処理させる。
  await page.getByRole('button', { name: '選択ツール', exact: true }).click();
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 8 });
  await expect(sofa(page)).not.toHaveAttribute('transform', originalSofa!);
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await expect(sofa(page)).toHaveAttribute('transform', originalSofa!);
  await expect(
    page.getByRole('heading', { name: 'プランの概要', exact: true }),
  ).toBeVisible();

  await sofa(page).press('Enter');
  await page
    .getByRole('button', { name: '選択した家具を削除', exact: true })
    .click();
  await expect(sofa(page)).toHaveCount(0);
  await page.getByRole('button', { name: '元に戻す', exact: true }).click();
  await expect(sofa(page)).toHaveAttribute('transform', originalSofa!);
  await page.getByRole('button', { name: 'やり直す', exact: true }).click();
  await expect(sofa(page)).toHaveCount(0);
});

test('モバイル幅でも横にはみ出さず、表示モードと家具カタログを操作できる', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.locator('main')).toHaveAttribute('data-ready', 'true');
  await expect(floorCanvas(page)).toBeVisible();
  await active3DCanvas(page);

  // カタログ内の横スクロールは許容しつつ、ページ全体に不要な横スクロールが出ないことを確認する。
  const expectNoPageOverflow = async () => {
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            document.documentElement.scrollWidth -
            document.documentElement.clientWidth,
        ),
      )
      .toBeLessThanOrEqual(1);
  };
  await expectNoPageOverflow();
  await page.getByRole('tab', { name: '間取り', exact: true }).click();
  await expect(floorCanvas(page)).toBeVisible();
  await expectNoPageOverflow();
  await page.getByRole('tab', { name: '3D', exact: true }).click();
  await active3DCanvas(page);
  await expectNoPageOverflow();
  await page
    .getByRole('button', { name: '3人掛けソファを配置', exact: true })
    .click();
  await expect(
    page.getByRole('tab', { name: '2D + 3D', exact: true }),
  ).toHaveAttribute('aria-selected', 'true');
  await expect(floorCanvas(page)).toBeVisible();
  await page
    .getByRole('button', { name: '配置をキャンセル', exact: true })
    .click();
  await expect(
    page.getByRole('button', { name: '3人掛けソファを配置', exact: true }),
  ).toHaveAttribute('aria-pressed', 'false');
  await expectNoPageOverflow();
});
