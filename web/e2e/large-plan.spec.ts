// 大きな敷地を通常のUI操作で編集し、表示変換・3D実描画・履歴・保存復元を一続きで検証する。
import {
  test as base,
  expect,
  type Locator,
  type Page,
} from '@playwright/test';
import { Matrix4, Vector3 } from 'three';
import type { PlanDocument } from '../app/lib/model';

const test = base.extend<{ runtimeErrors: void }>({
  runtimeErrors: [
    async ({ page }, use, testInfo) => {
      // WebGLのシェーダー失敗もconsole.errorへ出るため、未処理例外と両方を収集する。
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      page.on('console', (message) => {
        if (message.type() === 'error') errors.push(message.text());
      });
      await use();
      await testInfo.attach('large-plan-runtime-errors', {
        body: JSON.stringify(errors),
        contentType: 'application/json',
      });
      expect(
        errors,
        '大きな間取りの編集中にJavaScript例外・WebGL描画エラーがないこと',
      ).toEqual([]);
    },
    { auto: true },
  ],
});

type Point = { x: number; z: number };
const floor = (page: Page) =>
  page.getByRole('img', { name: /^間取り編集キャンバス/ });
const sofa = (page: Page) =>
  page.getByRole('button', { name: '3人掛けソファを選択', exact: true });
const button = (page: Page, name: string) =>
  page.getByRole('button', { name, exact: true });
const scene = (page: Page) =>
  page.getByRole('region', { name: '3Dプレビュー', exact: true });

async function screenPoint(page: Page, point: Point) {
  await floor(page).scrollIntoViewIfNeeded();
  // ズーム・パン・CSSの縦横比をすべて含むSVG行列を使い、固定ピクセル倍率には依存しない。
  return floor(page).evaluate((element, position) => {
    const matrix = (element as SVGSVGElement).getScreenCTM();
    if (!matrix) throw new Error('SVGの変換行列がありません。');
    const projected = new DOMPoint(position.x, position.z).matrixTransform(
      matrix,
    );
    return { x: projected.x, y: projected.y };
  }, point);
}

async function drag(page: Page, start: Point, end: Point, cancel = false) {
  const from = await screenPoint(page, start);
  const to = await screenPoint(page, end);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 10 });
  if (cancel) await page.keyboard.press('Escape');
  await page.mouse.up();
}

async function setNumber(page: Page, name: string, value: string) {
  const field = page.getByRole('spinbutton', { name, exact: true });
  await field.fill(value);
  await field.press('Enter');
  await expect(field).toHaveValue(value);
}

async function viewBox(page: Page) {
  return (await floor(page).getAttribute('viewBox'))!;
}

async function openEmpty(page: Page) {
  await page.goto('/');
  await expect(page.locator('main')).toHaveAttribute('data-ready', 'true');
  await button(page, '新規作成').click();
  await page
    .getByRole('alertdialog')
    .getByRole('button', { name: '空のプランを作成', exact: true })
    .click();
  await expect(floor(page).locator('[data-object]')).toHaveCount(0);
}

async function readyScene(page: Page) {
  await expect(scene(page).locator('[data-scene-state]')).toHaveAttribute(
    'data-scene-state',
    'ready',
  );
  const canvas = scene(page).locator('canvas');
  await expect(canvas).toBeVisible();
  await expect
    .poll(() =>
      canvas.evaluate((element) => {
        const gl = (element as HTMLCanvasElement).getContext('webgl2');
        return (
          !!gl &&
          !gl.isContextLost() &&
          gl.drawingBufferWidth > 0 &&
          gl.getError() === gl.NO_ERROR
        );
      }),
    )
    .toBe(true);
  return canvas;
}

