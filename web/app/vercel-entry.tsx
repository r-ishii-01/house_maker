// 既存のハウスプランナーをブラウザーで起動する、静的配信用のReactエントリー。
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import HousePlanner from './components/HousePlanner';
import './globals.css';

// HTMLとエントリーの不整合を、空白表示のままにせず起動時に検出する。
const container = document.getElementById('root');
if (!container) {
  throw new Error('Housemakerの表示先が見つかりませんでした。');
}

// 開発時のStrictModeで、3D初期化やイベント購読の後処理も検証できるようにする。
createRoot(container).render(
  <StrictMode>
    <HousePlanner />
  </StrictMode>,
);
