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
};
const HOT_LIMIT = 200;

const state = {
  items: [],
  byRegion: {},
  region: "ALL",
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
  return `
    <a class="game-item-row" href="${url}" target="_blank" rel="noopener noreferrer">
      <span class="game-item-title">${title}</span>
      <span class="game-item-meta">
        <span class="game-item-source">${source}</span>
        <span class="game-item-region">${regionLabel}</span>
        <span class="game-item-date">${date}</span>
      </span>
    </a>`;
}

function currentList() {
  let list = state.items;
  if (state.region !== "ALL") {
    list = list.filter((it) => it.region === state.region);
  }
  if (state.query) {
    const q = state.query.toLowerCase();
    list = list.filter((it) =>
      String(it.title || "").toLowerCase().includes(q) ||
      String(it.source || "").toLowerCase().includes(q)
    );
  }
  if (state.region === "ALL" && !state.query) {
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
    eyebrow.textContent = "TOP SIGNALS (MOST RECENT)";
  } else {
    title.textContent = `${REGION_LABELS[state.region]} Game Signals`;
    eyebrow.textContent = `${REGION_LABELS[state.region].toUpperCase()} SIGNALS`;
  }
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

    render();
  } catch (err) {
    document.getElementById("gamePanelBody").innerHTML =
      `<div class="empty-state">Could not load game news data (${escapeHtml(err.message)}).</div>`;
    document.getElementById("gameStatusPill").textContent = "Load failed";
  }
}

document.addEventListener("DOMContentLoaded", init);