async function project3D(canvas: Locator, position: Point) {
  // 実際にWebGLへ渡った行列を読み、カメラ実装の計算式を複製せず3Dメッシュをクリックする。
  const matrices = await canvas.evaluate(async (element) => {
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );
    const gl = (element as HTMLCanvasElement).getContext('webgl2');
    if (!gl || gl.isContextLost())
      throw new Error('WebGL描画が停止しています。');
    const program = gl.getParameter(gl.CURRENT_PROGRAM) as WebGLProgram | null;
    if (!program) throw new Error('描画済みシェーダーがありません。');
    const matrix = (name: string) => {
      const location = gl.getUniformLocation(program, name);
      if (!location) throw new Error(`${name}がありません。`);
      return Array.from(gl.getUniform(program, location) as Float32Array);
    };
    return {
      view: matrix('viewMatrix'),
      projection: matrix('projectionMatrix'),
    };
  });
  const projected = new Vector3(position.x, 0.6, position.z)
    .applyMatrix4(new Matrix4().fromArray(matrices.view))
    .applyMatrix4(new Matrix4().fromArray(matrices.projection));
  expect(
    Math.abs(projected.x),
    '旧範囲外の家具が3D画面内に収まること',
  ).toBeLessThan(1);
  expect(Math.abs(projected.y)).toBeLessThan(1);
  const box = await canvas.boundingBox();
  if (!box) throw new Error('3Dキャンバスの表示範囲がありません。');
  return {
    x: box.x + ((projected.x + 1) * box.width) / 2,
    y: box.y + ((1 - projected.y) * box.height) / 2,
  };
}

async function noPageOverflow(page: Page) {
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          document.documentElement.scrollWidth -
          document.documentElement.clientWidth,
      ),
    )
    .toBeLessThanOrEqual(1);
}

