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
const ST_RANK_URL = "./data/game-rank-index.json";
const REGION_LABELS = {
  ALL: "Hot",
  TH: "Thailand",
  PH: "Philippines",
  VN: "Vietnam",
  SG: "Singapore",
  MY: "Malaysia",
  ID: "Indonesia",
  CN: "China",
  TW: "Taiwan",
  GLOBAL: "Global",
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
  gnn_tw: "dedicated_game_media",
  pcgamer: "dedicated_game_media",
  gamerant: "dedicated_game_media",
  gamesradar: "dedicated_game_media",
  polygon: "dedicated_game_media",
  shacknews: "dedicated_game_media",
  siliconera: "dedicated_game_media",
  pockettactics: "dedicated_game_media",
  rsshub_riotgames: "dedicated_game_media",
  rsshub_scoga: "dedicated_game_media",
  rsshub_zynga: "dedicated_game_media",
  pokde: "tech_portal",
  mothership_sg: "tech_portal",
  siakapkeli: "tech_portal",
  medcom: "tech_portal",
  genmuda: "tech_portal",
  kaorinusantara: "tech_portal",
  inet_detik: "tech_portal",
  kontan_lifestyle: "tech_portal",
  mediaindonesia: "tech_portal",
  liputan6: "tech_portal",
  straitstimes: "tech_portal",
  hardwarezone_sg: "tech_portal",
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
  stBonus: new Map(),         // url → float, pre-computed Sensor Tower rank bonus
  multiSourceBonus: new Map(), // url → float, +0.3 when 2+ distinct sources cover same game within 24h
  multiSourceSources: new Map(), // url → int, count of distinct sources for badge display
};

