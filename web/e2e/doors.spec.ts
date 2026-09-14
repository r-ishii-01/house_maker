// 扉を利用者の操作で配置・編集し、2D/3D・履歴・端末保存が同じ開口を扱うことを検証する。
import {
  test as base,
  expect,
  type Locator,
  type Page,
} from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import type { PlanDocument } from '../app/lib/model';

type FloorPoint = { x: number; z: number };

// WebGLのエラーログも収集し、canvasが存在するだけで描画成功と判断しない。
const test = base.extend<{ runtimeErrors: void }>({
  runtimeErrors: [
    async ({ page }, use, testInfo) => {
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      page.on('console', (message) => {
        if (
          message.type() === 'error' &&
          /webgl|three|shader/i.test(message.text())
        )
          errors.push(message.text());
      });
      await use();
      await testInfo.attach('door-runtime-errors', {
        body: JSON.stringify(errors),
        contentType: 'application/json',
      });
      expect(errors, '扉操作中にページ例外・WebGL描画エラーがないこと').toEqual(
        [],
      );
    },
    { auto: true },
  ],
});

const floorCanvas = (page: Page) =>
  page.getByRole('img', { name: /^間取り編集キャンバス/ });
const doors = (page: Page) => floorCanvas(page).locator('[data-door]');
const door = (page: Page, index = 1) =>
  page.getByRole('button', { name: `扉 ${index}を選択`, exact: true });
const numberField = (page: Page, name: string) =>
  page.getByRole('spinbutton', { name, exact: true });

// SVGの変換行列でメートルを画面座標へ変換し、分割表示やモバイル幅でも実際の図形を操作する。
async function screenPoint(page: Page, point: FloorPoint) {
  const canvas = floorCanvas(page);
  await canvas.scrollIntoViewIfNeeded();
  return canvas.evaluate((element, position) => {
    const matrix = (element as SVGSVGElement).getScreenCTM();
    if (!matrix) throw new Error('間取りの座標変換行列がありません。');
    const result = new DOMPoint(position.x, position.z).matrixTransform(matrix);
    return { x: result.x, y: result.y };
  }, point);
}

async function clickFloor(page: Page, point: FloorPoint) {
  const position = await screenPoint(page, point);
  await page.mouse.click(position.x, position.y);
}

async function beginDrag(page: Page, from: FloorPoint, to: FloorPoint) {
  const start = await screenPoint(page, from);
  const end = await screenPoint(page, to);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 12 });
}

async function dragFloor(page: Page, from: FloorPoint, to: FloorPoint) {
  await beginDrag(page, from, to);
  await page.mouse.up();
}

async function setNumber(page: Page, name: string, value: string) {
  const field = numberField(page, name);
  await field.fill(value);
  await field.press('Enter');
  await expect(field).toHaveValue(value);
}

async function newRoom(
  page: Page,
  start = { x: 2, z: 2 },
  end = { x: 12, z: 10 },
) {
  await page.goto('/');
  await expect(page.locator('main')).toHaveAttribute('data-ready', 'true');
  await page.getByRole('button', { name: '新規作成', exact: true }).click();
  await page
    .getByRole('alertdialog')
    .getByRole('button', { name: '空のプランを作成', exact: true })
    .click();
  await page.getByRole('button', { name: '部屋ツール', exact: true }).click();
  await dragFloor(page, start, end);
  await page
    .getByRole('textbox', { name: '部屋の名前', exact: true })
    .fill('扉検証室');
  await expect(doors(page)).toHaveCount(0);
  // 部屋ツールは2D単独表示へ移るため、扉の2D/3D同期を確認する既存シナリオの表示を明示する。
  await page.getByRole('tab', { name: '2D + 3D', exact: true }).click();
}

async function placeDoor(page: Page, point: FloorPoint, count: number) {
  await page.getByRole('button', { name: '扉ツール', exact: true }).click();
  await clickFloor(page, point);
  await expect(doors(page)).toHaveCount(count);
  await expect(
    page.getByRole('heading', { name: '扉の詳細', exact: true }),
  ).toBeVisible();
}

// 保存APIの代わりに保存ボタンを押し、読取だけでUI表示と永続化された寸法を照合する。
async function savePlan(page: Page): Promise<PlanDocument> {
  await page.getByRole('button', { name: /^保存/ }).click();
  return page.evaluate(() => {
    const raw = localStorage.getItem('housemaker.plan.v1');
    if (!raw) throw new Error('保存ボタンで間取りが保存されませんでした。');
    return JSON.parse(raw) as PlanDocument;
  });
}

