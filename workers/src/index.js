import {
  ACTIONS,
  ERR_ACTION,
  ERR_IO,
  ERR_TYPE_NAME,
  callbackName,
  clean,
  currentAt,
  jsonText,
  safeErrorMessage,
  MAX_NAME,
  MAX_TYPE,
} from "./logic.js";
import {
  applyExclude,
  applyHold,
  applyReclass,
  applyReclassClear,
  applyRestore,
  applyUnhold,
  importSnapshot,
  readPublicPayload,
  seedOverrides,
} from "./store.js";

const MAX_BODY = 1_000_000;

export default {
  async fetch(request, env, ctx) {
    return handleRequest(request, env, ctx);
  },
};

export async function handleRequest(request, env, ctx) {
  const url = new URL(request.url);
  const path = normalizePath(url.pathname);
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders() });
  }
  try {
    if (path === "/admin/seed" || path === "/admin/import") {
      return await handleAdmin(request, env, path);
    }
    if (path !== "/") {
      return jsonResponse({ error: "找不到路徑" }, 404);
    }
    if (request.method === "GET") return await handleGet(request, env);
    if (request.method === "POST") return await handlePost(request, env, ctx);
    return jsonResponse({ error: "方法不支援" }, 405);
  } catch (err) {
    const message = safeErrorMessage(err);
    if (path.startsWith("/admin")) return jsonResponse({ error: message || ERR_IO }, 500);
    const callback =
      request.method === "GET" ? callbackName(url.searchParams.get("callback")) : "";
    const payload = { items: [], held: [], overrides: [], error: message || ERR_IO };
    if (callback) return jsonpResponse(callback, payload);
    return jsonResponse(payload, 200);
  }
}

function normalizePath(pathname) {
  if (!pathname || pathname === "/") return "/";
  return pathname.replace(/\/+$/, "") || "/";
}

async function handleGet(request, env) {
  const url = new URL(request.url);
  const callback = callbackName(url.searchParams.get("callback"));
  const payload = await readPublicPayload(env.DB);
  if (callback) return jsonpResponse(callback, payload);
  return jsonResponse(payload, 200);
}

async function handlePost(request, env, ctx) {
  const body = await parsePublicBody(request);
  const action = body.action;
  const type = clean(body.type, MAX_TYPE);
  const name = clean(body.name, MAX_NAME);
  if (!ACTIONS.has(action)) {
    return jsonResponse(await withError(env, ERR_ACTION), 200);
  }
  if (!type || !name) {
    return jsonResponse(await withError(env, ERR_TYPE_NAME), 200);
  }
  const at = currentAt(env);
  let error = "";
  let webhook = null;
  if (action === "exclude") {
    error = await applyExclude(env.DB, { type, name, at, body });
  } else if (action === "restore") {
    error = await applyRestore(env.DB, type, name);
  } else if (action === "hold") {
    error = await applyHold(env.DB, { type, name, at, body });
  } else if (action === "unhold") {
    error = await applyUnhold(env.DB, type, name, at);
  } else if (action === "reclass") {
    const result = await applyReclass(env.DB, { type, name, at, body });
    error = result.error;
    webhook = result.webhook;
  } else if (action === "reclass_clear") {
    error = await applyReclassClear(env.DB, type, name, at);
  }
  if (error) return jsonResponse(await withError(env, error), 200);
  if (webhook) defer(ctx, notifyReclass(env, webhook));
  return jsonResponse(await readPublicPayload(env.DB), 200);
}

async function withError(env, error) {
  const payload = await readPublicPayload(env.DB);
  return { ...payload, error };
}

