# Housemaker

間取りを描き、家具を配置し、2Dと3Dで確認できる日本語のハウスモデリングWebアプリです。

一般公開URL: https://housemaker-studio.vercel.app

## 技術スタック

| 用途 | 採用技術 | 理由 |
| --- | --- | --- |
| UI・型 | React 19 / TypeScript | 間取り・家具を型で共通化し、表示の不整合を防ぐ |
| 開発・配信 | Vite / Vercel、Vinext / Sites | Vercelで静的SPAを一般公開。既存Sites版のWorkers配信も維持 |
| 間取り編集 | SVG / Pointer Events | メートル単位の作図、タッチとマウスの座標変換 |
| 3D | Three.js / React Three Fiber 9 / Drei | 共通データから部屋と家具を立体化し、視点を操作 |
| 状態管理 | Zustand | 2D/3Dの同期とUndo/Redo |
| UI部品 | shadcn/ui / Base UI / Tailwind CSS | アクセシブルなタブ、ダイアログ、スイッチ |
| テスト | Vitest / Playwright | 座標・履歴の単体検証と実ブラウザでの一連の操作 |
| 開発支援 | Codexサブエージェント / Context7 MCP | 実装・レビュー・テストの分担と公式ライブラリ資料の参照 |

## 起動

Node.js 22.13以上を使用します。

```sh
cd web
npm ci
npm run dev
```

表示されたローカルURLを開きます。`npm run build` で本番ビルドを生成します。

Vercel版は `npm run dev:vercel` で開発、`npm run build:vercel` で静的ファイルを生成します。公開設定と手順は [web/README.md](web/README.md) を参照してください。

## 操作

- 「新規作成」→「空のプランを作成」で開始。または最初のサンプルを編集します。
- 「部屋」ツールでドラッグして矩形の部屋を作り、プロパティで名前・寸法・位置を変更します。
- 「壁」ツールで任意の間仕切り壁を描けます。
- カタログから家具を選び、部屋の内側をクリックして配置します。家具は10種類です。
- 家具のドラッグ、座標・回転・色の編集は2D/3Dへ反映されます。
- 3Dはドラッグで回転、ホイールで拡大縮小。「壁を低く表示」を切り替えられます。
- `⌘/Ctrl + Z` でUndo、`⌘/Ctrl + Shift + Z` でRedo、`R`で90度回転、`Esc`で操作取消、`Delete`で削除。
- 「保存する」は **現在のブラウザに1プランを保存** します。端末間の同期やクラウド保存はありません。

現在は単一フロア・矩形の部屋が対象です。ドア・窓、自由多角形、複数階、家具同士の衝突判定は対象外です。家具は全体が1つの部屋内に収まる必要があります。

## 構成

- `web/app/lib/model.ts`：単位・型・家具カタログ・境界検証・保存データの検証
- `web/app/lib/store.ts`：共通ドキュメント、選択、最大100件の編集履歴
- `web/app/components/FloorPlan.tsx`：SVG描画、座標変換、一時ドラッグ状態
- `web/app/components/Scene3D.tsx`：外部アセット不要の家具モデル、床・壁、視点操作
- `web/app/components/HousePlanner.tsx`：入力検証、各ビューの統合、ブラウザ保存
- `.codex/agents/`：再利用可能な5役割のサブエージェント設定
- `AGENTS.md`：日本語ロジックコメント、担当境界、検証の共通ルール

各自作コードファイルに日本語の処理・設計意図コメントを記載しています。コメントを許さないJSONについては以下で意図を説明します。

- `web/package.json` / `package-lock.json`：依存関係と再現可能なバージョン、起動・検証コマンド。
- `web/tsconfig.json`：厳密な型検査とパス別名。
- `web/.oxlintrc.json`：自作コードを検査。変更していない生成済みUIカタログと生成キャッシュは対象外。
- `web/.openai/hosting.json`：Sitesのプロジェクト識別。DB・オブジェクトストレージは使用しない。
- `web/components.json` / `.oxfmtrc.json`：生成済みUI部品のパスとフォーマット方針。

## テスト

```sh
cd web
npm run typecheck
npm run lint
npm test
npx playwright install chromium
npm run test:e2e
```

既存Chromeを使う場合は `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` に実行ファイルのパスを設定します。E2Eは開発サーバーがなければ起動し、ある場合は再利用します。

## 開発エージェントとMCP

役割・分担・利用方法は [オーケストレーション](docs/orchestration.md)、検証項目は [テストシナリオ](docs/test-scenarios.md) を参照してください。Context7はCodex共通設定に登録し、MCP初期化・ツール一覧・React Three Fiberの資料検索が成功することを確認しています。
