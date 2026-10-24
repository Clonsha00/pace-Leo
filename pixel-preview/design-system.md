# PACE PIXEL · 視覺設計系統 v01

獨立風格原型，觀察復古像素 RPG 介面如何用於個人校園步行與跑步。尚未套用正式網站，不啟用定位、不讀寫 localStorage、不提供好友、排名、經驗值或真實地圖。頁面數字僅供互動示範。

## 視覺方向

- 16-bit RPG 的窗框、選單與俯視校園場景；暖紙張底色搭配森林墨綠，以日落橘強調主要操作。
- 中文採現代系統字體維持可讀性；英數採等寬字體呈現復古節奏。尚未加入外部像素字體，不依賴字體 CDN。
- 基礎單位 4 px；邊框 2 px；硬陰影 4 px。以直角、像素缺口、無模糊陰影維持同一系統。
- 圖示與像素地圖以 SVG 建構，使用 `shape-rendering: crispEdges`，圖像指定 nearest-neighbor 相關的 `image-rendering: pixelated`／`crisp-edges`。場景是視覺示意，不是導航地圖。

## 色彩 token

| Token | 色碼 | 用途 |
| --- | --- | --- |
| ink | #293E35 | 主文字、視窗邊框、導覽 |
| deep | #20342B | 深色陰影 |
| paper | #FAF6E5 | 面板與視窗背景 |
| canvas | #EEECDF | 頁面底色 |
| orange | #D57B45 | 主要按鈕、路線與重點 |
| sage | #9FB787 | 進度條、自然背景 |
| blue | #718FA1 | 次要資訊與地圖元素 |

## 可重用元件

| 元件 | 樣式／介面 | 狀態與用途 |
| --- | --- | --- |
| 視窗與資訊面板 | `.pixel-window`、`.window-title` | 淺色／深色標題列，共用邊框與陰影 |
| 按鈕 | `.pixel-button`、`.primary`、`.wide` | 一般、主要、hover、按下、停用與鍵盤焦點 |
| 活動切換 | `.mode-switch`、`aria-pressed` | 步行／跑步選取狀態 |
| 分頁 | `.pixel-tabs`、`mountTabs()` | 選取樣式、ARIA 連結、左右方向鍵與 Home／End |
| 進度條 | `.pixel-progress`、`setProgress()` | 視覺填色、上限限制、同步 aria-valuenow |
| 彈出視窗 | `.pixel-dialog`、`mountDialog()` | 原生 dialog 焦點管理、Escape、關閉與背景點擊 |
| 短訊息 | `.toast`、`createNotifier()` | live region 回饋，3 秒自動消失 |
| 像素圖示 | 頁首 SVG symbols | 同一 24×24 座標系與硬邊呈現 |

本原型使用原生 HTML、CSS、ES modules 的共用元件。正式網站仍維持原本架構；如之後確認要用 React，可依這些元件邊界遷移，不需要先重寫運動算法。

## 互動

- 模擬開始／暫停與重設；每秒展示 20 秒的示範變化。
- 步行／跑步切換重設示範快照；60 kg 預設體重，可在設定視窗調整。
- 熱量展示採平地 ACSM 簡化的連續移動情境，不模擬定位缺口，也不作精確耗能承諾。
- 分析分頁依次展示運動摘要、熱量比較、軌跡品質說明。
- 設計系統區展示五個基礎色彩、像素比例、按鈕、互動進度條。

## 響應式與無障礙

- 桌面使用側邊 RPG 選單、並排地圖與運動面板；平板縮為圖示選單；手機上下排列並保留主要操作。
- 所有互動具可見鍵盤焦點，分頁可用方向鍵，彈窗可用 Escape 關閉。
- 提供圖片替代文字、進度條可存取名稱及數值，狀態訊息使用 live region。
- `prefers-reduced-motion` 停用角色與視窗動畫；只保留必要的數據更新。

## 檔案

- `index.html`：原型版面與元件展示。
- `style.css`：設計 token、共用元件與響應式樣式。
- `components.js`：共用互動行為。
- `app.js`：純記憶體示範狀態。
- `map.svg`：程式繪製的像素校園示意圖。

預覽：`http://localhost:8000/pixel-preview/index.html`。此資料夾沒有註冊 service worker，也不納入正式網站的離線快取。
