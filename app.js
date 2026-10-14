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
  const EXCLUSION_TIMEOUT_MS = 12000;

  const state = {
    items: [],
    updatedAt: null,
    search: "",
    suggest: "all",
    type: "all",
    view: "main",
    openTypes: new Set(),
    exclusions: [],
    apiUrl: "",
    pendingKey: "",
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
    exclusionNotice: document.getElementById("exclusionNotice"),
    excludeDialog: document.getElementById("excludeDialog"),
    excludeForm: document.getElementById("excludeForm"),
    excludeDialogItem: document.getElementById("excludeDialogItem"),
    excludeNote: document.getElementById("excludeNote"),
    excludeCancel: document.getElementById("excludeCancel"),
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
        excludedAt: String(raw.excludedAt || ""),
        note: String(raw.note || ""),
        status: "excluded",
      });
    }
    return out;
  }

  function applyFromSheet(items) {
    state.exclusions = normalizeExclusions(items);
    try {
      localStorage.setItem(
        CACHE_KEY,
        JSON.stringify({ items: state.exclusions, savedAt: new Date().toISOString() })
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
      return normalizeExclusions(parsed.items);
    } catch (_) {
      return null;
    }
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
            image: base.image,
            imageAlt: base.imageAlt,
          }
        : {
            type: ex.type,
            name: ex.name,
            lastPurchased: "",
            daysSince: null,
            suggest: "",
            note: "",
            image: null,
            imageAlt: null,
          };
      return Object.assign(grocery, {
        exclusionNote: ex.note || "",
        excludedAt: ex.excludedAt || "",
      });
    });
  }

  function sourceItems() {
    if (state.view === "excluded") return excludedDisplayItems();
    const hidden = new Set(state.exclusions.map((ex) => exclusionKey(ex.type, ex.name)));
    return state.items.filter((item) => !hidden.has(keyOf(item)));
  }

  function filterItems() {
    const q = state.search.trim().toLowerCase();
    return sourceItems().filter((item) => {
      // Display the stored suggest only — never recalculate it.
      if (state.suggest !== "all" && item.suggest !== state.suggest) return false;
      if (state.type !== "all" && item.type !== state.type) return false;
      if (!q) return true;
      const hay = [
        item.name,
        item.type,
        item.note || "",
        item.suggest || "",
        item.exclusionNote || "",
      ]
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }

  function groupByType(items) {
    const map = new Map();
    for (const item of items) {
      if (!map.has(item.type)) map.set(item.type, []);
      map.get(item.type).push(item);
    }
    const types = Array.from(map.keys()).sort(
      (a, b) => typeSortKey(a) - typeSortKey(b)
    );
    return types.map((type) => ({ type, items: map.get(type) }));
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

  function actionButtonHtml(item) {
    const restore = state.view === "excluded";
    const action = restore ? "restore" : "exclude";
    const pending = state.pendingKey === keyOf(item);
    const label = pending ? "處理緊…" : restore ? "回復" : "暫不考慮";
    const enabled = exclusionsEnabled() && !pending;
    return (
      '<button type="button" class="action-btn ' +
      (restore ? "action-restore" : "action-exclude") +
      '" data-action="' +
      action +
      '" data-type="' +
      escapeHtml(item.type) +
      '" data-name="' +
      escapeHtml(item.name) +
      '"' +
      (enabled ? "" : " disabled") +
      (exclusionsEnabled() ? "" : ' title="未設定 Web App 網址"') +
      ' aria-label="' +
      escapeHtml(label + "：" + item.name) +
      '">' +
      escapeHtml(label) +
      "</button>"
    );
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

  function cardHtml(item) {
    const hasImg = !!item.image;
    const thumb = hasImg
      ? thumbHtml(item, "item-thumb")
      : '<span class="item-thumb-placeholder" aria-hidden="true"></span>';
    const note = item.note
      ? '<p class="item-note">' + escapeHtml(item.note) + "</p>"
      : "";
    return (
      '<li class="item-card">' +
      thumb +
      '<div class="item-main">' +
      '<div class="item-name-row">' +
      '<p class="item-name">' +
      escapeHtml(item.name) +
      "</p>" +
      badgeHtml(item.suggest) +
      "</div>" +
      '<div class="item-meta">' +
      "<div><span class=\"meta-label\">上次購買</span><span class=\"meta-value\">" +
      escapeHtml(formatDate(item.lastPurchased)) +
      "</span></div>" +
      "<div><span class=\"meta-label\">距今天數</span><span class=\"meta-value\">" +
      escapeHtml(formatDaysSince(item.daysSince)) +
      "</span></div>" +
      "<div><span class=\"meta-label\">類型</span><span class=\"meta-value\">" +
      escapeHtml(item.type) +
      "</span></div>" +
      "</div>" +
      note +
      exclusionMetaHtml(item) +
      '<div class="item-actions">' +
      actionButtonHtml(item) +
      "</div>" +
      "</div>" +
      "</li>"
    );
  }

  function tableRowHtml(item) {
    const imgCell = item.image
      ? '<td class="col-img">' + thumbHtml(item, "thumb-sm") + "</td>"
      : '<td class="col-img"></td>';
    const excludedCells =
      state.view === "excluded"
        ? "<td>" +
          escapeHtml(formatExcludedAt(item.excludedAt)) +
          "</td><td>" +
          escapeHtml(item.exclusionNote || "") +
          "</td>"
        : "";
    return (
      "<tr>" +
      imgCell +
      '<td class="name-cell">' +
      escapeHtml(item.name) +
      "</td>" +
      "<td>" +
      escapeHtml(item.type) +
      "</td>" +
      "<td>" +
      escapeHtml(formatDate(item.lastPurchased)) +
      "</td>" +
      "<td>" +
      escapeHtml(formatDaysSince(item.daysSince)) +
      "</td>" +
      "<td>" +
      badgeHtml(item.suggest) +
      "</td>" +
      '<td class="note-cell">' +
      escapeHtml(item.note || "") +
      "</td>" +
      excludedCells +
      '<td class="action-cell">' +
      actionButtonHtml(item) +
      "</td>" +
      "</tr>"
    );
  }

  function tableHeadHtml() {
    const extra =
      state.view === "excluded" ? "<th>剔除時間</th><th>剔除備註</th>" : "";
    return (
      "<thead><tr>" +
      '<th class="col-img"></th>' +
      "<th>品名</th><th>類型</th><th>上次購買</th><th>距今天數</th><th>建議</th><th>短備註</th>" +
      extra +
      "<th>操作</th>" +
      "</tr></thead>"
    );
  }

  function sectionHtml(group) {
    const isOpen = state.openTypes.has(group.type);
    const openClass = isOpen ? " is-open" : "";
    const expanded = isOpen ? "true" : "false";
    const panelId = "panel-" + encodeURIComponent(group.type).replace(/%/g, "");
    const cards = group.items.map(cardHtml).join("");
    const rows = group.items.map(tableRowHtml).join("");
    return (
      '<section class="category' +
      openClass +
      '" data-type="' +
      escapeHtml(group.type) +
      '">' +
      '<button type="button" class="category-toggle" aria-expanded="' +
      expanded +
      '" aria-controls="' +
      panelId +
      '">' +
      '<svg class="chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>' +
      '<span class="category-title">' +
      escapeHtml(group.type) +
      "</span>" +
      '<span class="category-count">' +
      group.items.length +
      "</span>" +
      "</button>" +
      '<div class="category-body" id="' +
      panelId +
      '"' +
      (isOpen ? "" : " hidden") +
      ">" +
      '<ul class="item-list">' +
      cards +
      "</ul>" +
      '<div class="table-wrap">' +
      '<table class="data-table">' +
      tableHeadHtml() +
      "<tbody>" +
      rows +
      "</tbody></table></div>" +
      "</div></section>"
    );
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
    const groups = groupByType(filtered);
    const universe = sourceItems().length;

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
    els.sections.innerHTML = groups.map(sectionHtml).join("");
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

  function setView(view) {
    state.view = view === "excluded" ? "excluded" : "main";
    if (state.view === "excluded") {
      for (const item of excludedDisplayItems()) state.openTypes.add(item.type);
    }
    render();
  }

  function toggleType(type) {
    if (state.openTypes.has(type)) state.openTypes.delete(type);
    else state.openTypes.add(type);
    render();
  }

  function expandAllVisible() {
    const filtered = filterItems();
    for (const item of filtered) state.openTypes.add(item.type);
    render();
  }

  function collapseAll() {
    state.openTypes.clear();
    render();
  }

  function openExcludeDialog(type, name, trigger) {
    if (!exclusionsEnabled() || state.pendingKey) return;
    state.dialogItem = { type: type, name: name };
    state.dialogTrigger = trigger || null;
    els.excludeDialogItem.textContent = type + " · " + name;
    els.excludeNote.value = "";
    if (typeof els.excludeDialog.showModal === "function") {
      els.excludeDialog.showModal();
      els.excludeNote.focus();
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
    state.flashNotice = "";
    state.flashLevel = "";
    render();
    try {
      const payload = { action: action, type: type, name: name };
      if (action === "exclude") payload.note = String(note || "").trim();
      // text/plain keeps the browser from sending a CORS preflight, which Apps Script does not answer.
      const data = await fetchJson(state.apiUrl, {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify(payload),
      });
      if (Array.isArray(data.items)) {
        applyFromSheet(data.items);
        state.baseNotice = "";
        state.baseLevel = "";
      }
      if (data.error) throw new Error(data.error);
      state.flashNotice =
        action === "exclude" ? "已暫不考慮「" + name + "」。" : "已回復「" + name + "」。";
      state.flashLevel = "ok";
      if (action === "exclude" && state.view === "excluded") state.openTypes.add(type);
    } catch (err) {
      state.flashNotice =
        (action === "exclude" ? "剔除失敗：" : "回復失敗：") +
        (err && err.message ? err.message : "請再試");
      state.flashLevel = "error";
    } finally {
      state.pendingKey = "";
      refreshTypeFilter();
      render();
    }
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
      const actionBtn = e.target.closest("[data-action]");
      if (actionBtn) {
        if (actionBtn.disabled) return;
        const type = actionBtn.getAttribute("data-type");
        const name = actionBtn.getAttribute("data-name");
        const action = actionBtn.getAttribute("data-action");
        if (action === "exclude") openExcludeDialog(type, name, actionBtn);
        if (action === "restore") postExclusion("restore", type, name);
        return;
      }
      const btn = e.target.closest(".category-toggle");
      if (!btn) return;
      const section = btn.closest(".category");
      if (!section) return;
      toggleType(section.getAttribute("data-type"));
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
  }

  async function loadExclusions() {
    const url = String(
      typeof window.GROCERY_EXCLUSIONS_API === "string" ? window.GROCERY_EXCLUSIONS_API : ""
    ).trim();
    state.apiUrl = url;
    if (!url) {
      state.exclusions = [];
      state.baseNotice = "未設定剔除清單網址。請喺 config.js 貼上 Web App 網址，先用到「暫不考慮」。";
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
      if (data.error && !Array.isArray(data.items)) throw new Error(data.error);
      applyFromSheet(Array.isArray(data.items) ? data.items : []);
      state.baseNotice = data.error ? data.error : "";
      state.baseLevel = data.error ? "error" : "";
    } catch (err) {
      const cached = readCache();
      if (cached) {
        state.exclusions = cached;
        state.baseNotice = "讀唔到 Google Sheet，暫時用本機暫存。連到試算表之後會以 Sheet 為準。";
        state.baseLevel = "warn";
      } else {
        state.exclusions = [];
        state.baseNotice = "讀唔到剔除清單。補貨清單照常顯示，剔除暫時用唔到。";
        state.baseLevel = "error";
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
      for (const t of uniqueTypes(state.items)) state.openTypes.add(t);

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
  load();
})();
