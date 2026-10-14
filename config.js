/**
 * 「暫不考慮」剔除清單嘅 Apps Script Web App 網址。
 *
 * 按 README 部署 gas/Code.gs 之後（執行身分：我；誰可以存取：任何人），
 * 將以 /exec 結尾嘅網址貼入下面字串。
 * 留空 = 功能關閉：主清單照常顯示，「暫不考慮」按鈕會停用。
 *
 * 唔好加 token，唔好放私人參數。網站請求只會帶 type、name、note。
 */
window.GROCERY_EXCLUSIONS_API = "";
