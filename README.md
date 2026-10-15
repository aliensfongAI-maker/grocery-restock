# 超市補貨

公開靜態頁：睇補貨歷史同建議（唔下單）。`index.html` 可以暫不考慮同手動暫緩。`view.html` 只供睇。顯示名「超市補貨」。粵語／繁中、英文、印尼文、香港時間（HKT）、手機優先。

## 檔案

| 檔案 | 用途 |
|------|------|
| `index.html` | 編輯頁：搜尋、分組、剔除同手動暫緩 |
| `view.html` | 唯讀頁。同一份資料同語言，冇寫入動作，亦冇連去編輯頁 |
| `styles.css` | 樣式（mobile-first） |
| `app.js` | 讀 `data.json`、搜尋／篩選、兩層分組、牌子摺疊。`window.GROCERY_READ_ONLY` 為真時唔呼叫剔除／暫緩 |
| `i18n-data.json` | `type`、`subtype`、品名嘅英文同印尼文對照（靜態檔，冇翻譯 API） |
| `config.js` | Sheet Web App 網址（預設留空；剔除、暫緩、改類共用） |
| `gas/Code.gs` | Apps Script：讀寫 Google Sheet（剔除、暫緩、改類 overrides） |
| `gas/seed-reclass.json` | 改類 seed 清單（9 行）。編輯器跑 `seedReclassOverrides_()`，呢份檔唔會被網站讀 |
| `data.json` | 建議資料（前端只顯示 `suggest`，唔重算；唔存剔除或暫緩） |

## 分組

工具列可以切「建議優先」同「類型優先」。

- **建議優先**（預設）：先按建議（已下單／優先／未使買住；手動暫緩會計入未使買住），再按類型。篩選芯片次序一樣。
- **類型優先**：先按類型，再按建議。

`data.json` 嘅 `suggest` 仍然係 `優先`｜`暫緩`｜`在途`。頁面先改顯示：`暫緩` 顯示做「未使買住」，`在途` 顯示做「已下單」（英文 Not needed yet／Ordered，印尼文 Belum perlu beli／Sudah dipesan）。篩選同分組仍然跟住呢兩個值。

類型**剛好**係「水果」或「蔬菜」嘅項目只係購買紀錄（`鮮果蔬` 唔算）。無論 `suggest` 係缺失、null，定係仍然有值，都唔會塞入優先／暫緩／在途：

- **建議優先**：佢哋集中喺建議組後面嘅「紀錄」組（英文 Record、印尼文 Riwayat），組內再按類型。
- **類型優先**：仍然先見到「水果」「蔬菜」，入面只得一組「紀錄」，唔再拆建議。
- 建議篩選揀「全部」會列出佢哋。揀優先／暫緩／在途唔會當佢哋係嗰個建議，避免紀錄被藏喺建議桶。類型篩選同搜尋照用。

呢兩類只顯示上次購買、距今天數、包裝同牌子。唔顯示建議章，窄螢幕冇「⋯」，闊螢幕冇手動暫緩／暫不考慮／回復。舊有 Sheet 剔除或暫緩都唔會改佢哋嘅顯示（頁面唔寫 Sheet）。

兩層都可以獨立展開同摺疊。選擇記喺瀏覽器 `grocery-restock-group-mode`（`suggest-type` 或 `type-suggest`）。

每行預設顯示品名、`subtype`、包裝、距今天數同建議（水果同蔬菜冇建議欄同操作欄）。窄螢幕（手機）手動動作收喺右邊「⋯」入面（手動暫緩、暫不考慮、回復、回復日子），撳開先見到。闊螢幕（900px 或以上，例如 Windows 電腦）同一行直接顯示呢啲動作按鈕，欄位對齊成品名、距今、建議、操作。水果同蔬菜喺闊螢幕只對齊品名同距今。`view.html` 唔顯示呢啲動作。

## 語言

頁頂可以切「中」「eng」「印」。介面字句喺 `app.js`。`type`（分組標題同類型篩選）、`subtype`（每行）、品名由 `i18n-data.json` 對照英文同印尼文。中文顯示 `data.json` 原文。對唔到或者譯文空白都顯示原本中文。`note`、牌子、牌子標題、`pack` 唔翻譯。冇翻譯 API。

## 唯讀頁

