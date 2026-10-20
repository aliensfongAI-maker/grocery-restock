# 超市補貨 exclusions Worker（D1）

Cloudflare Worker + D1，合約對齊 `gas/Code.gs` 嘅 Web App：

- `GET /` → `{ items, held, overrides }`
- `GET /?callback=onExclusions` → `onExclusions({...});`（只接受 JS 識別字）
- `POST /`，`Content-Type: text/plain;charset=utf-8`，主體 JSON：`{ action, type, name, note?, newType?, newSubtype? }`
- action：`exclude` | `restore` | `hold` | `unhold` | `reclass` | `reclass_clear`
- 主鍵 `type|name`。改類主鍵係請求入面嘅 `type|name`（即 `oldType|name`）
- 時間係香港時間 `YYYY-MM-DDTHH:mm:ss+08:00`
- 長度上限：type 80、name 120、note 200、subtype 80
- 成功 `reclass` 先 POST webhook。失敗唔擋寫入。冇 MailApp

`gas/Code.gs` 留喺 repo 做參考。呢個目錄唔會關 GAS。線上 `config.js` 仍然指住 GAS，直到下面直切嗰一步。

## 邊度要 secret

瀏覽器六個 action **唔使** secret，同而家 GAS Web App「任何人」一樣。頁面 POST 唔加 `Authorization`，先至係簡單請求，唔會 preflight。

| 路徑 | 誰可以呼叫 | 授權 |
|------|------------|------|
| `GET /`、`POST /` 六個 action | 公開網站 | 冇 |
| `POST /admin/seed` | 只係部署時 | `WRITE_SECRET` |
| `POST /admin/import` | 只係直切匯入 | `WRITE_SECRET` |

`WRITE_SECRET` 可以用其中一個 header：

- `Authorization: Bearer <WRITE_SECRET>`
- `X-Write-Secret: <WRITE_SECRET>`

未設定 `WRITE_SECRET` 嘅話，admin 路徑會 401。

## 資料點樣對齊 Sheet

- **剔除**：每個 `type|name` 一行。`exclude` upsert 做 `excluded`；冇帶 `note` 就保留舊備註。`restore` 只把 `excluded` 改做 `restored`。GET `items` 只得而家剔除緊嘅行（`at` 同 `excludedAt` 一樣）。
- **暫緩**：每次 `hold` / `unhold` 追加一行。同一鍵最新 `at`，打和就較大 `id` 先算。GET `held` 只列最新係 `held` 嘅鍵。
- **改類**：每次 `reclass` / `reclass_clear` 追加一行。GET `overrides` 只列最新係 `active` 嘅鍵，並帶 `oldType` 同 `type`（兩個都係舊 type）。
- `/admin/seed` 寫入 `gas/seed-reclass.json` 嗰 9 行，`note` 係 `seed`。個鍵已經有過 `active` 列就跳過（同 GAS `seedReclassOverrides`）。**唔**打 webhook。
- `/admin/import` 收 GAS GET 嘅 `{ items, held, overrides }`。預設只係合併呢啲鍵。`"replace": true` 會令公開狀態同 snapshot 一致（多出嚟嘅剔除變 restored，暫緩同改類歷史換做 snapshot）。**唔**打 webhook。

## 直切順序

冇並行期。`config.js` 改指 Worker 同停用 GAS Web App 要同一步做完。

1. 你自己登入（agent 唔會代你 login）：

   ```bash
   cd workers
   npx wrangler login
   ```

2. 開 D1，將印出嘅 `database_id` 寫入 `wrangler.toml`（而家係全零 placeholder）：

   ```bash
   npx wrangler d1 create grocery-restock-exclusions
   npx wrangler d1 migrations apply grocery-restock-exclusions --remote
   ```

3. 設 secrets。`WRITE_SECRET` 匯入之前就要有。兩個 webhook 可以等到 Grocery Bot 準備好先設；未設之前改類仍然會寫入，只係唔通知。

   ```bash
   npx wrangler secret put WRITE_SECRET
   npx wrangler secret put RECLASS_WEBHOOK_URL
   npx wrangler secret put RECLASS_WEBHOOK_AUTH
   ```

   - `WRITE_SECRET`：長隨機字串。只係 admin。唔好放進 `config.js` 或 `data.json`。
   - `RECLASS_WEBHOOK_URL`：Grocery Bot 收 webhook 嘅 URL。Bot 未好就先唔設。
   - `RECLASS_WEBHOOK_AUTH`：成段 `Authorization` header 值（例如 `Bearer …`）。Bot 唔要求就留空。

4. 部署，抄低終端機印出嘅 `*.workers.dev`（或自訂網域）URL。唔好估 subdomain。

   ```bash
   npx wrangler deploy
   ```

5. 用**而家** GAS GET snapshot 匯入 D1。`GAS_URL` 就係 `config.js` 而家嗰條 `/exec`。

   ```bash
   export GAS_URL="https://script.google.com/macros/s/…/exec"
   export WORKER_URL="https://grocery-restock-exclusions.<subdomain>.workers.dev"
   export WRITE_SECRET="…"

   curl -fsSL "$GAS_URL" -o /tmp/gas-snapshot.json
   node -e 'const fs=require("fs"); const s=JSON.parse(fs.readFileSync("/tmp/gas-snapshot.json","utf8")); s.replace=true; fs.writeFileSync("/tmp/gas-import.json", JSON.stringify(s));'
   curl -fsS -X POST "$WORKER_URL/admin/import" \
     -H "Authorization: Bearer $WRITE_SECRET" \
     -H "Content-Type: application/json" \
     --data-binary @/tmp/gas-import.json
   ```

   對一下 `curl -fsS "$WORKER_URL"` 同 `/tmp/gas-snapshot.json` 嘅 `items` / `held` / `overrides`。空 snapshot 先至需要 seed：

   ```bash
   curl -fsS -X POST "$WORKER_URL/admin/seed" \
     -H "X-Write-Secret: $WRITE_SECRET"
   ```

   呢一下對稿係切換前嘅資料檢查。確認完就切，唔好兩邊同時接流量。

6. 改 `config.js` 嗰一行做第 4 步抄低嘅 URL（根路徑，後面唔使 `/exec`），push 去 GitHub Pages 用緊嘅分支。

7. Pages 已經 serve 緊新 `config.js` 之後，**同一刻**停 GAS：Apps Script → 部署 → 管理部署 → 停用個網頁應用程式。舊 `/exec` 要停，唔好留低接寫入。開住舊頁嘅人要重新載入先至打去 Worker；直切唔會為佢哋繼續開 GAS。

Webhook 仍然未設都可切。Bot 準備好之後再 `npx wrangler secret put RECLASS_WEBHOOK_URL`（同需要嘅 `RECLASS_WEBHOOK_AUTH`）。成功 `reclass` 先會 POST：

```json
{ "event": "reclass", "type": "…", "name": "…", "newType": "…", "newSubtype": "…", "at": "2026-10-15T14:00:00+08:00" }
```

## 本機

```bash
cd workers
npm test
bash scripts/smoke.sh
cp .dev.vars.example .dev.vars
npx wrangler d1 migrations apply grocery-restock-exclusions --local
npx wrangler dev --local
```

`scripts/smoke.sh` 冇 `WORKER_URL` 就只印 curl。設咗 `WORKER_URL` 會打一輪公開 action，再 restore / unhold / reclass_clear 清走煙霧列。

合約測試喺 `workers/test/contract.test.js`，用本機 SQLite 模擬 D1，唔使登入 Cloudflare。
