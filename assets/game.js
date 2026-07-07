// Game News Radar frontend.
//
// Reads data/game-news.json, produced by the live pipeline
// (scripts/update_game_news.py, see .github/workflows/update-game-news.yml)
// and pushed to the orphan `game-data` branch - NOT committed into master's
// history, so it never accumulates the way AI News's archive.json used to.
// Falls back to the same-branch relative path (the one-time historical seed
// baked into master) if the live branch isn't reachable yet, e.g. before its
// first successful run. Kept deliberately separate from assets/app.js so
// this page can iterate without risking the AI News page.

const REPO_SLUG = "DarylWong-PlayPark/ai-news-radar";
const LIVE_DATA_URL = `https://raw.githubusercontent.com/${REPO_SLUG}/game-data/data/game-news.json`;
const FALLBACK_DATA_URL = "./data/game-news.json";
const REGION_LABELS = {
  ALL: "Hot",
  TH: "Thailand",
  PH: "Philippines",
  VN: "Vietnam",
  SG: "Singapore",
  MY: "Malaysia",
  ID: "Indonesia",
  CN: "China",
  OTHERS: "Others",
  MISC: "Misc",
};
const HOT_LIMIT = 200;

// Mirrors scripts/game_sources.py's dedicated-site list plus the broad
// "what's trending" scrapers reused from update_news.py. Kept in sync by
// hand today; revisit if this drifts (e.g. serve site->type from the data
// payload itself instead of duplicating the map client-side).
const SOURCE_TYPE_MAP = {
  gamingph: "dedicated_game_media",
  gamingpinas: "dedicated_game_media",
  gamingdose: "dedicated_game_media",
  gamestation_id: "dedicated_game_media",
  gamebrott: "dedicated_game_media",
  gamelade: "dedicated_game_media",
  pokde: "tech_portal",
};
const DEFAULT_SOURCE_TYPE = "aggregator"; // tophub/iris/buzzing/techurls/newsnow/zeli/etc.

const MONTH_ABBR = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const state = {
  items: [],
  byRegion: {},
  region: "ALL",
  contentType: "",
  sourceType: "",
  specificSource: "",
  query: "",
  dateFrom: null, // Date, UTC start-of-day
  dateTo: null,   // Date, UTC end-of-day
};

function itemEventTime(item) {
  const iso = item.published_at || item.last_seen_at || item.first_seen_at;
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

function formatDate(iso) {
  const d = itemEventTime({ published_at: iso });
  return d ? d.toISOString().slice(0, 10) : "Undated";
}

function formatDDMMMYYYY(date) {
  const dd = String(date.getUTCDate()).padStart(2, "0");
  const mmm = MONTH_ABBR[date.getUTCMonth()];
  return `${dd}-${mmm}-${date.getUTCFullYear()}`;
}

function escapeHtml(str) {
  return String(str || "").replace(/[&<>"']/g, (ch) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]
  ));
}

function sourceTypeOf(item) {
  return SOURCE_TYPE_MAP[item.site_id] || DEFAULT_SOURCE_TYPE;
}

// --- Date range quick-select math -------------------------------------
// Calendar quarters: Q1 Jan-Mar, Q2 Apr-Jun, Q3 Jul-Sep, Q4 Oct-Dec.
// "Current Quarter" = quarter-start through today (e.g. on 1-Jul, Current
// Quarter is just 1-Jul, since Q3 starts 1-Jul). "Last Quarter" = the full
// previous quarter, start through end.

function quarterStartUTC(year, quarterIndex) {
  return new Date(Date.UTC(year, quarterIndex * 3, 1));
}

function currentQuarterRange(now) {
  const q = Math.floor(now.getUTCMonth() / 3);
  return { from: quarterStartUTC(now.getUTCFullYear(), q), to: now };
}

function lastQuarterRange(now) {
  const q = Math.floor(now.getUTCMonth() / 3);
  let year = now.getUTCFullYear();
  let lastQ = q - 1;
  if (lastQ < 0) {
    lastQ = 3;
    year -= 1;
  }
  const from = quarterStartUTC(year, lastQ);
  const to = new Date(Date.UTC(year, lastQ * 3 + 3, 0)); // day 0 of next month = last day of this quarter
  return { from, to };
}

function daysAgoRange(now, days) {
  const from = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  return { from, to: now };
}

function startOfDayUTC(date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function endOfDayUTC(date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 23, 59, 59, 999));
}

