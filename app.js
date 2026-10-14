(function () {
  "use strict";

  const SUGGEST_ORDER = { 優先: 0, 在途: 1, 暫緩: 2 };
  const TYPE_ORDER = [
    "用紙／清潔",
    "嬰兒／幼兒",
    "飲品／即食",
    "鮮果蔬",
    "急凍蛋白",
    "乾貨／調味",
    "個人護理",
    "口罩／防疫",
  ];
  const CACHE_KEY = "grocery-exclusions-v1";
  const GROUP_MODE_KEY = "grocery-restock-group-mode";
  const EXCLUSION_TIMEOUT_MS = 12000;
  const HOLD_NOTE_DEFAULT = "已從非網購渠道補貨";

  const state = {
    items: [],
    updatedAt: null,
    search: "",
    suggest: "all",
    type: "all",
    view: "main",
    groupMode: readStoredGroupMode(),
    collapsedGroups: new Set(),
    openProducts: new Set(),
    exclusions: [],
    holds: [],
    apiUrl: "",
    pendingKey: "",
    pendingAction: "",
    baseNotice: "",
    baseLevel: "",
    flashNotice: "",
    flashLevel: "",
    loadingExclusions: false,
    dialogItem: null,
    dialogTrigger: null,
  };

  const els = {
    updatedAt: document.getElementById("updatedAt"),
    searchInput: document.getElementById("searchInput"),
    suggestFilters: document.getElementById("suggestFilters"),
    viewFilters: document.getElementById("viewFilters"),
    excludedViewBtn: document.getElementById("excludedViewBtn"),
    typeFilter: document.getElementById("typeFilter"),
    sections: document.getElementById("sections"),
    emptyState: document.getElementById("emptyState"),
    errorBox: document.getElementById("errorBox"),
    resultCount: document.getElementById("resultCount"),
    expandAll: document.getElementById("expandAll"),
    collapseAll: document.getElementById("collapseAll"),
    groupMode: document.getElementById("groupMode"),
    exclusionNotice: document.getElementById("exclusionNotice"),
    excludeDialog: document.getElementById("excludeDialog"),
    excludeForm: document.getElementById("excludeForm"),
    excludeDialogItem: document.getElementById("excludeDialogItem"),
    excludeNote: document.getElementById("excludeNote"),
    excludeCancel: document.getElementById("excludeCancel"),
    holdDialog: document.getElementById("holdDialog"),
    holdForm: document.getElementById("holdForm"),
    holdDialogItem: document.getElementById("holdDialogItem"),
    holdNote: document.getElementById("holdNote"),
    holdCancel: document.getElementById("holdCancel"),
  };

  function escapeHtml(str) {
    if (str == null) return "";
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  /** Format updatedAt for humans in HKT */
  function formatUpdatedAt(iso) {
    if (!iso) return "上次更新：—";
    try {
      const d = new Date(iso);
      if (Number.isNaN(d.getTime())) return "上次更新：" + iso;
      const fmt = new Intl.DateTimeFormat("zh-HK", {
        timeZone: "Asia/Hong_Kong",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      });
      const parts = fmt.formatToParts(d);
      const get = (t) => parts.find((p) => p.type === t)?.value || "";
      const label =
        get("year") +
        "-" +
        get("month") +
        "-" +
        get("day") +
        " " +
        get("hour") +
        ":" +
        get("minute") +
        " HKT";
      return "上次更新：" + label;
    } catch (_) {
      return "上次更新：" + iso;
    }
  }

  function formatExcludedAt(iso) {
    if (!iso) return "—";
    const label = formatUpdatedAt(iso).replace(/^上次更新：/, "");
    return label || iso;
  }

  function formatDate(ymd) {
    if (!ymd) return "—";
    return ymd;
  }

  function formatDaysSince(n) {
    if (n == null || n === "") return "—";
    return String(n);
  }

  function typeSortKey(type) {
    const i = TYPE_ORDER.indexOf(type);
    return i === -1 ? 999 : i;
  }

  function sortItems(items) {
    return items.slice().sort((a, b) => {
      const ta = typeSortKey(a.type);
      const tb = typeSortKey(b.type);
      if (ta !== tb) return ta - tb;
      const sa = SUGGEST_ORDER[a.suggest] ?? 9;
      const sb = SUGGEST_ORDER[b.suggest] ?? 9;
      if (sa !== sb) return sa - sb;
      // more days since first within same suggest
      if (b.daysSince !== a.daysSince) return (b.daysSince || 0) - (a.daysSince || 0);
      return String(a.name).localeCompare(String(b.name), "zh-HK");
    });
  }

  function uniqueTypes(items) {
    const set = new Set(items.map((i) => i.type).filter(Boolean));
    return Array.from(set).sort((a, b) => typeSortKey(a) - typeSortKey(b));
  }

  function exclusionKey(type, name) {
    return String(type) + "|" + String(name);
  }

  function keyOf(item) {
    return exclusionKey(item.type, item.name);
  }

  function exclusionsEnabled() {
    return state.apiUrl.length > 0;
  }

  /** Sheet payload only. suggest is never derived here. */
  function normalizeExclusions(items) {
    if (!Array.isArray(items)) return [];
    const out = [];
    const seen = new Set();
    for (const raw of items) {
      if (!raw || typeof raw !== "object") continue;
      const type = String(raw.type || "").trim();
      const name = String(raw.name || "").trim();
      if (!type || !name) continue;
      if (raw.status && raw.status !== "excluded") continue;
      const key = exclusionKey(type, name);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        type: type,
        name: name,
        excludedAt: String(raw.at || raw.excludedAt || ""),
        note: String(raw.note || ""),
        status: "excluded",
      });
    }
    return out;
  }

  /** Sheet payload only. Does not invent a suggest. */
  function normalizeHolds(items) {
    if (!Array.isArray(items)) return [];
    const out = [];
    const seen = new Set();
    for (const raw of items) {
      if (!raw || typeof raw !== "object") continue;
      const type = String(raw.type || "").trim();
      const name = String(raw.name || "").trim();
      if (!type || !name) continue;
      if (raw.status && raw.status !== "held") continue;
      const key = exclusionKey(type, name);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        type: type,
        name: name,
        at: String(raw.at || ""),
        note: String(raw.note || ""),
        status: "held",
      });
    }
    return out;
  }

  function applyFromSheet(items, held) {
    state.exclusions = normalizeExclusions(items);
    if (Array.isArray(held)) state.holds = normalizeHolds(held);
    try {
      localStorage.setItem(
        CACHE_KEY,
        JSON.stringify({
          items: state.exclusions,
          held: state.holds,
          savedAt: new Date().toISOString(),
        })
      );
    } catch (_) {
      /* private mode or quota; Sheet remains source of truth on next load */
    }
  }

  function readCache() {
    try {
      const raw = localStorage.getItem(CACHE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || !Array.isArray(parsed.items)) return null;
      return {
        items: normalizeExclusions(parsed.items),
        held: normalizeHolds(parsed.held),
      };
    } catch (_) {
      return null;
    }
  }

  function hktYmd(date) {
    try {
      return new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Hong_Kong",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(date);
    } catch (_) {
      return "";
    }
  }

  /** Calendar days from heldAt in HKT. Hold day is 0. */
  function daysFromHeldAt(at) {
    const parsed = new Date(at);
    if (!at || Number.isNaN(parsed.getTime())) return null;
    const heldDay = hktYmd(parsed);
    const today = hktYmd(new Date());
    if (!/^\d{4}-\d{2}-\d{2}$/.test(heldDay) || !/^\d{4}-\d{2}-\d{2}$/.test(today)) return null;
    const start = Date.UTC(+heldDay.slice(0, 4), +heldDay.slice(5, 7) - 1, +heldDay.slice(8, 10));
    const end = Date.UTC(+today.slice(0, 4), +today.slice(5, 7) - 1, +today.slice(8, 10));
    const diff = Math.round((end - start) / 86400000);
    return diff < 0 ? 0 : diff;
  }

  function holdRecord(type, name) {
    const key = exclusionKey(type, name);
    for (const row of state.holds) {
      if (exclusionKey(row.type, row.name) === key) return row;
    }
    return null;
  }

  /**
   * Display overlay only. data.json suggest and dates stay untouched.
   * A hold forces the badge to 暫緩 and counts days from heldAt in HKT.
   */
  function applyHoldOverlay(item) {
    const hold = holdRecord(item.type, item.name);
    if (!hold) return item;
    const heldDay = hktYmd(new Date(hold.at));
    const days = daysFromHeldAt(hold.at);
    return Object.assign({}, item, {
      suggest: "暫緩",
      lastPurchased: heldDay || item.lastPurchased,
      daysSince: days == null ? item.daysSince : days,
      manualHold: true,
      holdNote: hold.note || "",
      heldAt: hold.at || "",
    });
  }

  function excludedDisplayItems() {
    const byKey = new Map(state.items.map((item) => [keyOf(item), item]));
    return state.exclusions.map((ex) => {
      const base = byKey.get(exclusionKey(ex.type, ex.name));
      const grocery = base
        ? {
            type: base.type,
            name: base.name,
            lastPurchased: base.lastPurchased,
            daysSince: base.daysSince,
            suggest: base.suggest,
            note: base.note,
            pack: base.pack,
            brands: Array.isArray(base.brands) ? base.brands : [],
          }
        : {
            type: ex.type,
            name: ex.name,
            lastPurchased: "",
            daysSince: null,
            suggest: "",
            note: "",
            pack: "",
            brands: [],
          };
      return Object.assign(grocery, {
        exclusionNote: ex.note || "",
        excludedAt: ex.excludedAt || "",
      });
    });
  }

  function sourceItems() {
    if (state.view === "excluded") return excludedDisplayItems().map(applyHoldOverlay);
    const hidden = new Set(state.exclusions.map((ex) => exclusionKey(ex.type, ex.name)));
    return state.items.filter((item) => !hidden.has(keyOf(item))).map(applyHoldOverlay);
  }

  function filterItems() {
    const q = state.search.trim().toLowerCase();
    return sourceItems().filter((item) => {
      // data.json suggest is display-only. A manual hold may overlay 暫緩.
      if (state.suggest !== "all" && item.suggest !== state.suggest) return false;
      if (state.type !== "all" && item.type !== state.type) return false;
      if (!q) return true;
      const brandBits = brandsOf(item).map((entry) =>
        [entry.brand || "", entry.title || "", entry.pack || "", entry.note || ""].join(" ")
      );
      const hay = [
        item.name,
        item.type,
        item.note || "",
        item.suggest || "",
        item.exclusionNote || "",
        item.holdNote || "",
        item.pack || "",
      ]
        .concat(brandBits)
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }

  function readStoredGroupMode() {
    try {
      const value = localStorage.getItem(GROUP_MODE_KEY);
      if (value === "type-suggest" || value === "suggest-type") return value;
    } catch (_) {
      /* private mode */
    }
    return "suggest-type";
  }

  function groupRank(node) {
    if (node.kind === "type") return typeSortKey(node.value);
    if (!node.value) return 50;
    return Object.prototype.hasOwnProperty.call(SUGGEST_ORDER, node.value)
      ? SUGGEST_ORDER[node.value]
      : 40;
  }

  function groupLabel(node) {
    if (node.kind === "suggest") return node.value || "未有建議";
    return node.value || "未分類";
  }

  /**
   * suggest-type: 建議 then 類型. type-suggest: the other way.
   * Manual holds already overlay suggest to 暫緩 before this runs.
   */
  function nest(items) {
    const suggestFirst = state.groupMode !== "type-suggest";
    const outerOf = (item) =>
      suggestFirst
        ? { kind: "suggest", value: item.suggest || "" }
        : { kind: "type", value: item.type || "" };
    const innerOf = (item) =>
      suggestFirst
        ? { kind: "type", value: item.type || "" }
        : { kind: "suggest", value: item.suggest || "" };
    const outerMap = new Map();
    for (const item of items) {
      const outer = outerOf(item);
      const outerKey = outer.kind + ":" + outer.value;
      if (!outerMap.has(outerKey)) {
        outerMap.set(outerKey, { kind: outer.kind, value: outer.value, key: outerKey, inners: new Map() });
      }
      const bucket = outerMap.get(outerKey);
      const inner = innerOf(item);
      const innerKey = outerKey + ">" + inner.kind + ":" + inner.value;
      if (!bucket.inners.has(innerKey)) {
        bucket.inners.set(innerKey, {
          kind: inner.kind,
          value: inner.value,
          key: innerKey,
          items: [],
        });
      }
      bucket.inners.get(innerKey).items.push(item);
    }
    const outers = Array.from(outerMap.values());
    outers.sort((a, b) => groupRank(a) - groupRank(b) || groupLabel(a).localeCompare(groupLabel(b), "zh-HK"));
    for (const outer of outers) {
      outer.groups = Array.from(outer.inners.values());
      outer.groups.sort(
        (a, b) => groupRank(a) - groupRank(b) || groupLabel(a).localeCompare(groupLabel(b), "zh-HK")
      );
      let count = 0;
      for (const group of outer.groups) {
        group.items = sortItems(group.items);
        group.count = group.items.length;
        count += group.count;
      }
      outer.count = count;
      delete outer.inners;
    }
    return outers;
  }

  function collectGroupKeys(outers) {
    const keys = [];
    for (const outer of outers) {
      keys.push(outer.key);
      for (const inner of outer.groups) keys.push(inner.key);
    }
    return keys;
  }

  function thumbHtml(item, className) {
    if (!item.image) return "";
    const alt = escapeHtml(item.imageAlt || item.name || "");
    return (
      '<img class="' +
      className +
      '" src="' +
      escapeHtml(item.image) +
      '" alt="' +
      alt +
      '" loading="lazy" width="56" height="56" />'
    );
  }

  function badgeHtml(suggest) {
    if (!suggest) return "";
    const s = escapeHtml(suggest);
    const cls =
      suggest === "優先" || suggest === "暫緩" || suggest === "在途"
        ? "badge badge-" + suggest
        : "badge";
    return '<span class="' + cls + '">' + s + "</span>";
  }

  function sheetButtonHtml(item, action, label, className, asMenuItem) {
    const busy = state.pendingKey === keyOf(item);
    const pending = busy && state.pendingAction === action;
    const shown = pending ? "處理緊…" : label;
    const enabled = exclusionsEnabled() && !busy;
    return (
      '<button type="button" class="action-btn ' +
      className +
      '" data-action="' +
      action +
      '" data-type="' +
      escapeHtml(item.type) +
      '" data-name="' +
      escapeHtml(item.name) +
      '"' +
      (enabled ? "" : " disabled") +
      (exclusionsEnabled() ? "" : ' title="未設定 Web App 網址"') +
      (asMenuItem ? ' role="menuitem"' : "") +
      ' aria-label="' +
      escapeHtml(shown + "：" + item.name) +
      '">' +
      escapeHtml(shown) +
      "</button>"
    );
  }

  function rowMenuHtml(item) {
    const menuId = domId("menu", keyOf(item));
    const pending = state.pendingKey === keyOf(item);
    const label = (pending ? "處理緊：" : "操作：") + item.name;
    return (
      '<div class="row-menu">' +
      '<button type="button" class="row-menu-trigger" aria-expanded="false" aria-haspopup="menu" aria-controls="' +
      menuId +
      '" aria-label="' +
      escapeHtml(label) +
      '"' +
      (pending ? ' aria-busy="true" disabled' : "") +
      ">" +
      '<span class="row-menu-glyph" aria-hidden="true">⋯</span>' +
      "</button>" +
      '<div class="row-menu-panel" id="' +
      menuId +
      '" role="menu" hidden aria-label="' +
      escapeHtml("操作：" + item.name) +
      '">' +
      actionButtonsHtml(item, true) +
      "</div></div>"
    );
  }

  /** Inline actions for wide screens. Hidden with CSS below 900px. */
  function rowActionsHtml(item) {
    return (
      '<div class="row-actions" role="group" aria-label="' +
      escapeHtml("操作：" + item.name) +
      '">' +
      actionButtonsHtml(item, false) +
      "</div>"
    );
  }

  function daysHtml(n) {
    const text = formatDaysSince(n);
    const shown = text === "—" ? "—" : text + "日";
    return (
      '<span class="item-days"><span class="sr-only">距今天數 </span>' +
      escapeHtml(shown) +
      "</span>"
    );
  }

  function actionButtonsHtml(item, asMenuItem) {
    const exclude = sheetButtonHtml(
      item,
      state.view === "excluded" ? "restore" : "exclude",
      state.view === "excluded" ? "回復" : "暫不考慮",
      state.view === "excluded" ? "action-restore" : "action-exclude",
      asMenuItem
    );
    if (state.view === "excluded") {
      const unhold = item.manualHold
        ? sheetButtonHtml(item, "unhold", "回復日子", "action-unhold", asMenuItem)
        : "";
      return unhold + exclude;
    }
    const hold = item.manualHold
      ? sheetButtonHtml(item, "unhold", "回復日子", "action-unhold", asMenuItem)
      : sheetButtonHtml(item, "hold", "手動暫緩", "action-hold", asMenuItem);
    return hold + exclude;
  }

  function holdMetaHtml(item) {
    if (!item.manualHold) return "";
    const note = item.holdNote
      ? '<p class="item-note">暫緩備註：' + escapeHtml(item.holdNote) + "</p>"
      : "";
    return '<p class="hold-flag">手動暫緩 · 日子由暫緩當日計，原本建議未改</p>' + note;
  }

  function exclusionMetaHtml(item) {
    if (state.view !== "excluded") return "";
    const note = item.exclusionNote
      ? '<p class="item-note">剔除備註：' + escapeHtml(item.exclusionNote) + "</p>"
      : "";
    return (
      '<p class="exclusion-when"><span class="meta-label">剔除時間</span><span class="meta-value">' +
      escapeHtml(formatExcludedAt(item.excludedAt)) +
      "</span></p>" +
      note
    );
  }

  function brandsOf(item) {
    return Array.isArray(item.brands) ? item.brands : [];
  }

  function domId(prefix, key) {
    return prefix + "-" + encodeURIComponent(key).replace(/%/g, "");
  }

  /** Public product links only. Rejects javascript: and other schemes. */
  function safeLink(url) {
    if (url == null) return "";
    const text = String(url).trim();
    if (!text) return "";
    try {
      const parsed = new URL(text);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return "";
      return parsed.href;
    } catch (_) {
      return "";
    }
  }

  function packHtml(pack, className) {
    if (pack == null || String(pack).trim() === "") return "";
    return '<span class="' + className + '">' + escapeHtml(String(pack).trim()) + "</span>";
  }

  /**
   * brand if present; title stands in when brand is null.
   * When both exist, title is the second line.
   */
  function brandLabelParts(entry) {
    const brand = entry && entry.brand != null ? String(entry.brand).trim() : "";
    const title = entry && entry.title != null ? String(entry.title).trim() : "";
    if (brand && title) return { primary: brand, secondary: title };
    if (brand) return { primary: brand, secondary: "" };
    if (title) return { primary: title, secondary: "" };
    return { primary: "未有牌子", secondary: "" };
  }

  function brandHtml(entry) {
    const labels = brandLabelParts(entry);
    const secondary = labels.secondary
      ? '<p class="brand-title">' + escapeHtml(labels.secondary) + "</p>"
      : "";
    const note =
      entry.note && String(entry.note).trim()
        ? '<p class="item-note">' + escapeHtml(entry.note) + "</p>"
        : "";
    const href = safeLink(entry.link);
    const link = href
      ? '<a class="public-link" href="' +
        escapeHtml(href) +
        '" target="_blank" rel="noopener noreferrer">公開連結</a>'
      : "";
    const imgSrc = safeLink(entry.image);
    const img = imgSrc
      ? thumbHtml(
          { image: imgSrc, imageAlt: entry.imageAlt || labels.primary, name: labels.primary },
          "brand-thumb"
        )
      : "";
    return (
      '<li class="brand-card">' +
      img +
      '<div class="brand-main">' +
      '<p class="brand-name">' +
      escapeHtml(labels.primary) +
      packHtml(entry.pack, "brand-pack") +
      "</p>" +
      secondary +
      '<div class="item-meta brand-meta">' +
      '<div><span class="meta-label">上次購買</span><span class="meta-value">' +
      escapeHtml(formatDate(entry.lastPurchased)) +
      "</span></div>" +
      '<div><span class="meta-label">距今天數</span><span class="meta-value">' +
      escapeHtml(formatDaysSince(entry.daysSince)) +
      "</span></div>" +
      "</div>" +
      note +
      link +
      "</div></li>"
    );
  }

  function cardHtml(item) {
    const brands = brandsOf(item);
    const canExpand = brands.length > 0;
    const key = keyOf(item);
    const isOpen = canExpand && state.openProducts.has(key);
    const panelId = domId("brands", key);
    const note = item.note
      ? '<p class="item-note">' + escapeHtml(item.note) + "</p>"
      : "";
    const nameAndPack =
      '<span class="item-title"><span class="item-name">' +
      escapeHtml(item.name) +
      "</span>" +
      packHtml(item.pack, "item-pack") +
      "</span>";
    const title = canExpand
      ? '<button type="button" class="product-toggle" aria-expanded="' +
        (isOpen ? "true" : "false") +
        '" aria-controls="' +
        panelId +
        '">' +
        '<svg class="chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>' +
        nameAndPack +
        "</button>"
      : '<div class="product-title-static">' + nameAndPack + "</div>";
    const empty = canExpand ? "" : '<p class="brand-empty">未有牌子明細</p>';
    const brandList = canExpand
      ? '<ul class="brand-list" id="' +
        panelId +
        '"' +
        (isOpen ? "" : " hidden") +
        ">" +
        brands.map(brandHtml).join("") +
        "</ul>"
      : "";
    const when = item.lastPurchased
      ? '<p class="item-when"><span class="meta-label">上次購買</span><span class="meta-value">' +
        escapeHtml(formatDate(item.lastPurchased)) +
        "</span></p>"
      : "";
    return (
      '<li class="item-card' +
      (isOpen ? " is-open" : "") +
      (item.manualHold ? " is-held" : "") +
      '" data-key="' +
      escapeHtml(key) +
      '">' +
      '<div class="product-row">' +
      '<div class="product-head">' +
      title +
      "</div>" +
      daysHtml(item.daysSince) +
      '<span class="item-suggest">' +
      badgeHtml(item.suggest) +
      "</span>" +
      rowMenuHtml(item) +
      rowActionsHtml(item) +
      "</div>" +
      when +
      note +
      holdMetaHtml(item) +
      exclusionMetaHtml(item) +
      empty +
      brandList +
      "</li>"
    );
  }

  function groupHeadingHtml(node) {
    const label = '<span class="category-title">' + escapeHtml(groupLabel(node)) + "</span>";
    if (node.kind === "suggest" && node.value) return label + badgeHtml(node.value);
    return label;
  }

  function accordionHtml(node, bodyHtml, extraClass) {
    const isOpen = !state.collapsedGroups.has(node.key);
    const panelId = domId("group", node.key);
    return (
      '<section class="category' +
      (extraClass ? " " + extraClass : "") +
      (isOpen ? " is-open" : "") +
      '" data-group-key="' +
      escapeHtml(node.key) +
      '" data-kind="' +
      escapeHtml(node.kind) +
      '" data-value="' +
      escapeHtml(node.value) +
      '">' +
      '<button type="button" class="category-toggle" aria-expanded="' +
      (isOpen ? "true" : "false") +
      '" aria-controls="' +
      panelId +
      '">' +
      '<svg class="chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>' +
      groupHeadingHtml(node) +
      '<span class="category-count">' +
      node.count +
      "</span>" +
      "</button>" +
      '<div class="category-body" id="' +
      panelId +
      '"' +
      (isOpen ? "" : " hidden") +
      ">" +
      bodyHtml +
      "</div></section>"
    );
  }

  function itemListHtml(items) {
    return (
      '<ul class="item-list">' +
      '<li class="item-columns" aria-hidden="true">' +
      "<span>品名</span><span>距今</span><span>建議</span><span>操作</span>" +
      "</li>" +
      items.map(cardHtml).join("") +
      "</ul>"
    );
  }

  function nestedHtml(outers) {
    return outers
      .map((outer) => {
        const inners = outer.groups
          .map((group) =>
            accordionHtml(group, itemListHtml(group.items), "category-inner")
          )
          .join("");
        return accordionHtml(outer, inners, "");
      })
      .join("");
  }

  function syncNotice() {
    const parts = [];
    if (state.flashNotice) parts.push(state.flashNotice);
    if (state.baseNotice) parts.push(state.baseNotice);
    const text = parts.join(" ");
    const level = state.flashNotice ? state.flashLevel : state.baseLevel;
    els.exclusionNotice.hidden = !text;
    els.exclusionNotice.textContent = text;
    els.exclusionNotice.classList.remove("is-warn", "is-error", "is-ok");
    if (text && level) els.exclusionNotice.classList.add("is-" + level);
  }

  function syncViewChips() {
    els.viewFilters.querySelectorAll("[data-view]").forEach((btn) => {
      const active = btn.getAttribute("data-view") === state.view;
      btn.classList.toggle("is-active", active);
      btn.setAttribute("aria-pressed", active ? "true" : "false");
    });
    const n = state.exclusions.length;
    els.excludedViewBtn.textContent = n > 0 ? "暫不考慮 (" + n + ")" : "暫不考慮";
  }

  function render() {
    syncNotice();
    syncViewChips();

    if (state.loadingExclusions) {
      els.sections.innerHTML = "";
      els.emptyState.hidden = false;
      els.emptyState.textContent = "讀緊剔除清單…";
      els.resultCount.textContent = "";
      return;
    }

    const filtered = sortItems(filterItems());
    const groups = nest(filtered);
    const universe = state.view === "excluded" ? state.exclusions.length : state.items.length;

    els.resultCount.textContent =
      state.view === "excluded"
        ? "暫不考慮 " + filtered.length + "／" + universe + " 項"
        : "顯示 " + filtered.length + "／" + universe + " 項";

    if (groups.length === 0) {
      els.sections.innerHTML = "";
      els.emptyState.hidden = false;
      els.emptyState.textContent =
        state.view === "excluded" && state.exclusions.length === 0
          ? "未有暫不考慮嘅項目。"
          : "冇符合條件嘅項目。";
      return;
    }
    els.emptyState.hidden = true;
    els.sections.innerHTML = nestedHtml(groups);
  }

  function populateTypeFilter(types) {
    const sel = els.typeFilter;
    const current = state.type;
    while (sel.options.length > 1) sel.remove(1);
    for (const t of types) {
      const opt = document.createElement("option");
      opt.value = t;
      opt.textContent = t;
      sel.appendChild(opt);
    }
    if ([...sel.options].some((opt) => opt.value === current)) {
      sel.value = current;
    } else {
      state.type = "all";
      sel.value = "all";
    }
  }

  function refreshTypeFilter() {
    const types = uniqueTypes(
      state.items.concat(state.exclusions.map((ex) => ({ type: ex.type })))
    );
    populateTypeFilter(types);
  }

  function setSuggestFilter(value) {
    state.suggest = value;
    const buttons = els.suggestFilters.querySelectorAll("[data-suggest]");
    buttons.forEach((btn) => {
      const active = btn.getAttribute("data-suggest") === value;
      btn.classList.toggle("is-active", active);
      btn.setAttribute("aria-pressed", active ? "true" : "false");
    });
    render();
  }

  function revealGroups(items) {
    for (const key of collectGroupKeys(nest(items))) state.collapsedGroups.delete(key);
  }

  function setGroupMode(mode) {
    state.groupMode = mode === "type-suggest" ? "type-suggest" : "suggest-type";
    try {
      localStorage.setItem(GROUP_MODE_KEY, state.groupMode);
    } catch (_) {
      /* private mode; the choice still applies this visit */
    }
    syncGroupMode();
    render();
  }

  function syncGroupMode() {
    if (!els.groupMode) return;
    els.groupMode.querySelectorAll("[data-group-mode]").forEach((btn) => {
      const active = btn.getAttribute("data-group-mode") === state.groupMode;
      btn.classList.toggle("is-active", active);
      btn.setAttribute("aria-pressed", active ? "true" : "false");
    });
  }

  function setView(view) {
    state.view = view === "excluded" ? "excluded" : "main";
    if (state.view === "excluded") revealGroups(excludedDisplayItems().map(applyHoldOverlay));
    render();
  }

  function toggleGroup(key) {
    if (state.collapsedGroups.has(key)) state.collapsedGroups.delete(key);
    else state.collapsedGroups.add(key);
    render();
    const escaped = typeof CSS !== "undefined" && CSS.escape ? CSS.escape(key) : key;
    const btn = els.sections.querySelector(
      '.category[data-group-key="' + escaped + '"] > .category-toggle'
    );
    if (btn) btn.focus();
  }

  function toggleProduct(key) {
    if (state.openProducts.has(key)) state.openProducts.delete(key);
    else state.openProducts.add(key);
    render();
    const escaped = typeof CSS !== "undefined" && CSS.escape ? CSS.escape(key) : key;
    const btn = els.sections.querySelector(
      '.item-card[data-key="' + escaped + '"] .product-toggle'
    );
    if (btn) btn.focus();
  }

  function expandAllVisible() {
    for (const key of collectGroupKeys(nest(filterItems()))) state.collapsedGroups.delete(key);
    render();
  }

  function collapseAll() {
    for (const key of collectGroupKeys(nest(filterItems()))) state.collapsedGroups.add(key);
    render();
  }

  function openExcludeDialog(type, name, trigger) {
    if (!exclusionsEnabled() || state.pendingKey) return;
    state.dialogItem = { type: type, name: name, kind: "exclude" };
    state.dialogTrigger = trigger || null;
    els.excludeDialogItem.textContent = type + " · " + name;
    els.excludeNote.value = "";
    if (typeof els.excludeDialog.showModal === "function") {
      els.excludeDialog.showModal();
      els.excludeNote.focus();
    }
  }

  function openHoldDialog(type, name, trigger) {
    if (!exclusionsEnabled() || state.pendingKey) return;
    state.dialogItem = { type: type, name: name, kind: "hold" };
    state.dialogTrigger = trigger || null;
    els.holdDialogItem.textContent = type + " · " + name;
    els.holdNote.value = HOLD_NOTE_DEFAULT;
    if (typeof els.holdDialog.showModal === "function") {
      els.holdDialog.showModal();
      els.holdNote.focus();
      const end = els.holdNote.value.length;
      if (typeof els.holdNote.setSelectionRange === "function") {
        els.holdNote.setSelectionRange(end, end);
      }
    }
  }

  async function fetchJson(url, options) {
    const res = await fetch(
      url,
      Object.assign(
        { credentials: "omit", cache: "no-store", redirect: "follow" },
        options || {}
      )
    );
    const text = await res.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch (_) {
      throw new Error("回應唔係 JSON。請確認 Web App 已部署為「任何人」。");
    }
    if (!data || typeof data !== "object") throw new Error("回應格式唔啱");
    if (!res.ok && !data.error) throw new Error("HTTP " + res.status);
    return data;
  }

  function withTimeout(promise, ms) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("連線逾時")), ms);
      promise.then(
        (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        (err) => {
          clearTimeout(timer);
          reject(err);
        }
      );
    });
  }

  async function postExclusion(action, type, name, note) {
    if (!exclusionsEnabled()) return;
    const key = exclusionKey(type, name);
    if (state.pendingKey) return;
    state.pendingKey = key;
    state.pendingAction = action;
    state.flashNotice = "";
    state.flashLevel = "";
    render();
    try {
      const payload = { action: action, type: type, name: name };
      if (action === "exclude" || action === "hold") payload.note = String(note || "").trim();
      // POST stays a simple request: text/plain JSON body, no preflight.
      // Apps Script does not answer CORS preflight OPTIONS.
      const data = await fetchJson(state.apiUrl, {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify(payload),
      });
      if (Array.isArray(data.items)) {
        applyFromSheet(data.items, Array.isArray(data.held) ? data.held : undefined);
        state.baseNotice = "";
        state.baseLevel = "";
      }
      if (data.error) throw new Error(data.error);
      const done = {
        exclude: "已暫不考慮「" + name + "」。呢項會喺主清單隱藏。",
        restore: "已回復「" + name + "」到補貨清單。",
        hold: "已手動暫緩「" + name + "」。仍然留喺補貨清單。",
        unhold: "已回復「" + name + "」嘅日子同建議。",
      };
      state.flashNotice = done[action] || "已更新。";
      state.flashLevel = "ok";
      if (action === "exclude" && state.view === "excluded") {
        revealGroups(
          excludedDisplayItems()
            .filter((item) => item.type === type && item.name === name)
            .map(applyHoldOverlay)
        );
      }
    } catch (err) {
      const failed = {
        exclude: "剔除失敗：",
        restore: "回復失敗：",
        hold: "手動暫緩失敗：",
        unhold: "回復日子失敗：",
      };
      state.flashNotice = (failed[action] || "更新失敗：") + (err && err.message ? err.message : "請再試");
      state.flashLevel = "error";
    } finally {
      state.pendingKey = "";
      state.pendingAction = "";
      refreshTypeFilter();
      render();
    }
  }

  function enabledMenuItems(panel) {
    return Array.from(panel.querySelectorAll('[role="menuitem"]:not([disabled])'));
  }

  function placeRowMenu(menu) {
    const trigger = menu.querySelector(".row-menu-trigger");
    const panel = menu.querySelector(".row-menu-panel");
    if (!trigger || !panel || panel.hidden) return;
    const rect = trigger.getBoundingClientRect();
    if (rect.bottom < 0 || rect.top > window.innerHeight) {
      closeRowMenu(menu, false);
      return;
    }
    const margin = 8;
    const width = panel.offsetWidth;
    const height = panel.offsetHeight;
    let top = rect.bottom + 4;
    if (top + height > window.innerHeight - margin && rect.top - height - 4 >= margin) {
      top = rect.top - height - 4;
    }
    let left = rect.right - width;
    if (left < margin) left = margin;
    if (left + width > window.innerWidth - margin) {
      left = Math.max(margin, window.innerWidth - margin - width);
    }
    panel.style.top = Math.round(top) + "px";
    panel.style.left = Math.round(left) + "px";
  }

  function closeRowMenu(menu, restoreFocus) {
    const trigger = menu.querySelector(".row-menu-trigger");
    const panel = menu.querySelector(".row-menu-panel");
    if (!trigger || !panel) return;
    const wasOpen = trigger.getAttribute("aria-expanded") === "true";
    trigger.setAttribute("aria-expanded", "false");
    panel.hidden = true;
    menu.classList.remove("is-open");
    panel.style.top = "";
    panel.style.left = "";
    if (restoreFocus && wasOpen) trigger.focus();
  }

  function closeRowMenus(restoreFocus) {
    els.sections.querySelectorAll(".row-menu.is-open").forEach((menu) => {
      closeRowMenu(menu, restoreFocus);
    });
  }

  function openRowMenu(menu) {
    closeRowMenus(false);
    const trigger = menu.querySelector(".row-menu-trigger");
    const panel = menu.querySelector(".row-menu-panel");
    if (!trigger || !panel || trigger.disabled) return;
    trigger.setAttribute("aria-expanded", "true");
    panel.hidden = false;
    menu.classList.add("is-open");
    placeRowMenu(menu);
    const items = enabledMenuItems(panel);
    if (items.length) items[0].focus();
  }

  function onRowMenuKeydown(e) {
    if (els.excludeDialog.open || els.holdDialog.open) return;
    const openMenu = els.sections.querySelector(".row-menu.is-open");
    const inMenu = e.target.closest ? e.target.closest(".row-menu") : null;

    if (e.key === "Escape") {
      if (!openMenu) return;
      e.preventDefault();
      closeRowMenu(openMenu, true);
      return;
    }

    const trigger = e.target.closest ? e.target.closest(".row-menu-trigger") : null;
    if (
      trigger &&
      trigger.getAttribute("aria-expanded") !== "true" &&
      (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Enter" || e.key === " ")
    ) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        openRowMenu(trigger.closest(".row-menu"));
      }
      return;
    }

    if (!openMenu || inMenu !== openMenu) return;

    const panel = openMenu.querySelector(".row-menu-panel");
    const items = enabledMenuItems(panel);
    const triggerEl = openMenu.querySelector(".row-menu-trigger");
    const cycle = [triggerEl].concat(items);
    const index = cycle.indexOf(document.activeElement);

    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      if (!items.length) return;
      e.preventDefault();
      const current = items.indexOf(document.activeElement);
      const delta = e.key === "ArrowDown" ? 1 : -1;
      const next =
        current === -1
          ? delta === 1
            ? 0
            : items.length - 1
          : (current + delta + items.length) % items.length;
      items[next].focus();
      return;
    }
    if (e.key === "Home") {
      if (!items.length) return;
      e.preventDefault();
      items[0].focus();
      return;
    }
    if (e.key === "End") {
      if (!items.length) return;
      e.preventDefault();
      items[items.length - 1].focus();
      return;
    }
    if (e.key === "Tab") {
      if (cycle.length < 2) return;
      e.preventDefault();
      const from = index === -1 ? 0 : index;
      const next = e.shiftKey ? (from - 1 + cycle.length) % cycle.length : (from + 1) % cycle.length;
      cycle[next].focus();
    }
  }

  function runRowAction(actionBtn, focusEl) {
    if (!actionBtn || actionBtn.disabled) return;
    const type = actionBtn.getAttribute("data-type");
    const name = actionBtn.getAttribute("data-name");
    const action = actionBtn.getAttribute("data-action");
    const focus = focusEl || actionBtn;
    if (action === "exclude") openExcludeDialog(type, name, focus);
    if (action === "restore") postExclusion("restore", type, name);
    if (action === "hold") openHoldDialog(type, name, focus);
    if (action === "unhold") postExclusion("unhold", type, name);
  }

  function bindEvents() {
    let searchTimer = null;
    els.searchInput.addEventListener("input", () => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => {
        state.search = els.searchInput.value;
        render();
      }, 120);
    });

    els.suggestFilters.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-suggest]");
      if (!btn) return;
      setSuggestFilter(btn.getAttribute("data-suggest"));
    });

    els.viewFilters.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-view]");
      if (!btn) return;
      setView(btn.getAttribute("data-view"));
    });

    els.typeFilter.addEventListener("change", () => {
      state.type = els.typeFilter.value;
      render();
    });

    els.sections.addEventListener("click", (e) => {
      const inMenu = e.target.closest(".row-menu");
      if (inMenu) {
        const trigger = e.target.closest(".row-menu-trigger");
        if (trigger) {
          if (trigger.getAttribute("aria-expanded") === "true") closeRowMenu(inMenu, false);
          else openRowMenu(inMenu);
          return;
        }
        const actionBtn = e.target.closest("[data-action]");
        if (actionBtn) {
          const menuTrigger = inMenu.querySelector(".row-menu-trigger");
          closeRowMenu(inMenu, false);
          runRowAction(actionBtn, menuTrigger || actionBtn);
          return;
        }
        return;
      }
      const inlineAction = e.target.closest(".row-actions [data-action]");
      if (inlineAction) {
        closeRowMenus(false);
        runRowAction(inlineAction, inlineAction);
        return;
      }
      closeRowMenus(false);
      const productBtn = e.target.closest(".product-toggle");
      if (productBtn) {
        const card = productBtn.closest(".item-card");
        const key = card && card.getAttribute("data-key");
        if (key) toggleProduct(key);
        return;
      }
      const btn = e.target.closest(".category-toggle");
      if (!btn) return;
      const section = btn.closest(".category");
      const key = section && section.getAttribute("data-group-key");
      if (key) toggleGroup(key);
    });

    els.groupMode.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-group-mode]");
      if (!btn) return;
      setGroupMode(btn.getAttribute("data-group-mode"));
    });

    els.expandAll.addEventListener("click", expandAllVisible);
    els.collapseAll.addEventListener("click", collapseAll);

    els.excludeCancel.addEventListener("click", () => {
      state.dialogItem = null;
      els.excludeDialog.close();
    });

    els.excludeForm.addEventListener("submit", () => {
      const item = state.dialogItem;
      const note = els.excludeNote.value;
      state.dialogItem = null;
      if (!item) return;
      postExclusion("exclude", item.type, item.name, note);
    });

    els.excludeDialog.addEventListener("close", () => {
      const trigger = state.dialogTrigger;
      state.dialogTrigger = null;
      if (trigger && typeof trigger.focus === "function") trigger.focus();
    });

    els.excludeDialog.addEventListener("click", (e) => {
      if (e.target === els.excludeDialog) {
        state.dialogItem = null;
        els.excludeDialog.close();
      }
    });

    els.holdCancel.addEventListener("click", () => {
      state.dialogItem = null;
      els.holdDialog.close();
    });

    els.holdForm.addEventListener("submit", () => {
      const item = state.dialogItem;
      const note = els.holdNote.value;
      state.dialogItem = null;
      if (!item || item.kind !== "hold") return;
      postExclusion("hold", item.type, item.name, note);
    });

    els.holdDialog.addEventListener("close", () => {
      const trigger = state.dialogTrigger;
      state.dialogTrigger = null;
      if (trigger && typeof trigger.focus === "function") trigger.focus();
    });

    els.holdDialog.addEventListener("click", (e) => {
      if (e.target === els.holdDialog) {
        state.dialogItem = null;
        els.holdDialog.close();
      }
    });

    document.addEventListener("click", (e) => {
      if (e.target.closest(".row-menu")) return;
      closeRowMenus(false);
    });

    els.sections.addEventListener("focusout", (e) => {
      const menu = e.target.closest(".row-menu");
      if (!menu || !menu.classList.contains("is-open")) return;
      requestAnimationFrame(() => {
        if (!menu.isConnected || !menu.classList.contains("is-open")) return;
        if (menu.contains(document.activeElement)) return;
        closeRowMenu(menu, false);
      });
    });

    document.addEventListener("keydown", onRowMenuKeydown);

    window.addEventListener("resize", () => {
      const open = els.sections.querySelector(".row-menu.is-open");
      if (open) placeRowMenu(open);
    });

    // Keep in step with the 900px layout in styles.css. Wide screens show
    // inline actions, so an open 「⋯」 menu should not stay expanded.
    const wideLayout = window.matchMedia("(min-width: 900px)");
    const onWideLayout = (event) => {
      if (event.matches) closeRowMenus(false);
    };
    if (typeof wideLayout.addEventListener === "function") {
      wideLayout.addEventListener("change", onWideLayout);
    } else if (typeof wideLayout.addListener === "function") {
      wideLayout.addListener(onWideLayout);
    }

    window.addEventListener(
      "scroll",
      () => {
        const open = els.sections.querySelector(".row-menu.is-open");
        if (open) placeRowMenu(open);
      },
      true
    );
  }

  function shortReason(err) {
    const msg = err && err.message ? String(err.message).replace(/\s+/g, " ").trim() : "";
    if (!msg) return "未知錯誤";
    return msg.length > 140 ? msg.slice(0, 140) + "…" : msg;
  }

  function noticeWithReason(sentence, err, extraErr) {
    const bits = [];
    const primary = shortReason(err);
    if (primary) bits.push(primary);
    if (extraErr) {
      const extra = shortReason(extraErr);
      if (extra && extra !== primary) bits.push("JSONP：" + extra);
    }
    if (!bits.length) return sentence;
    return sentence + "（" + bits.join("；") + "）";
  }

  function acceptExclusionPayload(data) {
    if (!data || typeof data !== "object") throw new Error("回應格式唔啱");
    if (data.error && !Array.isArray(data.items)) throw new Error(data.error);
    const hasHeld = Array.isArray(data.held);
    applyFromSheet(Array.isArray(data.items) ? data.items : [], hasHeld ? data.held : undefined);
    if (data.error) {
      state.baseNotice = data.error;
      state.baseLevel = "error";
      return;
    }
    if (!hasHeld) {
      state.baseNotice = "讀到剔除清單，但呢個部署未支援「手動暫緩」。請喺 Apps Script 建立新版本。";
      state.baseLevel = "warn";
      return;
    }
    state.baseNotice = "";
    state.baseLevel = "";
  }

  function withCallbackParam(url, callbackName) {
    const parsed = new URL(url);
    parsed.searchParams.set("callback", callbackName);
    return parsed.href;
  }

  /**
   * <script> JSONP. GAS redirects script.google.com → script.googleusercontent.com;
   * a script tag follows that redirect without a CORS check. fetch often does not.
   */
  function loadScriptJsonp(url) {
    return new Promise((resolve, reject) => {
      const callbackName =
        "groceryExclusionsCb_" +
        Date.now().toString(36) +
        "_" +
        Math.floor(Math.random() * 1e9).toString(36);
      let settled = false;
      const script = document.createElement("script");
      const timer = setTimeout(() => finish(new Error("JSONP 逾時")), EXCLUSION_TIMEOUT_MS);

      function cleanup() {
        clearTimeout(timer);
        try {
          delete window[callbackName];
        } catch (_) {
          window[callbackName] = undefined;
        }
        script.onload = null;
        script.onerror = null;
        if (script.parentNode) script.parentNode.removeChild(script);
      }

      function finish(err, data) {
        if (settled) return;
        settled = true;
        cleanup();
        if (err) reject(err);
        else resolve(data);
      }

      window[callbackName] = function (data) {
        finish(null, data);
      };

      script.async = true;
      script.referrerPolicy = "no-referrer";
      try {
        script.src = withCallbackParam(url, callbackName);
      } catch (err) {
        finish(err instanceof Error ? err : new Error("JSONP 網址唔啱"));
        return;
      }
      script.onerror = function () {
        finish(new Error("JSONP 載入失敗"));
      };
      script.onload = function () {
        if (!settled) finish(new Error("JSONP 回應冇呼叫 callback"));
      };
      document.head.appendChild(script);
    });
  }

  function failExclusions(err, jsonpErr) {
    const cached = readCache();
    if (cached) {
      state.exclusions = cached.items;
      state.holds = cached.held;
      state.baseNotice = noticeWithReason(
        "讀唔到 Google Sheet，暫時用本機暫存。連到試算表之後會以 Sheet 為準。",
        err,
        jsonpErr
      );
      state.baseLevel = "warn";
      return;
    }
    state.exclusions = [];
    state.holds = [];
    state.baseNotice = noticeWithReason(
      "讀唔到剔除清單。補貨清單照常顯示，剔除暫時用唔到。",
      err,
      jsonpErr
    );
    state.baseLevel = "error";
  }

  async function loadExclusions() {
    const url = String(
      typeof window.GROCERY_EXCLUSIONS_API === "string" ? window.GROCERY_EXCLUSIONS_API : ""
    ).trim();
    state.apiUrl = url;
    if (!url) {
      state.exclusions = [];
      state.holds = [];
      state.baseNotice =
        "未設定剔除清單網址。請喺 config.js 貼上 Web App 網址，先用到「暫不考慮」同「手動暫緩」。";
      state.baseLevel = "warn";
      state.loadingExclusions = false;
      return;
    }

    state.loadingExclusions = true;
    state.baseNotice = "讀緊剔除清單…";
    state.baseLevel = "";
    render();
    try {
      const data = await withTimeout(fetchJson(url, { method: "GET" }), EXCLUSION_TIMEOUT_MS);
      acceptExclusionPayload(data);
    } catch (err) {
      console.error(err);
      try {
        const data = await loadScriptJsonp(url);
        acceptExclusionPayload(data);
      } catch (jsonpErr) {
        console.error(jsonpErr);
        failExclusions(err, jsonpErr);
      }
    } finally {
      state.loadingExclusions = false;
    }
  }

  async function load() {
    try {
      const res = await fetch("./data.json", { cache: "no-store" });
      if (!res.ok) throw new Error("載入 data.json 失敗（" + res.status + "）");
      const data = await res.json();
      if (!data || !Array.isArray(data.items)) {
        throw new Error("data.json 格式唔啱：缺少 items");
      }
      state.updatedAt = data.updatedAt || null;
      state.items = data.items;
      els.updatedAt.textContent = formatUpdatedAt(state.updatedAt);

      refreshTypeFilter();

      els.errorBox.hidden = true;
      await loadExclusions();
      refreshTypeFilter();
      render();
    } catch (err) {
      console.error(err);
      els.updatedAt.textContent = "上次更新：載入失敗";
      els.errorBox.hidden = false;
      els.errorBox.textContent =
        "讀唔到資料。請用本機靜態伺服器開啟（例如：python3 -m http.server 8080），唔好直接用 file://。";
    }
  }

  bindEvents();
  syncGroupMode();
  load();
})();
