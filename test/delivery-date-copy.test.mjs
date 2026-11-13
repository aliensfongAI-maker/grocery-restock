import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import vm from "node:vm";

const source = readFileSync(new URL("../app.js", import.meta.url), "utf8");

function extractFunction(name) {
  const marker = "function " + name + "(";
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, "missing " + name);
  let depth = 0;
  for (let i = source.indexOf("{", start); i < source.length; i++) {
    if (source[i] === "{") depth += 1;
    else if (source[i] === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  throw new Error("unclosed " + name);
}

const names = [
  "calendarYmd",
  "daysAfterHktToday",
  "formatDate",
  "deliveryDatesOf",
  "deliveryDateParts",
  "deliveryDatePhrase",
];
const sandbox = {};
vm.runInNewContext(
  names.map(extractFunction).join("\n") +
    "\nthis.api = { calendarYmd, daysAfterHktToday, formatDate, deliveryDatesOf, deliveryDateParts, deliveryDatePhrase };",
  sandbox
);
const { deliveryDateParts, deliveryDatePhrase } = sandbox.api;

const TODAY = "2026-11-13";
const ZH = {
  lastPurchased: "上次送貨",
  deliveringToday: "今日送貨",
  deliveringOn: "將於{date}號送貨",
};
const NOTE = "約每 5 日一包 · 預計 15 日要補貨";

function phrase(item, labels) {
  return deliveryDatePhrase(item, TODAY, labels || ZH);
}

/** 「上次送貨」 may only be followed by a date already before HKT today. */
function assertLastDeliveryIsPast(text) {
  const re = /上次送貨 (\d{4}-\d{2}-\d{2})/g;
  let match;
  let found = false;
  while ((match = re.exec(text))) {
    found = true;
    assert.ok(match[1] < TODAY, "future or today labeled 上次送貨: " + match[1]);
  }
  return found;
}

describe("deliveryDatePhrase", () => {
  test("index and view share the cache token and the same helper", () => {
    assert.match(readFileSync(new URL("../index.html", import.meta.url), "utf8"), /app\.js\?v=20261113-2/);
    assert.match(readFileSync(new URL("../view.html", import.meta.url), "utf8"), /app\.js\?v=20261113-2/);
    assert.match(readFileSync(new URL("../index.html", import.meta.url), "utf8"), /styles\.css\?v=20261113-1/);
    assert.match(readFileSync(new URL("../view.html", import.meta.url), "utf8"), /styles\.css\?v=20261113-1/);
    assert.match(source, /deliveringOn: "將於\{date\}號送貨"/);
    assert.match(source, /deliveringOn: "Delivering on \{date\}"/);
    assert.match(source, /deliveringOn: "Akan dikirim pada \{date\}"/);
    assert.match(source, /deliveryDatePhrase\(item, hktYmd\(new Date\(\)\)\)/);
    assert.match(source, /const tails = rowTailParts\(item\);/);
    assert.match(
      source,
      /function applyFutureDeliveryOverlay\(item\) \{\s*if \(!item \|\| item\.manualHold \|\| isHistoryOnly\(item\)\) return item;/
    );
    assert.doesNotMatch(extractFunction("deliveryDatePhrase"), /daysUntil/);
    assert.doesNotMatch(extractFunction("rowCopyParts"), /daysUntil/);
  });

  test("past plus several future dates lists the latest past and every future date", () => {
    const item = {
      lastPurchased: "2026-11-17",
      note: NOTE,
      brands: [
        { lastPurchased: "2026-11-17" },
        { lastPurchased: "2026-11-14" },
        { lastPurchased: "2026-10-15" },
        { lastPurchased: "2026-09-25" },
        { lastPurchased: "2026-11-14" },
      ],
    };
    const date = phrase(item);
    assert.equal(date, "- 上次送貨 2026-10-15 · 將於2026-11-14、2026-11-17號送貨");
    assert.equal(date + " · " + item.note, "- 上次送貨 2026-10-15 · 將於2026-11-14、2026-11-17號送貨 · " + NOTE);
    assert.equal(assertLastDeliveryIsPast(date), true);
    assert.deepEqual(JSON.parse(JSON.stringify(deliveryDateParts(item, TODAY))), [
      { kind: "last", date: "2026-10-15" },
      { kind: "upcoming", dates: ["2026-11-14", "2026-11-17"] },
    ]);
  });

  test("several future dates and no past delivery show 將於 only", () => {
    const item = {
      lastPurchased: "2026-11-17",
      brands: [{ lastPurchased: "2026-11-14" }, { lastPurchased: "2026-11-17" }],
    };
    const date = phrase(item);
    assert.equal(date, "- 將於2026-11-14、2026-11-17號送貨");
    assert.equal(date.includes("上次送貨"), false);
    assert.equal(assertLastDeliveryIsPast(date), false);
  });

  test("a first future date and no past delivery is 將於, not 上次送貨", () => {
    const item = {
      lastPurchased: "2026-11-17",
      brands: [{ lastPurchased: "2026-11-17" }],
    };
    const date = phrase(item);
    assert.equal(date, "- 將於2026-11-17號送貨");
    assert.equal(date.includes("上次送貨"), false);
    assert.equal(date.includes("2026-11-17"), true);
  });

  test("a past date alone stays 上次送貨", () => {
    const item = {
      lastPurchased: "2026-10-15",
      brands: [{ lastPurchased: " 2026-09-25 " }, { lastPurchased: "not-a-date" }],
    };
    const date = phrase(item);
    assert.equal(date, "- 上次送貨 2026-10-15");
    assert.equal(assertLastDeliveryIsPast(date), true);
    assert.equal(date.includes("將於"), false);
  });

  test("today is 今日送貨, including next to a past or future date", () => {
    const onlyToday = phrase({
      lastPurchased: "2026-11-13",
      brands: [{ lastPurchased: "2026-11-13" }],
    });
    assert.equal(onlyToday, "- 今日送貨");
    assert.equal(onlyToday.includes("上次送貨"), false);
    assert.equal(onlyToday.includes("將於"), false);

    const pastAndToday = phrase({
      lastPurchased: "2026-11-13",
      brands: [{ lastPurchased: "2026-10-15" }, { lastPurchased: "2026-11-13" }],
    });
    assert.equal(pastAndToday, "- 上次送貨 2026-10-15 · 今日送貨");
    assert.equal(assertLastDeliveryIsPast(pastAndToday), true);

    const todayAndFuture = phrase({
      lastPurchased: "2026-11-17",
      brands: [{ lastPurchased: "2026-11-13" }, { lastPurchased: "2026-11-17" }],
    });
    assert.equal(todayAndFuture, "- 今日送貨 · 將於2026-11-17號送貨");
    assert.equal(todayAndFuture.includes("上次送貨"), false);
  });

  test("history-only rows use the same date wording", () => {
    const dates = {
      lastPurchased: "2026-11-17",
      brands: [{ lastPurchased: "2026-11-17" }, { lastPurchased: "2026-10-15" }],
    };
    const fruit = Object.assign({ type: "水果" }, dates);
    const veg = Object.assign({ type: "蔬菜" }, dates);
    const ordinary = phrase(dates);
    assert.equal(phrase(fruit), ordinary);
    assert.equal(phrase(veg), ordinary);
    assert.equal(ordinary, "- 上次送貨 2026-10-15 · 將於2026-11-17號送貨");
    const futureOnly = phrase({ type: "水果", lastPurchased: "2026-11-17", brands: [] });
    assert.equal(futureOnly, "- 將於2026-11-17號送貨");
    assert.equal(futureOnly.includes("上次送貨"), false);
  });

  test("a manual hold does not add upcoming wording, and a future hold day is not 上次送貨", () => {
    const heldPast = phrase({
      manualHold: true,
      lastPurchased: "2026-11-01",
      brands: [{ lastPurchased: "2026-11-17" }, { lastPurchased: "2026-11-14" }],
    });
    assert.equal(heldPast, "- 上次送貨 2026-11-01");
    assert.equal(heldPast.includes("將於"), false);
    assert.equal(assertLastDeliveryIsPast(heldPast), true);

    const heldToday = phrase({
      manualHold: true,
      lastPurchased: "2026-11-13",
      brands: [{ lastPurchased: "2026-11-17" }],
    });
    assert.equal(heldToday, "- 今日送貨");
    assert.equal(heldToday.includes("上次送貨"), false);
    assert.equal(heldToday.includes("將於"), false);

    const heldFuture = phrase({
      manualHold: true,
      lastPurchased: "2026-11-17",
      brands: [{ lastPurchased: "2026-11-14" }],
    });
    assert.equal(heldFuture, "");
    assert.equal(heldFuture.includes("上次送貨"), false);
    assert.equal(heldFuture.includes("將於"), false);
  });

  test("english and indonesian upcoming copy accept a joined date list", () => {
    const item = {
      lastPurchased: "2026-10-15",
      brands: [{ lastPurchased: "2026-11-14" }, { lastPurchased: "2026-11-17" }],
    };
    assert.equal(
      phrase(item, {
        lastPurchased: "Last delivery",
        deliveringToday: "Delivering today",
        deliveringOn: "Delivering on {date}",
      }),
      "- Last delivery 2026-10-15 · Delivering on 2026-11-14、2026-11-17"
    );
    assert.equal(
      phrase(item, {
        lastPurchased: "Pengiriman terakhir",
        deliveringToday: "Dikirim hari ini",
        deliveringOn: "Akan dikirim pada {date}",
      }),
      "- Pengiriman terakhir 2026-10-15 · Akan dikirim pada 2026-11-14、2026-11-17"
    );
  });

  test("no valid dates leave the date phrase empty", () => {
    assert.equal(phrase({ lastPurchased: "", brands: [{ lastPurchased: "soon" }] }), "");
    assert.equal(phrase(null), "");
  });
});