function applyDateRange(from, to) {
  state.dateFrom = startOfDayUTC(from);
  state.dateTo = endOfDayUTC(to);
  const readout = document.getElementById("gameDateRangeReadout");
  readout.textContent = `${formatDDMMMYYYY(state.dateFrom)} → ${formatDDMMMYYYY(state.dateTo)}`;
  readout.hidden = false;
}

function clearDateRange() {
  state.dateFrom = null;
  state.dateTo = null;
  const readout = document.getElementById("gameDateRangeReadout");
  readout.hidden = true;
  readout.textContent = "";
}

function handleDateRangePresetChange(value) {
  const now = new Date();
  const fromField = document.getElementById("gameDateFromField");
  const toField = document.getElementById("gameDateToField");
  const isCustom = value === "custom";
  fromField.hidden = !isCustom;
  toField.hidden = !isCustom;

  if (value === "all") {
    clearDateRange();
  } else if (value === "7d") {
    const r = daysAgoRange(now, 7);
    applyDateRange(r.from, r.to);
  } else if (value === "14d") {
    const r = daysAgoRange(now, 14);
    applyDateRange(r.from, r.to);
  } else if (value === "30d") {
    const r = daysAgoRange(now, 30);
    applyDateRange(r.from, r.to);
  } else if (value === "cq") {
    const r = currentQuarterRange(now);
    applyDateRange(r.from, r.to);
  } else if (value === "lq") {
    const r = lastQuarterRange(now);
    applyDateRange(r.from, r.to);
  } else if (isCustom) {
    const fromInput = document.getElementById("gameDateFrom");
    const toInput = document.getElementById("gameDateTo");
    if (!fromInput.value) fromInput.value = daysAgoRange(now, 30).from.toISOString().slice(0, 10);
    if (!toInput.value) toInput.value = now.toISOString().slice(0, 10);
    applyCustomDateInputs();
  }
  render();
}

function applyCustomDateInputs() {
  const fromInput = document.getElementById("gameDateFrom");
  const toInput = document.getElementById("gameDateTo");
  if (!fromInput.value || !toInput.value) return;
  applyDateRange(new Date(`${fromInput.value}T00:00:00Z`), new Date(`${toInput.value}T00:00:00Z`));
}

function renderItem(item) {
  const title = escapeHtml(item.title || "Untitled");
  const source = escapeHtml(item.source || item.site_name || item.site_id || "");
  const date = formatDate(item.published_at || item.last_seen_at || item.first_seen_at);
  const regionLabel = escapeHtml(item.region_label || "Others");
  const url = escapeHtml(item.url || "#");
  const contentType = item.content_type && item.content_type !== "general"
    ? `<span class="game-item-type">${escapeHtml(item.content_type)}</span>`
    : "";
  return `
    <a class="game-item-row" href="${url}" target="_blank" rel="noopener noreferrer">
      <span class="game-item-title">${title}</span>
      <span class="game-item-meta">
        <span class="game-item-source">${source}</span>
        <span class="game-item-region">${regionLabel}</span>
        ${contentType}
        <span class="game-item-date">${date}</span>
      </span>
    </a>`;
}

// Multi-word search: every space-separated term must appear somewhere in the
// haystack, but terms don't need to be contiguous - "gaming sdk" should match
// a title like "Gaming Chat SDK by CometChat".
function matchesQuery(item, query) {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return true;
  const hay = `${item.title || ""} ${item.source || ""}`.toLowerCase();
  return terms.every((term) => hay.includes(term));
}

