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
  "exclusionKey",
  "reclassText",
  "reclassCaughtUp",
  "findOverride",
  "decideReclassOverlay",
];
const sandbox = {};
vm.runInNewContext(
  names.map(extractFunction).join("\n") +
    "\nthis.api = { exclusionKey, reclassText, reclassCaughtUp, findOverride, decideReclassOverlay };",
  sandbox
);
const { decideReclassOverlay } = sandbox.api;

function item(extra) {
  return Object.assign(
    {
      type: "嬰兒用品／食品",
      name: "幼兒動物餅",
      subtype: "餅",
      suggest: "優先",
    },
    extra
  );
}

function row(extra) {
  return Object.assign(
    {
      oldType: "嬰兒用品／食品",
      name: "幼兒動物餅",
      newType: "嬰兒用品／食品",
      newSubtype: "幼兒小食",
    },
    extra
  );
}

describe("decideReclassOverlay", () => {
  test("index and view share the helper and view stays read-only", () => {
    assert.match(
      source,
      /function applyReclassOverlay\(item\) \{\s*return decideReclassOverlay\(item, state\.overrides, READ_ONLY\);/
    );
    assert.match(readFileSync(new URL("../index.html", import.meta.url), "utf8"), /app\.js\?v=20261112-1/);
    assert.match(readFileSync(new URL("../view.html", import.meta.url), "utf8"), /app\.js\?v=20261112-1/);
    assert.match(readFileSync(new URL("../index.html", import.meta.url), "utf8"), /styles\.css\?v=20261112-1/);
    assert.match(readFileSync(new URL("../view.html", import.meta.url), "utf8"), /styles\.css\?v=20261112-1/);
    assert.match(readFileSync(new URL("../view.html", import.meta.url), "utf8"), /GROCERY_READ_ONLY = true/);
    assert.match(source, /subtype: base\.subtype/);
  });

  test("subtype-only override already in data.json does not flag or rewrite", () => {
    const grocery = item({ subtype: "幼兒小食" });
    const shown = decideReclassOverlay(grocery, [row()], false);
    assert.equal(shown, grocery);
    assert.equal(shown.reclassPending, undefined);
    assert.equal(shown.subtype, "幼兒小食");
    assert.equal(shown.type, "嬰兒用品／食品");
  });

  test("subtype match ignores surrounding whitespace", () => {
    const grocery = item({ subtype: " 幼兒小食 " });
    const shown = decideReclassOverlay(grocery, [row({ newSubtype: "幼兒小食" })], false);
    assert.equal(shown, grocery);
  });

  test("blank subtype on both sides counts as applied", () => {
    const grocery = item({ subtype: "" });
    const missing = item({ subtype: undefined });
    const override = row({ newSubtype: "" });
    const absent = row({ newSubtype: undefined });
    assert.equal(decideReclassOverlay(grocery, [override], false), grocery);
    assert.equal(decideReclassOverlay(missing, [absent], false), missing);
    assert.equal(decideReclassOverlay(grocery, [absent], false), grocery);
  });

  test("subtype-only override still pending when data.json subtype differs", () => {
    const grocery = item({ subtype: "餅" });
    const shown = decideReclassOverlay(grocery, [row()], false);
    assert.notEqual(shown, grocery);
    assert.equal(shown.reclassPending, true);
    assert.equal(shown.type, "嬰兒用品／食品");
    assert.equal(shown.subtype, "幼兒小食");
    assert.equal(shown.sourceType, "嬰兒用品／食品");
    assert.equal(shown.sourceName, "幼兒動物餅");
    assert.equal(grocery.subtype, "餅");
  });

  test("missing newSubtype does not keep a matching type pending", () => {
    const grocery = item({ subtype: "餅" });
    const shown = decideReclassOverlay(grocery, [row({ newSubtype: "  " })], false);
    assert.equal(shown, grocery);
    assert.equal(shown.subtype, "餅");
  });

  test("type change not yet in data.json overlays and flags", () => {
    const grocery = item({ type: "零食／甜品", subtype: "餅" });
    const override = row({ oldType: "零食／甜品", newType: "嬰兒用品／食品", newSubtype: "幼兒小食" });
    const shown = decideReclassOverlay(grocery, [override], false);
    assert.equal(shown.reclassPending, true);
    assert.equal(shown.type, "嬰兒用品／食品");
    assert.equal(shown.subtype, "幼兒小食");
    assert.equal(shown.sourceType, "零食／甜品");
  });

  test("type change already stored under newType does not match oldType", () => {
    const grocery = item({ type: "嬰兒用品／食品", subtype: "幼兒小食" });
    const override = row({
      oldType: "零食／甜品",
      newType: "嬰兒用品／食品",
      newSubtype: "幼兒小食",
    });
    const shown = decideReclassOverlay(grocery, [override], false);
    assert.equal(shown, grocery);
    assert.equal(shown.reclassPending, undefined);
  });

  test("type change stays pending until data.json type is newType", () => {
    const override = row({ oldType: "零食／甜品", newType: "嬰兒用品／食品", newSubtype: "幼兒小食" });
    const stillOld = item({ type: "零食／甜品", subtype: "幼兒小食" });
    const shown = decideReclassOverlay(stillOld, [override], false);
    assert.equal(shown.reclassPending, true);
    assert.equal(shown.type, "嬰兒用品／食品");
    assert.equal(shown.subtype, "幼兒小食");
  });

  test("item already stored as newType no longer matches oldType, so the flag stays off", () => {
    const override = row({ oldType: "零食／甜品", newType: "嬰兒用品／食品", newSubtype: "幼兒小食" });
    const moved = item({ type: "嬰兒用品／食品", subtype: "餅" });
    const shown = decideReclassOverlay(moved, [override], false);
    assert.equal(shown, moved);
    assert.equal(shown.reclassPending, undefined);
    assert.equal(shown.subtype, "餅");
  });

  test("lookup uses the item's current type and name", () => {
    const grocery = item({ subtype: "餅" });
    const other = row({ name: "七星茶", newType: "飲品／即沖飲品", newSubtype: "茶" });
    const shown = decideReclassOverlay(grocery, [other, row()], false);
    assert.equal(shown.reclassPending, true);
    assert.equal(shown.type, "嬰兒用品／食品");
    assert.equal(shown.subtype, "幼兒小食");
    assert.equal(shown.sourceType, "嬰兒用品／食品");
  });

  test("read-only never flags or rewrites, even when data.json is behind", () => {
    const grocery = item({ subtype: "餅" });
    const shown = decideReclassOverlay(grocery, [row()], true);
    assert.equal(shown, grocery);
    assert.equal(shown.reclassPending, undefined);
    assert.equal(shown.subtype, "餅");
  });

  test("no overlay without an item, a newType, or a matching override", () => {
    const grocery = item();
    assert.equal(decideReclassOverlay(null, [row()], false), null);
    assert.equal(decideReclassOverlay(grocery, [], false), grocery);
    assert.equal(decideReclassOverlay(grocery, [row({ newType: "" })], false), grocery);
    assert.equal(decideReclassOverlay(grocery, [row({ newType: "   " })], false), grocery);
    assert.equal(decideReclassOverlay(grocery, null, false), grocery);
  });
});
