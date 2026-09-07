// 日本語UIの言語とメタデータを定義し、共通スタイルを全ビューに適用する。
import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = {
  title: 'Housemaker — 3Dハウスプランナー',
  description: '間取りを描き、家具を置いて、理想の住まいを2Dと3Dで確かめる。',
};
export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}