async function openingCoordinates(item: Locator) {
  // 開口の白線は家具より下に描かれるため、選択用gとは別のSVG直下の要素をIDで関連づける。
  const id = await item.getAttribute('data-door');
  return floorCanvas(item.page())
    .locator(`line[data-door-opening="${id}"]`)
    .evaluate((element) => ({
      x1: Number(element.getAttribute('x1')),
      z1: Number(element.getAttribute('y1')),
      x2: Number(element.getAttribute('x2')),
      z2: Number(element.getAttribute('y2')),
    }));
}

async function activeCanvas(page: Page) {
  const region = page.getByRole('region', {
    name: '3Dプレビュー',
    exact: true,
  });
  // 初期表示が2Dのみでも、3Dを確認するケースは表示タブを明示して実際のcanvasを起動する。
  if ((await region.count()) === 0) {
    await page.getByRole('tab', { name: '2D + 3D', exact: true }).click();
  }
  const canvas = region.locator('canvas');
  await expect(canvas).toBeVisible();
  await expect(
    region.getByText('3Dビューを表示できませんでした', { exact: true }),
  ).toBeHidden();
  await expect
    .poll(() =>
      canvas.evaluate((element) => {
        const gl = (element as HTMLCanvasElement).getContext('webgl2');
        return (
          !!gl &&
          !gl.isContextLost() &&
          gl.drawingBufferWidth > 0 &&
          gl.drawingBufferHeight > 0
        );
      }),
    )
    .toBe(true);
  return canvas;
}

// 合成済みPNGの実画素を比較する。GPUバッファの消去時期やPNG圧縮バイトの差には依存しない。
async function changedPixels(page: Page, before: Buffer, after: Buffer) {
  return page.evaluate(
    async ({ previous, current }) => {
      const images = await Promise.all(
        [previous, current].map(async (encoded) => {
          const image = new Image();
          image.src = `data:image/png;base64,${encoded}`;
          await image.decode();
          return image;
        }),
      );
      const canvas = document.createElement('canvas');
      canvas.width = images[0].width;
      canvas.height = images[0].height;
      if (
        images[1].width !== canvas.width ||
        images[1].height !== canvas.height
      )
        throw new Error('3D領域の大きさが比較中に変わりました。');
      const context = canvas.getContext('2d');
      if (!context) throw new Error('PNG比較用の2D描画領域がありません。');
      const pixels = images.map((image) => {
        context.clearRect(0, 0, canvas.width, canvas.height);
        context.drawImage(image, 0, 0);
        return context.getImageData(0, 0, canvas.width, canvas.height).data;
      });
      let changed = 0;
      for (let index = 0; index < pixels[0].length; index += 4) {
        // 小さなアンチエイリアス差を除き、扉・開口の色や遮蔽が変わった画素を数える。
        if (
          Math.max(
            ...[0, 1, 2].map((channel) =>
              Math.abs(pixels[0][index + channel] - pixels[1][index + channel]),
            ),
          ) > 24
        )
          changed++;
      }
      return changed;
    },
    { previous: before.toString('base64'), current: after.toString('base64') },
  );
}

