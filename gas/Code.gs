/**
 * 超市補貨 — Google Sheet 係「暫不考慮」同「手動暫緩」嘅唯一來源。
 * 唔寫入 data.json。主鍵係 type|name（成件貨，唔係逐個牌子）。
 *
 * 綁定同部署：
 * 1. 新建試算表，名稱「超市補貨-剔除」。
 * 2. 擴充功能 → Apps Script，刪除預設程式，貼上本檔，儲存（執行環境用 V8）。
 * 3. 部署 → 新增部署 → 類型：網頁應用程式。
 *    執行身分：我（Execute as Me）
 *    誰可以存取：任何人（Anyone）
 * 4. 授權後複製以 /exec 結尾嘅網址，貼入網站 config.js 嘅 GROCERY_EXCLUSIONS_API。
 *    之後改過程式，必須喺「管理部署」建立新版本。網址可以不變，但舊版本唔會自動更新。
 *
 * 欄位：type | name | at（香港時間 ISO，+08:00）| note | status。
 * status：excluded、restored、held、unheld。
 * 舊表第一列如果係 excludedAt，第一次讀寫會把欄名改做 at，儲存格內容唔郁。
 * 剔除／回復改同一組 excluded|restored 列，唔刪行。
 * 手動暫緩／回復日子每次追加一列（held 或 unheld），唔刪舊列。最新一列先算數。
 * 兩組列互不相干：暫緩唔會隱藏貨品，剔除先會。
 *
 * 瀏覽器用簡單請求：GET，或 POST 且 Content-Type 為 text/plain
 * （Apps Script 唔會回應 CORS preflight OPTIONS；Web App「任何人」會加 Access-Control-Allow-Origin）。
 * GET 可加 callback（只接受 JS 識別字）。有 callback 就回傳 callback({...})，MIME 為 JavaScript，
 * 畀 <script> JSONP 用；冇 callback 就照舊回 JSON。
 * doGet 回傳 { items: 剔除中, held: 暫緩中 }。
 * POST 主體維持 text/plain JSON，action 係 exclude、restore、hold 或 unhold。唔加 callback。
 */

var HEADERS = ["type", "name", "at", "note", "status"];
var OLD_HEADERS = ["type", "name", "excludedAt", "note", "status"];
var MAX_TYPE = 80;
var MAX_NAME = 120;
var MAX_NOTE = 200;

function doGet(e) {
  var callback = callbackName_(e);
  return withLock_(function () {
    var data = readAll_();
    return respond_(sheetPayload_(data.rows), callback);
  }, callback);
}

function doPost(e) {
  return withLock_(function () {
    var body = parseBody_(e);
    var action = body.action;
    var type = clean_(body.type, MAX_TYPE);
    var name = clean_(body.name, MAX_NAME);
    var data = readAll_();
    var known =
      action === "exclude" || action === "restore" || action === "hold" || action === "unhold";

    if (!known) {
      return json_(
        sheetPayload_(data.rows, "action 必須係 exclude、restore、hold 或 unhold")
      );
    }
    if (!type || !name) {
      return json_(sheetPayload_(data.rows, "缺少 type 或 name"));
    }

    var matches = data.rows.filter(function (row) {
      return row.type === type && row.name === name;
    });
    var error = "";
    if (action === "exclude" || action === "restore") {
      error = applyExclusion_(data.sheet, matches, action, body, type, name);
    } else {
      error = applyHold_(data.sheet, matches, action, body, type, name);
    }
    if (error) return json_(sheetPayload_(data.rows, error));

    var fresh = readAll_();
    return json_(sheetPayload_(fresh.rows));
  });
}

function withLock_(fn, callback) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(20000);
  } catch (err) {
    return respond_(sheetPayload_([], "系統忙，請再試"), callback);
  }
  try {
    return fn();
  } catch (err) {
    var message = err && err.message ? String(err.message) : "讀寫失敗";
    if (message.length > 160 || message.indexOf("\n") !== -1) message = "讀寫失敗";
    return respond_(sheetPayload_([], message), callback);
  } finally {
    lock.releaseLock();
  }
}

function callbackName_(e) {
  var raw = "";
  if (e && e.parameter && e.parameter.callback != null) raw = String(e.parameter.callback);
  raw = raw.replace(/^\s+|\s+$/g, "");
  if (!raw) return "";
  if (!/^[A-Za-z_$][A-Za-z0-9_$]{0,63}$/.test(raw)) return "";
  return raw;
}

function jsonText_(obj) {
  return JSON.stringify(obj)
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029")
    .replace(/</g, "\\u003c");
}

function json_(obj) {
  return ContentService.createTextOutput(jsonText_(obj)).setMimeType(
    ContentService.MimeType.JSON
  );
}

