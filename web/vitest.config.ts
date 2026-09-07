// 単体テストではブラウザー用・Cloudflare用のViteプラグインを起動せず、共有モデルだけを検証する。
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
