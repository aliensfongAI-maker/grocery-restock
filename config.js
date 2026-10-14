/**
 * 「暫不考慮」剔除清單嘅 Apps Script Web App 網址。
 *
 * 按 README 部署 gas/Code.gs 之後（執行身分：我；誰可以存取：任何人），
 * 將以 /exec 結尾嘅網址貼入下面字串。
 * 留空 = 功能關閉：主清單照常顯示，「暫不考慮」同「手動暫緩」會停用（窄螢幕喺「⋯」入面，闊螢幕係一行按鈕）。
 * 同一個網址同時處理剔除同手動暫緩。改完 Code.gs 要建立新部署版本，網址可以不變。
 *
 * 唔好加 token，唔好放私人參數。網站請求只會帶 type、name、note。
 */
window.GROCERY_EXCLUSIONS_API = "https://script.google.com/macros/s/AKfycbwb226k6-iCnqirUgnk-1XVZSu2PupvxTtEros1haE5h5ku_GX_nuNEavevo1d0J6kS3A/exec";
