/**
 * 剔除／暫緩／改類 API。
 *
 * 而家呢行係已部署嘅 Cloudflare Worker。直切步驟喺 workers/README.md。
 *
 * 直切（同一步，冇並行期，冇雙寫）：
 * 1. 部署 Worker、開 D1、跑 migration、設 secrets，用 GAS GET snapshot 匯入 D1。
 * 2. 將下面網址改成該次 deploy 印出嘅 Worker URL（根路徑，唔使 /exec）。
 * 3. Push 上 GitHub Pages。
 * 4. Pages 已經用緊新網址之後，停用 GAS 網頁應用程式。唔好兩邊同時寫。
 *
 * 留空 = 功能關閉：主清單照常顯示，「暫不考慮」同「手動暫緩」會停用（窄螢幕喺「⋯」入面，闊螢幕係一行按鈕）。
 * 唔好加 token，唔好放私人參數。網站請求只會帶 type、name、note。
 */
window.GROCERY_EXCLUSIONS_API = "https://grocery-restock-exclusions.aliensfong-gemini.workers.dev";
// 直切時改成該次 deploy 嘅 Worker URL（<subdomain> 要換成輸出，唔好照抄）：
// window.GROCERY_EXCLUSIONS_API = "https://grocery-restock-exclusions.<subdomain>.workers.dev";
