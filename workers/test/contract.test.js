import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { afterEach, describe, test } from "node:test";
import { handleRequest } from "../src/index.js";
import { SEED_ROWS, byOverride, jsonText, nowHkt } from "../src/logic.js";
import { createTestDb } from "./d1shim.js";

const WORKER_URL = "https://grocery-restock-exclusions.aliensfong-gemini.workers.dev";

let restoreFetch = null;

afterEach(() => {
  if (restoreFetch) {
    globalThis.fetch = restoreFetch;
    restoreFetch = null;
  }
});

function makeClock() {
  let n = 0;
  return () => {
    n += 1;
    return nowHkt(new Date(Date.UTC(2026, 9, 20, 4, 0, n)));
  };
}

function makeEnv(db, extra = {}) {
  return {
    DB: db,
    WRITE_SECRET: "test-secret",
    RECLASS_WEBHOOK_URL: "",
    RECLASS_WEBHOOK_AUTH: "",
    now: makeClock(),
    ...extra,
  };
}

function createCtx() {
  const tasks = [];
  return {
    tasks,
    waitUntil(promise) {
      tasks.push(promise);
    },
    flush() {
      return Promise.all(tasks);
    },
  };
}

async function call(env, method, path, { body, headers, ctx } = {}) {
  const init = { method, headers: headers ? { ...headers } : {} };
  if (body !== undefined) {
    init.body = typeof body === "string" ? body : JSON.stringify(body);
    if (!init.headers["Content-Type"] && !init.headers["content-type"]) {
      init.headers["Content-Type"] = "text/plain;charset=utf-8";
    }
  }
  const context = ctx || createCtx();
  const response = await handleRequest(new Request("https://worker.test" + path, init), env, context);
  const text = await response.text();
  let json = null;
  const type = response.headers.get("content-type") || "";
  if (type.includes("application/json")) json = JSON.parse(text);
  return { response, text, json, status: response.status, ctx: context };
}

function post(env, body, path = "/") {
  return call(env, "POST", path, { body });
}

function get(env, path = "/") {
  return call(env, "GET", path);
}

describe("clock", () => {
  test("formats Hong Kong time with +08:00 and no milliseconds", () => {
    assert.equal(nowHkt(new Date("2026-10-15T06:00:00Z")), "2026-10-15T14:00:00+08:00");
    assert.equal(nowHkt(new Date("2026-10-15T16:00:00Z")), "2026-10-16T00:00:00+08:00");
  });
});

