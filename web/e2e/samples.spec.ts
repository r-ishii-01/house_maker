// サンプルの下見・確定・再編集を利用者のUI操作で通し、履歴・保存・3D描画への反映を検証する。
import {
  test as base,
  expect,
  type Locator,
  type Page,
} from '@playwright/test';
import { Matrix4, Vector3 } from 'three';
import type { PlanDocument } from '../app/lib/model';
import { createSamplePlan, type SamplePlanId } from '../app/lib/samples';

const examples: { id: SamplePlanId; name: string }[] = [
  { id: 'airy-home', name: '光がつながる家' },
  { id: 'compact-studio', name: 'ひとり暮らしのワンルーム' },
  { id: 'cozy-1ldk', name: 'ふたり暮らしの1LDK' },
  { id: 'family-2ldk', name: '暮らしやすい2LDK' },
  { id: 'family-3ldk', name: '家族で暮らす3LDK' },
  { id: 'courtyard-house', name: '庭にひらくL字の家' },
];

// 未処理例外と描画失敗を独立に収集し、操作成功だけでWebGL成功とみなさない。
const test = base.extend<{ runtimeErrors: void }>({
  runtimeErrors: [
    async ({ page }, use, testInfo) => {
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      page.on('console', (message) => {
        if (message.type() === 'error') errors.push(message.text());
      });
      await use();
      await testInfo.attach('sample-runtime-errors', {
        body: JSON.stringify(errors),
        contentType: 'application/json',
      });
      expect(errors, 'サンプル操作中のページ例外・描画エラー').toEqual([]);
    },
    { auto: true },
  ],
});

const button = (page: Page, name: string) =>
  page.getByRole('button', { name, exact: true });
const gallery = (page: Page) =>
  page.getByRole('dialog', { name: 'サンプル間取りを選ぶ', exact: true });
const floor = (page: Page) =>
  page.getByRole('img', { name: /^間取り編集キャンバス/ });
const projectName = (page: Page) =>
  page.getByRole('textbox', { name: 'プロジェクト名', exact: true });
const stored = (page: Page) =>
  page.evaluate(() => localStorage.getItem('housemaker.plan.v1'));

async function openEditor(page: Page) {
  await page.goto('/');
  await expect(page.locator('main')).toHaveAttribute('data-ready', 'true');
  await page.getByRole('tab', { name: '間取り', exact: true }).click();
}

async function loadSample(page: Page, name: string) {
  await button(page, 'サンプル間取りを選ぶ').click();
  await chooseDraft(page, name);
  await gallery(page)
    .getByRole('button', { name: 'この間取りを使う', exact: true })
    .click();
  await expect(gallery(page)).toBeHidden();
  await expect(projectName(page)).toHaveValue(name);
}

async function chooseDraft(page: Page, name: string) {
  // radio自体は視覚的に隠されているため、実際のクリック対象であるラベル全体を操作する。
  const radio = gallery(page).getByRole('radio', { name, exact: true });
  await gallery(page)
    .locator('label')
    .filter({ has: page.getByRole('radio', { name, exact: true }) })
    .click();
  await expect(radio).toBeChecked();
}

async function save(page: Page): Promise<PlanDocument> {
  await page.getByRole('button', { name: /^保存/ }).click();
  const raw = await stored(page);
  if (!raw) throw new Error('保存ボタンで文書が保存されませんでした。');
  return JSON.parse(raw) as PlanDocument;
}

// 選択装飾など一時的なDOM差を除き、ID・寸法・座標を含む図形の実データを読み取る。
async function drawing(page: Page) {
  return floor(page)
    .locator('[data-object]')
    .evaluateAll((elements) =>
      elements.map((element) => ({
        id: element.getAttribute('data-object'),
        label: element.getAttribute('aria-label'),
        transform: element.getAttribute('transform'),
        geometry: Array.from(element.querySelectorAll('rect,line,path')).map(
          (shape) =>
            ['x', 'y', 'width', 'height', 'x1', 'x2', 'y1', 'y2', 'd'].map(
              (name) => shape.getAttribute(name),
            ),
        ),
      })),
    );
}

