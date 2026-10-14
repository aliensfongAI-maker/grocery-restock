# 超市補貨

公開靜態單頁：睇補貨歷史同建議（唔下單）。顯示名「超市補貨」。粵語／繁中、香港時間（HKT）、手機優先。

## 檔案

| 檔案 | 用途 |
|------|------|
| `index.html` | 頁面結構 |
| `styles.css` | 樣式（mobile-first） |
| `app.js` | 讀 `data.json`、搜尋／篩選、按類型摺疊 |
| `data.json` | 建議資料（前端只顯示 `suggest`，唔重算） |

## GitHub Pages

1. 建 public repo `grocery-restock`（或將呢啲檔放喺 repo **main 分支根目錄**）。
2. Settings → Pages → Source：**Deploy from a branch** → Branch：**main** → Folder：**/ (root)**。
3. 等一兩分鐘，開 `https://<user>.github.io/grocery-restock/`。

唔好放私人資料、價錢、地址、帳戶資訊入 `data.json`。

## 本機預覽

需要 HTTP（`fetch` 讀 `data.json`），唔好直接開 `file://`：

```bash
cd grocery-restock
python3 -m http.server 8080
# 或：npx --yes serve -p 8080
```

瀏覽器開 `http://localhost:8080`。

## data.json

- `updatedAt`：ISO 8601，HKT（例如 `2026-10-14T14:00:00+08:00`）
- `items[]`：`type`（大類摺疊）、`name`（貨品種類）、`lastPurchased`、`daysSince`、`suggest`（只得 `優先`｜`暫緩`｜`在途`）、`note`、可選 `image`／`imageAlt`