describe("public contract", () => {
  test("GET empty state", async () => {
    const env = makeEnv(createTestDb());
    const { status, json, response } = await get(env);
    assert.equal(status, 200);
    assert.deepEqual(json, { items: [], held: [], overrides: [] });
    assert.equal(response.headers.get("access-control-allow-origin"), "*");
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(response.headers.get("content-type"), "application/json; charset=utf-8");
  });

  test("exclude upserts one row and restore removes it from items", async () => {
    const db = createTestDb();
    const env = makeEnv(db);
    const first = await post(env, {
      action: "exclude",
      type: "紙品／即棄品",
      name: "廚房紙",
      note: "屋企仲有",
    });
    assert.equal(first.status, 200);
    assert.equal(first.json.error, undefined);
    assert.equal(first.json.items.length, 1);
    const at1 = first.json.items[0].at;
    assert.deepEqual(first.json.items[0], {
      type: "紙品／即棄品",
      name: "廚房紙",
      at: at1,
      excludedAt: at1,
      note: "屋企仲有",
      status: "excluded",
    });
    assert.match(at1, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+08:00$/);

    const second = await post(env, { action: "exclude", type: "紙品／即棄品", name: "廚房紙" });
    assert.equal(second.json.items.length, 1);
    assert.equal(second.json.items[0].note, "屋企仲有");
    assert.notEqual(second.json.items[0].at, at1);
    const count = await db.prepare("SELECT COUNT(*) AS n FROM exclusions").first();
    assert.equal(count.n, 1);

    const cleared = await post(env, {
      action: "exclude",
      type: "紙品／即棄品",
      name: "廚房紙",
      note: "",
    });
    assert.equal(cleared.json.items[0].note, "");

    const again = await post(env, {
      action: "exclude",
      type: "紙品／即棄品",
      name: "廚房紙",
      note: "再寫",
    });
    const restored = await post(env, { action: "restore", type: "紙品／即棄品", name: "廚房紙" });
    assert.deepEqual(restored.json.items, []);
    assert.equal(restored.json.error, undefined);
    const row = await db.prepare("SELECT status, note FROM exclusions").first();
    assert.equal(row.status, "restored");
    assert.equal(row.note, "再寫");
    const missing = await post(env, { action: "restore", type: "紙品／即棄品", name: "廚房紙" });
    assert.equal(missing.status, 200);
    assert.equal(missing.json.error, "找不到呢項");
    assert.deepEqual(missing.json.items, []);
  });

  test("hold appends and latest status wins", async () => {
    const db = createTestDb();
    const env = makeEnv(db);
    const held = await post(env, {
      action: "hold",
      type: "糧油雜貨",
      name: "米",
      note: "已從非網購渠道補貨",
    });
    assert.deepEqual(held.json.items, []);
    assert.equal(held.json.held.length, 1);
    assert.deepEqual(held.json.held[0], {
      type: "糧油雜貨",
      name: "米",
      at: held.json.held[0].at,
      note: "已從非網購渠道補貨",
      status: "held",
    });

    const omitted = await post(env, { action: "hold", type: "糧油雜貨", name: "米" });
    assert.equal(omitted.json.held.length, 1);
    assert.equal(omitted.json.held[0].note, "已從非網購渠道補貨");
    assert.equal(await (await db.prepare("SELECT COUNT(*) AS n FROM holds").first()).n, 2);

    const unheld = await post(env, { action: "unhold", type: "糧油雜貨", name: "米" });
    assert.deepEqual(unheld.json.held, []);
    const missing = await post(env, { action: "unhold", type: "糧油雜貨", name: "米" });
    assert.equal(missing.json.error, "找不到手動暫緩紀錄");

    await post(env, { action: "hold", type: "糧油雜貨", name: "米", note: "第二次" });
    const latest = await get(env);
    assert.equal(latest.json.held.length, 1);
    assert.equal(latest.json.held[0].note, "第二次");
    assert.equal(latest.json.held[0].status, "held");
  });

  test("same timestamp, higher id wins for holds", async () => {
    const db = createTestDb();
    const env = makeEnv(db);
    const at = "2026-10-20T12:00:00+08:00";
    await db
      .prepare("INSERT INTO holds (type, name, at, note, status) VALUES (?, ?, ?, ?, 'held')")
      .bind("糧油雜貨", "米", at, "舊")
      .run();
    await db
      .prepare("INSERT INTO holds (type, name, at, note, status) VALUES (?, ?, ?, ?, 'unheld')")
      .bind("糧油雜貨", "米", at, "舊")
      .run();
    const { json } = await get(env);
    assert.deepEqual(json.held, []);
  });

  test("exclusion and hold are independent", async () => {
    const env = makeEnv(createTestDb());
    await post(env, { action: "exclude", type: "凍肉", name: "雞翼", note: "太多" });
    await post(env, { action: "hold", type: "凍肉", name: "雞翼", note: "已買" });
    const { json } = await get(env);
    assert.equal(json.items.length, 1);
    assert.equal(json.held.length, 1);
    assert.equal(json.items[0].name, "雞翼");
    assert.equal(json.held[0].name, "雞翼");
  });

  test("reclass appends active rows and clear removes the key", async () => {
    const env = makeEnv(createTestDb());
    const missingType = await post(env, { action: "reclass", type: "嬰兒用品／食品", name: "幼兒動物餅" });
    assert.equal(missingType.json.error, "缺少 newType");
    assert.deepEqual(missingType.json.overrides, []);

    const blankType = await post(env, {
      action: "reclass",
      type: "嬰兒用品／食品",
      name: "幼兒動物餅",
      newType: "   ",
    });
    assert.equal(blankType.json.error, "缺少 newType");

    const created = await post(env, {
      action: "reclass",
      type: "嬰兒用品／食品",
      name: "幼兒動物餅",
      newType: "嬰兒用品／食品",
      newSubtype: "",
      note: "先試",
    });
    assert.equal(created.json.error, undefined);
    assert.equal(created.json.overrides.length, 1);
    const row = created.json.overrides[0];
    assert.deepEqual(row, {
      oldType: "嬰兒用品／食品",
      type: "嬰兒用品／食品",
      name: "幼兒動物餅",
      newType: "嬰兒用品／食品",
      newSubtype: "",
      at: row.at,
      note: "先試",
      status: "active",
    });

    const updated = await post(env, {
      action: "reclass",
      type: "嬰兒用品／食品",
      name: "幼兒動物餅",
      newType: "嬰兒用品／食品",
      newSubtype: "幼兒小食",
    });
    assert.equal(updated.json.overrides.length, 1);
    assert.equal(updated.json.overrides[0].newSubtype, "幼兒小食");
    assert.equal(updated.json.overrides[0].note, "先試");

    const cleared = await post(env, {
      action: "reclass_clear",
      type: "嬰兒用品／食品",
      name: "幼兒動物餅",
    });
    assert.deepEqual(cleared.json.overrides, []);
    const again = await post(env, {
      action: "reclass_clear",
      type: "嬰兒用品／食品",
      name: "幼兒動物餅",
    });
    assert.equal(again.json.error, "找不到改類紀錄");
  });

  test("validation errors keep the current public lists", async () => {
    const env = makeEnv(createTestDb());
    await post(env, { action: "exclude", type: "飲料", name: "汽水", note: "甜" });
    const bad = await post(env, { action: "nope", type: "飲料", name: "汽水" });
    assert.equal(bad.status, 200);
    assert.equal(
      bad.json.error,
      "action 必須係 exclude、restore、hold、unhold、reclass 或 reclass_clear"
    );
    assert.equal(bad.json.items.length, 1);
    const missing = await post(env, { action: "hold", type: "  ", name: "" });
    assert.equal(missing.json.error, "缺少 type 或 name");
    assert.equal(missing.json.items[0].name, "汽水");
    const invalid = await post(env, "{");
    assert.equal(invalid.json.error, bad.json.error);
    const objectType = await post(env, { action: "exclude", type: { a: 1 }, name: "汽水" });
    assert.equal(objectType.json.error, "缺少 type 或 name");
  });

  test("numbers are accepted and fields are truncated", async () => {
    const env = makeEnv(createTestDb());
    const { json } = await post(env, {
      action: "exclude",
      type: 12,
      name: 34,
      note: "註".repeat(250),
    });
    assert.equal(json.items[0].type, "12");
    assert.equal(json.items[0].name, "34");
    assert.equal(json.items[0].note.length, 200);

    const long = await post(env, {
      action: "reclass",
      type: "類".repeat(100),
      name: "名".repeat(150),
      newType: "新".repeat(90),
      newSubtype: "子".repeat(90),
    });
    assert.equal(long.json.overrides[0].oldType.length, 80);
    assert.equal(long.json.overrides[0].name.length, 120);
    assert.equal(long.json.overrides[0].newType.length, 80);
    assert.equal(long.json.overrides[0].newSubtype.length, 80);
  });

  test("strips control characters and escapes JSONP-breaking text", async () => {
    const env = makeEnv(createTestDb());
    const saved = await post(env, {
      action: "exclude",
      type: "a\u0000b",
      name: "x<y\u2028z",
      note: "n",
    });
    assert.equal(saved.json.items[0].type, "ab");
    assert.equal(saved.json.items[0].name, "x<y\u2028z");
    const raw = await call(env, "GET", "/");
    assert.equal(raw.text.includes("<"), false);
    assert.equal(raw.text.includes("\u2028"), false);
    assert.match(raw.text, /\\u003c/);
    assert.deepEqual(JSON.parse(raw.text).items[0].name, "x<y\u2028z");
  });

  test("sorts items by at descending then type and name", async () => {
    const env = makeEnv(createTestDb());
    await post(env, { action: "exclude", type: "乙", name: "後", note: "" });
    await post(env, { action: "exclude", type: "甲", name: "先", note: "" });
    const { json } = await get(env);
    assert.deepEqual(
      json.items.map((row) => row.name),
      ["先", "後"]
    );
    assert.ok(json.items[0].at > json.items[1].at);
  });

  test("JSONP uses a JS identifier and ignores an invalid callback", async () => {
    const env = makeEnv(createTestDb());
    await post(env, { action: "hold", type: "零食", name: "餅", note: "" });
    const goodName = "onLoad";
    const good = await call(env, "GET", `/?callback=${goodName}`);
    assert.equal(good.response.headers.get("content-type"), "application/javascript; charset=utf-8");
    assert.ok(good.text.startsWith(`${goodName}(`));
    assert.ok(good.text.endsWith(");"));
    const payload = JSON.parse(good.text.slice(goodName.length + 1, -2));
    assert.equal(payload.held[0].name, "餅");
    assert.equal(good.text, `${goodName}(${jsonText(payload)});`);

    const bad = await call(env, "GET", "/?callback=alert(1)");
    assert.equal(bad.response.headers.get("content-type"), "application/json; charset=utf-8");
    assert.equal(bad.json.held[0].name, "餅");

    const long = "a".repeat(64);
    const okLong = await call(env, "GET", `/?callback=${long}`);
    assert.ok(okLong.text.startsWith(`${long}(`));
    const tooLong = await call(env, "GET", `/?callback=${"a".repeat(65)}`);
    assert.equal(tooLong.response.headers.get("content-type"), "application/json; charset=utf-8");

    const posted = await call(env, "POST", "/?callback=onLoad", {
      body: { action: "unhold", type: "零食", name: "餅" },
    });
    assert.equal(posted.response.headers.get("content-type"), "application/json; charset=utf-8");
    assert.deepEqual(posted.json.held, []);
  });

  test("browser POST does not need a write secret", async () => {
    const env = makeEnv(createTestDb(), { WRITE_SECRET: "" });
    const { status, json } = await post(env, { action: "exclude", type: "菜", name: "菜心", note: "" });
    assert.equal(status, 200);
    assert.equal(json.items.length, 1);
    assert.equal(json.error, undefined);
  });

  test("OPTIONS is a CORS preflight and unknown routes are rejected", async () => {
    const env = makeEnv(createTestDb());
    const options = await call(env, "OPTIONS", "/");
    assert.equal(options.status, 204);
    assert.equal(options.response.headers.get("access-control-allow-origin"), "*");
    assert.match(options.response.headers.get("access-control-allow-headers"), /X-Write-Secret/);
    const missing = await get(env, "/nope");
    assert.equal(missing.status, 404);
    const put = await call(env, "PUT", "/");
    assert.equal(put.status, 405);
  });

  test("database failures become 讀寫失敗 when the message is unsafe", async () => {
    const env = makeEnv(createTestDb());
    env.DB = {
      prepare() {
        throw new Error(`${"x".repeat(180)}\nsecond`);
      },
    };
    const { status, json } = await get(env);
    assert.equal(status, 200);
    assert.equal(json.error, "讀寫失敗");
    assert.deepEqual(json.items, []);
  });
});