`view.html` 同 `index.html` 讀同一份 `data.json` 同 `i18n-data.json`。保留語言、分組、搜尋、類型篩選、兩層摺疊同牌子展開。頁面喺載入 `app.js` 之前設 `window.GROCERY_READ_ONLY = true`，所以唔顯示「⋯」、手動暫緩、暫不考慮、回復、暫緩備註，亦唔讀寫 Google Sheet。文件標題同 `h1` 仍然係「超市補貨」。頁內冇連去 `/` 或 `index.html`。

## GitHub Pages

1. 建 public repo `grocery-restock`（或將呢啲檔放喺 repo **main 分支根目錄**）。
2. Settings → Pages → Source：**Deploy from a branch** → Branch：**main** → Folder：**/ (root)**。
3. 等一兩分鐘，開 `https://<user>.github.io/grocery-restock/`。

唔好放私人資料、價錢、地址、帳戶資訊入 `data.json`。

## 暫不考慮（Google Sheet）

剔除／回復同手動暫緩都唔寫入 `data.json`。Google Sheet 先算數；主清單照舊只讀 `data.json`。每項主鍵係 `type|name`（成件貨，唔係逐個牌子）。

工作表欄位：`type | name | at | note | status`。`at` 係香港時間 ISO。`status` 只得 `excluded`、`restored`、`held`、`unheld`。

- **暫不考慮**：`exclude` 把貨品喺主清單隱藏；`restore` 只把該列 `status` 改做 `restored`，唔刪行。
- **手動暫緩**：`hold` 追加一列 `held`。貨品留喺主清單，頁面暫時顯示建議「未使買住」（`data.json` 嘅值仍然係 `暫緩`），上次購買同距今天數由 `at` 計（暫緩當日係 0）。備註欄開啟時預填「已從非網購渠道補貨」，可以改或者清空先確認。`unhold` 追加一列 `unheld`，唔刪舊列；頁面恢復 `data.json` 嘅日子同建議。
- 兩件事分開。暫緩唔會隱藏；剔除先會。同一件貨可以同時有兩組列。
- 舊表如果第一列係 `excludedAt`，第一次讀寫會把欄名改做 `at`，入面嘅時間唔郁。

`doGet` 回傳 `{ items: [剔除中…], held: [暫緩中…], overrides: [改類 active…] }`。`overrides` 只包含最新狀態係 `active` 嘅列；`cleared` 唔出現。剔除同暫緩嘅讀寫同之前一樣，同改類分開。

1. 開新 Google 試算表，名稱 **超市補貨-剔除**（用第一個工作表，唔使自己打欄位）。
2. 擴充功能 → **Apps Script**。刪除預設程式，將 `gas/Code.gs` 全部貼上，儲存。
3. **部署 → 新增部署 → 網頁應用程式**。
   - 執行身分：**我**（Execute as Me）
   - 誰可以存取：**任何人**（Anyone）
4. 授權試算表存取。複製以 `/exec` 結尾嘅 Web App 網址。
5. 貼入 `config.js`：

```js
window.GROCERY_EXCLUSIONS_API = "https://script.google.com/macros/s/…/exec";
```

6. Commit 並 push 到 GitHub Pages 用緊嘅分支。之後改 `Code.gs`，要喺「管理部署」建立**新版本**先會生效。
7. 部署新版本之後，喺 Apps Script 編輯器跑一次 `seedReclassOverrides_()`。佢會寫入 9 行初始改類（濕紙巾、幼兒小食／補充、洗衣液、成人益生菌）。同一 `oldType|name` 已經有 `active` 列就跳過。清單同 `gas/seed-reclass.json` 一致；網站唔讀呢份 JSON。

### 改類（overrides）

同一個 Web App、同一張試算表。冇名為 `overrides` 嘅工作表就會自動建立。欄位：`oldType | name | newType | newSubtype | at | status | note`。`status` 只得 `active`、`cleared`。主鍵係 `oldType|name`（對應 `data.json` 嘅 `type|name`）。

