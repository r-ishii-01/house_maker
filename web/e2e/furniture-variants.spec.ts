// 家具12種の追加がカタログ・2D編集・3D描画・端末保存まで到達することを実際のUI操作で検証する。
import {
  test as base,
  expect,
  type Locator,
  type Page,
} from '@playwright/test';
import { Matrix4, Vector3 } from 'three';
import {
  createInitialPlan,
  type FurnitureKind,
  type PlanDocument,
} from '../app/lib/model';

// カタログ定義を期待値へ流用せず、名前と保存kindの対応を独立に列挙してカードの取り違えを検出する。
const variants: { kind: FurnitureKind; name: string }[] = [
  { kind: 'loveseat', name: '2人掛けソファ' },
  { kind: 'ottoman', name: 'オットマン' },
  { kind: 'side-table', name: 'サイドテーブル' },
  { kind: 'round-dining-table', name: 'ラウンドダイニングテーブル' },
  { kind: 'stool', name: 'スツール' },
  { kind: 'single-bed', name: 'シングルベッド' },
  { kind: 'nightstand', name: 'ナイトテーブル' },
  { kind: 'wardrobe', name: 'ワードローブ' },
  { kind: 'dresser', name: 'チェスト' },
  { kind: 'office-chair', name: 'オフィスチェア' },
  { kind: 'floor-lamp', name: 'フロアライト' },
  { kind: 'kitchen-island', name: 'キッチンアイランド' },
];
const categories: Record<string, string[]> = {
  リビング: [
    '3人掛けソファ',
    'ラウンジチェア',
    'ローテーブル',
    'テレビボード',
    'インドアグリーン',
    '2人掛けソファ',
    'オットマン',
    'サイドテーブル',
    'フロアライト',
  ],
  ダイニング: [
    'ダイニングテーブル',
    'ダイニングチェア',
    'ラウンドダイニングテーブル',
    'スツール',
  ],
  ベッドルーム: ['ダブルベッド', 'シングルベッド', 'ナイトテーブル'],
  ワークスペース: ['ワークデスク', 'オープンシェルフ', 'オフィスチェア'],
  収納: ['ワードローブ', 'チェスト'],
  キッチン: ['キッチンアイランド'],
};

const test = base.extend<{ runtimeErrors: void }>({
  runtimeErrors: [
    async ({ page }, use, testInfo) => {
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      page.on('console', (message) => {
        if (message.type() === 'error') errors.push(message.text());
      });
      await use();
      await testInfo.attach('furniture-runtime-errors', {
        body: JSON.stringify(errors),
        contentType: 'application/json',
      });
      expect(
        errors,
        '追加家具の描画や編集で例外・WebGLエラーがないこと',
      ).toEqual([]);
    },
    { auto: true },
  ],
});

const button = (page: Page, name: string) =>
  page.getByRole('button', { name, exact: true });
const catalog = (page: Page) =>
  page.getByRole('complementary', { name: '家具カタログ', exact: true });
const floor = (page: Page) =>
  page.getByRole('img', { name: /^間取り編集キャンバス/ });
const placed = (page: Page, name: string) =>
  floor(page).getByRole('button', { name: `${name}を選択`, exact: true });
const field = (page: Page, name: string) =>
  page.getByRole('spinbutton', { name, exact: true });
type Point = { x: number; z: number };

async function openEditor(page: Page, emptyRoom = true) {
  if (emptyRoom) {
    // 初期条件は空の部屋だけにし、追加家具をストアへ注入してカタログや配置処理を飛ばさない。
    // リロード時に編集済み保存を上書きしないよう、同じタブでは一度だけfixtureを設定する。
    const plan: PlanDocument = {
      name: '家具の検証室',
      rooms: [
        {
          id: 'test-room',
          name: '家具の検証室',
          x: 1,
          z: 1,
          width: 14,
          depth: 11,
          color: '#eee6d8',
        },
      ],
      walls: [],
      doors: [],
      furniture: [],
    };
    await page.addInitScript((initial) => {
      if (sessionStorage.getItem('furniture-variants-initialized')) return;
      localStorage.setItem('housemaker.plan.v1', JSON.stringify(initial));
      sessionStorage.setItem('furniture-variants-initialized', 'true');
    }, plan);
  }
  await page.goto('/');
  await expect(page.locator('main')).toHaveAttribute('data-ready', 'true');
  await page.getByRole('tab', { name: '間取り', exact: true }).click();
}

