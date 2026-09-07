// 既存の開発サーバーを再利用し、CIではソフトウェアWebGLを使って3D描画も検証する。
import { defineConfig, devices } from '@playwright/test';

// 同じ7件の操作を開発版・Sites公開用ビルド・Vercel静的ビルドへ切り替えて実行する。
// 両フラグが指定された場合は、明示的なVercel検証を優先する。
const production = process.env.E2E_PRODUCTION === 'true';
const vercel = process.env.E2E_VERCEL === 'true';
const baseURL =
  process.env.E2E_BASE_URL ??
  (vercel
    ? 'http://localhost:4173'
    : production
      ? 'http://localhost:8787'
      : 'http://localhost:3000');

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  retries: 0,
  reporter: 'list',
  use: {
    baseURL,
    viewport: { width: 1600, height: 1000 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1600, height: 1000 },
        launchOptions: {
          // 既に取得済みのChromiumが別の場所にある場合だけ、環境変数でその実行ファイルを指定する。
          executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
          args: [
            '--use-gl=angle',
            '--use-angle=swiftshader',
            '--enable-unsafe-swiftshader',
          ],
        },
      },
    },
  ],
  // 公開URLが指定された場合は、ローカルサーバーを起動せずにそのURLを検証する。
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        // Sites用workerdの互換日付を維持し、Vercelでは事前に生成した静的ファイルを配信する。
        command: vercel
          ? 'npm run preview:vercel -- --host 127.0.0.1 --port 4173'
          : production
            ? 'npm run start -- --port 8787 --compatibility-date 2026-08-08'
            : 'npm run dev -- --host 127.0.0.1 --port 3000',
        url: baseURL,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
      },
});