function currentList() {
  let list = state.items;

  if (state.region === "ALL") {
    list = list.filter((it) => it.region !== "MISC"); // Misc is opt-in only, see the Misc tab
  } else {
    list = list.filter((it) => it.region === state.region);
  }

  if (state.contentType) {
    list = list.filter((it) => it.content_type === state.contentType);
  }

  if (state.sourceType) {
    list = list.filter((it) => sourceTypeOf(it) === state.sourceType);
  }

  if (state.specificSource) {
    list = list.filter((it) => it.site_id === state.specificSource);
  }

  if (state.dateFrom && state.dateTo) {
    list = list.filter((it) => {
      const t = itemEventTime(it);
      return t && t >= state.dateFrom && t <= state.dateTo;
    });
  }

  if (state.query) {
    list = list.filter((it) => matchesQuery(it, state.query));
  }

  const noOtherFilters = !state.contentType && !state.sourceType && !state.specificSource
    && !state.dateFrom && !state.query;
  if (state.region === "ALL" && noOtherFilters) {
    list = list.slice(0, HOT_LIMIT);
  }

  return list;
}

function render() {
  const body = document.getElementById("gamePanelBody");
  const list = currentList();

  if (!list.length) {
    body.innerHTML = `<div class="empty-state">No game news matches this view yet.</div>`;
  } else {
    body.innerHTML = `<div class="game-item-list">${list.map(renderItem).join("")}</div>`;
  }

  const title = document.getElementById("gamePanelTitle");
  const eyebrow = document.getElementById("gamePanelEyebrow");
  if (state.region === "ALL") {
    title.textContent = "Top Game Signals";
    eyebrow.textContent = "TOP SIGNALS (MOST RECENT, MISC HIDDEN)";
  } else {
    title.textContent = `${REGION_LABELS[state.region]} Game Signals`;
    eyebrow.textContent = `${REGION_LABELS[state.region].toUpperCase()} SIGNALS`;
  }
}

function updateTabCounts() {
  const miscCount = state.byRegion.MISC || 0;
  const total = state.items.length;
  document.querySelectorAll("#gameTabs .section-tab").forEach((btn) => {
    const region = btn.dataset.region;
    const count = region === "ALL" ? total - miscCount : (state.byRegion[region] || 0);
    const strong = btn.querySelector("strong");
    if (strong) strong.textContent = count.toLocaleString();
  });
}

function setRegion(region) {
  state.region = region;
  document.querySelectorAll("#gameTabs .section-tab").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.region === region);
  });
  const select = document.getElementById("gameRegionSelect");
  if (select) select.value = region;
  render();
}

