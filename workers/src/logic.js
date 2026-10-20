import seedFile from "../../gas/seed-reclass.json" with { type: "json" };

export const MAX_TYPE = 80;
export const MAX_NAME = 120;
export const MAX_NOTE = 200;
export const MAX_SUBTYPE = 80;
export const MAX_AT = 64;

export const ACTIONS = new Set([
  "exclude",
  "restore",
  "hold",
  "unhold",
  "reclass",
  "reclass_clear",
]);

export const ERR_ACTION =
  "action 必須係 exclude、restore、hold、unhold、reclass 或 reclass_clear";
export const ERR_TYPE_NAME = "缺少 type 或 name";
export const ERR_NOT_FOUND = "找不到呢項";
export const ERR_HOLD = "找不到手動暫緩紀錄";
export const ERR_RECLASS = "找不到改類紀錄";
export const ERR_NEW_TYPE = "缺少 newType";
export const ERR_IO = "讀寫失敗";

/** Same nine rows as gas/Code.gs seedReclassOverrides / gas/seed-reclass.json. */
export const SEED_ROWS = seedFile.rows.map((row) => ({
  oldType: row.oldType,
  name: row.name,
  newType: row.newType,
  newSubtype: row.newSubtype,
}));

export function clean(value, maxLen) {
  if (value == null) return "";
  if (typeof value !== "string" && typeof value !== "number") return "";
  let text = String(value)
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .trim();
  if (text.length > maxLen) text = text.slice(0, maxLen);
  return text;
}

/** Hong Kong time, no milliseconds: 2026-10-15T14:00:00+08:00 */
export function nowHkt(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Hong_Kong",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (type) => parts.find((part) => part.type === type)?.value ?? "";
  let hour = get("hour");
  if (hour === "24") hour = "00";
  return `${get("year")}-${get("month")}-${get("day")}T${hour}:${get("minute")}:${get("second")}+08:00`;
}

export function callbackName(raw) {
  if (raw == null) return "";
  const text = String(raw).trim();
  if (!text) return "";
  if (!/^[A-Za-z_$][A-Za-z0-9_$]{0,63}$/.test(text)) return "";
  return text;
}

export function jsonText(obj) {
  return JSON.stringify(obj)
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029")
    .replace(/</g, "\\u003c");
}

export function byAtDesc(a, b) {
  const aAt = a.at || a.excludedAt || "";
  const bAt = b.at || b.excludedAt || "";
  if (aAt !== bAt) return aAt < bAt ? 1 : -1;
  if ((a.type || "") !== (b.type || "")) return a.type < b.type ? -1 : 1;
  if ((a.name || "") !== (b.name || "")) return a.name < b.name ? -1 : 1;
  return 0;
}

export function byOverride(a, b) {
  if (a.at !== b.at) return a.at < b.at ? 1 : -1;
  if (a.oldType !== b.oldType) return a.oldType < b.oldType ? -1 : 1;
  if (a.name !== b.name) return a.name < b.name ? -1 : 1;
  return 0;
}

export function sheetPayload(items, error, overrides, held) {
  const payload = {
    items: items || [],
    held: held || [],
    overrides: overrides || [],
  };
  if (error) payload.error = error;
  return payload;
}

export function publicExclusion(row) {
  return {
    type: row.type,
    name: row.name,
    at: row.at,
    excludedAt: row.at,
    note: row.note ?? "",
    status: "excluded",
  };
}

export function publicHold(row) {
  return {
    type: row.type,
    name: row.name,
    at: row.at,
    note: row.note ?? "",
    status: "held",
  };
}

export function publicOverride(row) {
  const oldType = row.old_type ?? row.oldType;
  return {
    oldType,
    type: oldType,
    name: row.name,
    newType: row.new_type ?? row.newType,
    newSubtype: row.new_subtype ?? row.newSubtype ?? "",
    at: row.at,
    note: row.note ?? "",
    status: "active",
  };
}

export function currentAt(env) {
  if (env && typeof env.now === "function") return env.now();
  return nowHkt();
}

export function safeErrorMessage(err) {
  const message = err && err.message ? String(err.message) : ERR_IO;
  if (message.length > 160 || message.includes("\n")) return ERR_IO;
  return message;
}