test('部屋外周の扉を編集し、家具の操作と保存再読込・表示幅変更を通して寸法と開き方を保持する', async ({
  page,
}, testInfo) => {
  await newRoom(page);
  await setNumber(page, '部屋の幅', '11');
  await placeDoor(page, { x: 5, z: 2 }, 1);
  await expect(numberField(page, '扉の幅')).toHaveValue('0.9');
  await expect(numberField(page, '扉の高さ')).toHaveValue('2');
  await expect(door(page)).toHaveAttribute('aria-pressed', 'true');
  // 垂直線は幅0のためPlaywrightのvisible条件に合わない。線の長さと描画属性で存在を検証する。
  expect(
    await door(page)
      .locator('[data-door-leaf]')
      .evaluate((element) => {
        const style = getComputedStyle(element);
        return (
          (element as SVGLineElement).getTotalLength() > 0 &&
          style.stroke !== 'none' &&
          style.visibility !== 'hidden' &&
          style.display !== 'none'
        );
      }),
  ).toBe(true);
  await expect(door(page).locator('[data-door-arc]')).toBeVisible();
  await setNumber(page, '壁沿いの位置', '1.5');
  await setNumber(page, '扉の幅', '1.2');
  await setNumber(page, '扉の高さ', '2.1');
  const originalArc = await door(page)
    .locator('[data-door-arc]')
    .getAttribute('d');
  await page.getByRole('button', { name: '終点側', exact: true }).click();
  await expect(door(page).locator('[data-door-arc]')).not.toHaveAttribute(
    'd',
    originalArc!,
  );
  await page.getByRole('button', { name: '反対方向', exact: true }).click();
  const editedArc = await door(page)
    .locator('[data-door-arc]')
    .getAttribute('d');

  // 不正な幅は確定されず、フォーム内のDelete/Ctrl+Zもオブジェクト削除や履歴操作にならない。
  const width = numberField(page, '扉の幅');
  await width.fill('0');
  await width.press('Enter');
  await expect(width).toHaveValue('1.2');
  await width.focus();
  await width.press('ControlOrMeta+z');
  await width.press('Delete');
  await width.fill('1.2');
  await width.press('Enter');
  await expect(doors(page)).toHaveCount(1);
  await expect(door(page).locator('[data-door-arc]')).toHaveAttribute(
    'd',
    editedArc!,
  );

  await page
    .getByRole('button', { name: '3人掛けソファを配置', exact: true })
    .click();
  await clickFloor(page, { x: 7, z: 5 });
  await dragFloor(page, { x: 7, z: 5 }, { x: 8, z: 6 });
  await setNumber(page, '回転角度', '90');
  const saved = await savePlan(page);
  expect(saved.doors).toHaveLength(1);
  expect(saved.doors[0]).toMatchObject({
    host: { kind: 'room', id: saved.rooms[0].id, side: 'north' },
    offset: 1.5,
    width: 1.2,
    height: 2.1,
    hinge: 'end',
    swing: -1,
  });
  expect(saved.furniture[0]).toMatchObject({ x: 8, z: 6, rotation: 90 });
  await page.reload();
  await expect(page.locator('main')).toHaveAttribute('data-ready', 'true');
  await expect(doors(page)).toHaveCount(1);
  await door(page).press('Enter');
  await expect(numberField(page, '壁沿いの位置')).toHaveValue('1.5');
  await expect(numberField(page, '扉の高さ')).toHaveValue('2.1');
  await expect(door(page).locator('[data-door-arc]')).toHaveAttribute(
    'd',
    editedArc!,
  );
  expect((await savePlan(page)).doors).toEqual(saved.doors);
  await activeCanvas(page);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('tab', { name: '間取り', exact: true }).click();
  await door(page).press('Enter');
  await expect(numberField(page, '扉の幅')).toHaveValue('1.2');
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          document.documentElement.scrollWidth -
          document.documentElement.clientWidth,
      ),
    )
    .toBeLessThanOrEqual(1);
  await page.getByRole('tab', { name: '3D', exact: true }).click();
  await activeCanvas(page);
  await page.getByRole('tab', { name: '2D + 3D', exact: true }).click();
  await expect(doors(page)).toHaveCount(1);
  const mobilePath = testInfo.outputPath('door-mobile.png');
  await page.screenshot({ path: mobilePath, fullPage: true });
  await testInfo.attach('door-mobile', {
    path: mobilePath,
    contentType: 'image/png',
  });
});

test('扉のドラッグを1回のUndoで戻し、Escapeとpointercancelでは位置と履歴を変更しない', async ({
  page,
}) => {
  await newRoom(page);
  await placeDoor(page, { x: 5, z: 2 }, 1);
  const original = (await savePlan(page)).doors[0];
  const opening = await openingCoordinates(door(page));
  const center = { x: (opening.x1 + opening.x2) / 2, z: opening.z1 };
  await page.getByRole('button', { name: '選択ツール', exact: true }).click();
  await dragFloor(page, center, { x: center.x + 1, z: center.z });
  expect((await savePlan(page)).doors[0].offset).toBeCloseTo(
    original.offset + 1,
    8,
  );
  await page.getByRole('button', { name: '元に戻す', exact: true }).click();
  expect((await savePlan(page)).doors).toEqual([original]);
  await page.getByRole('button', { name: 'やり直す', exact: true }).click();
  const moved = (await savePlan(page)).doors[0];
  expect(moved.offset).toBeCloseTo(original.offset + 1, 8);

  for (const cancel of ['Escape', 'pointercancel']) {
    await page.getByRole('button', { name: '選択ツール', exact: true }).click();
    const start = { x: center.x + 1, z: center.z };
    const before = await openingCoordinates(door(page));
    await beginDrag(page, start, { x: start.x + 1, z: start.z });
    await expect.poll(() => openingCoordinates(door(page))).not.toEqual(before);
    if (cancel === 'Escape') await page.keyboard.press('Escape');
    else
      await floorCanvas(page).dispatchEvent('pointercancel', {
        pointerId: 1,
        bubbles: true,
      });
    await page.mouse.up();
    expect(await openingCoordinates(door(page))).toEqual(before);
    expect((await savePlan(page)).doors).toEqual([moved]);
  }
  // 中断操作が履歴を増やしていれば、この1回のUndoで元位置まで戻れなくなる。
  await page.getByRole('button', { name: '元に戻す', exact: true }).click();
  expect((await savePlan(page)).doors).toEqual([original]);
});

