/**
 * 超市補貨 — Google Sheet 係「暫不考慮」「手動暫緩」同「改類 overrides」嘅唯一來源。
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
 * 工作表：
 * - 第 1 個 sheet：剔除／暫緩（舊行為）
 * - 名為 `overrides` 嘅 sheet：改類（reclass）。冇就自動建。
 *
 * 剔除／暫緩欄位：type | name | at（香港時間 ISO，+08:00）| note | status。
 * status：excluded、restored、held、unheld。
 * 舊表第一列如果係 excludedAt，第一次讀寫會把欄名改做 at，儲存格內容唔郁。
 * 剔除／回復改同一組 excluded|restored 列，唔刪行。
 * 手動暫緩／回復日子每次追加一列（held 或 unheld），唔刪舊列。最新一列先算數。
 * 兩組列互不相干：暫緩唔會隱藏貨品，剔除先會。
 *
 * 改類 overrides 欄位：oldType | name | newType | newSubtype | at | status | note。
 * status：active | cleared。主鍵 = oldType|name（對應公開 data 嘅 type|name）。
 * type／newType 跟 HKTVmall L1（公開站約 17 類）；newSubtype 可用 data 既有值或自由輸入。
 * POST action `reclass` upsert active；`reclass_clear` 將該鍵設為 cleared。
 * 改類成功後會 POST JSON 到 Script Properties `RECLASS_WEBHOOK_URL`
 * （{event:"reclass", type, name, newType, newSubtype, at}）。Property 空就靜音唔打。
 * 優先 `RECLASS_NOTIFY_EMAIL`（例 reclass@mail.grokbot.com）用 MailApp 通知；
 * 可選 webhook：`RECLASS_WEBHOOK_URL`＋`RECLASS_WEBHOOK_AUTH`。
 * 部署後喺編輯器 Run 選單跑一次 `seedReclassOverrides`（冇底線）寫入初始 toddler／濕紙巾／洗衣液等 seed。
 *
 * 瀏覽器用簡單請求：GET，或 POST 且 Content-Type 為 text/plain
 * （Apps Script 唔會回應 CORS preflight OPTIONS；Web App「任何人」會加 Access-Control-Allow-Origin）。
 * GET 可加 callback（只接受 JS 識別字）。有 callback 就回傳 callback({...})，MIME 為 JavaScript，
 * 畀 <script> JSONP 用；冇 callback 就照舊回 JSON。
 * doGet 回傳 { items: 剔除中, held: 暫緩中, overrides: 改類 activeOnly }。
 * POST 主體維持 text/plain JSON；action：exclude、restore、hold、unhold、reclass、reclass_clear。唔加 callback。
 */

var HEADERS = ["type", "name", "at", "note", "status"];
var OLD_HEADERS = ["type", "name", "excludedAt", "note", "status"];
var OVERRIDE_SHEET = "overrides";
var OVERRIDE_HEADERS = ["oldType", "name", "newType", "newSubtype", "at", "status", "note"];
var MAX_TYPE = 80;
var MAX_NAME = 120;
var MAX_NOTE = 200;
var MAX_SUBTYPE = 80;

function doGet(e) {
  var callback = callbackName_(e);
  return withLock_(function () {
    var data = readAll_();
    var overrides = readOverridesActive_();
    return respond_(sheetPayload_(data.rows, "", overrides), callback);
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
      action === "exclude" ||
      action === "restore" ||
      action === "hold" ||
      action === "unhold" ||
      action === "reclass" ||
      action === "reclass_clear";

    if (!known) {
      return json_(
        sheetPayload_(
          data.rows,
          "action 必須係 exclude、restore、hold、unhold、reclass 或 reclass_clear",
          readOverridesActive_()
        )
      );
    }
    if (!type || !name) {
      return json_(sheetPayload_(data.rows, "缺少 type 或 name", readOverridesActive_()));
    }

    if (action === "reclass" || action === "reclass_clear") {
      var reErr = applyReclass_(action, body, type, name);
      if (reErr) return json_(sheetPayload_(data.rows, reErr, readOverridesActive_()));
      var freshRows = readAll_().rows;
      return json_(sheetPayload_(freshRows, "", readOverridesActive_()));
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
    if (error) return json_(sheetPayload_(data.rows, error, readOverridesActive_()));

    var fresh = readAll_();
    return json_(sheetPayload_(fresh.rows, "", readOverridesActive_()));
  });
}

function withLock_(fn, callback) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(20000);
  } catch (err) {
    return respond_(sheetPayload_([], "系統忙，請再試", []), callback);
  }
  try {
    return fn();
  } catch (err) {
    var message = err && err.message ? String(err.message) : "讀寫失敗";
    if (message.length > 160 || message.indexOf("\n") !== -1) message = "讀寫失敗";
    return respond_(sheetPayload_([], message, []), callback);
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

function overridesSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) {
    throw new Error("請將程式綁定喺試算表，唔好用獨立專案。");
  }
  var sh = ss.getSheetByName(OVERRIDE_SHEET);
  if (!sh) {
    sh = ss.insertSheet(OVERRIDE_SHEET);
  }
  ensureOverrideHeaders_(sh);
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