// SVGの実行時変換行列でm単位の位置をクリック位置へ変換し、ズームや画面幅に追従する。
async function screenPoint(page: Page, point: { x: number; z: number }) {
  await floor(page).scrollIntoViewIfNeeded();
  return floor(page).evaluate((element, position) => {
    const matrix = (element as SVGSVGElement).getScreenCTM();
    if (!matrix) throw new Error('間取りの座標変換行列がありません。');
    const result = new DOMPoint(position.x, position.z).matrixTransform(matrix);
    return { x: result.x, y: result.y };
  }, point);
}

async function drag(
  page: Page,
  from: { x: number; z: number },
  to: { x: number; z: number },
  cancel = false,
) {
  const start = await screenPoint(page, from);
  const end = await screenPoint(page, to);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 10 });
  if (cancel) await page.keyboard.press('Escape');
  await page.mouse.up();
}

async function number(page: Page, name: string, value: string) {
  const field = page.getByRole('spinbutton', { name, exact: true });
  await field.fill(value);
  await field.press('Enter');
  await expect(field).toHaveValue(value);
}

async function readyScene(page: Page) {
  const region = page.getByRole('region', {
    name: '3Dプレビュー',
    exact: true,
  });
  await expect(region.locator('[data-scene-state]')).toHaveAttribute(
    'data-scene-state',
    'ready',
  );
  const canvas = region.locator('canvas');
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

async function clickFurniture3D(
  page: Page,
  canvas: Locator,
  point: { x: number; z: number },
) {
  // カメラ計算を再実装せず、実際のシェーダー行列から投影した家具をクリックする。
  const matrices = await canvas.evaluate(async (element) => {
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );
    const gl = (element as HTMLCanvasElement).getContext('webgl2');
    if (!gl || gl.isContextLost())
      throw new Error('WebGL描画が停止しています。');
    const program = gl.getParameter(gl.CURRENT_PROGRAM) as WebGLProgram | null;
    if (!program) throw new Error('描画済みシェーダーがありません。');
    const read = (name: string) => {
      const location = gl.getUniformLocation(program, name);
      if (!location) throw new Error(`${name}がありません。`);
      return Array.from(gl.getUniform(program, location) as Float32Array);
    };
    return { view: read('viewMatrix'), projection: read('projectionMatrix') };
  });
  const projected = new Vector3(point.x, 0.6, point.z)
    .applyMatrix4(new Matrix4().fromArray(matrices.view))
    .applyMatrix4(new Matrix4().fromArray(matrices.projection));
  expect(Math.abs(projected.x)).toBeLessThan(1);
  expect(Math.abs(projected.y)).toBeLessThan(1);
  const box = await canvas.boundingBox();
  if (!box) throw new Error('3Dの表示範囲がありません。');
  await page.mouse.click(
    box.x + ((projected.x + 1) * box.width) / 2,
    box.y + ((1 - projected.y) * box.height) / 2,
  );
}

test('全サンプルを下見してキャンセル・Escapeで閉じても編集中の文書と保存は変わらない', async ({
  page,
}, testInfo) => {
  await openEditor(page);
  await projectName(page).fill('編集中の住まい');
  await save(page);
  await floor(page)
    .getByRole('button', { name: '3人掛けソファを選択', exact: true })
    .press('Enter');
  const before = await drawing(page);
  const savedBefore = await stored(page);
  await button(page, 'サンプル間取りを選ぶ').click();
  await expect(gallery(page).getByRole('radio')).toHaveCount(6);
  for (const { name } of examples) {
    const radio = gallery(page).getByRole('radio', { name, exact: true });
    await chooseDraft(page, name);
    await expect(radio).toBeChecked();
  }
  // モーダル内の操作が背後の履歴や削除に流れないことも、実文書の変化で判断する。
  expect(
    await gallery(page).evaluate((element) =>
      element.contains(document.activeElement),
    ),
  ).toBe(true);
  await page.keyboard.press('ControlOrMeta+z');
  await expect(page.locator('input[aria-label="プロジェクト名"]')).toHaveValue(
    '編集中の住まい',
  );
  await page.keyboard.press('Delete');
  await testInfo.attach('sample-gallery-desktop', {
    body: await page.screenshot({
      path: testInfo.outputPath('sample-gallery-desktop.png'),
      fullPage: true,
    }),
    contentType: 'image/png',
  });
  await gallery(page)
    .getByRole('button', { name: 'キャンセル', exact: true })
    .click();
  await expect(projectName(page)).toHaveValue('編集中の住まい');
  expect(await drawing(page)).toEqual(before);
  expect(await stored(page)).toBe(savedBefore);
  await button(page, 'サンプル間取りを選ぶ').click();
  await chooseDraft(page, examples[1].name);
  await page.keyboard.press('Escape');
  await expect(gallery(page)).toBeHidden();
  await expect(button(page, 'サンプル間取りを選ぶ')).toBeFocused();
  expect(await drawing(page)).toEqual(before);
  expect(await stored(page)).toBe(savedBefore);
  await button(page, '元に戻す').click();
  await expect(projectName(page)).toHaveValue('光がつながる家');
});