- **改類**：POST `action` 係 `reclass`，再帶 `type`、`name`、`newType`、`newSubtype`（可空）、可選 `note`。追加一列 `active`。
- **取消改類**：POST `action` 係 `reclass_clear`，帶 `type`、`name`。追加一列 `cleared`。GET 唔再回傳該鍵。
- 成功 `reclass` 之後先通知，主體係 JSON `{ event: "reclass", type, name, newType, newSubtype, at }`。優先 Script Property `RECLASS_NOTIFY_EMAIL`（例如 `reclass@mail.grokbot.com`），用 `MailApp.sendEmail` 寄出。有呢個值就唔打 webhook。冇 email 先至可選用 `RECLASS_WEBHOOK_URL` POST 同一份 JSON；`RECLASS_WEBHOOK_AUTH` 係完整 `Authorization` header。兩個都空就唔通知。通知失敗唔會擋低寫入。新版本部署要授權寄信。
- 編輯頁「⋯」可以呼叫 `reclass`／`reclass_clear`。`view.html` 冇改類按鈕。通知只喺 Apps Script 發生，唔寫入 `data.json`。

`GROCERY_EXCLUSIONS_API` 留空時，頁面照常顯示補貨清單，「⋯」入面嘅「暫不考慮」同「手動暫緩」會停用。網站請求只帶 `type`、`name`、`note`（時間由試算表寫入），冇 token、冇私人資料。瀏覽器可能用 localStorage 暫存剔除同暫緩，但每次成功讀到 Sheet 都會以試算表覆蓋。

### 讀清單：fetch，失敗就 JSONP

`curl` GET 網頁應用程式多數會 200，而且會 302 去 `script.googleusercontent.com`（回應有 `Access-Control-Allow-Origin: *`）。瀏覽器嘅 `fetch` 跟住呢個重新導向，有時會被 CORS 或攔截擴充功能擋低，頁面就會顯示「讀唔到剔除清單…」，後面附上真正嘅錯誤訊息。

所以讀取（GET）失敗時，`app.js` 會再試一次 `<script>` JSONP：網址加 `callback` 參數。`gas/Code.gs` 嘅 `doGet`：

- 有合法 `callback`：回傳 `callback({...});`，MIME 為 JavaScript
- 冇 `callback`：照舊回 JSON

寫入（POST）維持 `Content-Type: text/plain` 嘅 JSON 主體，係簡單請求，唔會觸發 CORS preflight。

**你而家要做：** 將更新後嘅 `gas/Code.gs` 貼上 Apps Script，然後喺「部署 → 管理部署」建立**新版本**（執行身分：我；誰可以存取：任何人）。同一個 Web App 網址可以繼續用，但一定要換成新版本。未建立新版本之前：

- 舊程式唔識 `callback`，JSONP 後備用唔到（`fetch` 成功就唔使靠 JSONP）
- 舊程式唔識 `hold`／`unhold`，亦唔會回傳 `held`，「手動暫緩」用唔到
- 舊程式唔識 `reclass`／`reclass_clear`，亦唔會回傳 `overrides`

## 本機預覽

需要 HTTP（`fetch` 讀 `data.json`），唔好直接開 `file://`：

```bash
cd grocery-restock
python3 -m http.server 8080
# 或：npx --yes serve -p 8080
```

瀏覽器開 `http://localhost:8080`。

## data.json

- `updatedAt`：ISO 8601，HKT（例如 `2026-10-14T16:25:30+08:00`）
- `items[]`：`type`（大類摺疊）、`subtype`（HKTVmall 第二層，顯示喺品名下）、`name`（貨品種類）、`lastPurchased`、`daysSince`、`suggest`（只得 `優先`｜`暫緩`｜`在途`；前端只顯示，唔重算。`暫緩` 顯示做「未使買住」，`在途` 顯示做「已下單」）、`note`、可選 `pack`、`brands[]`（一定有，可以係空陣列）
- eng／印 顯示 `type`、`subtype`、`name` 時讀 `i18n-data.json`。`note`、`brand`、`title`、`pack` 維持呢度嘅原文。
- `type` 剛好係「水果」或「蔬菜」：可以冇 `suggest`，或者係 null。前端唔顯示建議，亦唔提供暫緩／剔除。其他類型如果 `suggest` 缺失，會落入「未有建議」，唔會當成優先／暫緩／在途。
- `brands[]`：`brand`（可空）、可選 `title`、`lastPurchased`、`daysSince`、`image`、`imageAlt`、`link`（公開連結）、`note`、可選 `pack`
- 剔除主鍵仍然係成件貨嘅 `type|name`，唔係逐個牌子。`brands` 唔入 Google Sheet。
