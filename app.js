(function () {
  "use strict";

  const SUGGEST_ORDER = { 在途: 0, 優先: 1, 暫緩: 2 };
  /** Purchase history only. Exact `type` match. */
  const HISTORY_ONLY_TYPES = new Set(["水果", "蔬菜"]);
  /** Sits after 在途 / 優先 / 暫緩 and before an empty 「未有建議」 bucket. */
  const HISTORY_GROUP_RANK = 3;
  /**
   * Order for types that current data.json uses. Names absent from the file
   * are not listed. A type that appears in data but not here sorts after these.
   */
  const TYPE_ORDER = [
    "紙品／即棄品",
    "家居清潔用品",
    "嬰兒用品／食品",
    "飲品／即沖飲品",
    "即食麵／麵／意粉",
    "湯／熟食／醃製食品",
    "早餐／果醬",
    "米／食油",
    "罐頭／乾貨",
    "零食／甜品",
    "酒類",
    "水果",
    "蔬菜",
    "冷凍／急凍食品",
    "鹽／糖／生粉",
    "豉油／生抽／頭抽／蒸魚豉油／蠔油",
    "個人護理用品",
  ];
  const CACHE_KEY = "grocery-exclusions-v1";
  const GROUP_MODE_KEY = "grocery-restock-group-mode";
  const LANG_KEY = "grocery-restock-lang";
  const EXCLUSION_TIMEOUT_MS = 12000;
  const HTML_LANG = { zh: "zh-Hant", en: "en", id: "id" };
  const SUGGEST_KEYS = { 優先: "suggestPriority", 暫緩: "suggestHold", 在途: "suggestTransit" };
  /** view.html sets this. index.html leaves it unset, so actions stay available. */
  const READ_ONLY = window.GROCERY_READ_ONLY === true;

  /**
   * UI chrome only. Notes, packs, and brand titles from data.json or the
   * Sheet stay as returned. type, subtype, and item name are display-mapped
   * from i18n-data.json when the language is English or Indonesian.
   */
  const I18N = {
    zh: {
      appTitle: "方氏超市補貨",
      metaDescription: "方氏超市補貨 — 依過住網購單歷史建議",
      tagline: "依過住網購單歷史建議",
      loading: "載入緊…",
      langLabel: "語言",
      toolbarLabel: "搜尋同篩選",
      searchLabel: "搜尋品名、牌子、類型或備註",
      searchPlaceholder: "搜尋品名／牌子／類型／備註…",
      groupLabel: "分組",
      groupSuggest: "建議優先",
      groupType: "類型優先",
      viewLabel: "清單",
      viewMain: "補貨清單",
      skip: "暫不考慮",
      suggestLabel: "建議",
      suggestAll: "全部",
      suggestPriority: "優先",
      suggestHold: "未使買住",
      suggestTransit: "已下單",
      typeLabel: "類型",
      typeAll: "全部類型",
      expandAll: "全部展開",
      collapseAll: "全部摺疊",
      emptyFilter: "冇符合條件嘅項目。",
      footer: "公開建議工具 · 唔含私人資料 · 時間為香港時間（HKT） · 剔除同手動暫緩另存 Google Sheet",
      excludeHelp: "呢項會喺補貨清單隱藏，之後可以「回復」。同「手動暫緩」唔同：未使買住會留喺主清單。建議維持原樣，唔改 data.json。",
      noteLabel: "備註（可留空）",
      excludePlaceholder: "例如：屋企仲有",
      cancel: "取消",
      excludeConfirm: "確認剔除",
      hold: "手動暫緩",
      holdHelp: "用嚟記低已經補咗貨、但 data.json 未更新。呢項會留喺補貨清單，唔會隱藏。建議會顯示做「未使買住」，上次送貨同距今天數由暫緩當日計。想恢復 data.json 嘅日子同建議，撳「回復日子」。",
      holdPlaceholder: "例如：今日超市買咗",
      holdConfirm: "確認暫緩",
      reclass: "改類",
      reclassHelp: "改呢項嘅類型同子類。寫入 Google Sheet，唔改呢份 data.json。Gmail 之後會再整份資料。",
      reclassTypeLabel: "類型",
      reclassSubtypeLabel: "子類（可揀建議，亦可自己打）",
      reclassConfirm: "確認改類",
      reclassClear: "取消改類",
      reclassPlaceholder: "揀現有子類，或自己打",
      reclassFlag: "改類已記下，等 data.json 更新",
      updatedPrefix: "上次更新：",
      updatedFailed: "上次更新：載入失敗",
      noSuggest: "未有建議",
      historyGroup: "紀錄",
      uncategorized: "未分類",
      processing: "處理緊…",
      noApiTitle: "未設定 Web App 網址",
      processingPrefix: "處理緊：",
      actionPrefix: "操作：",
      daysValue: "{n}日",
      daysUntil: "還有 {n} 日",
      deliveringToday: "今日送貨",
      daysLabel: "距今天數",
      restore: "回復",
      unhold: "回復日子",
      holdNotePrefix: "暫緩備註：",
      holdFlag: "手動暫緩 · 日子由暫緩當日計，原本建議未改",
      exclusionNotePrefix: "剔除備註：",
      excludedAtLabel: "剔除時間",
      noBrand: "未有牌子",
      publicLink: "公開連結",
      lastPurchased: "上次送貨",
      qtyValue: "{n} 件",
      noBrandDetail: "未有牌子明細",
      colName: "品名",
      colDays: "距今",
      colAction: "操作",
      loadingExclusions: "讀緊剔除清單…",
      countExcluded: "暫不考慮 {n}／{total} 項",
      countMain: "顯示 {n}／{total} 項",
      emptyExcluded: "未有暫不考慮嘅項目。",
      viewExcludedCount: "暫不考慮 ({n})",
      errNotJson: "回應唔係 JSON。請確認 Web App 已部署為「任何人」。",
      errBadFormat: "回應格式唔啱",
      errTimeout: "連線逾時",
      doneExclude: "已暫不考慮「{name}」。呢項會喺主清單隱藏。",
      doneRestore: "已回復「{name}」到補貨清單。",
      doneHold: "已手動暫緩「{name}」。仍然留喺補貨清單。",
      doneUnhold: "已回復「{name}」嘅日子同建議。",
      doneReclass: "已改類「{name}」。Gmail 會再整份 data.json。",
      doneReclassClear: "已取消「{name}」嘅改類。Gmail 會再整份 data.json。",
      doneGeneric: "已更新。",
      failExclude: "剔除失敗：",
      failRestore: "回復失敗：",
      failHold: "手動暫緩失敗：",
      failUnhold: "回復日子失敗：",
      failReclass: "改類失敗：",
      failReclassClear: "取消改類失敗：",
      failGeneric: "更新失敗：",
      tryAgain: "請再試",
      unknownError: "未知錯誤",
      jsonpPrefix: "JSONP：",
      warnNoHold: "讀到剔除清單，但呢個部署未支援「手動暫緩」。請喺 Apps Script 建立新版本。",
      jsonpTimeout: "JSONP 逾時",
      jsonpBadUrl: "JSONP 網址唔啱",
      jsonpLoadFail: "JSONP 載入失敗",
      jsonpNoCallback: "JSONP 回應冇呼叫 callback",
      cacheNotice: "讀唔到 Google Sheet，暫時用本機暫存。連到試算表之後會以 Sheet 為準。",
      failNotice: "讀唔到剔除清單。補貨清單照常顯示，剔除暫時用唔到。",
      noApiNotice: "未設定剔除清單網址。請喺 config.js 貼上 Web App 網址，先用到「暫不考慮」同「手動暫緩」。",
      loadFail: "載入 data.json 失敗（{status}）",
      badData: "data.json 格式唔啱：缺少 items",
      fileError: "讀唔到資料。請用本機靜態伺服器開啟（例如：python3 -m http.server 8080），唔好直接用 file://。",
      holdNoteDefault: "已從非網購渠道補貨",
    },
    en: {
      appTitle: "Fong's grocery restock",
      metaDescription: "Fong's grocery restock — suggestions from past online-order history",
      tagline: "Suggestions from past online-order history",
      loading: "Loading…",
      langLabel: "Language",
      toolbarLabel: "Search and filters",
      searchLabel: "Search name, brand, type, or note",
      searchPlaceholder: "Search name / brand / type / note…",
      groupLabel: "Group",
      groupSuggest: "Suggestion first",
      groupType: "Type first",
      viewLabel: "List",
      viewMain: "Restock list",
      skip: "Skip for now",
      suggestLabel: "Suggestion",
      suggestAll: "All",
      suggestPriority: "Priority",
      suggestHold: "Not needed yet",
      suggestTransit: "Ordered",
      typeLabel: "Type",
      typeAll: "All types",
      expandAll: "Expand all",
      collapseAll: "Collapse all",
      emptyFilter: "No matching items.",
      footer: "Public suggestion tool · no private data · times are Hong Kong time (HKT) · skips and manual holds are stored in a Google Sheet",
      excludeHelp: "This item is hidden from the restock list. You can restore it later. A manual hold is different: it stays on the main list. The suggestion is left as-is, and data.json is not changed.",
      noteLabel: "Note (optional)",
      excludePlaceholder: "e.g. still have some at home",
      cancel: "Cancel",
      excludeConfirm: "Confirm skip",
      hold: "Manual hold",
      holdHelp: "Use this when you already restocked, but data.json has not updated. The item stays on the restock list and is not hidden. The suggestion shows as “Not needed yet”, and last delivery and days ago count from the hold date. To bring back the dates and suggestion from data.json, choose “Restore dates”.",
      holdPlaceholder: "e.g. bought at the supermarket today",
      holdConfirm: "Confirm hold",
      reclass: "Reclassify",
      reclassHelp: "Change this item’s type and subtype. This is stored in the Google Sheet and does not edit data.json. Gmail will rebuild the file afterwards.",
      reclassTypeLabel: "Type",
      reclassSubtypeLabel: "Subtype (pick a suggestion or type your own)",
      reclassConfirm: "Confirm reclass",
      reclassClear: "Clear reclass",
      reclassPlaceholder: "Pick an existing subtype, or type one",
      reclassFlag: "Reclass saved, waiting for data.json",
      updatedPrefix: "Updated: ",
      updatedFailed: "Updated: failed to load",
      noSuggest: "No suggestion",
      historyGroup: "Record",
      uncategorized: "Uncategorized",
      processing: "Working…",
      noApiTitle: "Web App URL is not set",
      processingPrefix: "Working: ",
      actionPrefix: "Actions: ",
      daysValue: "{n} days",
      daysUntil: "{n} days left",
      deliveringToday: "Delivering today",
      daysLabel: "Days ago",
      restore: "Restore",
      unhold: "Restore dates",
      holdNotePrefix: "Hold note: ",
      holdFlag: "Manual hold · days count from the hold date; the original suggestion is unchanged",
      exclusionNotePrefix: "Skip note: ",
      excludedAtLabel: "Skipped at",
      noBrand: "No brand",
      publicLink: "Public link",
      lastPurchased: "Last delivery",
      qtyValue: "{n} pcs",
      noBrandDetail: "No brand details",
      colName: "Item",
      colDays: "Ago",
      colAction: "Actions",
      loadingExclusions: "Loading skip list…",
      countExcluded: "Skipped {n}/{total}",
      countMain: "Showing {n}/{total}",
      emptyExcluded: "Nothing skipped yet.",
      viewExcludedCount: "Skip for now ({n})",
      errNotJson: "The response is not JSON. Confirm the Web App is deployed as “Anyone”.",
      errBadFormat: "Unexpected response format",
      errTimeout: "Connection timed out",
      doneExclude: "Skipped “{name}” for now. It is hidden from the main list.",
      doneRestore: "Restored “{name}” to the restock list.",
      doneHold: "Set a manual hold on “{name}”. It stays on the restock list.",
      doneUnhold: "Restored the dates and suggestion for “{name}”.",
      doneReclass: "Reclassified “{name}”. Gmail will rebuild data.json.",
      doneReclassClear: "Cleared the reclass for “{name}”. Gmail will rebuild data.json.",
      doneGeneric: "Updated.",
      failExclude: "Could not skip: ",
      failRestore: "Could not restore: ",
      failHold: "Could not set a manual hold: ",
      failUnhold: "Could not restore dates: ",
      failReclass: "Could not reclassify: ",
      failReclassClear: "Could not clear reclass: ",
      failGeneric: "Update failed: ",
      tryAgain: "Please try again",
      unknownError: "Unknown error",
      jsonpPrefix: "JSONP: ",
      warnNoHold: "The skip list loaded, but this deployment does not support “Manual hold”. Create a new Apps Script version.",
      jsonpTimeout: "JSONP timed out",
      jsonpBadUrl: "Invalid JSONP URL",
      jsonpLoadFail: "JSONP failed to load",
      jsonpNoCallback: "JSONP response did not call the callback",
      cacheNotice: "Could not read the Google Sheet. Using the copy saved on this device for now. Once the spreadsheet connects, the Sheet is the source of truth.",
      failNotice: "Could not read the skip list. The restock list still shows, but skipping is unavailable for now.",
      noApiNotice: "Skip-list URL is not set. Paste the Web App URL in config.js to use “Skip for now” and “Manual hold”.",
      loadFail: "Failed to load data.json ({status})",
      badData: "Invalid data.json: missing items",
      fileError: "Could not read the data. Open this page from a local static server (for example: python3 -m http.server 8080), not file://.",
      holdNoteDefault: "Restocked outside online shopping",
    },
    id: {
      appTitle: "Restok supermarket Fong",
      metaDescription: "Restok supermarket Fong — saran dari riwayat pesanan daring sebelumnya",
      tagline: "Saran dari riwayat pesanan daring sebelumnya",
      loading: "Memuat…",
      langLabel: "Bahasa",
      toolbarLabel: "Cari dan filter",
      searchLabel: "Cari nama, merek, jenis, atau catatan",
      searchPlaceholder: "Cari nama / merek / jenis / catatan…",
      groupLabel: "Kelompok",
      groupSuggest: "Saran dulu",
      groupType: "Jenis dulu",
      viewLabel: "Daftar",
      viewMain: "Daftar restok",
      skip: "Lewati dulu",
      suggestLabel: "Saran",
      suggestAll: "Semua",
      suggestPriority: "Prioritas",
      suggestHold: "Belum perlu beli",
      suggestTransit: "Sudah dipesan",
      typeLabel: "Jenis",
      typeAll: "Semua jenis",
      expandAll: "Buka semua",
      collapseAll: "Tutup semua",
      emptyFilter: "Tidak ada item yang cocok.",
      footer: "Alat saran publik · tanpa data pribadi · waktu dalam Waktu Hong Kong (HKT) · lewati dan tunda manual disimpan di Google Sheet",
      excludeHelp: "Item ini disembunyikan dari daftar restok. Nanti bisa dipulihkan. Tunda manual berbeda: item tetap ada di daftar utama. Saran tidak diubah, dan data.json tidak diubah.",
      noteLabel: "Catatan (opsional)",
      excludePlaceholder: "misalnya: masih ada di rumah",
      cancel: "Batal",
      excludeConfirm: "Konfirmasi lewati",
      hold: "Tunda manual",
      holdHelp: "Pakai ini kalau barang sudah diisi ulang, tetapi data.json belum diperbarui. Item tetap di daftar restok dan tidak disembunyikan. Saran ditampilkan sebagai “Belum perlu beli”, lalu pengiriman terakhir dan hari sejak itu dihitung dari tanggal tunda. Untuk mengembalikan tanggal dan saran dari data.json, pilih “Pulihkan tanggal”.",
      holdPlaceholder: "misalnya: beli di supermarket hari ini",
      holdConfirm: "Konfirmasi tunda",
      reclass: "Ubah jenis",
      reclassHelp: "Ubah jenis dan subjenis item ini. Disimpan di Google Sheet, data.json tidak diubah. Gmail akan menyusun ulang berkasnya nanti.",
      reclassTypeLabel: "Jenis",
      reclassSubtypeLabel: "Subjenis (pilih saran atau ketik sendiri)",
      reclassConfirm: "Konfirmasi ubah jenis",
      reclassClear: "Batalkan ubah jenis",
      reclassPlaceholder: "Pilih subjenis yang ada, atau ketik sendiri",
      reclassFlag: "Ubah jenis tersimpan, menunggu data.json",
      updatedPrefix: "Diperbarui: ",
      updatedFailed: "Diperbarui: gagal memuat",
      noSuggest: "Tanpa saran",
      historyGroup: "Riwayat",
      uncategorized: "Tanpa jenis",
      processing: "Memproses…",
      noApiTitle: "URL Web App belum diatur",
      processingPrefix: "Memproses: ",
      actionPrefix: "Aksi: ",
      daysValue: "{n} hari",
      daysUntil: "{n} hari lagi",
      deliveringToday: "Dikirim hari ini",
      daysLabel: "Hari lalu",
      restore: "Pulihkan",
      unhold: "Pulihkan tanggal",
      holdNotePrefix: "Catatan tunda: ",
      holdFlag: "Tunda manual · hari dihitung dari tanggal tunda; saran asli tidak diubah",
      exclusionNotePrefix: "Catatan lewati: ",
      excludedAtLabel: "Waktu dilewati",
      noBrand: "Tanpa merek",
      publicLink: "Tautan publik",
      lastPurchased: "Pengiriman terakhir",
      qtyValue: "{n} buah",
      noBrandDetail: "Belum ada detail merek",
      colName: "Nama",
      colDays: "Lalu",
      colAction: "Aksi",
      loadingExclusions: "Memuat daftar lewati…",
      countExcluded: "Dilewati {n}/{total}",
      countMain: "Menampilkan {n}/{total}",
      emptyExcluded: "Belum ada item yang dilewati.",
      viewExcludedCount: "Lewati dulu ({n})",
      errNotJson: "Respons bukan JSON. Pastikan Web App di-deploy sebagai “Siapa saja”.",
      errBadFormat: "Format respons tidak sesuai",
      errTimeout: "Koneksi habis waktu",
      doneExclude: "“{name}” dilewati dulu. Item ini disembunyikan dari daftar utama.",
      doneRestore: "“{name}” dipulihkan ke daftar restok.",
      doneHold: "“{name}” ditunda manual. Tetap ada di daftar restok.",
      doneUnhold: "Tanggal dan saran “{name}” dipulihkan.",
      doneReclass: "“{name}” diubah jenisnya. Gmail akan menyusun ulang data.json.",
      doneReclassClear: "Ubah jenis “{name}” dibatalkan. Gmail akan menyusun ulang data.json.",
      doneGeneric: "Diperbarui.",
      failExclude: "Gagal melewati: ",
      failRestore: "Gagal memulihkan: ",
      failHold: "Gagal menunda manual: ",
      failUnhold: "Gagal memulihkan tanggal: ",
      failReclass: "Gagal mengubah jenis: ",
      failReclassClear: "Gagal membatalkan ubah jenis: ",
      failGeneric: "Pembaruan gagal: ",
      tryAgain: "Silakan coba lagi",
      unknownError: "Kesalahan tidak diketahui",
      jsonpPrefix: "JSONP: ",
      warnNoHold: "Daftar lewati terbaca, tetapi deployment ini belum mendukung “Tunda manual”. Buat versi Apps Script yang baru.",
      jsonpTimeout: "JSONP habis waktu",
      jsonpBadUrl: "URL JSONP tidak valid",
      jsonpLoadFail: "JSONP gagal dimuat",
      jsonpNoCallback: "Respons JSONP tidak memanggil callback",
      cacheNotice: "Google Sheet tidak terbaca. Untuk sementara memakai salinan di perangkat ini. Setelah spreadsheet tersambung, Sheet yang dipakai.",
      failNotice: "Daftar lewati tidak terbaca. Daftar restok tetap tampil, tetapi lewati belum bisa dipakai.",
      noApiNotice: "URL daftar lewati belum diatur. Tempel URL Web App di config.js untuk memakai “Lewati dulu” dan “Tunda manual”.",
      loadFail: "Gagal memuat data.json ({status})",
      badData: "data.json tidak valid: items tidak ada",
      fileError: "Data tidak terbaca. Buka halaman ini lewat server statis lokal (misalnya: python3 -m http.server 8080), bukan file://.",
      holdNoteDefault: "Sudah diisi ulang di luar belanja online",
    },
  };

  function readStoredLang() {
    try {
      const value = localStorage.getItem(LANG_KEY);
      if (value === "zh" || value === "en" || value === "id") return value;
    } catch (_) {
      /* private mode */
    }
    return "zh";
  }

  const state = {
    items: [],
    updatedAt: null,
    search: "",
    suggest: "all",
    type: "all",
    view: "main",
    groupMode: readStoredGroupMode(),
    lang: readStoredLang(),
    loadSettled: false,
    loadFailed: false,
    collapsedGroups: new Set(),
    openProducts: new Set(),
    exclusions: [],
    holds: [],
    overrides: [],
    apiUrl: "",
    pendingKey: "",
    pendingAction: "",
    baseNotice: null,
    baseLevel: "",
    flashNotice: null,
    flashLevel: "",
    loadingExclusions: false,
    dialogItem: null,
    dialogTrigger: null,
  };

  function t(key, vars) {
    const pack = I18N[state.lang] || I18N.zh;
    let str = Object.prototype.hasOwnProperty.call(pack, key) ? pack[key] : undefined;
    if (str == null) str = I18N.zh[key];
    if (str == null) return key;
    if (!vars) return str;
    return str.replace(/\{(\w+)\}/g, function (_, name) {
      return vars[name] == null ? "" : String(vars[name]);
    });
  }

  function suggestLabel(value) {
    if (value == null || value === "") return "";
    const key = SUGGEST_KEYS[value];
    return key ? t(key) : String(value);
  }

  /** Static zh→en/id maps. Missing or blank entries stay the original Chinese. */
  let catalogI18n = { type: {}, subtype: {}, name: {} };

  function catalogLabel(kind, value) {
    if (value == null) return "";
    const text = String(value);
    if (!text) return "";
    if (state.lang !== "en" && state.lang !== "id") return text;
    const table = catalogI18n[kind];
    if (!table || !Object.prototype.hasOwnProperty.call(table, text)) return text;
    const entry = table[text];
    if (!entry || typeof entry !== "object") return text;
    const translated = entry[state.lang];
    if (translated == null || String(translated).trim() === "") return text;
    return String(translated);
  }

  function dialogItemText(type, name) {
    return catalogLabel("type", type) + " · " + catalogLabel("name", name);
  }

  async function loadCatalogI18n() {
    try {
      const res = await fetch("./i18n-data.json", { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json();
      if (!data || typeof data !== "object") return;
      catalogI18n = {
        type: data.type && typeof data.type === "object" ? data.type : {},
        subtype: data.subtype && typeof data.subtype === "object" ? data.subtype : {},
        name: data.name && typeof data.name === "object" ? data.name : {},
      };
    } catch (err) {
      console.error(err);
    }
  }

  function appError(code, vars) {
    const message = code === "http" ? "HTTP " + ((vars && vars.status) || "") : t(code, vars);
    const err = new Error(message);
    err.appCode = code;
    if (vars) err.vars = vars;
    return err;
  }

  const els = {
    updatedAt: document.getElementById("updatedAt"),
    langSwitch: document.getElementById("langSwitch"),
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
    reclassDialog: document.getElementById("reclassDialog"),
    reclassForm: document.getElementById("reclassForm"),
    reclassDialogItem: document.getElementById("reclassDialogItem"),
    reclassType: document.getElementById("reclassType"),
    reclassSubtype: document.getElementById("reclassSubtype"),
    reclassSubtypeList: document.getElementById("reclassSubtypeList"),
    reclassNote: document.getElementById("reclassNote"),
    reclassCancel: document.getElementById("reclassCancel"),
    reclassClear: document.getElementById("reclassClear"),
  };

  function applyStaticI18n() {
    document.documentElement.lang = HTML_LANG[state.lang] || "zh-Hant";
    document.querySelectorAll("[data-i18n]").forEach((el) => {
      el.textContent = t(el.getAttribute("data-i18n"));
    });
    document.querySelectorAll("[data-i18n-placeholder]").forEach((el) => {
      el.setAttribute("placeholder", t(el.getAttribute("data-i18n-placeholder")));
    });
    document.querySelectorAll("[data-i18n-aria]").forEach((el) => {
      el.setAttribute("aria-label", t(el.getAttribute("data-i18n-aria")));
    });
    document.querySelectorAll("[data-i18n-content]").forEach((el) => {
      el.setAttribute("content", t(el.getAttribute("data-i18n-content")));
    });
  }

  function syncLangSwitch() {
    if (!els.langSwitch) return;
    els.langSwitch.querySelectorAll("[data-lang]").forEach((btn) => {
      const active = btn.getAttribute("data-lang") === state.lang;
      btn.classList.toggle("is-active", active);
      btn.setAttribute("aria-pressed", active ? "true" : "false");
    });
  }

  function refreshUpdatedAt() {
    if (state.loadFailed) {
      els.updatedAt.textContent = t("updatedFailed");
      return;
    }
    if (!state.loadSettled) {
      els.updatedAt.textContent = t("loading");
      return;
    }
    els.updatedAt.textContent = formatUpdatedAt(state.updatedAt);
  }

  function setLang(lang) {
    const next = lang === "en" || lang === "id" || lang === "zh" ? lang : "zh";
    if (next === state.lang) return;
    const previousDefault = t("holdNoteDefault");
    state.lang = next;
    try {
      localStorage.setItem(LANG_KEY, state.lang);
    } catch (_) {
      /* private mode; the choice still applies this visit */
    }
    applyStaticI18n();
    syncLangSwitch();
    if (
      els.holdDialog &&
      els.holdDialog.open &&
      els.holdNote &&
      els.holdNote.value === previousDefault
    ) {
      els.holdNote.value = t("holdNoteDefault");
    }
    if (state.dialogItem) {
      const text = dialogItemText(state.dialogItem.type, state.dialogItem.name);
      if (els.excludeDialog && els.excludeDialog.open && els.excludeDialogItem) {
        els.excludeDialogItem.textContent = text;
      }
      if (els.holdDialog && els.holdDialog.open && els.holdDialogItem) {
        els.holdDialogItem.textContent = text;
      }
      if (els.reclassDialog && els.reclassDialog.open && els.reclassDialogItem) {
        els.reclassDialogItem.textContent = text;
        fillReclassTypes(els.reclassType ? els.reclassType.value : "");
      }
    }
    refreshUpdatedAt();
    if (!els.errorBox.hidden) els.errorBox.textContent = t("fileError");
    refreshTypeFilter();
    render();
  }

  function escapeHtml(str) {
    if (str == null) return "";
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  /** Clock time in HKT. Locale-independent so the stamp stays YYYY-MM-DD HH:mm. */
  function formatHktStamp(iso) {
    if (!iso) return "—";
    try {
      const d = new Date(iso);
      if (Number.isNaN(d.getTime())) return String(iso);
      const fmt = new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Hong_Kong",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
        hour12: false,
      });
      const parts = fmt.formatToParts(d);
      const get = (type) => parts.find((p) => p.type === type)?.value || "";
      return (
        get("year") +
        "-" +
        get("month") +
        "-" +
        get("day") +
        " " +
        get("hour") +
        ":" +
        get("minute") +
        " HKT"
      );
    } catch (_) {
      return String(iso);
    }
  }

  function formatUpdatedAt(iso) {
    return t("updatedPrefix") + formatHktStamp(iso);
  }

  function formatExcludedAt(iso) {
    if (!iso) return "—";
    return formatHktStamp(iso);
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

  /** Exact type match. Missing or null suggest does not change this. */
  function isHistoryOnlyType(type) {
    return HISTORY_ONLY_TYPES.has(type);
  }

  function isHistoryOnly(item) {
    return !!item && isHistoryOnlyType(item.type);
  }

  /** Sheet rows for 水果 / 蔬菜 stay put, but the page does not hide history behind them. */
  function listedExclusions() {
    return state.exclusions.filter((ex) => !isHistoryOnlyType(ex.type));
  }

  function sortItems(items) {
    return items.slice().sort((a, b) => {
      const ta = typeSortKey(a.type);
      const tb = typeSortKey(b.type);
      if (ta !== tb) return ta - tb;
      const aHistory = isHistoryOnly(a);
      const bHistory = isHistoryOnly(b);
      if (!aHistory && !bHistory) {
        const sa = SUGGEST_ORDER[a.suggest] ?? 9;
        const sb = SUGGEST_ORDER[b.suggest] ?? 9;
        if (sa !== sb) return sa - sb;
      }
      // more days since first within same suggest (history rows ignore suggest)
      if (b.daysSince !== a.daysSince) return (b.daysSince || 0) - (a.daysSince || 0);
      return String(a.name).localeCompare(String(b.name), "zh-HK");
    });
  }

  function uniqueTypes(items) {
    const set = new Set(items.map((i) => i.type).filter(Boolean));
    return Array.from(set).sort(
      (a, b) => typeSortKey(a) - typeSortKey(b) || String(a).localeCompare(String(b), "zh-HK")
    );
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

  /** Active reclass rows only. Key is oldType|name from the Sheet. */
  function normalizeOverrides(items) {
    if (!Array.isArray(items)) return [];
    const best = new Map();
    for (const raw of items) {
      if (!raw || typeof raw !== "object") continue;
      const oldType = String(raw.oldType || raw.type || "").trim();
      const name = String(raw.name || "").trim();
      if (!oldType || !name) continue;
      if (raw.status && raw.status !== "active") continue;
      const row = {
        oldType: oldType,
        name: name,
        newType: String(raw.newType || "").trim(),
        newSubtype: String(raw.newSubtype || "").trim(),
        at: String(raw.at || ""),
        note: String(raw.note || ""),
        status: "active",
      };
      const key = exclusionKey(oldType, name);
      const prev = best.get(key);
      if (!prev || row.at >= prev.at) best.set(key, row);
    }
    return Array.from(best.values());
  }

  function applyFromSheet(items, held, overrides) {
    state.exclusions = normalizeExclusions(items);
    if (Array.isArray(held)) state.holds = normalizeHolds(held);
    if (Array.isArray(overrides)) state.overrides = normalizeOverrides(overrides);
    try {
      localStorage.setItem(
        CACHE_KEY,
        JSON.stringify({
          items: state.exclusions,
          held: state.holds,
          overrides: state.overrides,
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
        overrides: normalizeOverrides(parsed.overrides),
      };
    } catch (_) {
      return null;
    }
  }

  /**
   * Hong Kong calendar day as YYYY-MM-DD.
   * Parts are read by type. en-CA `.format()` is not YYYY-MM-DD in every browser,
   * and a failed parse used to let daysSince -1 show as 「還有 1 日」.
   */
  function hktYmd(date) {
    try {
      const parts = new Intl.DateTimeFormat("en-US", {
        timeZone: "Asia/Hong_Kong",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).formatToParts(date);
      const get = (type) => {
        const part = parts.find((p) => p.type === type);
        return part ? String(part.value) : "";
      };
      const year = get("year");
      let month = get("month");
      let day = get("day");
      if (!/^\d{4}$/.test(year) || !/^\d{1,2}$/.test(month) || !/^\d{1,2}$/.test(day)) return "";
      if (month.length === 1) month = "0" + month;
      if (day.length === 1) day = "0" + day;
      return year + "-" + month + "-" + day;
    } catch (_) {
      return "";
    }
  }

  function calendarYmd(value) {
    if (value == null) return "";
    const text = String(value).trim();
    return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : "";
  }

  function finiteNumber(value) {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string") {
      const text = value.trim();
      if (text && /^-?\d+(\.\d+)?$/.test(text)) {
        const n = Number(text);
        if (Number.isFinite(n)) return n;
      }
    }
    return null;
  }

  /** Calendar days from HKT today to ymd. 0 is today. Negative means that date is in the past. */
  function daysAfterHktToday(ymd) {
    const day = calendarYmd(ymd);
    const today = hktYmd(new Date());
    if (!day || !/^\d{4}-\d{2}-\d{2}$/.test(today)) return null;
    if (day === today) return 0;
    const start = Date.UTC(+today.slice(0, 4), +today.slice(5, 7) - 1, +today.slice(8, 10));
    const end = Date.UTC(+day.slice(0, 4), +day.slice(5, 7) - 1, +day.slice(8, 10));
    return Math.round((end - start) / 86400000);
  }

  /**
   * Calendar timing for a delivery row. Does not read or write suggest.
   * A known lastPurchased date wins over daysSince, including daysSince -1.
   * "today": that date is the HKT calendar today.
   * "until": that date is after today; n is calendar days (tomorrow = 1).
   * daysSince is used only when the date is missing.
   * Null means a past delivery, or a known date we will not guess from daysSince.
   */
  function deliveryTiming(entry) {
    if (!entry || typeof entry !== "object") return null;
    const day = calendarYmd(entry.lastPurchased);
    if (day) {
      const ahead = daysAfterHktToday(day);
      if (ahead === 0) return { kind: "today" };
      if (ahead != null && ahead > 0) return { kind: "until", n: ahead };
      return null;
    }
    const since = finiteNumber(entry.daysSince);
    if (since != null && since < 0) return { kind: "until", n: Math.abs(since) };
    return null;
  }

  /** Today or a later HKT delivery date. */
  function isOpenDelivery(entry) {
    return deliveryTiming(entry) != null;
  }

  function deliveryPhrase(entry) {
    if (!entry || entry.manualHold) return "";
    const timing = deliveryTiming(entry);
    if (!timing) return "";
    if (timing.kind === "today") return t("deliveringToday");
    return t("daysUntil", { n: String(timing.n) });
  }

  /** Days-ago figure. A stale negative daysSince on a past date uses the calendar. */
  function pastDaysValue(entry) {
    const since = finiteNumber(entry && entry.daysSince);
    if (since != null && since < 0) {
      const ahead = daysAfterHktToday(entry && entry.lastPurchased);
      if (ahead != null && ahead < 0) return Math.abs(ahead);
      return null;
    }
    return entry ? entry.daysSince : null;
  }

  /** Bought pieces: qty, then quantity, then count. Missing or invalid is 1. */
  function pieceCount(entry) {
    const keys = ["qty", "quantity", "count"];
    if (entry && typeof entry === "object") {
      for (let i = 0; i < keys.length; i++) {
        if (!Object.prototype.hasOwnProperty.call(entry, keys[i])) continue;
        const n = finiteNumber(entry[keys[i]]);
        if (n != null && n >= 1) return n;
      }
    }
    return 1;
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
   * 水果 / 蔬菜 stay on the data.json dates; holds do not apply.
   */
  function applyHoldOverlay(item) {
    if (isHistoryOnly(item)) return item;
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

  /**
   * Display overlay only. Does not rewrite data.json.
   * Today and future deliveries show, sort, and filter as 在途 (已下單).
   * A past delivery with suggest 在途 leaves that bucket and groups as 紀錄.
   * Manual holds stay 暫緩. 水果 / 蔬菜 stay off the suggest axis.
   */
  function applyFutureDeliveryOverlay(item) {
    if (!item || item.manualHold || isHistoryOnly(item)) return item;
    if (isOpenDelivery(item)) {
      if (item.suggest === "在途") return item;
      return Object.assign({}, item, { suggest: "在途" });
    }
    if (item.suggest === "在途") {
      return Object.assign({}, item, { suggest: "", pastDelivery: true });
    }
    return item;
  }

  function overrideRecord(type, name) {
    const key = exclusionKey(type, name);
    for (const row of state.overrides) {
      if (exclusionKey(row.oldType, row.name) === key) return row;
    }
    return null;
  }

  /**
   * Display-only. data.json stays put until Gmail rebuilds it.
   * The read-only page does not apply this, so view.html keeps the file's types.
   */
  function applyReclassOverlay(item) {
    if (READ_ONLY || !item) return item;
    const row = overrideRecord(item.type, item.name);
    if (!row || !row.newType) return item;
    return Object.assign({}, item, {
      sourceType: item.type,
      sourceName: item.name,
      type: row.newType,
      subtype: row.newSubtype,
      reclassPending: true,
    });
  }

  function displayItem(item) {
    return applyReclassOverlay(applyFutureDeliveryOverlay(applyHoldOverlay(item)));
  }

  function sheetTypeOf(item) {
    return item && item.sourceType ? item.sourceType : item.type;
  }

  function sheetNameOf(item) {
    return item && item.sourceName ? item.sourceName : item.name;
  }

  function excludedDisplayItems() {
    const byKey = new Map(state.items.map((item) => [keyOf(item), item]));
    return listedExclusions().map((ex) => {
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
            qty: base.qty,
            quantity: base.quantity,
            count: base.count,
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
    if (state.view === "excluded") return excludedDisplayItems().map(displayItem);
    const hidden = new Set(listedExclusions().map((ex) => exclusionKey(ex.type, ex.name)));
    return state.items.filter((item) => !hidden.has(keyOf(item))).map(displayItem);
  }

  function filterItems() {
    const q = state.search.trim().toLowerCase();
    return sourceItems().filter((item) => {
      const historyOnly = isHistoryOnly(item);
      // data.json suggest is display-only. A manual hold may overlay 暫緩.
      // Today and future deliveries may overlay 在途. A past 在途 row does not.
      // History-only rows and past deliveries stay out of the suggest chips.
      if (state.suggest !== "all") {
        if (historyOnly || item.pastDelivery) return false;
        if ((item.suggest || "") !== state.suggest) return false;
      }
      if (state.type !== "all" && item.type !== state.type) return false;
      if (!q) return true;
      const brandBits = brandsOf(item).map((entry) =>
        [entry.brand || "", entry.title || "", entry.pack || "", entry.note || ""].join(" ")
      );
      const hay = [
        item.name,
        catalogLabel("name", item.name),
        item.type,
        catalogLabel("type", item.type || ""),
        item.subtype || "",
        catalogLabel("subtype", item.subtype || ""),
        item.note || "",
        historyOnly ? "" : item.suggest || "",
        historyOnly ? "" : suggestLabel(item.suggest || ""),
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
    if (node.kind === "history") return HISTORY_GROUP_RANK;
    if (node.kind === "type") return typeSortKey(node.value);
    if (!node.value) return 50;
    return Object.prototype.hasOwnProperty.call(SUGGEST_ORDER, node.value)
      ? SUGGEST_ORDER[node.value]
      : 40;
  }

  function groupLabel(node) {
    if (node.kind === "history") return t("historyGroup");
    if (node.kind === "suggest") return node.value ? suggestLabel(node.value) : t("noSuggest");
    if (node.kind === "type") return node.value ? catalogLabel("type", node.value) : t("uncategorized");
    return node.value || t("uncategorized");
  }

  /** Type groups keep the Chinese key so language does not reshuffle them. */
  function groupTieBreak(node) {
    if (node.kind === "type") return node.value || "";
    return groupLabel(node);
  }

  /**
   * Suggest axis for grouping. 水果 / 蔬菜 always use the history bucket,
   * so a missing or leftover suggest cannot file them under 優先 / 暫緩 / 在途.
   * A past delivery marked 在途 also stays in 紀錄, not 已下單.
   * Other items with a missing suggest stay in 「未有建議」.
   */
  function suggestNode(item) {
    if (isHistoryOnly(item) || item.pastDelivery) return { kind: "history", value: "" };
    return { kind: "suggest", value: item.suggest || "" };
  }

  /**
   * suggest-type: 建議 then 類型. type-suggest: the other way.
   * Manual holds overlay suggest to 暫緩. Today and future deliveries overlay 在途.
   * Past 在途 rows overlay onto 紀錄. History-only types use 紀錄 then type, or type then 紀錄.
   */
  function nest(items) {
    const suggestFirst = state.groupMode !== "type-suggest";
    const outerOf = (item) =>
      suggestFirst ? suggestNode(item) : { kind: "type", value: item.type || "" };
    const innerOf = (item) =>
      suggestFirst ? { kind: "type", value: item.type || "" } : suggestNode(item);
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
    outers.sort((a, b) => groupRank(a) - groupRank(b) || groupTieBreak(a).localeCompare(groupTieBreak(b), "zh-HK"));
    for (const outer of outers) {
      outer.groups = Array.from(outer.inners.values());
      outer.groups.sort(
        (a, b) => groupRank(a) - groupRank(b) || groupTieBreak(a).localeCompare(groupTieBreak(b), "zh-HK")
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
    const alt = escapeHtml(item.imageAlt || catalogLabel("name", item.name) || "");
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
    const cls =
      suggest === "優先" || suggest === "暫緩" || suggest === "在途"
        ? "badge badge-" + suggest
        : "badge";
    return '<span class="' + cls + '">' + escapeHtml(suggestLabel(suggest)) + "</span>";
  }

  function sheetButtonHtml(item, action, label, className, asMenuItem) {
    const type = sheetTypeOf(item);
    const name = sheetNameOf(item);
    const busy = state.pendingKey === exclusionKey(type, name);
    const pending = busy && state.pendingAction === action;
    const shown = pending ? t("processing") : label;
    const enabled = exclusionsEnabled() && !busy;
    return (
      '<button type="button" class="action-btn ' +
      className +
      '" data-action="' +
      action +
      '" data-type="' +
      escapeHtml(type) +
      '" data-name="' +
      escapeHtml(name) +
      '"' +
      (enabled ? "" : " disabled") +
      (exclusionsEnabled() ? "" : ' title="' + escapeHtml(t("noApiTitle")) + '"') +
      (asMenuItem ? ' role="menuitem"' : "") +
      ' aria-label="' +
      escapeHtml(shown + (state.lang === "zh" ? "：" : ": ") + catalogLabel("name", item.name)) +
      '">' +
      escapeHtml(shown) +
      "</button>"
    );
  }

  function rowMenuHtml(item) {
    const menuId = domId("menu", keyOf(item));
    const pending = state.pendingKey === exclusionKey(sheetTypeOf(item), sheetNameOf(item));
    const label = (pending ? t("processingPrefix") : t("actionPrefix")) + catalogLabel("name", item.name);
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
      escapeHtml(t("actionPrefix") + catalogLabel("name", item.name)) +
      '">' +
      actionButtonsHtml(item, true) +
      "</div></div>"
    );
  }

  /** Inline actions for wide screens. Hidden with CSS below 900px. */
  function rowActionsHtml(item) {
    return (
      '<div class="row-actions" role="group" aria-label="' +
      escapeHtml(t("actionPrefix") + catalogLabel("name", item.name)) +
      '">' +
      actionButtonsHtml(item, false) +
      "</div>"
    );
  }

  function daysHtml(entry) {
    const phrase = deliveryPhrase(entry);
    if (phrase) {
      return '<span class="item-days">' + escapeHtml(phrase) + "</span>";
    }
    const text = formatDaysSince(pastDaysValue(entry));
    const shown = text === "—" ? "—" : t("daysValue", { n: text });
    return (
      '<span class="item-days"><span class="sr-only">' +
      escapeHtml(t("daysLabel")) +
      " </span>" +
      escapeHtml(shown) +
      "</span>"
    );
  }

  function daysMetaHtml(entry) {
    const phrase = deliveryPhrase(entry);
    if (phrase) {
      return '<div><span class="meta-value">' + escapeHtml(phrase) + "</span></div>";
    }
    return (
      '<div><span class="meta-label">' +
      escapeHtml(t("daysLabel")) +
      '</span><span class="meta-value">' +
      escapeHtml(formatDaysSince(pastDaysValue(entry))) +
      "</span></div>"
    );
  }

  function qtyHtml(entry, className) {
    return (
      '<span class="' +
      className +
      '">' +
      escapeHtml(t("qtyValue", { n: String(pieceCount(entry)) })) +
      "</span>"
    );
  }

  function actionButtonsHtml(item, asMenuItem) {
    if (isHistoryOnly(item)) return "";
    const exclude = sheetButtonHtml(
      item,
      state.view === "excluded" ? "restore" : "exclude",
      state.view === "excluded" ? t("restore") : t("skip"),
      state.view === "excluded" ? "action-restore" : "action-exclude",
      asMenuItem
    );
    if (state.view === "excluded") {
      const unhold = item.manualHold
        ? sheetButtonHtml(item, "unhold", t("unhold"), "action-unhold", asMenuItem)
        : "";
      return unhold + exclude;
    }
    const hold = item.manualHold
      ? sheetButtonHtml(item, "unhold", t("unhold"), "action-unhold", asMenuItem)
      : sheetButtonHtml(item, "hold", t("hold"), "action-hold", asMenuItem);
    const reclass = sheetButtonHtml(item, "reclass", t("reclass"), "action-reclass", asMenuItem);
    const pending = overrideRecord(sheetTypeOf(item), sheetNameOf(item));
    const clear = pending
      ? sheetButtonHtml(item, "reclass_clear", t("reclassClear"), "action-reclass-clear", asMenuItem)
      : "";
    return hold + reclass + clear + exclude;
  }

  function holdMetaHtml(item) {
    if (READ_ONLY || !item.manualHold) return "";
    const note = item.holdNote
      ? '<p class="item-note">' + escapeHtml(t("holdNotePrefix") + item.holdNote) + "</p>"
      : "";
    return '<p class="hold-flag">' + escapeHtml(t("holdFlag")) + "</p>" + note;
  }

  function reclassMetaHtml(item) {
    if (READ_ONLY || !item.reclassPending) return "";
    return '<p class="reclass-flag">' + escapeHtml(t("reclassFlag")) + "</p>";
  }

  function exclusionMetaHtml(item) {
    if (state.view !== "excluded") return "";
    const note = item.exclusionNote
      ? '<p class="item-note">' + escapeHtml(t("exclusionNotePrefix") + item.exclusionNote) + "</p>"
      : "";
    return (
      '<p class="exclusion-when"><span class="meta-label">' +
      escapeHtml(t("excludedAtLabel")) +
      '</span><span class="meta-value">' +
      escapeHtml(formatExcludedAt(item.excludedAt)) +
      "</span></p>" +
      note
    );
  }

  function brandsOf(item) {
    return Array.isArray(item.brands) ? item.brands : [];
  }

  /**
   * Open-delivery rows (已下單) expand to today/future brands only.
   * Past brands stay in data.json and still show on rows that are not open deliveries.
   */
  function shownBrands(item) {
    const brands = brandsOf(item);
    if (!item || item.manualHold || isHistoryOnly(item) || !isOpenDelivery(item)) return brands;
    return brands.filter((entry) => isOpenDelivery(entry));
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
    return { primary: t("noBrand"), secondary: "" };
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
        '" target="_blank" rel="noopener noreferrer">' +
        escapeHtml(t("publicLink")) +
        "</a>"
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
      qtyHtml(entry, "brand-qty") +
      "</p>" +
      secondary +
      '<div class="item-meta brand-meta">' +
      '<div><span class="meta-label">' +
      escapeHtml(t("lastPurchased")) +
      '</span><span class="meta-value">' +
      escapeHtml(formatDate(entry.lastPurchased)) +
      "</span></div>" +
      daysMetaHtml(entry) +
      "</div>" +
      note +
      link +
      "</div></li>"
    );
  }

  function cardHtml(item) {
    const brands = shownBrands(item);
    const canExpand = brands.length > 0;
    const key = keyOf(item);
    const isOpen = canExpand && state.openProducts.has(key);
    const panelId = domId("brands", key);
    const note = item.note
      ? '<p class="item-note">' + escapeHtml(item.note) + "</p>"
      : "";
    const subtypeHtml =
      item.subtype && String(item.subtype).trim()
        ? '<span class="item-subtype">' + escapeHtml(catalogLabel("subtype", item.subtype)) + "</span>"
        : "";
    const nameAndPack =
      '<span class="item-title"><span class="item-name-row"><span class="item-name">' +
      escapeHtml(catalogLabel("name", item.name)) +
      "</span>" +
      packHtml(item.pack, "item-pack") +
      qtyHtml(item, "item-qty") +
      "</span>" +
      subtypeHtml +
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
    const empty =
      canExpand || brandsOf(item).length > 0
        ? ""
        : '<p class="brand-empty">' + escapeHtml(t("noBrandDetail")) + "</p>";
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
      ? '<p class="item-when"><span class="meta-label">' +
        escapeHtml(t("lastPurchased")) +
        '</span><span class="meta-value">' +
        escapeHtml(formatDate(item.lastPurchased)) +
        "</span></p>"
      : "";
    const historyOnly = isHistoryOnly(item);
    const suggestAndActions = historyOnly
      ? ""
      : '<span class="item-suggest">' +
        badgeHtml(item.suggest) +
        "</span>" +
        (READ_ONLY ? "" : rowMenuHtml(item) + rowActionsHtml(item));
    return (
      '<li class="item-card' +
      (isOpen ? " is-open" : "") +
      (historyOnly ? " is-history" : "") +
      (!historyOnly && item.manualHold ? " is-held" : "") +
      (item.reclassPending ? " is-reclass" : "") +
      '" data-key="' +
      escapeHtml(key) +
      '">' +
      '<div class="product-row">' +
      '<div class="product-head">' +
      title +
      "</div>" +
      daysHtml(item) +
      suggestAndActions +
      "</div>" +
      when +
      note +
      holdMetaHtml(item) +
      reclassMetaHtml(item) +
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
    const history = items.length > 0 && items.every(isHistoryOnly);
    const suggestCols = history
      ? ""
      : "<span>" +
        escapeHtml(t("suggestLabel")) +
        "</span>" +
        (READ_ONLY ? "" : "<span>" + escapeHtml(t("colAction")) + "</span>");
    return (
      '<ul class="item-list' +
      (history ? " is-history" : READ_ONLY ? " is-readonly" : "") +
      '">' +
      '<li class="item-columns" aria-hidden="true">' +
      "<span>" +
      escapeHtml(t("colName")) +
      "</span><span>" +
      escapeHtml(t("colDays")) +
      "</span>" +
      suggestCols +
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

  function formatNotice(entry) {
    if (!entry) return "";
    if (entry.kind === "text") return entry.text || "";
    if (entry.kind === "loading") return t("loadingExclusions");
    if (entry.kind === "noApi") return t("noApiNotice");
    if (entry.kind === "noHold") return t("warnNoHold");
    if (entry.kind === "cache") return noticeWithReason(t("cacheNotice"), entry.err, entry.jsonpErr);
    if (entry.kind === "failRead") return noticeWithReason(t("failNotice"), entry.err, entry.jsonpErr);
    if (entry.kind === "done") {
      const key = {
        exclude: "doneExclude",
        restore: "doneRestore",
        hold: "doneHold",
        unhold: "doneUnhold",
        reclass: "doneReclass",
        reclass_clear: "doneReclassClear",
      }[entry.action];
      return key ? t(key, { name: catalogLabel("name", entry.name) }) : t("doneGeneric");
    }
    if (entry.kind === "failAction") {
      const key = {
        exclude: "failExclude",
        restore: "failRestore",
        hold: "failHold",
        unhold: "failUnhold",
        reclass: "failReclass",
        reclass_clear: "failReclassClear",
      }[entry.action];
      const detail = entry.err ? shortReason(entry.err) : t("tryAgain");
      return t(key || "failGeneric") + detail;
    }
    return "";
  }

  function syncNotice() {
    const parts = [];
    const flash = formatNotice(state.flashNotice);
    const base = formatNotice(state.baseNotice);
    if (flash) parts.push(flash);
    if (base) parts.push(base);
    const text = parts.join(" ");
    const level = state.flashNotice ? state.flashLevel : state.baseLevel;
    els.exclusionNotice.hidden = !text;
    els.exclusionNotice.textContent = text;
    els.exclusionNotice.classList.remove("is-warn", "is-error", "is-ok");
    if (text && level) els.exclusionNotice.classList.add("is-" + level);
  }

  function syncViewChips() {
    if (!els.viewFilters || !els.excludedViewBtn) return;
    els.viewFilters.querySelectorAll("[data-view]").forEach((btn) => {
      const active = btn.getAttribute("data-view") === state.view;
      btn.classList.toggle("is-active", active);
      btn.setAttribute("aria-pressed", active ? "true" : "false");
    });
    const n = listedExclusions().length;
    els.excludedViewBtn.textContent = n > 0 ? t("viewExcludedCount", { n: n }) : t("skip");
  }

  function render() {
    syncNotice();
    syncViewChips();

    if (state.loadFailed || !state.loadSettled) {
      els.sections.innerHTML = "";
      els.emptyState.hidden = true;
      els.resultCount.textContent = "";
      return;
    }

    if (state.loadingExclusions) {
      els.sections.innerHTML = "";
      els.emptyState.hidden = false;
      els.emptyState.textContent = t("loadingExclusions");
      els.resultCount.textContent = "";
      return;
    }

    const filtered = sortItems(filterItems());
    const groups = nest(filtered);
    const excludedCount = listedExclusions().length;
    const universe = state.view === "excluded" ? excludedCount : state.items.length;

    els.resultCount.textContent =
      state.view === "excluded"
        ? t("countExcluded", { n: filtered.length, total: universe })
        : t("countMain", { n: filtered.length, total: universe });

    if (groups.length === 0) {
      els.sections.innerHTML = "";
      els.emptyState.hidden = false;
      els.emptyState.textContent =
        state.view === "excluded" && listedExclusions().length === 0
          ? t("emptyExcluded")
          : t("emptyFilter");
      return;
    }
    els.emptyState.hidden = true;
    els.sections.innerHTML = nestedHtml(groups);
  }

  function populateTypeFilter(types) {
    const sel = els.typeFilter;
    const current = state.type;
    while (sel.options.length > 1) sel.remove(1);
    for (const typeName of types) {
      const opt = document.createElement("option");
      opt.value = typeName;
      opt.textContent = catalogLabel("type", typeName);
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
    // Options follow data.json only. Sheet rows can still name retired types.
    populateTypeFilter(uniqueTypes(state.items));
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
    if (state.view === "excluded") revealGroups(excludedDisplayItems().map(displayItem));
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
    const visible = filterItems();
    for (const key of collectGroupKeys(nest(visible))) state.collapsedGroups.delete(key);
    for (const item of visible) {
      if (shownBrands(item).length > 0) state.openProducts.add(keyOf(item));
    }
    render();
  }

  function collapseAll() {
    const visible = filterItems();
    for (const key of collectGroupKeys(nest(visible))) state.collapsedGroups.add(key);
    for (const item of visible) state.openProducts.delete(keyOf(item));
    render();
  }

  function openExcludeDialog(type, name, trigger) {
    if (READ_ONLY || !exclusionsEnabled() || state.pendingKey || isHistoryOnlyType(type)) return;
    state.dialogItem = { type: type, name: name, kind: "exclude" };
    state.dialogTrigger = trigger || null;
    els.excludeDialogItem.textContent = dialogItemText(type, name);
    els.excludeNote.value = "";
    if (typeof els.excludeDialog.showModal === "function") {
      els.excludeDialog.showModal();
      els.excludeNote.focus();
    }
  }

  function rawItem(type, name) {
    for (const item of state.items) {
      if (item.type === type && item.name === name) return item;
    }
    return null;
  }

  function fillReclassTypes(selected) {
    const sel = els.reclassType;
    if (!sel) return;
    const current = selected || sel.value;
    sel.innerHTML = "";
    for (const typeName of TYPE_ORDER) {
      const opt = document.createElement("option");
      opt.value = typeName;
      opt.textContent = catalogLabel("type", typeName);
      sel.appendChild(opt);
    }
    if (TYPE_ORDER.indexOf(current) !== -1) sel.value = current;
  }

  function fillReclassSubtypes(typeName) {
    const list = els.reclassSubtypeList;
    if (!list) return;
    const names = [];
    const seen = new Set();
    for (const item of state.items) {
      if (typeName && item.type !== typeName) continue;
      const sub = item.subtype == null ? "" : String(item.subtype).trim();
      if (!sub || seen.has(sub)) continue;
      seen.add(sub);
      names.push(sub);
    }
    names.sort((a, b) => a.localeCompare(b, "zh-HK"));
    list.innerHTML = "";
    for (const sub of names) {
      const opt = document.createElement("option");
      opt.value = sub;
      opt.label = catalogLabel("subtype", sub);
      list.appendChild(opt);
    }
  }

  function openReclassDialog(type, name, trigger) {
    if (READ_ONLY || !exclusionsEnabled() || !els.reclassDialog || state.pendingKey || isHistoryOnlyType(type)) return;
    const raw = rawItem(type, name);
    const override = overrideRecord(type, name);
    const selectedType = (override && override.newType) || (raw && raw.type) || type;
    const selectedSubtype = override
      ? override.newSubtype || ""
      : raw && raw.subtype
        ? String(raw.subtype)
        : "";
    state.dialogItem = { type: type, name: name, kind: "reclass" };
    state.dialogTrigger = trigger || null;
    els.reclassDialogItem.textContent = dialogItemText(type, name);
    fillReclassTypes(selectedType);
    fillReclassSubtypes(els.reclassType.value);
    els.reclassSubtype.value = selectedSubtype;
    els.reclassNote.value = "";
    if (els.reclassClear) els.reclassClear.hidden = !override;
    if (typeof els.reclassDialog.showModal === "function") {
      els.reclassDialog.showModal();
      els.reclassType.focus();
    }
  }

  function openHoldDialog(type, name, trigger) {
    if (READ_ONLY || !exclusionsEnabled() || state.pendingKey || isHistoryOnlyType(type)) return;
    state.dialogItem = { type: type, name: name, kind: "hold" };
    state.dialogTrigger = trigger || null;
    els.holdDialogItem.textContent = dialogItemText(type, name);
    els.holdNote.value = t("holdNoteDefault");
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
      throw appError("errNotJson");
    }
    if (!data || typeof data !== "object") throw appError("errBadFormat");
    if (!res.ok && !data.error) throw appError("http", { status: String(res.status) });
    return data;
  }

  function withTimeout(promise, ms) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(appError("errTimeout")), ms);
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

  async function postExclusion(action, type, name, note, fields) {
    if (READ_ONLY || !exclusionsEnabled() || isHistoryOnlyType(type)) return;
    const key = exclusionKey(type, name);
    if (state.pendingKey) return;
    state.pendingKey = key;
    state.pendingAction = action;
    state.flashNotice = null;
    state.flashLevel = "";
    render();
    try {
      const payload = { action: action, type: type, name: name };
      if (action === "exclude" || action === "hold") payload.note = String(note || "").trim();
      if (action === "reclass" && fields) {
        payload.newType = String(fields.newType || "").trim();
        payload.newSubtype = String(fields.newSubtype == null ? "" : fields.newSubtype).trim();
        const extraNote = String(fields.note || "").trim();
        if (extraNote) payload.note = extraNote;
      }
      // POST stays a simple request: text/plain JSON body, no preflight.
      // Apps Script does not answer CORS preflight OPTIONS.
      const data = await fetchJson(state.apiUrl, {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify(payload),
      });
      if (Array.isArray(data.items)) {
        applyFromSheet(
          data.items,
          Array.isArray(data.held) ? data.held : undefined,
          Array.isArray(data.overrides) ? data.overrides : undefined
        );
        state.baseNotice = null;
        state.baseLevel = "";
      }
      if (data.error) throw new Error(data.error);
      state.flashNotice = { kind: "done", action: action, name: name };
      state.flashLevel = "ok";
      if (action === "exclude" && state.view === "excluded") {
        revealGroups(
          excludedDisplayItems()
            .filter((item) => item.type === type && item.name === name)
            .map(displayItem)
        );
      }
    } catch (err) {
      state.flashNotice = { kind: "failAction", action: action, err: err };
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
    if (
      (els.excludeDialog && els.excludeDialog.open) ||
      (els.holdDialog && els.holdDialog.open) ||
      (els.reclassDialog && els.reclassDialog.open)
    ) {
      return;
    }
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
    if (READ_ONLY || !actionBtn || actionBtn.disabled) return;
    const type = actionBtn.getAttribute("data-type");
    const name = actionBtn.getAttribute("data-name");
    const action = actionBtn.getAttribute("data-action");
    const focus = focusEl || actionBtn;
    if (action === "exclude") openExcludeDialog(type, name, focus);
    if (action === "restore") postExclusion("restore", type, name);
    if (action === "hold") openHoldDialog(type, name, focus);
    if (action === "unhold") postExclusion("unhold", type, name);
    if (action === "reclass") openReclassDialog(type, name, focus);
    if (action === "reclass_clear") postExclusion("reclass_clear", type, name);
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

    if (els.viewFilters) {
      els.viewFilters.addEventListener("click", (e) => {
        const btn = e.target.closest("[data-view]");
        if (!btn) return;
        setView(btn.getAttribute("data-view"));
      });
    }

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

    if (els.excludeCancel && els.excludeDialog && els.excludeForm) {
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

    if (els.holdCancel && els.holdDialog && els.holdForm) {
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
    }

    if (els.reclassCancel && els.reclassDialog && els.reclassForm && els.reclassType) {
      els.reclassType.addEventListener("change", () => {
        fillReclassSubtypes(els.reclassType.value);
      });

      els.reclassCancel.addEventListener("click", () => {
        state.dialogItem = null;
        els.reclassDialog.close();
      });

      els.reclassClear.addEventListener("click", () => {
        const item = state.dialogItem;
        state.dialogItem = null;
        els.reclassDialog.close();
        if (!item || item.kind !== "reclass") return;
        postExclusion("reclass_clear", item.type, item.name);
      });

      els.reclassForm.addEventListener("submit", () => {
        const item = state.dialogItem;
        const newType = els.reclassType.value;
        const newSubtype = els.reclassSubtype.value.trim();
        const note = els.reclassNote.value;
        state.dialogItem = null;
        if (!item || item.kind !== "reclass" || !newType) return;
        postExclusion("reclass", item.type, item.name, null, {
          newType: newType,
          newSubtype: newSubtype,
          note: note,
        });
      });

      els.reclassDialog.addEventListener("close", () => {
        const trigger = state.dialogTrigger;
        state.dialogTrigger = null;
        if (trigger && typeof trigger.focus === "function") trigger.focus();
      });

      els.reclassDialog.addEventListener("click", (e) => {
        if (e.target === els.reclassDialog) {
          state.dialogItem = null;
          els.reclassDialog.close();
        }
      });
    }

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

  function describeError(err) {
    if (!err) return "";
    if (err.appCode === "http") return "HTTP " + ((err.vars && err.vars.status) || "");
    if (err.appCode) return t(err.appCode, err.vars);
    const msg = err.message ? String(err.message).replace(/\s+/g, " ").trim() : "";
    return msg;
  }

  function shortReason(err) {
    const msg = describeError(err);
    if (!msg) return t("unknownError");
    return msg.length > 140 ? msg.slice(0, 140) + "…" : msg;
  }

  function noticeWithReason(sentence, err, extraErr) {
    const bits = [];
    const primary = shortReason(err);
    if (primary) bits.push(primary);
    if (extraErr) {
      const extra = shortReason(extraErr);
      if (extra && extra !== primary) bits.push(t("jsonpPrefix") + extra);
    }
    if (!bits.length) return sentence;
    return sentence + "（" + bits.join("；") + "）";
  }

  function acceptExclusionPayload(data) {
    if (!data || typeof data !== "object") throw appError("errBadFormat");
    if (data.error && !Array.isArray(data.items)) throw new Error(data.error);
    const hasHeld = Array.isArray(data.held);
    applyFromSheet(
      Array.isArray(data.items) ? data.items : [],
      hasHeld ? data.held : undefined,
      Array.isArray(data.overrides) ? data.overrides : undefined
    );
    if (data.error) {
      state.baseNotice = { kind: "text", text: String(data.error) };
      state.baseLevel = "error";
      return;
    }
    if (!hasHeld) {
      state.baseNotice = { kind: "noHold" };
      state.baseLevel = "warn";
      return;
    }
    state.baseNotice = null;
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
      const timer = setTimeout(() => finish(appError("jsonpTimeout")), EXCLUSION_TIMEOUT_MS);

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
        finish(err instanceof Error ? err : appError("jsonpBadUrl"));
        return;
      }
      script.onerror = function () {
        finish(appError("jsonpLoadFail"));
      };
      script.onload = function () {
        if (!settled) finish(appError("jsonpNoCallback"));
      };
      document.head.appendChild(script);
    });
  }

  function failExclusions(err, jsonpErr) {
    const cached = readCache();
    if (cached) {
      state.exclusions = cached.items;
      state.holds = cached.held;
      state.overrides = cached.overrides || [];
      state.baseNotice = { kind: "cache", err: err, jsonpErr: jsonpErr };
      state.baseLevel = "warn";
      return;
    }
    state.exclusions = [];
    state.holds = [];
    state.overrides = [];
    state.baseNotice = { kind: "failRead", err: err, jsonpErr: jsonpErr };
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
      state.overrides = [];
      state.baseNotice = { kind: "noApi" };
      state.baseLevel = "warn";
      state.loadingExclusions = false;
      return;
    }

    state.loadingExclusions = true;
    state.baseNotice = { kind: "loading" };
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
    const catalogPromise = loadCatalogI18n();
    try {
      const res = await fetch("./data.json", { cache: "no-store" });
      if (!res.ok) throw appError("loadFail", { status: String(res.status) });
      const data = await res.json();
      if (!data || !Array.isArray(data.items)) {
        throw appError("badData");
      }
      state.updatedAt = data.updatedAt || null;
      state.items = data.items;
      state.loadFailed = false;
      state.loadSettled = true;
      await catalogPromise;
      refreshUpdatedAt();

      refreshTypeFilter();

      els.errorBox.hidden = true;
      // Read-only still hides excluded rows (type|name). It does not offer skip, hold, or reclass.
      await loadExclusions();
      refreshTypeFilter();
      render();
    } catch (err) {
      console.error(err);
      state.loadFailed = true;
      state.loadSettled = true;
      refreshUpdatedAt();
      els.errorBox.hidden = false;
      els.errorBox.textContent = t("fileError");
    }
  }

  els.langSwitch.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-lang]");
    if (!btn) return;
    setLang(btn.getAttribute("data-lang"));
  });

  applyStaticI18n();
  syncLangSwitch();
  bindEvents();
  syncGroupMode();
  load();
})();
