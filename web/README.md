# Housemaker Studio

React・TypeScript・SVG・Zustand・Three.js / React Three Fiberを使った間取り編集アプリです。

## Vercelへの公開

Vercelのプロジェクトルートはこの `web` ディレクトリです。`vercel.json` はViteの静的配信を選択し、`npm ci` で依存関係を再現、`npm run build:vercel` の出力 `dist-vercel` を公開します。JSONはコメントに対応しないため、設定の意図はここに記載しています。

`index.html` と `app/vercel-entry.tsx` が既存のHousePlannerをブラウザーで起動します。3Dモデルと編集ロジックを共用し、`vite.vercel.config.ts` でSites用のWorkersビルドと出力先を分けています。Vercel用にDB・APIキーを追加する必要はありません。

ローカル確認は `npm run dev:vercel`。公開用の確認は `npm run build:vercel` の後に `E2E_VERCEL=true npm run test:e2e` を実行します。Vercel CLIではこのディレクトリを対象プロジェクトへリンクし、`npx vercel --prod` でアップロードできます。

保存済みの間取りはURLのドメインごとにブラウザー内へ保存されます。Sitesで保存した内容はVercelへ自動移行されません。`.vercelignore` はローカルの生成物・環境変数ファイル・Sitesの設定をソースアップロードから除外します。

## 既存Sites版の開発

```sh
npm ci
npm run dev
```

検証は `npm run lint`、`npm run typecheck`、`npm test`、`npm run test:e2e`。E2E用ブラウザは `npx playwright install chromium` で準備するか、`PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` に既存Chromeのパスを指定します。

公開用ビルドの検証は `npm run build` の後に `E2E_PRODUCTION=true npm run test:e2e` を実行します。既に起動しているサーバーを検証する場合は `E2E_BASE_URL` にURLを指定します。production用テストサーバーは、同梱workerdが対応する互換日付でローカル起動します。公開先の互換日付は変更しません。

3Dでは、縦長画面やズームで家が消えないよう固定距離の霧を使わず、カメラ距離に合わせて描画範囲を調整します。`SceneCanvas.tsx` がGPU初期化とリソース解放を管理し、WebGLが利用できない場合や描画中に失われた場合は案内と「3Dを再試行」を表示します。GPU非対応時は2D編集と保存を継続できます。

本番ビルドは `npm run build`。Sitesが `dist/server` のWorkerと `dist/client` のアセットを配信します。間取りデータは「保存する」でブラウザのlocalStorageに保存されます。アプリのバックエンドDBやAPIキーは不要です。

`app/lib/model.ts` が両ビューの共通モデルと境界判定、`app/lib/store.ts` が選択と編集履歴、`app/components/` が2D・3D・画面統合を担当します。自作コードには日本語のロジック解説コメントがあります。

`.oxlintrc.json` は自作コードを検査し、変更していない生成済みUI部品を除外します。`.openai/hosting.json` はサイト識別のみを保持し、DBとストレージのバインディングは使用しません。
