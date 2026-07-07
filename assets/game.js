// Game News Radar frontend.
//
// Reads data/game-news.json (built by scripts/build_game_news.py from a
// one-time historical seed, see data/game-news-seed.json). Not a live 24h
// feed yet: ranking is recency-only and region coverage outside China/Others
// is near-empty until dedicated SEA sources exist. Kept deliberately
// separate from assets/app.js so this page can iterate without risking the
// AI News page.

const DATA_URL = "./data/game-news.json";
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

const state = {
  items: [],
  byRegion: {},
  region: "ALL",
  contentType: "",
  query: "",
};

function formatDate(iso) {
  if (!iso) return "Undated";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "Undated";
  return d.toISOString().slice(0, 10);
}

function escapeHtml(str) {
  return String(str || "").replace(/[&<>"']/g, (ch) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]
  ));
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

  if (state.query) {
    list = list.filter((it) => matchesQuery(it, state.query));
  }

  if (state.region === "ALL" && !state.contentType && !state.query) {
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

  document.getElementById("gameSearch").addEventListener("input", (evt) => {
    state.query = evt.target.value.trim();
    render();
  });
}

async function init() {
  wireControls();
  try {
    const res = await fetch(`${DATA_URL}?t=${Date.now()}`, { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    state.items = data.items || [];
    state.byRegion = data.by_region || {};

    const sourceCount = new Set(state.items.map((it) => it.site_id)).size;
    document.getElementById("gameStatCount").textContent = state.items.length.toLocaleString();
    document.getElementById("gameStatSources").textContent = String(sourceCount);
    document.getElementById("gameUpdatedLabel").textContent = data.generated_at
      ? new Date(data.generated_at).toISOString().slice(0, 10)
      : "Unknown";

    const pill = document.getElementById("gameStatusPill");
    pill.textContent = "Historical backfill (not live yet)";
    pill.classList.remove("warn");

    updateTabCounts();
    render();
  } catch (err) {
    document.getElementById("gamePanelBody").innerHTML =
      `<div class="empty-state">Could not load game news data (${escapeHtml(err.message)}).</div>`;
    document.getElementById("gameStatusPill").textContent = "Load failed";
  }
}

document.addEventListener("DOMContentLoaded", init);