function populateSpecificSourceOptions() {
  const select = document.getElementById("gameSpecificSourceSelect");
  const sources = new Map();
  state.items.forEach((it) => {
    if (it.site_id && !sources.has(it.site_id)) {
      sources.set(it.site_id, it.site_name || it.source || it.site_id);
    }
  });
  const sorted = [...sources.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  select.innerHTML = `<option value="">All sites</option>` +
    sorted.map(([siteId, name]) => `<option value="${escapeHtml(siteId)}">${escapeHtml(name)}</option>`).join("");
}

function wireControls() {
  document.getElementById("gameTabs").addEventListener("click", (evt) => {
    const btn = evt.target.closest(".section-tab");
    if (!btn) return;
    setRegion(btn.dataset.region);
  });

  document.getElementById("gameRegionSelect").addEventListener("change", (evt) => {
    setRegion(evt.target.value);
  });

  document.getElementById("gameContentTypeSelect").addEventListener("change", (evt) => {
    state.contentType = evt.target.value;
    render();
  });

  document.getElementById("gameSourceTypeSelect").addEventListener("change", (evt) => {
    state.sourceType = evt.target.value;
    render();
  });

  document.getElementById("gameSpecificSourceSelect").addEventListener("change", (evt) => {
    state.specificSource = evt.target.value;
    render();
  });

  document.getElementById("gameDateRangePreset").addEventListener("change", (evt) => {
    handleDateRangePresetChange(evt.target.value);
  });

  document.getElementById("gameDateFrom").addEventListener("change", applyAndRenderCustomDates);
  document.getElementById("gameDateTo").addEventListener("change", applyAndRenderCustomDates);

  document.getElementById("gameSearch").addEventListener("input", (evt) => {
    state.query = evt.target.value.trim();
    render();
  });
}

function applyAndRenderCustomDates() {
  applyCustomDateInputs();
  render();
}

async function fetchJson(url) {
  const res = await fetch(`${url}${url.includes("?") ? "&" : "?"}t=${Date.now()}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

function renderSourceHealth(sourceHealth) {
  const el = document.getElementById("gameSourceHealthTable");
  if (!el) return;
  if (!sourceHealth || !Array.isArray(sourceHealth.sources) || !sourceHealth.sources.length) {
    el.innerHTML = `<div class="empty-state">No live source-health data yet (showing historical backfill).</div>`;
    return;
  }
  const rows = [...sourceHealth.sources].sort((a, b) => (b.ok - a.ok) || b.item_count - a.item_count);
  el.innerHTML = [
    `<div class="source-table-row source-table-head"><span>Source</span><span>Items</span><span>Duration</span><span>Status</span></div>`,
    ...rows.map((s) => `
      <div class="source-table-row">
        <span>${escapeHtml(s.site_name || s.site_id)}</span>
        <span>${(s.item_count || 0).toLocaleString()}</span>
        <span>${s.duration_ms ? `${s.duration_ms}ms` : "-"}</span>
        <span class="${s.ok ? "ok" : "bad"}">${s.ok ? "Healthy" : "Failed"}</span>
      </div>`),
  ].join("");
}

async function init() {
  wireControls();
  let data;
  let live = true;
  try {
    data = await fetchJson(LIVE_DATA_URL);
  } catch (liveErr) {
    live = false;
    try {
      data = await fetchJson(FALLBACK_DATA_URL);
    } catch (fallbackErr) {
      document.getElementById("gamePanelBody").innerHTML =
        `<div class="empty-state">Could not load game news data (live: ${escapeHtml(liveErr.message)}; fallback: ${escapeHtml(fallbackErr.message)}).</div>`;
      document.getElementById("gameStatusPill").textContent = "Load failed";
      return;
    }
  }

  state.items = data.items || [];
  state.byRegion = data.by_region || {};

  const sourceCount = new Set(state.items.map((it) => it.site_id)).size;
  document.getElementById("gameStatCount").textContent = state.items.length.toLocaleString();
  document.getElementById("gameStatSources").textContent = String(sourceCount);
  document.getElementById("gameUpdatedLabel").textContent = data.generated_at
    ? new Date(data.generated_at).toISOString().slice(0, 10)
    : "Unknown";

  const pill = document.getElementById("gameStatusPill");
  const health = data.source_health;
  const advancedSummary = document.getElementById("gameAdvancedSummary");
  if (live && health) {
    pill.textContent = `${health.ok_count}/${health.total_count} sources healthy`;
    pill.classList.toggle("warn", health.ok_count < health.total_count);
    advancedSummary.textContent = `Live · ${health.ok_count}/${health.total_count} sources healthy`;
  } else if (live) {
    pill.textContent = "Live";
    pill.classList.remove("warn");
    advancedSummary.textContent = "Live";
  } else {
    pill.textContent = "Historical backfill (live branch unreachable)";
    pill.classList.add("warn");
    advancedSummary.textContent = "Historical backfill, live branch unreachable";
  }
  renderSourceHealth(health);
  populateSpecificSourceOptions();

  updateTabCounts();
  render();
}

document.addEventListener("DOMContentLoaded", init);
