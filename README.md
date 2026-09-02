# 暗淵征討 Ashen Depths

放置型像素風地牢 RPG，單頁遊戲 + Cloudflare Worker/D1 雲端存檔、排行榜、基本反作弊。
架構跟《墨戰 War-of-Ink》同一套：Worker 出靜態頁 + `/api/*`，D1 存玩家資料。

## 檔案結構
```
ashen-depths/
├─ public/
│  └─ index.html      # 遊戲本體（純 HTML/CSS/JS，無外部依賴，字型走 Google Fonts CDN）
├─ worker.js           # Cloudflare Worker：靜態資產 + /api/save /api/load /api/leaderboard
├─ wrangler.toml        # Worker + D1 綁定設定
├─ schema.sql             # D1 資料表（全新部署用這個）
└─ migration.sql          # 如果你已經部署過舊版，跑這個升級資料表
```

## 部署步驟（全新部署）

1. 建立 D1 資料庫（第一次執行才需要）：
   ```bash
   npx wrangler d1 create ashen-depths-db
   ```
   會印出一組 `database_id`，複製它。

2. 把 `database_id` 貼進 `wrangler.toml` 的 `REPLACE_WITH_YOUR_D1_DATABASE_ID`。

3. 建表：
   ```bash
   npx wrangler d1 execute ashen-depths-db --remote --file=./schema.sql
   ```

4. 部署：
   ```bash
   npx wrangler deploy
   ```

5. 完成後 wrangler 會給一個 `*.workers.dev` 網址，開啟即可玩。

## 如果你已經部署過舊版（只有 id/data/updated_at 的 players 表）

跑遷移腳本補上 `name` / `best_stage` / `best_gold` / `flagged` 欄位：
```bash
npx wrangler d1 execute ashen-depths-db --remote --file=./migration.sql
```
然後照常 `npx wrangler deploy` 換新的 worker.js 跟 public/index.html。

## 這次補的三件事

### 1. 排行榜
`GET /api/leaderboard` 依「最深層數」排序回傳前 20 名（`best_stage` 是歷史最高，不會因為死亡扣金幣或當前層數浮動而掉榜）。前端在背包下方新增「排行榜」面板，載入時抓一次、之後每 30 秒自動刷新，也有手動「重新整理」。玩家可在頭像下方直接改暱稱（存在 localStorage，跟隨這台裝置/這組存檔ID）。

### 2. 存檔反作弊（heuristic，不是完整伺服器模擬）
老實講清楚這個做了什麼、沒做什麼：

**做了什麼**：`/api/save` 會拿這次存檔跟上一次存檔的時間差，回推「這段時間內物理上最多可能推進幾層、升幾級、賺多少金幣」（用遊戲本身最寬鬆的數值：速度x4、不間斷點擊、慷慨抓一個上限再加緩衝）。如果送上來的存檔超過這個上限，伺服器會直接把 stage/level/gold 砍回合理上限，存進資料庫的是砍過的版本，同時標記 `flagged`，前端會在戰鬥紀錄顯示一則提示。這擋得住「直接改 localStorage 灌數字、或重放一個誇張大的數字」這類最常見的作弊。

**沒做什麼**：現在的戰鬥還是純前端即時運算（放置遊戲沒有伺服器 tick loop），所以如果有人寫一個「改過的用戶端，但推進速度乖乖卡在上限以下」，這套機制擋不住。要完全杜絕，得把戰鬥結算搬到 Worker 端做權威運算（伺服器自己跑戰鬥邏輯、定期由伺服器產生事件，前端只負責顯示），這是規模明顯更大的重寫，如果你要往這個方向做，我可以再幫你規劃。

### 3. 存檔機制（沿用前一版，這次補了暱稱欄位）
- 前端在瀏覽器 localStorage 產生一組隨機 `playerId`（不用註冊/登入），每次升級、掉裝、換裝、過關都會 debounce 後打 `POST /api/save`（同時帶暱稱），同時鏡射一份到 localStorage 當離線備援。
- 開啟頁面時打 `GET /api/load?playerId=xxx`，雲端有資料就用雲端的，沒有就退回本機備援，都沒有就開新遊戲。
- 要在別的裝置接續進度：左側面板「複製ID」，到新裝置貼到「還原」欄位即可切換到同一份存檔——注意這代表任何拿到你 ID 的人都能讀寫你的存檔，這是匿名裝置級存檔的固有限制，不是帳號系統。

## 本機測試

沒部署前也能直接雙擊打開 `public/index.html` 玩——這時候 `/api/save`、`/api/load`、`/api/leaderboard` 會 fetch 失敗，遊戲自動退回純 localStorage 存檔模式、排行榜面板顯示「暫時無法讀取」，部署後自動切回雲端同步，邏輯不用改。

## 還沒做、之後想擴充可以考慮的方向

- 真正的帳號系統（Email/OAuth），取代目前「複製ID當密碼」的匿名模式
- 伺服器權威戰鬥運算（見上面反作弊段落），徹底杜絕改用戶端作弊
- 更多怪物/裝備詞綴、套裝效果、技能樹
- 依金幣排序的第二個排行榜分頁、好友對戰/公會等社交功能