function itemEventTime(item) {
  const iso = item.published_at || item.last_seen_at || item.first_seen_at;
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

function formatDate(iso) {
  const d = itemEventTime({ published_at: iso });
  return d ? formatDDMMMYYYY(d) : "Undated";
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

// High-signal title phrases — fires when content_type is unset or generic.
// Ordered by significance; first match wins, capped at 0.35.
const KEYWORD_BOOSTS = [
  // Major industry events
  [0.35, ["shuts down", "shut down", "shutting down", "bankruptcy", "bankrupt", "acquired by", "acquisition"]],
  [0.30, ["billion", "record breaking", "record-breaking", "all time high", "all-time high", "milestone"]],
  [0.25, ["lawsuit", "sued", "controversy", "major update", "big update", "world championship", "world cup"]],
  [0.20, ["launches", "launch date", "release date", "out now", "goes live", "early access", "new season",
           "server down", "maintenance", "ban wave", "partnership", "collaboration announced"]],
];

function keywordBoost(item) {
  const title = (item.title_en || item.title || "").toLowerCase();
  for (const [boost, phrases] of KEYWORD_BOOSTS) {
    for (const phrase of phrases) {
      if (title.includes(phrase)) return boost;
    }
  }
  return 0;
}

// Phase-1 signal score: pure client-side, no external API.
// Components: recency (decays to 0 at 7 days) + source tier + event type
// + keyword boost + Sensor Tower SEA revenue rank bonus (Phase 2).
function signalScore(item) {
  let score = 0;
  const t = itemEventTime(item);
  if (t) {
    const hoursAgo = (Date.now() - t.getTime()) / 3_600_000;
    score += Math.max(0, 1 - hoursAgo / 168); // 168h = 7 days
  }
  const stype = sourceTypeOf(item);
  if (stype === "dedicated_game_media") score += 0.6;
  else if (stype === "tech_portal") score += 0.3;
  else score += 0.1;
  const etype = item.content_type;
  if (etype === "launch")              score += 0.4;
  else if (etype === "business")       score += 0.3;
  else if (etype === "update" || etype === "esports") score += 0.2;
  score += keywordBoost(item);
  score += state.stBonus.get(item.url) || 0;
  score += state.multiSourceBonus.get(item.url) || 0;
  return score;
}

function signalLevel(score) {
  if (score >= 1.3) return 3;
  if (score >= 0.7) return 2;
  return 1;
}

function renderSignalBars(level) {
  return (
    `<span class="game-signal" data-level="${level}" aria-label="Signal level ${level} of 3" title="Signal ${level}/3 · recency + source tier + event type">` +
    `<span class="game-signal-bar"></span>` +
    `<span class="game-signal-bar"></span>` +
    `<span class="game-signal-bar"></span>` +
    `</span>`
  );
}

// ── Sensor Tower rank bonus (Phase 2) ─────────────────────────────
// Loads data/game-rank-index.json (generated by scripts/build_game_rank_index.py
// from the Sensor Tower SEA6 export). Bonus is added to signalScore() at load
// time — pre-computed once per item, not per-render.

function stNormalize(s) {
  return String(s).toLowerCase()
    .replace(/[™®''™®:!?,.'`\-™®’]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function regexEscape(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildStIndex(rankData) {
  // Only the top 1000 by revenue rank carry meaningful signal weight;
  // entries below that have < $1.5M revenue across 12 years in SEA.
  const entries = (rankData.entries || []).slice(0, 1000).map((e) => ({
    rank:     e.rank,
    name:     e.name,
    key:      e.key,
    alt:      e.alt || null,
    // boundary=true → must match as a whole word (short Latin names like "Roblox", "MIR4")
    // boundary=false → substring match is safe (long/specific names like "Mobile Legends: Bang Bang")
    re:       e.boundary ? new RegExp("\\b" + regexEscape(e.key) + "\\b") : null,
    reAlt:    (e.boundary && e.alt) ? new RegExp("\\b" + regexEscape(e.alt) + "\\b") : null,
  }));
  // Sort longest key first so a longer match beats a shorter one if both
  // could fire (e.g. "call of duty mobile" wins over "call of duty").
  entries.sort((a, b) => b.key.length - a.key.length);
  return entries;
}

function stBonusForRank(rank) {
  if (rank <= 10)  return 0.5;
  if (rank <= 100) return 0.4;
  if (rank <= 500) return 0.25;
  return 0.15;
}

function stMatchEntry(normalizedTitle, entry) {
  if (entry.re) {
    return entry.re.test(normalizedTitle) || (entry.reAlt && entry.reAlt.test(normalizedTitle));
  }
  return normalizedTitle.includes(entry.key) || (entry.alt && normalizedTitle.includes(entry.alt));
}

function precomputeStBonuses(items, stEntries) {
  const bonuses = new Map();
  if (!stEntries.length) return bonuses;
  for (const item of items) {
    const title = stNormalize(item.title_en || item.title || "");
    if (!title) continue;
    for (const entry of stEntries) {
      if (stMatchEntry(title, entry)) {
        bonuses.set(item.url, stBonusForRank(entry.rank));
        break; // longest-first means first match is best
      }
    }
  }
  return bonuses;
}

// Multi-source bonus: when 2+ distinct outlets cover the same ranked game
// within 24h, each matching article gets +0.3. Requires stEntries to be built.
function computeMultiSourceBonus(items, stEntries) {
  const now = Date.now();
  const WINDOW_MS = 24 * 3_600_000;
  const byGame = new Map(); // game key → [{url, site}]

  for (const item of items) {
    const t = itemEventTime(item);
    if (!t || now - t.getTime() > WINDOW_MS) continue;
    const title = stNormalize(item.title_en || item.title || "");
    if (!title) continue;
    for (const entry of stEntries) {
      if (stMatchEntry(title, entry)) {
        if (!byGame.has(entry.key)) byGame.set(entry.key, []);
        byGame.get(entry.key).push({ url: item.url, site: item.site_id });
        break;
      }
    }
  }

  const bonus = new Map();
  const sourceCount = new Map();
  for (const [, articles] of byGame) {
    const sites = new Set(articles.map((a) => a.site));
    if (sites.size >= 2) {
      for (const a of articles) {
        bonus.set(a.url, 0.3);
        sourceCount.set(a.url, sites.size);
      }
    }
  }
  return { bonus, sourceCount };
}

// Templated "why it matters" — keyword-first, then content_type, then ST/multi-source fallback.
function whyItMatters(item) {
  const title = (item.title_en || item.title || "").toLowerCase();

  if (["shuts down", "shut down", "shutting down", "bankruptcy", "bankrupt"].some((k) => title.includes(k)))
    return "Service ending — player base may be available for acquisition; rival exits the SEA market.";
  if (["acquired by", "acquisition", "merger"].some((k) => title.includes(k)))
    return "Industry consolidation — M&A reshaping the competitive landscape for SEA publishers.";
  if (["billion", "record breaking", "record-breaking", "all time high", "all-time high"].some((k) => title.includes(k)))
    return "Revenue or engagement milestone — benchmark signal for a title's live-service health.";
  if (["world championship", "world cup"].some((k) => title.includes(k)))
    return "Major esports event — peak viewership window and sponsorship opportunity for SEA.";
  if (["lawsuit", "sued", "legal action"].some((k) => title.includes(k)))
    return "Legal action — regulatory or IP risk that could affect publishing and distribution.";
  if (["ban wave", "ban waves"].some((k) => title.includes(k)))
    return "Enforcement action — platform policy signal affecting active players.";
  if (["server down", "maintenance"].some((k) => title.includes(k)))
    return "Service disruption on a known SEA title — direct impact to active player count.";
  if (["partnership", "collaboration announced"].some((k) => title.includes(k)))
    return "Partnership or IP deal — cross-promotion opportunity for SEA publishers to evaluate.";

  const etype = item.content_type;
  if (etype === "launch")   return "New title entering the market — assess competitive impact and SEA player migration risk.";
  if (etype === "business") return "Corporate or financial event — potential partner move, competitor shift, or market restructuring.";
  if (etype === "esports")  return "Esports event — viewership and sponsorship signal relevant to the SEA gaming audience.";
  if (etype === "update")   return "Significant content update — retention signal and indicator of live-service momentum.";
  if (etype === "platform") return "Platform or store change — affects how games reach and monetise SEA players.";

  if (state.multiSourceBonus.has(item.url))
    return "Multiple outlets are covering this story simultaneously — broad industry attention signal.";
  if (state.stBonus.has(item.url))
    return "Covers a top SEA revenue title — industry attention on a proven high-earner.";

  return "High-signal source coverage of a game-industry development.";
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
  const customField = document.getElementById("gameDateCustomField");
  const isCustom = value === "custom";
  customField.hidden = !isCustom;

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

function itemParts(item) {
  const original = escapeHtml(item.title || "Untitled");
  const hasTranslation = item.title_en && item.title_en !== item.title;
  const mainTitle = hasTranslation ? escapeHtml(item.title_en) : original;
  const originalLine = hasTranslation
    ? `<span class="game-item-original">${original}</span>`
    : "";
  const source = escapeHtml(item.source || item.site_name || item.site_id || "");
  const date = formatDate(item.published_at || item.last_seen_at || item.first_seen_at);
  const regionLabel = escapeHtml(item.region_label || "Others");
  const url = escapeHtml(item.url || "#");
  const contentType = item.content_type && item.content_type !== "general"
    ? `<span class="game-item-type" data-type="${escapeHtml(item.content_type)}">${escapeHtml(item.content_type)}</span>`
    : "";
  return { mainTitle, originalLine, source, date, regionLabel, url, contentType };
}

function renderItem(item) {
  const { mainTitle, originalLine, source, date, regionLabel, url, contentType } = itemParts(item);
  const level = signalLevel(signalScore(item));
  return `
    <a class="game-item-row" href="${url}" target="_blank" rel="noopener noreferrer">
      <span class="game-item-title">${mainTitle}</span>
      ${originalLine}
      <span class="game-item-meta">
        <span class="game-item-source">${source}</span>
        <span class="game-item-region">${regionLabel}</span>
        ${contentType}
        <span class="game-item-date">${date}</span>
        ${renderSignalBars(level)}
      </span>
    </a>`;
}

function renderFeaturedItem(item) {
  const { mainTitle, originalLine, source, date, regionLabel, url, contentType } = itemParts(item);
  const why = escapeHtml(whyItMatters(item));
  const multiCount = state.multiSourceSources.get(item.url);
  const multiSourceBadge = multiCount
    ? `<span class="game-source-count">${multiCount} sources</span>`
    : "";
  return `
    <a class="game-item-featured" href="${url}" target="_blank" rel="noopener noreferrer">
      <span class="game-item-title">${mainTitle}</span>
      ${originalLine}
      <div class="game-key-why">${why}</div>
      <span class="game-item-meta">
        <span class="game-item-source">${source}</span>
        <span class="game-item-region">${regionLabel}</span>
        ${contentType}
        ${multiSourceBadge}
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
  const hay = `${item.title || ""} ${item.title_en || ""} ${item.source || ""}`.toLowerCase();
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
  if (noOtherFilters) {
    // Default view (any region, no active filters): rank by signal score.
    list = list.map((it) => ({ it, score: signalScore(it) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, HOT_LIMIT)
      .map(({ it }) => it);
  }

  return list;
}

const KEY_SIGNALS_COUNT = 10;

function render() {
  const body = document.getElementById("gamePanelBody");
  const keyPanel = document.getElementById("gameKeySignalsPanel");
  const keyBody = document.getElementById("gameKeySignalsBody");
  const list = currentList();
  const title = document.getElementById("gamePanelTitle");
  const eyebrow = document.getElementById("gamePanelEyebrow");

  if (!list.length) {
    keyPanel.hidden = true;
    body.innerHTML = `<div class="empty-state">No game news matches this view yet.</div>`;
    if (state.region === "ALL") {
      title.textContent = "Top Game Signals";
      eyebrow.textContent = "TOP SIGNALS · ranked by recency × source × event type";
    } else {
      title.textContent = `${REGION_LABELS[state.region]} Game Signals`;
      eyebrow.textContent = `${REGION_LABELS[state.region].toUpperCase()} SIGNALS`;
    }
    return;
  }

  // Any region, no active filters: Key Signals panel + More Signals below
  const isDefaultView = !state.contentType && !state.sourceType && !state.specificSource
    && !state.dateFrom && !state.query;

  const regionLabel = state.region === "ALL" ? "" : `${REGION_LABELS[state.region]} `;

  if (isDefaultView && list.length > KEY_SIGNALS_COUNT) {
    const featured = list.slice(0, KEY_SIGNALS_COUNT);
    const rest     = list.slice(KEY_SIGNALS_COUNT);
    keyPanel.hidden = false;
    keyBody.innerHTML = featured.map(renderFeaturedItem).join("");
    body.innerHTML = `<div class="game-item-list">${rest.map(renderItem).join("")}</div>`;
    title.textContent = `More ${regionLabel}Signals`;
    eyebrow.textContent = `${regionLabel.toUpperCase().trim() || "FULL"} FEED`;
  } else {
    keyPanel.hidden = true;
    body.innerHTML = `<div class="game-item-list">${list.map(renderItem).join("")}</div>`;
    title.textContent = `${regionLabel}Game Signals`;
    eyebrow.textContent = `${regionLabel.toUpperCase().trim() || "TOP"} SIGNALS`;
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
  const countryRegionCount = Object.keys(REGION_LABELS).filter(
    (code) => !["ALL", "GLOBAL", "OTHERS", "MISC"].includes(code)
  ).length;
  document.getElementById("gameStatCount").textContent = state.items.length.toLocaleString();
  document.getElementById("gameStatSources").textContent = String(sourceCount);
  document.getElementById("gameStatRegions").textContent = String(countryRegionCount);
  document.getElementById("gameUpdatedLabel").textContent = data.generated_at
    ? formatDDMMMYYYY(new Date(data.generated_at))
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

  // Load Sensor Tower rank index in the background — non-blocking.
  // First render uses Phase 1 scores only; re-renders with ST bonus once loaded.
  // Fails silently if the file is missing (e.g. fresh clone without the data/).
  fetchJson(ST_RANK_URL)
    .then((rankData) => {
      const stEntries = buildStIndex(rankData);
      state.stBonus = precomputeStBonuses(state.items, stEntries);
      const { bonus: msBonus, sourceCount: msSources } = computeMultiSourceBonus(state.items, stEntries);
      state.multiSourceBonus = msBonus;
      state.multiSourceSources = msSources;
      if (state.stBonus.size > 0 || state.multiSourceBonus.size > 0) render();
    })
    .catch(() => { /* no ST index — Phase 1 scores remain in effect */ });
}

document.addEventListener("DOMContentLoaded", init);
