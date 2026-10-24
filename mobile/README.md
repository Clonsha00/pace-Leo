# PACE Expo 手機版

獨立的 React Native／Expo App，先以 iPhone 測試，原網站保留。已實作開始、暫停、繼續、結束、本機 SQLite 儲存、歷史紀錄與 JSON 分享匯出。

原生背景定位直接寫入資料庫，切換 App 不主動暫停；距離與熱量共用 `../core.js`。第一個有效定位後開始計時，暫停時間不計；30 秒以上缺口另開路段，不推算遺失距離，仍在計時的無有效速度區間以 1 MET 保守補估。體重、步行／跑步和速度用於 ACSM 平地估算，身高與年齡僅留存。

## 電腦準備

保留整份倉庫，不能只複製 mobile，因為需要上一層的計算核心。使用 Expo SDK 支援的 Node.js，在本資料夾執行：

```sh
npm ci
npm test
npm run typecheck
npm run lint
```

## iPhone 安裝

已確認可使用自己或學校的 Apple Developer 付費會員。請自行登入，不需提供密碼；學校帳號需具簽署和裝置管理權限。Windows 可用 EAS 雲端打包。

1. 執行 `npx eas-cli@latest login`，登入自己的 Expo 帳號。
2. 執行 `npx eas-cli@latest init`，建立或連結 Expo 專案。
3. 執行 `npx eas-cli@latest device:create`，依連結登記測試 iPhone。
4. 執行 `npx eas-cli@latest build --platform ios --profile development`，依提示自行登入 Apple 帳號、選團隊與測試裝置。
5. 用 iPhone 開啟完成後的安裝連結，依提示安裝並開啟 Developer Mode。
6. 電腦執行 `npm start`，手機和電腦連同一個 Wi-Fi，從開發測試版連上專案。

戶外測試建議改用 `npx eas-cli@latest build --platform ios --profile preview`。此設定內含 JS，測試不依賴電腦。新增原生套件、修改權限或地圖金鑰需重新打包。

**Expo Go 和網頁不能驗證此 App 的 iOS 背景定位。** 目前尚未替你登入、上傳 EAS、簽署或產生 IPA，背景能力仍待實機確認。

## Google Maps

複製 `.env.example` 為 `.env`，填入 `GOOGLE_MAPS_IOS_API_KEY`。Google Cloud 須啟用 Maps SDK for iOS 與其帳務設定，限制金鑰供 bundle identifier `com.paceleo.mobile` 使用；改識別碼時需同步修改限制。

在 EAS 專案對應建置環境也設定相同變數：development 或 preview。僅電腦有 `.env` 不代表雲端能取得。不要提交 `.env`；原生金鑰會隨 App 發佈，需設定使用限制。

未設定時顯示說明面板，仍能測定位及本機記錄。手機版使用 Google Maps，原網站地圖尚未遷移。

## 實機驗收

到戶外開啟精確位置，按開始並「永遠」允許定位。若先選「允許一次」而無法取得背景權限，請至 iPhone 設定調整。

| 情境 | 預期檢查 |
| --- | --- |
| 前景步行 2 分鐘 | 點數、距離、時間及估算消耗更新 |
| 鎖屏步行 3–5 分鐘 | 解鎖後仍有定位時間，距離與時間持續累計 |
| 切到其他 App | 返回後持續記錄，不因切換主動暫停 |
| 暫停、走遠、繼續 | 暫停時間不計，不跨暫停連線 |
| 訊號差或撤銷權限 | 顯示缺口／錯誤，不補造距離，計時缺口僅補估熱量 |
| 結束後重開 App | 歷史仍在，定位已停止 |
| 匯出 JSON | 用原網站 review.html 匯入驗算 |

強制滑掉 App 不等於鎖屏，iOS 可能終止背景定位，不保證自動恢復。重開時若原生任務已停止，會以最後收資料時間暫停並提示；若系統仍回報任務註冊，僅能提示缺口，無法識別所有中斷。任務已註冊不是持續運作的實測證據。

位置與個人資料只存手機，按分享才匯出；移除 App 可能遺失資料。JSON 含原始位置，請自行保存。原網站分析限制 5 MB，長時間紀錄可能超過。

參考：[Expo Location](https://docs.expo.dev/versions/v58.0.0/sdk/location/)、[iOS 內部分發](https://docs.expo.dev/build/internal-distribution/)、[EAS 環境變數](https://docs.expo.dev/eas/environment-variables/)。
