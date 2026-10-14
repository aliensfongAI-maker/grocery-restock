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

  const state = {
    items: [],
    updatedAt: null,
    search: "",
    suggest: "all",
    type: "all",
    openTypes: new Set(),
  };

  const els = {
    updatedAt: document.getElementById("updatedAt"),
    searchInput: document.getElementById("searchInput"),
    suggestFilters: document.getElementById("suggestFilters"),
    typeFilter: document.getElementById("typeFilter"),
    sections: document.getElementById("sections"),
    emptyState: document.getElementById("emptyState"),
    errorBox: document.getElementById("errorBox"),
    resultCount: document.getElementById("resultCount"),
    expandAll: document.getElementById("expandAll"),
    collapseAll: document.getElementById("collapseAll"),
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
    const set = new Set(items.map((i) => i.type));
    return Array.from(set).sort((a, b) => typeSortKey(a) - typeSortKey(b));
  }

  function filterItems() {
    const q = state.search.trim().toLowerCase();
    return state.items.filter((item) => {
      if (state.suggest !== "all" && item.suggest !== state.suggest) return false;
      if (state.type !== "all" && item.type !== state.type) return false;
      if (!q) return true;
      const hay = [item.name, item.type, item.note || "", item.suggest]
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
    const s = escapeHtml(suggest);
    const cls =
      suggest === "優先" || suggest === "暫緩" || suggest === "在途"
        ? "badge badge-" + suggest
        : "badge";
    return '<span class="' + cls + '">' + s + "</span>";
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
      "</div>" +
      "</li>"
    );
  }

  function tableRowHtml(item) {
    const imgCell = item.image
      ? '<td class="col-img">' + thumbHtml(item, "thumb-sm") + "</td>"
      : '<td class="col-img"></td>';
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
      "</tr>"
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
      (isOpen ? "" : ' hidden') +
      ">" +
      '<ul class="item-list">' +
      cards +
      "</ul>" +
      '<div class="table-wrap">' +
      '<table class="data-table">' +
      "<thead><tr>" +
      "<th class=\"col-img\"></th>" +
      "<th>品名</th><th>類型</th><th>上次購買</th><th>距今天數</th><th>建議</th><th>短備註</th>" +
      "</tr></thead>" +
      "<tbody>" +
      rows +
      "</tbody></table></div>" +
      "</div></section>"
    );
  }

  function render() {
    const filtered = sortItems(filterItems());
    const groups = groupByType(filtered);

    els.resultCount.textContent =
      "顯示 " + filtered.length + "／" + state.items.length + " 項";

    if (groups.length === 0) {
      els.sections.innerHTML = "";
      els.emptyState.hidden = false;
      return;
    }
    els.emptyState.hidden = true;
    els.sections.innerHTML = groups.map(sectionHtml).join("");
  }

  function populateTypeFilter(types) {
    const sel = els.typeFilter;
    // keep first "全部類型"
    while (sel.options.length > 1) sel.remove(1);
    for (const t of types) {
      const opt = document.createElement("option");
      opt.value = t;
      opt.textContent = t;
      sel.appendChild(opt);
    }
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

    els.typeFilter.addEventListener("change", () => {
      state.type = els.typeFilter.value;
      render();
    });

    els.sections.addEventListener("click", (e) => {
      const btn = e.target.closest(".category-toggle");
      if (!btn) return;
      const section = btn.closest(".category");
      if (!section) return;
      toggleType(section.getAttribute("data-type"));
    });

    els.expandAll.addEventListener("click", expandAllVisible);
    els.collapseAll.addEventListener("click", collapseAll);
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

      const types = uniqueTypes(state.items);
      populateTypeFilter(types);
      // default: open all categories so first paint shows content
      for (const t of types) state.openTypes.add(t);

      els.errorBox.hidden = true;
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