test('旧16×12mを超える部屋・壁・家具を編集し、表示を維持して3D選択と保存復元ができる', async ({
  page,
}, testInfo) => {
  test.setTimeout(150_000);
  await openEmpty(page);
  const initialWidth = (await viewBox(page)).split(' ').map(Number)[2];
  await button(page, '間取りを拡大').click();
  expect((await viewBox(page)).split(' ').map(Number)[2]).toBeLessThan(
    initialWidth,
  );
  await button(page, '間取りを縮小').click();
  expect((await viewBox(page)).split(' ').map(Number)[2]).toBeGreaterThan(
    initialWidth * 0.9,
  );
  await button(page, '敷地全体を表示').click();
  const wholeSite = await viewBox(page);
  expect(wholeSite.split(' ').map(Number)[2]).toBeGreaterThanOrEqual(40);
  expect(wholeSite.split(' ').map(Number)[3]).toBeGreaterThanOrEqual(30);
  await button(page, '部屋ツール').click();
  await expect(
    page.getByRole('tab', { name: '間取り', exact: true }),
  ).toHaveAttribute('aria-selected', 'true');
  await expect(scene(page)).toHaveCount(0);

  await drag(page, { x: 18, z: 14 }, { x: 34, z: 26 });
  await expect(
    page.getByRole('spinbutton', { name: '部屋の幅', exact: true }),
  ).toHaveValue('16');
  await expect(
    page.getByRole('spinbutton', { name: '部屋の奥行き', exact: true }),
  ).toHaveValue('12');
  await setNumber(page, '部屋の幅', '18');
  await setNumber(page, '部屋の奥行き', '14');
  await page
    .getByRole('textbox', { name: '部屋の名前', exact: true })
    .fill('大きな広間');
  await expect(floor(page)).toHaveAttribute('viewBox', wholeSite);
  await button(page, '壁ツール').click();
  await drag(page, { x: 19, z: 27 }, { x: 33, z: 27 });
  await expect(
    page.getByRole('heading', { name: '壁の詳細', exact: true }),
  ).toBeVisible();
  await setNumber(page, '壁の高さ', '3');
  await button(page, '3人掛けソファを配置').click();
  const placement = await screenPoint(page, { x: 24, z: 19 });
  await page.mouse.click(placement.x, placement.y);
  await expect(sofa(page)).toHaveAttribute(
    'transform',
    'translate(24 19) rotate(0)',
  );
  await drag(page, { x: 24, z: 19 }, { x: 26, z: 20 });
  await expect(sofa(page)).toHaveAttribute(
    'transform',
    'translate(26 20) rotate(0)',
  );

  // 家具のある場所から表示移動し、パンが家具のドラッグと混同されないことを確かめる。
  await button(page, '間取りを拡大').click();
  await button(page, '間取りの表示を移動').click();
  await expect(button(page, '間取りの表示を移動')).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  const beforePan = await viewBox(page);
  const panStart = await screenPoint(page, { x: 26, z: 20 });
  await page.mouse.move(panStart.x, panStart.y);
  await page.mouse.down();
  await page.mouse.move(panStart.x + 60, panStart.y + 25, { steps: 10 });
  await page.mouse.up();
  await expect(floor(page)).not.toHaveAttribute('viewBox', beforePan);
  await expect(sofa(page)).toHaveAttribute(
    'transform',
    'translate(26 20) rotate(0)',
  );
  const editedView = await viewBox(page);
  await button(page, '間取りの表示を移動').click();
  await sofa(page).press('Enter');
  await setNumber(page, '回転角度', '90');
  await expect(sofa(page)).toHaveAttribute(
    'transform',
    'translate(26 20) rotate(90)',
  );
  await expect(floor(page)).toHaveAttribute('viewBox', editedView);
  await button(page, '元に戻す').click();
  await expect(sofa(page)).toHaveAttribute(
    'transform',
    'translate(26 20) rotate(0)',
  );
  await expect(floor(page)).toHaveAttribute('viewBox', editedView);
  await button(page, 'やり直す').click();
  await expect(sofa(page)).toHaveAttribute(
    'transform',
    'translate(26 20) rotate(90)',
  );
  await expect(floor(page)).toHaveAttribute('viewBox', editedView);

  // 入力欄のUndoを全体履歴として扱わず、ドラッグ中断でも確定家具が動かないことを確認する。
  await sofa(page).press('Enter');
  const coordinate = page.getByRole('spinbutton', {
    name: 'X 座標',
    exact: true,
  });
  await coordinate.focus();
  await coordinate.press('ControlOrMeta+z');
  await expect(sofa(page)).toHaveAttribute(
    'transform',
    'translate(26 20) rotate(90)',
  );
  await button(page, '選択ツール').click();
  await drag(page, { x: 26, z: 20 }, { x: 27, z: 21 }, true);
  await expect(sofa(page)).toHaveAttribute(
    'transform',
    'translate(26 20) rotate(90)',
  );
  await expect(floor(page)).toHaveAttribute('viewBox', editedView);

  await page.getByRole('tab', { name: '3D', exact: true }).click();
  const canvas = await readyScene(page);
  const target = await project3D(canvas, { x: 26, z: 20 });
  await page.mouse.click(target.x, target.y);
  await expect(
    page.getByRole('heading', { name: '家具の詳細', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('spinbutton', { name: '回転角度', exact: true }),
  ).toHaveValue('90');
  await testInfo.attach('large-plan-3d', {
    body: await scene(page).screenshot({
      path: testInfo.outputPath('large-plan-3d.png'),
    }),
    contentType: 'image/png',
  });
  await page.getByRole('tab', { name: '2D + 3D', exact: true }).click();
  await expect(floor(page)).toHaveAttribute('viewBox', editedView);
  await expect(sofa(page)).toHaveAttribute('aria-pressed', 'true');
  await readyScene(page);
  await testInfo.attach('large-plan-desktop', {
    body: await page.screenshot({
      fullPage: true,
      path: testInfo.outputPath('large-plan-desktop.png'),
    }),
    contentType: 'image/png',
  });

  await page.setViewportSize({ width: 390, height: 844 });
  await noPageOverflow(page);
  await expect(floor(page)).toHaveAttribute('viewBox', editedView);
  await readyScene(page);
  await testInfo.attach('large-plan-mobile', {
    body: await page.screenshot({
      fullPage: true,
      path: testInfo.outputPath('large-plan-mobile.png'),
    }),
    contentType: 'image/png',
  });
  // モバイルではヘッダーの名前欄を省略するため、通常幅に戻して名前を編集・保存する。
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page
    .getByRole('textbox', { name: 'プロジェクト名', exact: true })
    .fill('広い敷地の住まい');
  await page.getByRole('button', { name: /^保存/ }).click();
  const saved = await page.evaluate(
    () =>
      JSON.parse(localStorage.getItem('housemaker.plan.v1')!) as PlanDocument,
  );
  expect(saved.rooms[0]).toMatchObject({ x: 18, z: 14, width: 18, depth: 14 });
  expect(saved.walls[0]).toMatchObject({
    x1: 19,
    z1: 27,
    x2: 33,
    z2: 27,
    height: 3,
  });
  expect(saved.furniture[0]).toMatchObject({ x: 26, z: 20, rotation: 90 });
  await testInfo.attach('large-plan-saved-document', {
    body: JSON.stringify(saved, null, 2),
    contentType: 'application/json',
  });
  await page.reload();
  await expect(
    page.getByRole('textbox', { name: 'プロジェクト名', exact: true }),
  ).toHaveValue('広い敷地の住まい');
  await expect(sofa(page)).toHaveAttribute(
    'transform',
    'translate(26 20) rotate(90)',
  );
  await expect(button(page, '大きな広間を選択')).toBeVisible();
  const restoredBox = (await viewBox(page)).split(' ').map(Number);
  expect(restoredBox[0] + restoredBox[2]).toBeGreaterThanOrEqual(36);
  expect(restoredBox[1] + restoredBox[3]).toBeGreaterThanOrEqual(28);
  await noPageOverflow(page);
  await readyScene(page);
});

test('拡大表示とキーボードパン・パン終了・表示切替は文書を変更しない', async ({
  page,
}, testInfo) => {
  await openEmpty(page);
  const original = await viewBox(page);
  await button(page, '間取りを拡大').click();
  await expect(floor(page)).not.toHaveAttribute('viewBox', original);
  const zoomed = await viewBox(page);
  expect(zoomed.split(' ').map(Number)[2]).toBeLessThan(
    original.split(' ').map(Number)[2],
  );
  await button(page, '間取りの表示を移動').click();
  await floor(page).focus();
  await floor(page).press('Shift+ArrowRight');
  await expect(floor(page)).not.toHaveAttribute('viewBox', zoomed);
  const panned = await viewBox(page);
  expect(
    panned.split(' ').map(Number)[0] - zoomed.split(' ').map(Number)[0],
  ).toBeCloseTo(5);
  // Escapeは現在の表示位置を保ってパンモードを終了し、文書の編集履歴には追加しない。
  await floor(page).press('Escape');
  await expect(button(page, '間取りの表示を移動')).toHaveAttribute(
    'aria-pressed',
    'false',
  );
  await expect(floor(page)).toHaveAttribute('viewBox', panned);
  await expect(floor(page).locator('[data-object]')).toHaveCount(0);
  // 表示操作はUndo履歴に入らず、1回で空プラン作成前のサンプルへ戻る。
  await button(page, '元に戻す').click();
  await expect(sofa(page)).toHaveCount(1);
  await button(page, 'やり直す').click();
  await expect(floor(page).locator('[data-object]')).toHaveCount(0);
  await page.getByRole('tab', { name: '3D', exact: true }).click();
  await readyScene(page);
  await page.getByRole('tab', { name: '間取り', exact: true }).click();
  await expect(floor(page)).toHaveAttribute('viewBox', panned);
  await page.setViewportSize({ width: 1000, height: 1400 });
  await expect(floor(page)).toHaveAttribute('viewBox', panned);
  await noPageOverflow(page);
  await testInfo.attach('large-plan-navigation', {
    body: await page.screenshot({
      fullPage: true,
      path: testInfo.outputPath('large-plan-navigation.png'),
    }),
    contentType: 'image/png',
  });
});

test('横長画面の図面余白からは作図できず、表示範囲内では部屋を作れる', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 633 });
  await openEmpty(page);
  await button(page, '部屋ツール').click();
  const unused = await floor(page).evaluate((element) => {
    const svg = element as SVGSVGElement;
    const rect = svg.getBoundingClientRect();
    const matrix = svg.getScreenCTM();
    if (!matrix) throw new Error('余白検証用の変換行列がありません。');
    const x = rect.right - 3;
    const y = rect.top + rect.height / 2;
    const world = new DOMPoint(x, y).matrixTransform(matrix.inverse());
    return {
      x,
      y,
      worldX: world.x,
      viewRight: svg.viewBox.baseVal.x + svg.viewBox.baseVal.width,
    };
  });
  expect(
    unused.worldX,
    '横長のSVG右端が図面の表示範囲外であること',
  ).toBeGreaterThan(unused.viewRight);
  const inside = await screenPoint(page, { x: 14, z: 9 });
  await page.mouse.move(unused.x, unused.y);
  await page.mouse.down();
  await page.mouse.move(inside.x, inside.y, { steps: 10 });
  await page.mouse.up();
  await expect(floor(page).locator('[data-object]')).toHaveCount(0);
  await drag(page, { x: 2, z: 2 }, { x: 10, z: 8 });
  await expect(
    page.getByRole('spinbutton', { name: '部屋の幅', exact: true }),
  ).toHaveValue('8');
  await expect(
    page.getByRole('spinbutton', { name: '部屋の奥行き', exact: true }),
  ).toHaveValue('6');
  await testInfo.attach('large-plan-wide-letterbox', {
    body: await page.screenshot({
      fullPage: true,
      path: testInfo.outputPath('large-plan-wide-letterbox.png'),
    }),
    contentType: 'image/png',
  });
});
