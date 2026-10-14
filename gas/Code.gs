/**
 * 超市補貨 —「暫不考慮」剔除清單。Google Sheet 係唯一來源。
 *
 * 綁定同部署：
 * 1. 新建試算表，名稱「超市補貨-剔除」。
 * 2. 擴充功能 → Apps Script，刪除預設程式，貼上本檔，儲存（執行環境用 V8）。
 * 3. 部署 → 新增部署 → 類型：網頁應用程式。
 *    執行身分：我（Execute as Me）
 *    誰可以存取：任何人（Anyone）
 * 4. 授權後複製以 /exec 結尾嘅網址，貼入網站 config.js 嘅 GROCERY_EXCLUSIONS_API。
 *    之後改過程式，要喺「管理部署」建立新版本先會生效。
 *
 * 欄位：type | name | excludedAt（香港時間 ISO，+08:00）| note | status（excluded 或 restored）。
 * 主鍵係 type|name。回復只改 status，保留該列做審計，唔刪行。
 * 瀏覽器用簡單請求：GET，或 POST 且 Content-Type 為 text/plain
 * （Apps Script 唔會回應 CORS preflight OPTIONS；Web App「任何人」會加 Access-Control-Allow-Origin）。
 */

var HEADERS = ["type", "name", "excludedAt", "note", "status"];
var MAX_TYPE = 80;
var MAX_NAME = 120;
var MAX_NOTE = 200;

function doGet(e) {
  return withLock_(function () {
    var data = readAll_();
    return json_({ items: excludedOnly_(data.rows) });
  });
}

function doPost(e) {
  return withLock_(function () {
    var body = parseBody_(e);
    var action = body.action;
    var type = clean_(body.type, MAX_TYPE);
    var name = clean_(body.name, MAX_NAME);
    var data = readAll_();

    if (action !== "exclude" && action !== "restore") {
      return json_({
        items: excludedOnly_(data.rows),
        error: "action 必須係 exclude 或 restore",
      });
    }
    if (!type || !name) {
      return json_({
        items: excludedOnly_(data.rows),
        error: "缺少 type 或 name",
      });
    }

    var matches = data.rows.filter(function (row) {
      return row.type === type && row.name === name;
    });

    if (action === "exclude") {
      var hasNote = body.note != null;
      var note = hasNote ? clean_(body.note, MAX_NOTE) : matches.length ? matches[0].note : "";
      var excludedAt = nowHkt_();
      var targets = matches.length ? matches : [{ rowIndex: data.sheet.getLastRow() + 1 }];
      targets.forEach(function (row) {
        var range = data.sheet.getRange(row.rowIndex, 1, 1, HEADERS.length);
        range.setNumberFormat("@");
        range.setValues([[type, name, excludedAt, note, "excluded"]]);
      });
    } else if (!matches.length) {
      return json_({
        items: excludedOnly_(data.rows),
        error: "找不到呢項",
      });
    } else {
      matches.forEach(function (row) {
        data.sheet.getRange(row.rowIndex, 5).setValue("restored");
      });
    }

    var fresh = readAll_();
    return json_({ items: excludedOnly_(fresh.rows) });
  });
}

function withLock_(fn) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(20000);
  } catch (err) {
    return json_({ items: [], error: "系統忙，請再試" });
  }
  try {
    return fn();
  } catch (err) {
    var message = err && err.message ? String(err.message) : "讀寫失敗";
    if (message.length > 160 || message.indexOf("\n") !== -1) message = "讀寫失敗";
    return json_({ items: [], error: message });
  } finally {
    lock.releaseLock();
  }
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(
    ContentService.MimeType.JSON
  );
}

function parseBody_(e) {
  var raw = "";
  if (e && e.postData && e.postData.contents) raw = e.postData.contents;
  if (!raw && e && e.parameter && e.parameter.payload) raw = e.parameter.payload;
  if (!raw) return {};
  try {
    var parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (err) {
    return {};
  }
}

function sheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) {
    throw new Error("請將程式綁定喺試算表，唔好用獨立專案。");
  }
  var sh = ss.getSheets()[0];
  if (!sh) throw new Error("試算表冇工作表");
  ensureHeaders_(sh);
  return sh;
}

function ensureHeaders_(sheet) {
  var first = sheet.getRange(1, 1, 1, HEADERS.length).getValues()[0];
  var blank = first.every(function (cell) {
    return String(cell || "").trim() === "";
  });
  if (blank) {
    sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]);
    sheet.setFrozenRows(1);
    sheet.getRange(1, 1, Math.max(sheet.getMaxRows(), 1), HEADERS.length).setNumberFormat("@");
    return;
  }
  var matches = HEADERS.every(function (header, i) {
    return String(first[i] || "").trim() === header;
  });
  if (!matches) {
    throw new Error("第一列欄位必須係 type、name、excludedAt、note、status");
  }
}

function readAll_() {
  var sheet = sheet_();
  var values = sheet.getDataRange().getValues();
  var rows = [];
  for (var i = 1; i < values.length; i++) {
    var row = values[i];
    var type = clean_(row[0], MAX_TYPE);
    var name = clean_(row[1], MAX_NAME);
    if (!type && !name) continue;
    rows.push({
      rowIndex: i + 1,
      type: type,
      name: name,
      excludedAt: cellText_(row[2]),
      note: clean_(row[3], MAX_NOTE),
      status: String(row[4] || "").trim(),
    });
  }
  return { sheet: sheet, rows: rows };
}

function excludedOnly_(rows) {
  var list = [];
  rows.forEach(function (row) {
    if (row.status !== "excluded" || !row.type || !row.name) return;
    var existing = null;
    for (var i = 0; i < list.length; i++) {
      if (list[i].type === row.type && list[i].name === row.name) {
        existing = list[i];
        break;
      }
    }
    if (!existing) {
      list.push({
        type: row.type,
        name: row.name,
        excludedAt: row.excludedAt,
        note: row.note,
        status: "excluded",
      });
      return;
    }
    if (String(row.excludedAt) >= String(existing.excludedAt)) {
      existing.excludedAt = row.excludedAt;
      existing.note = row.note;
    }
  });
  list.sort(function (a, b) {
    if (a.excludedAt !== b.excludedAt) return a.excludedAt < b.excludedAt ? 1 : -1;
    if (a.type !== b.type) return a.type < b.type ? -1 : 1;
    if (a.name !== b.name) return a.name < b.name ? -1 : 1;
    return 0;
  });
  return list;
}

function cellText_(value) {
  if (Object.prototype.toString.call(value) === "[object Date]" && !isNaN(value.getTime())) {
    return Utilities.formatDate(value, "Asia/Hong_Kong", "yyyy-MM-dd'T'HH:mm:ss") + "+08:00";
  }
  return String(value || "").trim();
}

function clean_(value, maxLen) {
  if (value == null) return "";
  if (typeof value !== "string" && typeof value !== "number") return "";
  var text = String(value).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").trim();
  if (text.length > maxLen) text = text.slice(0, maxLen);
  return text;
}

function nowHkt_() {
  return (
    Utilities.formatDate(new Date(), "Asia/Hong_Kong", "yyyy-MM-dd'T'HH:mm:ss") + "+08:00"
  );
}
