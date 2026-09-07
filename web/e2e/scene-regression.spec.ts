// 背景だけの3D表示とWebGL障害からの復旧を、実描画の画素と利用者の操作で検証する。
import {
  test as base,
  expect,
  type Locator,
  type Page,
} from '@playwright/test';

declare global {
  interface Window {
    // WebGL初期化失敗を再現するテストだけが設定し、再試行前に元のブラウザーAPIへ戻す。
    __housemakerRestoreWebGL?: () => void;
  }
}

// 想定内のWebGL失敗もアプリが処理し、未処理例外をページ全体へ漏らさないことを確認する。
const test = base.extend<{ runtimeErrors: void }>({
  runtimeErrors: [
    async ({ page }, use, testInfo) => {
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await use();
      if (errors.length) {
        await testInfo.attach('scene-page-errors', {
          body: JSON.stringify(errors, null, 2),
          contentType: 'application/json',
        });
      }
      expect(
        errors,
        'WebGL障害を含め、未処理のJavaScript例外がないこと',
      ).toEqual([]);
    },
    { auto: true },
  ],
});

const sceneRegion = (page: Page) =>
  page.getByRole('region', { name: '3Dプレビュー', exact: true });
const floorCanvas = (page: Page) =>
  page.getByRole('img', { name: /^間取り編集キャンバス/ });
const failureMessage = (page: Page) =>
  sceneRegion(page).getByText('3Dビューを表示できませんでした', {
    exact: true,
  });
const retryButton = (page: Page) =>
  sceneRegion(page).getByRole('button', { name: '3Dを再試行', exact: true });

async function openEditor(page: Page) {
  await page.goto('/');
  await expect(page.locator('main')).toHaveAttribute('data-ready', 'true');
  await expect(floorCanvas(page)).toBeVisible();
}

// WebGLの描画バッファはフレーム間で消去されることがあるため、画面に合成されたPNGを分析する。
// PNGの復号にはブラウザーの画像APIを使い、画像解析用パッケージを追加しない。
async function renderedColorDistribution(canvas: Locator) {
  const screenshot = await canvas.screenshot({
    type: 'png',
    animations: 'disabled',
  });
  return canvas.page().evaluate(async (encoded) => {
    const image = new Image();
    image.src = `data:image/png;base64,${encoded}`;
    await image.decode();

    const sampleSize = 192;
    const sample = document.createElement('canvas');
    sample.width = sampleSize;
    sample.height = sampleSize;
    const context = sample.getContext('2d');
    if (!context)
      throw new Error(
        'スクリーンショット解析用の2D描画領域を作成できませんでした。',
      );

    // 上下のタイトル・操作ボタン・フッターを除き、家が描かれる中央だけを測る。
    // これにより、家が消えていてもHTMLの文字色だけで成功してしまうことを防ぐ。
    context.drawImage(
      image,
      image.width * 0.15,
      image.height * 0.25,
      image.width * 0.7,
      image.height * 0.5,
      0,
      0,
      sampleSize,
      sampleSize,
    );
    const pixels = context.getImageData(0, 0, sampleSize, sampleSize).data;
    const colors = new Set<number>();
    let darkPixels = 0;
    let coloredPixels = 0;
    for (let offset = 0; offset < pixels.length; offset += 4) {
      const red = pixels[offset];
      const green = pixels[offset + 1];
      const blue = pixels[offset + 2];
      // 細かなアンチエイリアス差はまとめ、背景から区別できる色と明暗の両方を数える。
      colors.add((red >> 4) * 256 + (green >> 4) * 16 + (blue >> 4));
      if (red * 0.2126 + green * 0.7152 + blue * 0.0722 < 210) darkPixels++;
      if (
        Math.max(red, green, blue) - Math.min(red, green, blue) > 18 &&
        Math.min(red, green, blue) < 235
      ) {
        coloredPixels++;
      }
    }
    const pixelCount = sampleSize * sampleSize;
    const darkPixelRatio = darkPixels / pixelCount;
    const coloredPixelRatio = coloredPixels / pixelCount;
    return {
      distinctColorBins: colors.size,
      darkPixelRatio,
      coloredPixelRatio,
      // 背景色だけ、透明、単色のプレースホルダーはいずれも通らない条件にする。
      rendered:
        colors.size >= 8 &&
        darkPixelRatio >= 0.002 &&
        coloredPixelRatio >= 0.002,
    };
  }, screenshot.toString('base64'));
}