describe("reclass webhook", () => {
  test("posts the Grocery Bot payload and does not block on a slow webhook", async () => {
    const calls = [];
    let release;
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    restoreFetch = globalThis.fetch;
    globalThis.fetch = async (url, opts) => {
      calls.push({ url, opts });
      await gate;
      return new Response("ok", { status: 204 });
    };
    const env = makeEnv(createTestDb(), {
      RECLASS_WEBHOOK_URL: "https://bot.example/hook",
      RECLASS_WEBHOOK_AUTH: "Bearer bot-token",
    });
    const ctx = createCtx();
    const pending = call(env, "POST", "/", {
      body: {
        action: "reclass",
        type: "嬰兒用品／食品",
        name: "幼兒動物餅",
        newType: "嬰兒用品／食品",
        newSubtype: "幼兒小食",
      },
      ctx,
    });
    const winner = await Promise.race([
      pending.then((result) => ({ ok: true, result })),
      new Promise((resolve) => setTimeout(() => resolve({ ok: false }), 300)),
    ]);
    try {
      assert.equal(winner.ok, true);
      assert.equal(winner.result.status, 200);
      assert.equal(winner.result.json.error, undefined);
      assert.equal(winner.result.json.overrides[0].newSubtype, "幼兒小食");
      assert.equal(calls.length, 1);
      assert.equal(calls[0].url, "https://bot.example/hook");
      assert.equal(calls[0].opts.method, "POST");
      assert.equal(calls[0].opts.headers.Authorization, "Bearer bot-token");
      assert.equal(calls[0].opts.headers["Content-Type"], "application/json");
      assert.deepEqual(JSON.parse(calls[0].opts.body), {
        event: "reclass",
        type: "嬰兒用品／食品",
        name: "幼兒動物餅",
        newType: "嬰兒用品／食品",
        newSubtype: "幼兒小食",
        at: winner.result.json.overrides[0].at,
      });
      assert.equal(ctx.tasks.length, 1);
    } finally {
      release();
      await ctx.flush();
    }
  });

  test("webhook failure and empty URL do not fail the write", async () => {
    restoreFetch = globalThis.fetch;
    globalThis.fetch = async () => {
      throw new Error("down");
    };
    const env = makeEnv(createTestDb(), { RECLASS_WEBHOOK_URL: "https://bot.example/hook" });
    const ctx = createCtx();
    const saved = await call(env, "POST", "/", {
      body: {
        action: "reclass",
        type: "家居清潔用品",
        name: "嬰兒洗衣液",
        newType: "家居清潔用品",
        newSubtype: "幼兒清潔",
      },
      ctx,
    });
    await ctx.flush();
    assert.equal(saved.json.error, undefined);
    assert.equal(saved.json.overrides.length, 1);

    const calls = [];
    globalThis.fetch = async (...args) => {
      calls.push(args);
      return new Response("no");
    };
    const quiet = makeEnv(createTestDb());
    const ctx2 = createCtx();
    await call(quiet, "POST", "/", {
      body: {
        action: "reclass",
        type: "家居清潔用品",
        name: "嬰兒洗衣液",
        newType: "家居清潔用品",
        newSubtype: "幼兒清潔",
      },
      ctx: ctx2,
    });
    await ctx2.flush();
    const cleared = await call(quiet, "POST", "/", {
      body: { action: "reclass_clear", type: "家居清潔用品", name: "嬰兒洗衣液" },
      ctx: ctx2,
    });
    await ctx2.flush();
    assert.deepEqual(cleared.json.overrides, []);
    assert.equal(calls.length, 0);
  });
});