test('追加壁の扉は壁削除に連動し、部屋外周の扉を保ったままUndo/Redoと復元ができる', async ({
  page,
}) => {
  await newRoom(page);
  await placeDoor(page, { x: 5, z: 2 }, 1);
  await page.getByRole('button', { name: '壁ツール', exact: true }).click();
  await dragFloor(page, { x: 3, z: 7 }, { x: 10, z: 7 });
  await placeDoor(page, { x: 6, z: 7 }, 2);
  const before = await savePlan(page);
  expect(before.doors[1].host).toEqual({
    kind: 'wall',
    id: before.walls[0].id,
  });
  await page.getByRole('button', { name: '選択ツール', exact: true }).click();
  await clickFloor(page, { x: 3.3, z: 7 });
  await expect(
    page.getByRole('heading', { name: '壁の詳細', exact: true }),
  ).toBeVisible();
  // 扉の上端を切り落とす高さ変更は壁ごと拒否され、正しい寸法が残る。
  await numberField(page, '壁の高さ').fill('1.5');
  await numberField(page, '壁の高さ').press('Enter');
  await expect(numberField(page, '壁の高さ')).toHaveValue(
    String(before.walls[0].height),
  );
  await page
    .getByRole('button', { name: '選択した壁を削除', exact: true })
    .click();
  await expect(doors(page)).toHaveCount(1);
  expect((await savePlan(page)).doors).toEqual([before.doors[0]]);
  await page.getByRole('button', { name: '元に戻す', exact: true }).click();
  expect((await savePlan(page)).doors).toEqual(before.doors);
  await page.getByRole('button', { name: 'やり直す', exact: true }).click();
  await expect(doors(page)).toHaveCount(1);
  await page.getByRole('button', { name: '元に戻す', exact: true }).click();
  await page
    .getByRole('button', { name: '扉検証室を選択', exact: true })
    .press('Enter');
  await page
    .getByRole('button', { name: '選択した部屋を削除', exact: true })
    .click();
  // 部屋の削除は追加壁まで消さないため、その壁がホストの扉は残る。
  expect((await savePlan(page)).doors).toEqual([before.doors[1]]);
  await page.getByRole('button', { name: '元に戻す', exact: true }).click();
  expect((await savePlan(page)).doors).toEqual(before.doors);
  await door(page, 2).press('Enter');
  await page
    .getByRole('button', { name: '選択した扉を削除', exact: true })
    .click();
  await expect(
    page.getByRole('heading', { name: 'プランの概要', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: '元に戻す', exact: true }).click();
  expect((await savePlan(page)).doors).toEqual(before.doors);
});

test('扉と開き方向が3Dの実画素を変え、Undoで扉のない元の描画へ戻る', async ({
  page,
}, testInfo) => {
  await newRoom(page);
  await page.getByRole('button', { name: '選択ツール', exact: true }).click();
  await page.keyboard.press('Escape');
  const canvas = await activeCanvas(page);
  const before = await canvas.screenshot();
  const repeated = await canvas.screenshot();
  const noise = await changedPixels(page, before, repeated);
  await placeDoor(page, { x: 7, z: 2 }, 1);
  await page.keyboard.press('Escape');
  await expect
    .poll(async () => changedPixels(page, before, await canvas.screenshot()), {
      message: '選択枠なしでも扉と開口が3Dの画素を変えること',
    })
    .toBeGreaterThan(Math.max(25, noise * 3));
  const added = await canvas.screenshot();
  await door(page).press('Enter');
  await page.getByRole('button', { name: '反対方向', exact: true }).click();
  await page.keyboard.press('Escape');
  await expect
    .poll(async () => changedPixels(page, added, await canvas.screenshot()), {
      message: '開く方向の変更で3Dの扉板の向きが変わること',
    })
    .toBeGreaterThan(Math.max(10, noise * 3));
  const reversed = await canvas.screenshot();
  // 全高表示は切り欠き上部の壁と扉枠を含むため、低い壁だけでは見えない3D形状の証跡を残す。
  const cutaway = page.getByRole('switch', { name: /^壁を低く表示/ });
  await cutaway.uncheck();
  await expect(cutaway).not.toBeChecked();
  const fullHeight = await canvas.screenshot();
  expect(await changedPixels(page, reversed, fullHeight)).toBeGreaterThan(25);
  await cutaway.check();
  await page.getByRole('button', { name: '元に戻す', exact: true }).click();
  await page.getByRole('button', { name: '元に戻す', exact: true }).click();
  await expect(doors(page)).toHaveCount(0);
  await expect
    .poll(async () => changedPixels(page, before, await canvas.screenshot()), {
      message: '扉を取り消すと元の壁の描画へ戻ること',
    })
    .toBeLessThanOrEqual(Math.max(10, noise * 3));
  for (const [name, body] of [
    ['door-scene-before', before],
    ['door-scene-added', added],
    ['door-scene-reversed', reversed],
    ['door-scene-full-height', fullHeight],
  ] as const) {
    const path = testInfo.outputPath(`${name}.png`);
    await writeFile(path, body);
    await testInfo.attach(name, { path, contentType: 'image/png' });
  }
});

test('キーボードだけで壁に扉を配置でき、重複配置や扉を塞ぐ追加壁を拒否する', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.locator('main')).toHaveAttribute('data-ready', 'true');
  await page.getByRole('button', { name: '扉ツール', exact: true }).click();
  const canvas = floorCanvas(page);
  // 表示操作のボタンが間にあっても、Tab移動だけで編集キャンバスへ到達できることを確認する。
  for (let index = 0; index < 12; index++) {
    if (await canvas.evaluate((element) => document.activeElement === element))
      break;
    await page.keyboard.press('Tab');
  }
  await expect(canvas).toBeFocused();
  // 中央(8,6)mから0.5m刻みで共有壁(9,5)mへ移動し、ポインターを使わず確定する。
  for (const key of [
    'Shift+ArrowUp',
    'Shift+ArrowUp',
    'Shift+ArrowRight',
    'Shift+ArrowRight',
  ])
    await page.keyboard.press(key);
  await page.keyboard.press('Enter');
  await expect(doors(page)).toHaveCount(1);
  await expect(door(page)).toHaveAttribute('aria-pressed', 'true');
  const original = (await savePlan(page)).doors;
  expect(original[0].host.kind).toBe('room');
  await page.getByRole('button', { name: '扉ツール', exact: true }).click();
  await clickFloor(page, { x: 9, z: 5 });
  await expect(doors(page)).toHaveCount(1);
  expect((await savePlan(page)).doors).toEqual(original);
  await page.getByRole('button', { name: '壁ツール', exact: true }).click();
  await dragFloor(page, { x: 8, z: 5 }, { x: 10, z: 5 });
  const afterBlockedWall = await savePlan(page);
  expect(afterBlockedWall.walls).toHaveLength(0);
  expect(afterBlockedWall.doors).toEqual(original);
  await page.getByRole('button', { name: '元に戻す', exact: true }).click();
  await expect(doors(page)).toHaveCount(0);
});