function ensureOverrideHeaders_(sheet) {
  var first = sheet.getRange(1, 1, 1, OVERRIDE_HEADERS.length).getValues()[0];
  var blank = first.every(function (cell) {
    return String(cell || "").trim() === "";
  });
  if (blank) {
    sheet.getRange(1, 1, 1, OVERRIDE_HEADERS.length).setValues([OVERRIDE_HEADERS]);
    sheet.setFrozenRows(1);
    sheet
      .getRange(1, 1, Math.max(sheet.getMaxRows(), 1), OVERRIDE_HEADERS.length)
      .setNumberFormat("@");
    return;
  }
  if (headersMatch_(first, OVERRIDE_HEADERS)) return;
  throw new Error(
    "overrides 第一列必須係 oldType、name、newType、newSubtype、at、status、note"
  );
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

function readOverrideRows_() {
  var sheet = overridesSheet_();
  var values = sheet.getDataRange().getValues();
  var rows = [];
  for (var i = 1; i < values.length; i++) {
    var row = values[i];
    var oldType = clean_(row[0], MAX_TYPE);
    var name = clean_(row[1], MAX_NAME);
    if (!oldType && !name) continue;
    rows.push({
      rowIndex: i + 1,
      oldType: oldType,
      name: name,
      newType: clean_(row[2], MAX_TYPE),
      newSubtype: clean_(row[3], MAX_SUBTYPE),
      at: cellText_(row[4]),
      status: String(row[5] || "").trim(),
      note: clean_(row[6], MAX_NOTE),
    });
  }
  return { sheet: sheet, rows: rows };
}

function readOverridesActive_() {
  var data = readOverrideRows_();
  var best = {};
  data.rows.forEach(function (row) {
    if (!row.oldType || !row.name) return;
    if (row.status !== "active" && row.status !== "cleared") return;
    var key = row.oldType + "\n" + row.name;
    var prev = best[key];
    if (
      !prev ||
      String(row.at) > String(prev.at) ||
      (String(row.at) === String(prev.at) && row.rowIndex >= prev.rowIndex)
    ) {
      best[key] = row;
    }
  });
  var list = [];
  Object.keys(best).forEach(function (key) {
    var row = best[key];
    if (row.status !== "active") return;
    list.push({
      oldType: row.oldType,
      type: row.oldType,
      name: row.name,
      newType: row.newType,
      newSubtype: row.newSubtype,
      at: row.at,
      note: row.note,
      status: "active",
    });
  });
  list.sort(function (a, b) {
    if (a.at !== b.at) return a.at < b.at ? 1 : -1;
    if (a.oldType !== b.oldType) return a.oldType < b.oldType ? -1 : 1;
    if (a.name !== b.name) return a.name < b.name ? -1 : 1;
    return 0;
  });
  return list;
}

function writeStatusRow_(sheet, rowIndex, type, name, at, note, status) {
  var range = sheet.getRange(rowIndex, 1, 1, HEADERS.length);
  range.setNumberFormat("@");
  range.setValues([[type, name, at, note, status]]);
}

function writeOverrideRow_(sheet, rowIndex, oldType, name, newType, newSubtype, at, status, note) {
  var range = sheet.getRange(rowIndex, 1, 1, OVERRIDE_HEADERS.length);
  range.setNumberFormat("@");
  range.setValues([[oldType, name, newType, newSubtype, at, status, note]]);
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

function applyReclass_(action, body, type, name) {
  var data = readOverrideRows_();
  var sheet = data.sheet;
  var matches = data.rows.filter(function (row) {
    return row.oldType === type && row.name === name;
  });
  var prev = latestOverride_(matches);

  if (action === "reclass_clear") {
    if (!prev || prev.status !== "active") return "找不到改類紀錄";
    writeOverrideRow_(
      sheet,
      sheet.getLastRow() + 1,
      type,
      name,
      prev.newType,
      prev.newSubtype,
      nowHkt_(),
      "cleared",
      prev.note
    );
    return "";
  }

  // reclass
  var newType = clean_(body.newType, MAX_TYPE);
  var newSubtype = clean_(body.newSubtype, MAX_SUBTYPE);
  if (!newType) return "缺少 newType";
  // newSubtype 可空（自由輸入／可選）；空字串保留
  var hasNote = body.note != null;
  var note = hasNote ? clean_(body.note, MAX_NOTE) : prev ? prev.note : "";
  var at = nowHkt_();

  if (prev && (prev.status === "active" || prev.status === "cleared")) {
    // upsert：覆寫最新一列（同 exclusion 風格：同一鍵可重用列；此處追加一列 active，latest 優先）
    writeOverrideRow_(sheet, sheet.getLastRow() + 1, type, name, newType, newSubtype, at, "active", note);
  } else {
    writeOverrideRow_(sheet, sheet.getLastRow() + 1, type, name, newType, newSubtype, at, "active", note);
  }

  notifyReclass_({
    event: "reclass",
    type: type,
    name: name,
    newType: newType,
    newSubtype: newSubtype,
    at: at,
  });
  return "";
}

function latestOverride_(rows) {
  var best = null;
  rows.forEach(function (row) {
    if (row.status !== "active" && row.status !== "cleared") return;
    if (
      !best ||
      String(row.at) > String(best.at) ||
      (String(row.at) === String(best.at) && row.rowIndex >= best.rowIndex)
    ) {
      best = row;
    }
  });
  return best;
}

function notifyReclass_(payload) {
  var props;
  var email = "";
  var url = "";
  var auth = "";
  try {
    props = PropertiesService.getScriptProperties();
    email = String(props.getProperty("RECLASS_NOTIFY_EMAIL") || "").trim();
    url = String(props.getProperty("RECLASS_WEBHOOK_URL") || "").trim();
    auth = String(props.getProperty("RECLASS_WEBHOOK_AUTH") || "").trim();
  } catch (err) {
    return;
  }
  // Prefer email (Gmail Bot inbox); webhook optional fallback
  if (email) {
    try {
      MailApp.sendEmail({
        to: email,
        subject: "超市補貨改類 " + (payload.name || ""),
        body: JSON.stringify(payload),
      });
    } catch (err) {
      // mute
    }
    return;
  }
  if (!url) return;
  try {
    var opts = {
      method: "post",
      contentType: "application/json",
      payload: JSON.stringify(payload),
      muteHttpExceptions: true,
      followRedirects: true,
    };
    if (auth) {
      opts.headers = { Authorization: auth };
    }
    UrlFetchApp.fetch(url, opts);
  } catch (err) {
    // mute — 唔阻主流程
  }
}

function seedReclassOverrides() {
  return seedReclassOverrides_();
}

function seedReclassOverrides_() {
  var seeds = [
    ["紙品／即棄品", "嬰兒濕廁紙", "紙品／即棄品", "濕紙巾"],
    ["嬰兒用品／食品", "嬰兒濕紙巾", "嬰兒用品／食品", "濕紙巾"],
    ["嬰兒用品／食品", "幼兒動物餅", "嬰兒用品／食品", "幼兒小食"],
    ["嬰兒用品／食品", "幼兒小食（椰子卷／手指餅等）", "嬰兒用品／食品", "幼兒小食"],
    ["嬰兒用品／食品", "幼兒小食／補充", "嬰兒用品／食品", "幼兒小食"],
    ["嬰兒用品／食品", "七星茶", "嬰兒用品／食品", "幼兒補充"],
    ["嬰兒用品／食品", "嬰幼兒益生菌滴劑", "嬰兒用品／食品", "幼兒補充"],
    ["家居清潔用品", "嬰兒洗衣液", "家居清潔用品", "幼兒清潔"],
    ["個人護理用品", "成人益生菌", "個人護理用品", "保健食品"],
  ];
  var data = readOverrideRows_();
  var sheet = data.sheet;
  var active = {};
  data.rows.forEach(function (row) {
    if (row.status !== "active" || !row.oldType || !row.name) return;
    var key = row.oldType + "\n" + row.name;
    var prev = active[key];
    if (
      !prev ||
      String(row.at) > String(prev.at) ||
      (String(row.at) === String(prev.at) && row.rowIndex >= prev.rowIndex)
    ) {
      active[key] = row;
    }
  });
  var at = nowHkt_();
  var added = 0;
  seeds.forEach(function (s) {
    var key = s[0] + "\n" + s[1];
    if (active[key]) return;
    writeOverrideRow_(sheet, sheet.getLastRow() + 1, s[0], s[1], s[2], s[3], at, "active", "seed");
    added++;
  });
  Logger.log("seedReclassOverrides_: added " + added);
  return added;
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

function sheetPayload_(rows, error, overrides) {
  var payload = {
    items: excludedOnly_(rows),
    held: heldOnly_(rows),
    overrides: overrides || [],
  };
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