test('6種類を確定して読み込み、別サンプルへの切替を1回のUndo・Redoで戻せる', async ({
  page,
}, testInfo) => {
  await openEditor(page);
  for (const { id, name } of examples) {
    const savedBefore = await stored(page);
    await loadSample(page, name);
    expect(await stored(page), '読込だけでは前回の保存を上書きしない').toBe(
      savedBefore,
    );
    const expected = createSamplePlan(id);
    await expect(floor(page).locator('[data-object]')).toHaveCount(
      expected.rooms.length +
        expected.furniture.length +
        expected.walls.length +
        expected.doors.length,
    );
    // 単体検証済みのfactory文書と保存ボタンが書き出す実文書を照合し、カードIDの取り違えを検出する。
    expect(await save(page)).toEqual(expected);
  }
  await button(page, '元に戻す').click();
  await expect(projectName(page)).toHaveValue('家族で暮らす3LDK');
  expect(await save(page)).toEqual(createSamplePlan('family-3ldk'));
  await button(page, 'やり直す').click();
  await expect(projectName(page)).toHaveValue('庭にひらくL字の家');
  expect(await save(page)).toEqual(createSamplePlan('courtyard-house'));
  await testInfo.attach('sample-courtyard-loaded', {
    body: await page.screenshot({
      path: testInfo.outputPath('sample-courtyard-loaded.png'),
      fullPage: true,
    }),
    contentType: 'image/png',
  });
});