async function catalogNames(page: Page) {
  return catalog(page)
    .getByRole('button', { name: /を配置$/ })
    .evaluateAll((elements) =>
      elements
        .map((element) =>
          element.getAttribute('aria-label')!.replace(/を配置$/, ''),
        )
        .sort(),
    );
}

async function screenPoint(page: Page, point: Point) {
  // 床のX/Z(m)をSVGのX/Yへ対応させ、縮尺・分割画面・モバイルの表示変換を含めて操作する。
  await floor(page).scrollIntoViewIfNeeded();
  return floor(page).evaluate((element, position) => {
    const matrix = (element as SVGSVGElement).getScreenCTM();
    if (!matrix) throw new Error('2Dの座標変換行列がありません。');
    const result = new DOMPoint(position.x, position.z).matrixTransform(matrix);
    return { x: result.x, y: result.y };
  }, point);
}

async function place(page: Page, name: string, point: Point) {
  await catalog(page)
    .getByRole('button', { name: `${name}を配置`, exact: true })
    .click();
  const position = await screenPoint(page, point);
  await page.mouse.click(position.x, position.y);
  await expect(placed(page, name)).toHaveAttribute(
    'transform',
    `translate(${point.x} ${point.z}) rotate(0)`,
  );
}

async function drag(page: Page, from: Point, to: Point, cancel = false) {
  const start = await screenPoint(page, from);
  const end = await screenPoint(page, to);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 10 });
  if (cancel) await page.keyboard.press('Escape');
  await page.mouse.up();
}

async function setNumber(page: Page, name: string, value: string) {
  await field(page, name).fill(value);
  await field(page, name).press('Enter');
  await expect(field(page, name)).toHaveValue(value);
}

async function save(page: Page): Promise<PlanDocument> {
  await page.getByRole('button', { name: /^保存/ }).click();
  return page.evaluate(() => {
    const raw = localStorage.getItem('housemaker.plan.v1');
    if (!raw) throw new Error('家具を含む文書が保存されていません。');
    return JSON.parse(raw) as PlanDocument;
  });
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

async function clickInScene(
  page: Page,
  canvas: Locator,
  point: Point & { y: number },
) {
  // 実際のGPUシェーダー行列を使って立体の中心をクリックし、2Dだけの状態変更では成功しない検証にする。
  const matrices = await canvas.evaluate(async (element) => {
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );
    const gl = (element as HTMLCanvasElement).getContext('webgl2');
    if (!gl || gl.isContextLost()) throw new Error('3D描画が停止しています。');
    const program = gl.getParameter(gl.CURRENT_PROGRAM) as WebGLProgram | null;
    if (!program) throw new Error('描画済みシェーダーがありません。');
    const read = (name: string) => {
      const location = gl.getUniformLocation(program, name);
      if (!location) throw new Error(`${name}がありません。`);
      return Array.from(gl.getUniform(program, location) as Float32Array);
    };
    return { view: read('viewMatrix'), projection: read('projectionMatrix') };
  });
  const projected = new Vector3(point.x, point.y, point.z)
    .applyMatrix4(new Matrix4().fromArray(matrices.view))
    .applyMatrix4(new Matrix4().fromArray(matrices.projection));
  expect(Math.abs(projected.x)).toBeLessThan(1);
  expect(Math.abs(projected.y)).toBeLessThan(1);
  const box = await canvas.boundingBox();
  if (!box) throw new Error('3Dキャンバスの表示範囲がありません。');
  await page.mouse.click(
    box.x + ((projected.x + 1) * box.width) / 2,
    box.y + ((1 - projected.y) * box.height) / 2,
  );
}

test('22種すべてがカテゴリーから選べ、従来の初期間取りと家具は変わらない', async ({
  page,
}, testInfo) => {
  await openEditor(page, false);
  await expect(
    catalog(page).getByRole('button', { name: /を配置$/ }),
  ).toHaveCount(22);
  await expect(catalog(page).locator('.count-pill')).toHaveText('22');
  const expected = Object.values(categories).flat().sort();
  expect(await catalogNames(page)).toEqual(expected);
  for (const [category, names] of Object.entries(categories)) {
    await catalog(page)
      .getByRole('tab', { name: category, exact: true })
      .click();
    expect(await catalogNames(page)).toEqual([...names].sort());
  }
  await catalog(page).getByRole('tab', { name: 'すべて', exact: true }).click();
  expect(await catalogNames(page)).toEqual(expected);
  expect(await save(page)).toEqual(createInitialPlan());
  await testInfo.attach('furniture-catalog-desktop', {
    body: await catalog(page).screenshot({
      path: testInfo.outputPath('furniture-catalog-desktop.png'),
    }),
    contentType: 'image/png',
  });
});