function jsonp_(callback, obj) {
  return ContentService.createTextOutput(callback + "(" + jsonText_(obj) + ");").setMimeType(
    ContentService.MimeType.JAVASCRIPT
  );
}

function respond_(obj, callback) {
  if (callback) return jsonp_(callback, obj);
  return json_(obj);
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

function headersMatch_(actual, expected) {
  return expected.every(function (header, i) {
    return String(actual[i] || "").trim() === header;
  });
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
  if (headersMatch_(first, HEADERS)) return;
  if (headersMatch_(first, OLD_HEADERS)) {
    sheet.getRange(1, 3).setValue("at");
    return;
  }
  throw new Error("第一列欄位必須係 type、name、at、note、status");
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
      at: cellText_(row[2]),
      note: clean_(row[3], MAX_NOTE),
      status: String(row[4] || "").trim(),
    });
  }
  return { sheet: sheet, rows: rows };
}

function writeStatusRow_(sheet, rowIndex, type, name, at, note, status) {
  var range = sheet.getRange(rowIndex, 1, 1, HEADERS.length);
  range.setNumberFormat("@");
  range.setValues([[type, name, at, note, status]]);
}

function applyExclusion_(sheet, matches, action, body, type, name) {
  var rows = matches.filter(function (row) {
    return row.status === "excluded" || row.status === "restored";
  });
  if (action === "exclude") {
    var hasNote = body.note != null;
    var note = hasNote ? clean_(body.note, MAX_NOTE) : rows.length ? rows[0].note : "";
    var at = nowHkt_();
    var targets = rows.length ? rows : [{ rowIndex: sheet.getLastRow() + 1 }];
    targets.forEach(function (row) {
      writeStatusRow_(sheet, row.rowIndex, type, name, at, note, "excluded");
    });
    return "";
  }
  var excluded = rows.filter(function (row) {
    return row.status === "excluded";
  });
  if (!excluded.length) return "找不到呢項";
  excluded.forEach(function (row) {
    sheet.getRange(row.rowIndex, 5).setValue("restored");
  });
  return "";
}

function applyHold_(sheet, matches, action, body, type, name) {
  var prev = latestOf_(matches, ["held", "unheld"]);
  if (action === "hold") {
    var hasNote = body.note != null;
    var note = hasNote ? clean_(body.note, MAX_NOTE) : prev ? prev.note : "";
    writeStatusRow_(sheet, sheet.getLastRow() + 1, type, name, nowHkt_(), note, "held");
    return "";
  }
  if (!prev || prev.status !== "held") return "找不到手動暫緩紀錄";
  writeStatusRow_(sheet, sheet.getLastRow() + 1, type, name, nowHkt_(), prev.note, "unheld");
  return "";
}

function latestOf_(rows, statuses) {
  var best = null;
  rows.forEach(function (row) {
    if (statuses.indexOf(row.status) === -1) return;
    if (!best || String(row.at) > String(best.at) || (String(row.at) === String(best.at) && row.rowIndex >= best.rowIndex)) {
      best = row;
    }
  });
  return best;
}

function sheetPayload_(rows, error) {
  var payload = { items: excludedOnly_(rows), held: heldOnly_(rows) };
  if (error) payload.error = error;
  return payload;
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
      list.push(publicExclusion_(row));
      return;
    }
    if (String(row.at) >= String(existing.at)) {
      existing.at = row.at;
      existing.excludedAt = row.at;
      existing.note = row.note;
    }
  });
  list.sort(byAtDesc_);
  return list;
}

function heldOnly_(rows) {
  var grouped = {};
  rows.forEach(function (row) {
    if ((row.status !== "held" && row.status !== "unheld") || !row.type || !row.name) return;
    var key = row.type + "\n" + row.name;
    var prev = grouped[key];
    if (
      !prev ||
      String(row.at) > String(prev.at) ||
      (String(row.at) === String(prev.at) && row.rowIndex >= prev.rowIndex)
    ) {
      grouped[key] = row;
    }
  });
  var list = [];
  Object.keys(grouped).forEach(function (key) {
    var row = grouped[key];
    if (row.status !== "held") return;
    list.push({
      type: row.type,
      name: row.name,
      at: row.at,
      note: row.note,
      status: "held",
    });
  });
  list.sort(byAtDesc_);
  return list;
}

function publicExclusion_(row) {
  return {
    type: row.type,
    name: row.name,
    at: row.at,
    excludedAt: row.at,
    note: row.note,
    status: "excluded",
  };
}

function byAtDesc_(a, b) {
  var aAt = a.at || a.excludedAt || "";
  var bAt = b.at || b.excludedAt || "";
  if (aAt !== bAt) return aAt < bAt ? 1 : -1;
  if (a.type !== b.type) return a.type < b.type ? -1 : 1;
  if (a.name !== b.name) return a.name < b.name ? -1 : 1;
  return 0;
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