test('読み込んだサンプルへ部屋・壁・家具を追加し、移動回転・3D・保存再読込が連動する', async ({
  page,
}, testInfo) => {
  await openEditor(page);
  await loadSample(page, 'ひとり暮らしのワンルーム');
  await button(page, '敷地全体を表示').click();
  await button(page, '部屋ツール').click();
  await drag(page, { x: 20, z: 15 }, { x: 26, z: 21 });
  await number(page, '部屋の幅', '7');
  await page
    .getByRole('textbox', { name: '部屋の名前', exact: true })
    .fill('追加した部屋');
  await button(page, '壁ツール').click();
  await drag(page, { x: 22, z: 23 }, { x: 29, z: 23 });
  await expect(
    page.getByRole('heading', { name: '壁の詳細', exact: true }),
  ).toBeVisible();
  await button(page, '3人掛けソファを配置').click();
  const position = await screenPoint(page, { x: 23, z: 18 });
  await page.mouse.click(position.x, position.y);
  const sofa = floor(page)
    .getByRole('button', { name: '3人掛けソファを選択', exact: true })
    .last();
  await drag(page, { x: 23, z: 18 }, { x: 24, z: 18 });
  await number(page, '回転角度', '90');
  await expect(sofa).toHaveAttribute(
    'transform',
    'translate(24 18) rotate(90)',
  );
  await button(page, '元に戻す').click();
  await expect(sofa).toHaveAttribute('transform', 'translate(24 18) rotate(0)');
  await button(page, 'やり直す').click();
  await expect(sofa).toHaveAttribute(
    'transform',
    'translate(24 18) rotate(90)',
  );
  await sofa.press('Enter');
  await page
    .getByRole('spinbutton', { name: 'X 座標', exact: true })
    .press('ControlOrMeta+z');
  await expect(sofa).toHaveAttribute(
    'transform',
    'translate(24 18) rotate(90)',
  );
  await button(page, '選択ツール').click();
  await drag(page, { x: 24, z: 18 }, { x: 25, z: 19 }, true);
  await expect(sofa).toHaveAttribute(
    'transform',
    'translate(24 18) rotate(90)',
  );
  await button(page, '追加した部屋を選択').press('Enter');
  await page.getByRole('tab', { name: '3D', exact: true }).click();
  const canvas = await readyScene(page);
  await clickFurniture3D(page, canvas, { x: 24, z: 18 });
  await expect(
    page.getByRole('heading', { name: '家具の詳細', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('spinbutton', { name: '回転角度', exact: true }),
  ).toHaveValue('90');
  await testInfo.attach('sample-edited-3d', {
    body: await canvas.screenshot({
      path: testInfo.outputPath('sample-edited-3d.png'),
    }),
    contentType: 'image/png',
  });
  await page.getByRole('tab', { name: '2D + 3D', exact: true }).click();
  await projectName(page).fill('サンプルから編集した家');
  const saved = await save(page);
  expect(saved.rooms.at(-1)).toMatchObject({
    name: '追加した部屋',
    width: 7,
    depth: 6,
  });
  expect(saved.walls.at(-1)).toMatchObject({ x1: 22, z1: 23, x2: 29, z2: 23 });
  expect(saved.furniture.at(-1)).toMatchObject({ x: 24, z: 18, rotation: 90 });
  await testInfo.attach('sample-edited-document', {
    body: JSON.stringify(saved, null, 2),
    contentType: 'application/json',
  });
  await page.reload();
  await expect(projectName(page)).toHaveValue('サンプルから編集した家');
  await expect(sofa).toHaveAttribute(
    'transform',
    'translate(24 18) rotate(90)',
  );
  expect(JSON.parse((await stored(page))!)).toEqual(saved);
  await readyScene(page);
});

test('390px幅でもギャラリーを画面内でスクロールし、キーボードだけで選択・確定できる', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openEditor(page);
  await button(page, 'サンプル間取りを選ぶ').click();
  const bounds = await gallery(page).boundingBox();
  expect(bounds).not.toBeNull();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(391);
  expect(bounds!.y).toBeGreaterThanOrEqual(0);
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(845);
  await gallery(page)
    .getByRole('radio', { name: examples[0].name, exact: true })
    .focus();
  for (let index = 0; index < 5; index++)
    await page.keyboard.press('ArrowDown');
  const last = gallery(page).getByRole('radio', {
    name: '庭にひらくL字の家',
    exact: true,
  });
  await expect(last).toBeChecked();
  await expect(last).toBeFocused();
  await last.scrollIntoViewIfNeeded();
  await testInfo.attach('sample-gallery-mobile', {
    body: await page.screenshot({
      path: testInfo.outputPath('sample-gallery-mobile.png'),
      fullPage: false,
    }),
    contentType: 'image/png',
  });
  // Tabを繰り返しても背景へフォーカスが漏れず、確定ボタンへ到達できることを確認する。
  const apply = gallery(page).getByRole('button', {
    name: 'この間取りを使う',
    exact: true,
  });
  for (let index = 0; index < 10; index++) {
    if (await apply.evaluate((element) => element === document.activeElement))
      break;
    await page.keyboard.press('Tab');
    expect(
      await gallery(page).evaluate((element) =>
        element.contains(document.activeElement),
      ),
    ).toBe(true);
  }
  await expect(apply).toBeFocused();
  await page.keyboard.press('Tab');
  // Base UIは末尾のfocus guardから次フレームで選択radioへ戻すため、遷移完了を待って確認する。
  await expect(last).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(apply).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(gallery(page)).toBeHidden();
  expect(await save(page)).toEqual(createSamplePlan('courtyard-house'));
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  ).toBe(true);
  await page.setViewportSize({ width: 1600, height: 1000 });
  await expect(projectName(page)).toHaveValue('庭にひらくL字の家');
  await page.getByRole('tab', { name: '2D + 3D', exact: true }).click();
  await readyScene(page);
});