test('新12種をカタログから配置し、色と回転を保存再読込して全種類を3D表示する', async ({
  page,
}, testInfo) => {
  await openEditor(page);
  const expected = variants.map((item, index) => ({
    ...item,
    x: 3 + (index % 4) * 3,
    z: 3 + Math.floor(index / 4) * 3,
    rotation: (index % 4) * 90,
    color: index % 2 ? '#bd8c62' : '#b9c4d4',
  }));
  for (const item of expected) {
    await place(page, item.name, item);
    await setNumber(page, '回転角度', String(item.rotation));
    await button(page, `家具の色 ${item.color}`).click();
    await expect(placed(page, item.name)).toHaveAttribute(
      'transform',
      `translate(${item.x} ${item.z}) rotate(${item.rotation})`,
    );
  }
  const saved = await save(page);
  expect(saved.furniture).toHaveLength(12);
  expect(new Set(saved.furniture.map((item) => item.id)).size).toBe(12);
  expect(saved.furniture).toMatchObject(
    expected.map(({ name: _name, ...item }) => item),
  );
  await testInfo.attach('furniture-all-saved', {
    body: JSON.stringify(saved, null, 2),
    contentType: 'application/json',
  });
  await page.reload();
  await expect(page.locator('main')).toHaveAttribute('data-ready', 'true');
  for (const item of expected) {
    await expect(placed(page, item.name)).toHaveAttribute(
      'transform',
      `translate(${item.x} ${item.z}) rotate(${item.rotation})`,
    );
    await placed(page, item.name).press('Enter');
    await expect(button(page, `家具の色 ${item.color}`)).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  }
  await page.getByRole('tab', { name: '3D', exact: true }).click();
  const canvas = await readyScene(page);
  // 全種類の立体を残し、ソファ・丸机・照明・収納・キッチンを目視でも識別できる証跡にする。
  await testInfo.attach('furniture-all-3d', {
    body: await canvas.screenshot({
      path: testInfo.outputPath('furniture-all-3d.png'),
    }),
    contentType: 'image/png',
  });
});

test('追加家具の移動・回転・削除をUndo/Redoし、立体をクリックして同じ家具を選択できる', async ({
  page,
}, testInfo) => {
  await openEditor(page);
  await place(page, '2人掛けソファ', { x: 4, z: 6 });
  await drag(page, { x: 4, z: 6 }, { x: 5, z: 7 });
  const sofa = placed(page, '2人掛けソファ');
  await expect(sofa).toHaveAttribute('transform', 'translate(5 7) rotate(0)');
  await button(page, '元に戻す').click();
  await expect(sofa).toHaveAttribute('transform', 'translate(4 6) rotate(0)');
  await button(page, 'やり直す').click();
  await expect(sofa).toHaveAttribute('transform', 'translate(5 7) rotate(0)');
  await sofa.press('Enter');
  await button(page, '90度回転').click();
  await expect(sofa).toHaveAttribute('transform', 'translate(5 7) rotate(90)');
  await button(page, '元に戻す').click();
  await expect(sofa).toHaveAttribute('transform', 'translate(5 7) rotate(0)');
  await button(page, 'やり直す').click();
  await expect(sofa).toHaveAttribute('transform', 'translate(5 7) rotate(90)');
  await drag(page, { x: 5, z: 7 }, { x: 6, z: 8 }, true);
  await expect(sofa).toHaveAttribute('transform', 'translate(5 7) rotate(90)');
  await sofa.press('Enter');
  await sofa.press('Delete');
  await expect(sofa).toHaveCount(0);
  await expect(
    page.getByRole('heading', { name: '家具の詳細', exact: true }),
  ).toHaveCount(0);
  await button(page, '元に戻す').click();
  await expect(sofa).toHaveAttribute('transform', 'translate(5 7) rotate(90)');
  await button(page, 'やり直す').click();
  await expect(sofa).toHaveCount(0);
  await button(page, '元に戻す').click();
  await place(page, 'ワードローブ', { x: 9, z: 4 });
  await place(page, 'キッチンアイランド', { x: 11, z: 8 });
  await button(page, '家具の検証室を選択').press('Enter');
  await page.getByRole('tab', { name: '3D', exact: true }).click();
  const canvas = await readyScene(page);
  for (const item of [
    { name: '2人掛けソファ', x: 5, z: 7, y: 0.5, rotation: '90' },
    { name: 'ワードローブ', x: 9, z: 4, y: 1, rotation: '0' },
    { name: 'キッチンアイランド', x: 11, z: 8, y: 0.5, rotation: '0' },
  ]) {
    await clickInScene(page, canvas, item);
    await expect(
      page.getByRole('heading', { name: item.name, exact: true }),
    ).toBeVisible();
    await expect(field(page, '回転角度')).toHaveValue(item.rotation);
  }
  await testInfo.attach('furniture-selected-3d', {
    body: await canvas.screenshot({
      path: testInfo.outputPath('furniture-selected-3d.png'),
    }),
    contentType: 'image/png',
  });
});