test('敷地端の外向き扉は表示範囲を広げて全体を表示し、Undoで元の範囲へ戻る', async ({
  page,
}, testInfo) => {
  await newRoom(page, { x: 2, z: 0 }, { x: 12, z: 8 });
  const canvas = floorCanvas(page);
  const initialViewBox = await canvas.getAttribute('viewBox');
  await placeDoor(page, { x: 5, z: 0 }, 1);
  await setNumber(page, '扉の幅', '1.5');
  await page.getByRole('button', { name: '反対方向', exact: true }).click();
  await expect(canvas).not.toHaveAttribute('viewBox', initialViewBox!);
  const viewBox = (await canvas.getAttribute('viewBox'))!
    .split(/\s+/)
    .map(Number);
  const leaf = await door(page)
    .locator('[data-door-leaf]')
    .evaluate((element) => ({
      x: Number(element.getAttribute('x2')),
      z: Number(element.getAttribute('y2')),
    }));
  expect(leaf.z).toBeCloseTo(-1.5, 8);
  expect(viewBox[1]).toBeLessThan(leaf.z);
  expect(leaf.x).toBeGreaterThan(viewBox[0]);
  expect(leaf.x).toBeLessThan(viewBox[0] + viewBox[2]);
  const path = testInfo.outputPath('door-outward-boundary.png');
  await canvas.screenshot({ path });
  await testInfo.attach('door-outward-boundary', {
    path,
    contentType: 'image/png',
  });
  await page.getByRole('button', { name: '元に戻す', exact: true }).click();
  await expect(canvas).toHaveAttribute('viewBox', initialViewBox!);
  await page.getByRole('button', { name: 'やり直す', exact: true }).click();
  await expect(canvas).not.toHaveAttribute('viewBox', initialViewBox!);
  await activeCanvas(page);
});