async function handleAdmin(request, env, path) {
  if (request.method !== "POST") {
    return jsonResponse({ error: "方法不支援" }, 405);
  }
  if (!(await authorized(request, env))) {
    return jsonResponse({ error: "需要 WRITE_SECRET" }, 401);
  }
  const parsed = await parseAdminBody(request);
  if (!parsed.ok) return jsonResponse({ error: parsed.error }, 400);
  const at = currentAt(env);
  if (path === "/admin/seed") {
    const added = await seedOverrides(env.DB, at);
    const payload = await readPublicPayload(env.DB);
    return jsonResponse({ added, ...payload }, 200);
  }
  const result = await importSnapshot(env.DB, parsed.value, at);
  if (result.error) return jsonResponse({ error: result.error }, 400);
  const payload = await readPublicPayload(env.DB);
  return jsonResponse({ imported: result.imported, ...payload }, 200);
}

async function parsePublicBody(request) {
  const raw = await readRaw(request);
  if (raw == null) return {};
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return parsed;
  } catch {
    return {};
  }
}

async function parseAdminBody(request) {
  const raw = await readRaw(request);
  if (raw == null) return { ok: false, error: "主體太大" };
  if (!raw.trim()) return { ok: true, value: {} };
  try {
    const value = JSON.parse(raw);
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return { ok: false, error: "JSON 無效" };
    }
    return { ok: true, value };
  } catch {
    return { ok: false, error: "JSON 無效" };
  }
}

async function readRaw(request) {
  const declared = Number(request.headers.get("content-length") || "0");
  if (Number.isFinite(declared) && declared > MAX_BODY) return null;
  const raw = await request.text();
  if (raw.length > MAX_BODY) return null;
  return raw;
}

function extractCandidates(request) {
  const found = [];
  const header = request.headers.get("X-Write-Secret");
  if (header != null && header.trim()) found.push(header.trim());
  const auth = request.headers.get("Authorization");
  if (auth) {
    const match = /^Bearer\s+(.+)$/i.exec(auth.trim());
    if (match && match[1].trim()) found.push(match[1].trim());
  }
  return found;
}

async function authorized(request, env) {
  const expected = String(env?.WRITE_SECRET || "").trim();
  if (!expected) return false;
  const candidates = extractCandidates(request);
  for (const candidate of candidates) {
    if (await sha256Equal(candidate, expected)) return true;
  }
  return false;
}

async function sha256Equal(a, b) {
  const enc = new TextEncoder();
  const [left, right] = await Promise.all([
    crypto.subtle.digest("SHA-256", enc.encode(a)),
    crypto.subtle.digest("SHA-256", enc.encode(b)),
  ]);
  const aa = new Uint8Array(left);
  const bb = new Uint8Array(right);
  let diff = 0;
  for (let i = 0; i < aa.length; i++) diff |= aa[i] ^ bb[i];
  return diff === 0;
}

/**
 * Workers notify Grocery Bot by webhook only (no MailApp).
 * Empty RECLASS_WEBHOOK_URL stays quiet. Failures never fail the write.
 * RECLASS_WEBHOOK_AUTH is the full Authorization header value.
 */
export async function notifyReclass(env, payload) {
  const url = String(env?.RECLASS_WEBHOOK_URL || "").trim();
  if (!url) return;
  const auth = String(env?.RECLASS_WEBHOOK_AUTH || "").trim();
  const headers = { "Content-Type": "application/json" };
  if (auth) headers.Authorization = auth;
  try {
    await globalThis.fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    });
  } catch {
    // mute — do not block or fail the reclass write
  }
}

function defer(ctx, promise) {
  const guarded = Promise.resolve()
    .then(() => promise)
    .catch(() => {});
  if (ctx && typeof ctx.waitUntil === "function") ctx.waitUntil(guarded);
  return guarded;
}

function corsHeaders(extra = {}) {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Write-Secret",
    "Access-Control-Max-Age": "86400",
    "X-Content-Type-Options": "nosniff",
    ...extra,
  };
}

function jsonResponse(obj, status) {
  return new Response(jsonText(obj), {
    status,
    headers: corsHeaders({
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    }),
  });
}

function jsonpResponse(callback, obj) {
  return new Response(`${callback}(${jsonText(obj)});`, {
    status: 200,
    headers: corsHeaders({
      "Content-Type": "application/javascript; charset=utf-8",
      "Cache-Control": "no-store",
    }),
  });
}