async function expectSceneRendered(page: Page): Promise<Locator> {
  const canvas = sceneRegion(page).locator('canvas');
  await expect(canvas).toBeVisible();
  await expect(failureMessage(page)).toBeHidden();
  await expect(retryButton(page)).toBeHidden();
  await expect
    .poll(() => renderedColorDistribution(canvas), {
      message: '3Dキャンバスの中央に背景以外の家・家具の色と明暗が描かれること',
      timeout: 25_000,
      intervals: [300, 750, 1500],
    })
    .toMatchObject({ rendered: true });
  return canvas;
}

async function expectRecoverableFailure(page: Page) {
  const message = failureMessage(page);
  const retry = retryButton(page);
  await expect(message).toBeVisible();
  await expect(retry).toBeVisible();
  // canvasの代替コンテンツはWebGL初期化失敗時も表示されないため、外側のDOMにあることも確認する。
  expect(
    await message.evaluate((element) => element.closest('canvas') === null),
  ).toBe(true);
  expect(
    await retry.evaluate((element) => element.closest('canvas') === null),
  ).toBe(true);
  await expect(floorCanvas(page)).toBeVisible();
}

test('縦長1280×1900の分割表示でも家が霧や描画距離で消えない', async ({
  page,
}) => {
  // 幅の狭い3D領域に合わせてカメラ距離が増える、報告された再現条件を維持する。
  await page.setViewportSize({ width: 1280, height: 1900 });
  await openEditor(page);
  await expect(
    page.getByRole('tab', { name: '2D + 3D', exact: true }),
  ).toHaveAttribute('aria-selected', 'true');
  await expectSceneRendered(page);
});

test('WebGL初期化に失敗しても2Dを編集でき、再試行で実際の3D描画へ復帰する', async ({
  page,
}) => {
  // アプリの読み込み前にWebGL2だけを無効化し、GPUが利用できない初回起動を再現する。
  await page.addInitScript(() => {
    // Reflect.applyで呼び出し元canvasを明示するため、元メソッドはbindせず保存する。
    // oxlint-disable-next-line typescript/unbound-method
    const original = HTMLCanvasElement.prototype.getContext;
    Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
      configurable: true,
      writable: true,
      value: function (
        this: HTMLCanvasElement,
        contextId: string,
        ...args: unknown[]
      ) {
        if (contextId === 'webgl2') return null;
        return Reflect.apply(original, this, [contextId, ...args]);
      },
    });
    window.__housemakerRestoreWebGL = () => {
      Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
        configurable: true,
        writable: true,
        value: original,
      });
      delete window.__housemakerRestoreWebGL;
    };
  });
  await openEditor(page);
  await expectRecoverableFailure(page);

  // 3D障害の間にも通常のプロパティ入力が機能し、復旧によって編集内容が失われないことを確認する。
  const sofa = page.getByRole('button', {
    name: '3人掛けソファを選択',
    exact: true,
  });
  await sofa.press('Enter');
  const coordinate = page.getByRole('spinbutton', {
    name: 'X 座標',
    exact: true,
  });
  await coordinate.fill('5.7');
  await coordinate.press('Enter');
  await expect(coordinate).toHaveValue('5.7');
  await expect(sofa).toHaveAttribute(
    'transform',
    'translate(5.7 3.1) rotate(0)',
  );
  await expectRecoverableFailure(page);

  await page.evaluate(() => {
    if (!window.__housemakerRestoreWebGL)
      throw new Error('WebGL初期化失敗のスタブが見つかりません。');
    window.__housemakerRestoreWebGL();
  });
  await retryButton(page).click();
  await expectSceneRendered(page);
  await expect(sofa).toHaveAttribute(
    'transform',
    'translate(5.7 3.1) rotate(0)',
  );
  await expect(coordinate).toHaveValue('5.7');
});

test('描画中にWebGLコンテキストが失われても外側の復旧UIから再描画できる', async ({
  page,
}) => {
  await openEditor(page);
  const canvas = await expectSceneRendered(page);

  // ブラウザーが通知するコンテキスト消失イベントを再現し、同じ再試行経路を検証する。
  await canvas.evaluate((element) => {
    element.dispatchEvent(new Event('webglcontextlost', { cancelable: true }));
  });
  await expectRecoverableFailure(page);
  await retryButton(page).click();
  await expectSceneRendered(page);
});
