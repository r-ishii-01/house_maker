// Vercel向けには同じ編集画面を静的SPAとしてビルドし、Sites用のWorkers設定と出力を分ける。
import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/postcss';

export default defineConfig({
  plugins: [react()],
  resolve: {
    // 共用UI部品の@/参照を、このwebディレクトリへ解決する。
    alias: { '@': fileURLToPath(new URL('.', import.meta.url)) },
  },
  css: { postcss: { plugins: [tailwindcss()] } },
  build: { outDir: 'dist-vercel', emptyOutDir: true },
  server: {
    watch: {
      ignored: [
        '**/*.tsbuildinfo',
        '**/test-results/**',
        '**/playwright-report/**',
      ],
    },
  },
  // テスト時に別ポートへ自動退避すると誤ったサーバーを検証するため、競合は明示的に停止する。
  preview: { port: 4173, strictPort: true },
});