test('390pxでも収納・キッチンを含む全カテゴリーへ届き、キーボードで追加家具を選択・編集できる', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openEditor(page);
  // 2段の横スクロールカタログをTabで最後まで辿り、画面外にある新種もキーボードで到達できる。
  const allCards = catalog(page).getByRole('button', { name: /を配置$/ });
  await expect(allCards).toHaveCount(22);
  await allCards.first().focus();
  for (let index = 1; index < 22; index++) await page.keyboard.press('Tab');
  await expect(allCards.last()).toBeFocused();
  const lastBox = await allCards.last().boundingBox();
  expect(lastBox).not.toBeNull();
  expect(lastBox!.x).toBeGreaterThanOrEqual(0);
  expect(lastBox!.x + lastBox!.width).toBeLessThanOrEqual(391);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  ).toBe(true);
  await testInfo.attach('furniture-catalog-all-mobile', {
    body: await page.screenshot({
      path: testInfo.outputPath('furniture-catalog-all-mobile.png'),
      fullPage: false,
    }),
    contentType: 'image/png',
  });
  for (const [category, names] of Object.entries(categories)) {
    const tab = catalog(page).getByRole('tab', { name: category, exact: true });
    await tab.press('Enter');
    await expect(tab).toHaveAttribute('aria-selected', 'true');
    expect(await catalogNames(page)).toEqual([...names].sort());
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    ).toBe(true);
  }
  const card = catalog(page).getByRole('button', {
    name: 'キッチンアイランドを配置',
    exact: true,
  });
  await card.press('Enter');
  await expect(card).toHaveAttribute('aria-pressed', 'true');
  const position = await screenPoint(page, { x: 7, z: 6 });
  await page.mouse.click(position.x, position.y);
  const island = placed(page, 'キッチンアイランド');
  await island.press('Enter');
  await setNumber(page, 'X 座標', '7.5');
  await setNumber(page, '回転角度', '90');
  // 入力欄の文字編集キーが、家具削除・全体Undo・回転ショートカットへ流れないことを確認する。
  await field(page, 'X 座標').press('ControlOrMeta+z');
  await expect(island).toHaveAttribute(
    'transform',
    'translate(7.5 6) rotate(90)',
  );
  await field(page, '回転角度').press('r');
  await expect(island).toHaveAttribute(
    'transform',
    'translate(7.5 6) rotate(90)',
  );
  await island.press('Enter');
  await island.press('r');
  await expect(island).toHaveAttribute(
    'transform',
    'translate(7.5 6) rotate(180)',
  );
  const saved = await save(page);
  expect(saved.furniture).toHaveLength(1);
  expect(saved.furniture[0]).toMatchObject({
    kind: 'kitchen-island',
    x: 7.5,
    z: 6,
    rotation: 180,
  });
  await catalog(page).scrollIntoViewIfNeeded();
  await testInfo.attach('furniture-catalog-mobile', {
    body: await page.screenshot({
      path: testInfo.outputPath('furniture-catalog-mobile.png'),
      fullPage: false,
    }),
    contentType: 'image/png',
  });
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.getByRole('tab', { name: '2D + 3D', exact: true }).click();
  await expect(island).toHaveAttribute(
    'transform',
    'translate(7.5 6) rotate(180)',
  );
  await readyScene(page);
});