describe("admin seed and import", () => {
  test("seed writes the nine gas rows once and does not notify", async () => {
    const calls = [];
    restoreFetch = globalThis.fetch;
    globalThis.fetch = async (...args) => {
      calls.push(args);
      return new Response("ok");
    };
    const seedFile = JSON.parse(readFileSync(new URL("../../gas/seed-reclass.json", import.meta.url), "utf8"));
    assert.equal(SEED_ROWS.length, 9);
    assert.deepEqual(
      SEED_ROWS,
      seedFile.rows.map((row) => ({
        oldType: row.oldType,
        name: row.name,
        newType: row.newType,
        newSubtype: row.newSubtype,
      }))
    );
    const env = makeEnv(createTestDb(), { RECLASS_WEBHOOK_URL: "https://bot.example/hook" });
    const ctx = createCtx();
    const first = await call(env, "POST", "/admin/seed", {
      headers: { Authorization: "Bearer test-secret" },
      ctx,
    });
    await ctx.flush();
    assert.equal(first.status, 200);
    assert.equal(first.json.added, 9);
    assert.equal(first.json.overrides.length, 9);
    assert.ok(first.json.overrides.every((row) => row.note === "seed" && row.status === "active"));
    const animal = first.json.overrides.find((row) => row.name === "幼兒動物餅");
    assert.equal(animal.newSubtype, "幼兒小食");
    assert.deepEqual(
      first.json.overrides.map((row) => row.oldType + "|" + row.name),
      [...first.json.overrides].sort(byOverride).map((row) => row.oldType + "|" + row.name)
    );
    const second = await call(env, "POST", "/admin/seed", {
      headers: { "X-Write-Secret": "test-secret" },
      ctx,
    });
    await ctx.flush();
    assert.equal(second.json.added, 0);
    assert.equal(second.json.overrides.length, 9);
    assert.equal(calls.length, 0);

    const manual = await post(env, {
      action: "reclass",
      type: "個人護理用品",
      name: "成人益生菌",
      newType: "個人護理用品",
      newSubtype: "自訂",
    });
    assert.equal(manual.json.overrides.find((row) => row.name === "成人益生菌").newSubtype, "自訂");
    await post(env, {
      action: "reclass_clear",
      type: "個人護理用品",
      name: "成人益生菌",
    });
    const seeded = await call(env, "POST", "/admin/seed", {
      headers: { Authorization: "Bearer test-secret" },
    });
    assert.equal(seeded.json.added, 0);
    assert.equal(
      seeded.json.overrides.find((row) => row.name === "成人益生菌"),
      undefined
    );
  });

  test("admin routes require WRITE_SECRET", async () => {
    const env = makeEnv(createTestDb());
    const open = await post(env, {}, "/admin/seed");
    assert.equal(open.status, 401);
    assert.equal(open.json.error, "需要 WRITE_SECRET");
    assert.equal(open.response.headers.get("access-control-allow-origin"), "*");
    const wrong = await call(env, "POST", "/admin/import", {
      headers: { Authorization: "Bearer wrong", "Content-Type": "application/json" },
      body: { items: [] },
    });
    assert.equal(wrong.status, 401);
    const basic = await call(env, "POST", "/admin/seed", {
      headers: { Authorization: "Basic test-secret" },
    });
    assert.equal(basic.status, 401);
    const locked = makeEnv(createTestDb(), { WRITE_SECRET: "" });
    const noSecret = await call(locked, "POST", "/admin/seed", {
      headers: { "X-Write-Secret": "test-secret" },
    });
    assert.equal(noSecret.status, 401);
    const getAdmin = await get(env, "/admin/seed");
    assert.equal(getAdmin.status, 405);
    const badJson = await call(env, "POST", "/admin/import", {
      headers: { "X-Write-Secret": "test-secret", "Content-Type": "application/json" },
      body: "{",
    });
    assert.equal(badJson.status, 400);
  });

  test("import round-trips a GAS snapshot and replace converges", async () => {
    const calls = [];
    restoreFetch = globalThis.fetch;
    globalThis.fetch = async (...args) => {
      calls.push(args);
      return new Response("ok");
    };
    const env = makeEnv(createTestDb(), { RECLASS_WEBHOOK_URL: "https://bot.example/hook" });
    const snapshot = {
      items: [
        {
          type: "紙品／即棄品",
          name: "廚房紙",
          at: "2026-10-01T08:00:00+08:00",
          excludedAt: "2026-10-01T08:00:00+08:00",
          note: "舊剔除",
          status: "excluded",
        },
        {
          type: "飲料",
          name: "汽水",
          excludedAt: "2026-10-02T09:00:00+08:00",
          note: "只得 excludedAt",
          status: "excluded",
        },
      ],
      held: [
        {
          type: "糧油雜貨",
          name: "米",
          at: "2026-10-03T10:00:00+08:00",
          note: "已從非網購渠道補貨",
          status: "held",
        },
      ],
      overrides: [
        {
          oldType: "嬰兒用品／食品",
          type: "嬰兒用品／食品",
          name: "幼兒動物餅",
          newType: "嬰兒用品／食品",
          newSubtype: "幼兒小食",
          at: "2026-10-04T11:00:00+08:00",
          note: "seed",
          status: "active",
        },
      ],
    };
    const imported = await call(env, "POST", "/admin/import", {
      headers: { Authorization: "Bearer test-secret", "Content-Type": "application/json" },
      body: snapshot,
    });
    assert.equal(imported.status, 200);
    assert.equal(imported.json.error, undefined);
    assert.deepEqual(
      imported.json.items.map((row) => [row.name, row.at, row.note]),
      [
        ["汽水", "2026-10-02T09:00:00+08:00", "只得 excludedAt"],
        ["廚房紙", "2026-10-01T08:00:00+08:00", "舊剔除"],
      ]
    );
    assert.equal(imported.json.held[0].at, "2026-10-03T10:00:00+08:00");
    assert.equal(imported.json.overrides[0].oldType, "嬰兒用品／食品");
    assert.equal(imported.json.overrides[0].type, "嬰兒用品／食品");
    assert.equal(calls.length, 0);

    const again = await call(env, "POST", "/admin/import", {
      headers: { "X-Write-Secret": "test-secret", "Content-Type": "application/json" },
      body: snapshot,
    });
    assert.equal(again.json.imported.holds, 0);
    assert.equal(again.json.imported.overrides, 0);
    const holdCount = await env.DB.prepare("SELECT COUNT(*) AS n FROM holds").first();
    const overrideCount = await env.DB.prepare("SELECT COUNT(*) AS n FROM overrides").first();
    assert.equal(holdCount.n, 1);
    assert.equal(overrideCount.n, 1);

    await post(env, { action: "exclude", type: "零食", name: "糖", note: "本地" });
    await post(env, { action: "hold", type: "零食", name: "糖", note: "本地暫緩" });
    const replaced = await call(env, "POST", "/admin/import", {
      headers: { Authorization: "Bearer test-secret", "Content-Type": "application/json" },
      body: { ...snapshot, replace: true },
    });
    assert.equal(replaced.json.imported.replace, true);
    assert.deepEqual(
      replaced.json.items.map((row) => row.name),
      ["汽水", "廚房紙"]
    );
    assert.deepEqual(
      replaced.json.held.map((row) => row.name),
      ["米"]
    );
    assert.deepEqual(
      replaced.json.overrides.map((row) => row.name),
      ["幼兒動物餅"]
    );
    const holdsAfter = await env.DB.prepare("SELECT COUNT(*) AS n FROM holds").first();
    assert.equal(holdsAfter.n, 1);

    const empty = await call(env, "POST", "/admin/import", {
      headers: { "X-Write-Secret": "test-secret" },
      body: {},
    });
    assert.equal(empty.status, 400);
    assert.equal(calls.length, 0);
  });
});

describe("repo cutover guards", () => {
  test("config.js points at live Worker; gas/Code.gs retained", () => {
    const gas = readFileSync(new URL("../../gas/Code.gs", import.meta.url), "utf8");
    assert.match(gas, /function doGet/);
    assert.match(gas, /function doPost/);
    assert.match(gas, /function seedReclassOverrides/);
    const config = readFileSync(new URL("../../config.js", import.meta.url), "utf8");
    assert.match(
      config,
      new RegExp(`window\\.GROCERY_EXCLUSIONS_API = "${WORKER_URL.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`)
    );
    assert.match(config, /直切/);
  });
});
