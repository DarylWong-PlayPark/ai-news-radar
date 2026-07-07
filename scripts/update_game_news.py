#!/usr/bin/env python3
"""Live, recurring Game News fetch pipeline.

Reuses the existing general-purpose scrapers from update_news.py (TopHub,
Iris, Buzzing, TechURLs, NewsNow, Zeli - all broad "what's trending" sources
that happen to carry real game content alongside everything else) for
China/global coverage, plus a config-driven generic RSS fetcher
(scripts/game_sources.py) for dedicated single-country SEA outlets.

Unlike update_news.py's main pipeline, nothing here is gated by AI relevance
scoring - the quality gate is the game-keyword + junk-source rules in
scripts/game_news_classify.py instead.

State model: maintains a rolling window (default ~110 days, enough to cover
"last quarter" plus buffer) across runs. On the very first run (no previous
output to load), bootstraps from the historical seed
(data/game-news-seed.json) so the live feed doesn't start empty. Output is
intended to be committed to a dedicated orphan branch (see
.github/workflows/update-game-news.yml), NOT accumulated into master's
history - that's the exact git-bloat mistake the AI News pipeline made.

Usage:
  python scripts/update_game_news.py --output data/game-news.json \
      [--previous PATH] [--seed data/game-news-seed.json] \
      [--retention-days 110]
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(Path(__file__).resolve().parent))

import requests  # noqa: E402

from game_news_classify import (  # noqa: E402
    REGION_ORDER,
    classify_and_tag,
    dedupe_by_title,
    event_time_str,
    is_junk,
)
from game_sources import SEA_RSS_SOURCES  # noqa: E402
from update_news import (  # noqa: E402
    RawItem,
    fetch_buzzing,
    fetch_iris,
    fetch_newsnow,
    fetch_techurls,
    fetch_tophub,
    fetch_zeli,
    parse_date_any,
)

try:
    import feedparser
except ImportError:  # pragma: no cover
    feedparser = None

DEFAULT_RETENTION_DAYS = 110
DEFAULT_TRANSLATE_MAX_NEW = 800  # ~60s/run in testing; backfills the historical backlog in ~1-2 weeks


def translate_to_en(session: requests.Session, text: str) -> str | None:
    """Free, keyless Google Translate web endpoint, auto-detecting source language.

    Same trick already used by translate_to_zh_cn() in update_news.py (no API
    key/billing needed) - just pointed at tl=en instead of tl=zh-CN, since
    game sources span Chinese, Thai, Vietnamese, and Indonesian. If the text
    is already English, Google returns it unchanged, which we treat as "no
    translation needed" rather than a failure.
    """
    s = (text or "").strip()
    if not s:
        return None
    try:
        r = session.get(
            "https://translate.googleapis.com/translate_a/single",
            params={"client": "gtx", "sl": "auto", "tl": "en", "dt": "t", "q": s},
            timeout=12,
        )
        r.raise_for_status()
        payload = r.json()
        if not isinstance(payload, list) or not payload:
            return None
        segs = payload[0]
        if not isinstance(segs, list):
            return None
        translated = "".join(str(seg[0]) for seg in segs if isinstance(seg, list) and seg and seg[0])
        translated = translated.strip()
        if translated and translated != s:
            return translated
    except Exception:  # noqa: BLE001
        return None
    return None

# Broad "what's trending" scrapers - not game-specific, so every item goes
# through the same quality gate as everything else in game_news_classify.
GENERIC_TASKS = [
    ("tophub", "TopHub", fetch_tophub),
    ("iris", "Info Flow", fetch_iris),
    ("buzzing", "Buzzing", fetch_buzzing),
    ("techurls", "TechURLs", fetch_techurls),
    ("newsnow", "NewsNow", fetch_newsnow),
    ("zeli", "Zeli", fetch_zeli),
]


def fetch_rss_source(session: requests.Session, source: dict[str, Any], now: datetime) -> list[RawItem]:
    """Generic single-feed RSS/Atom fetcher driven by game_sources.py config."""
    if feedparser is None:
        raise RuntimeError("feedparser is required for SEA RSS sources")

    resp = session.get(source["feed_url"], timeout=30, headers={"User-Agent": "ai-news-radar-game-bot/1.0"})
    resp.raise_for_status()
    parsed = feedparser.parse(resp.content)

    out: list[RawItem] = []
    for entry in parsed.entries:
        title = str(entry.get("title", "")).strip()
        url = str(entry.get("link", "")).strip()
        if not title or not url:
            continue
        published = (
            parse_date_any(entry.get("published"), now)
            or parse_date_any(entry.get("updated"), now)
            or parse_date_any(entry.get("pubDate"), now)
        )
        out.append(
            RawItem(
                site_id=source["site_id"],
                site_name=source["site_name"],
                source=source["site_name"],
                title=title,
                url=url,
                published_at=published,
                meta={"region_override": source["region"], "source_dedicated": source.get("dedicated", False)},
            )
        )
    return out


def run_all_fetchers(now: datetime) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    session = requests.Session()
    raw_records: list[dict[str, Any]] = []
    statuses: list[dict[str, Any]] = []

    tasks: list[tuple[str, str, Any]] = list(GENERIC_TASKS)
    for source in SEA_RSS_SOURCES:
        tasks.append((source["site_id"], source["site_name"], source))

    for site_id, site_name, fn_or_config in tasks:
        start = time.perf_counter()
        error = None
        count = 0
        try:
            if isinstance(fn_or_config, dict):
                items = fetch_rss_source(session, fn_or_config, now)
            else:
                items = fn_or_config(session, now)
            count = len(items)
            for item in items:
                raw_records.append(
                    {
                        "id": f"{item.site_id}::{item.url}",
                        "site_id": item.site_id,
                        "site_name": item.site_name,
                        "source": item.source,
                        "title": item.title,
                        "url": item.url,
                        "published_at": item.published_at.isoformat() if item.published_at else None,
                        "region_override": item.meta.get("region_override"),
                        "source_dedicated": item.meta.get("source_dedicated", False),
                    }
                )
        except Exception as exc:  # noqa: BLE001
            error = str(exc)
        elapsed_ms = int((time.perf_counter() - start) * 1000)
        statuses.append(
            {
                "site_id": site_id,
                "site_name": site_name,
                "ok": error is None,
                "item_count": count,
                "duration_ms": elapsed_ms,
                "error": error,
            }
        )

    return raw_records, statuses


def load_json(path: Path) -> dict[str, Any] | None:
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:  # noqa: BLE001
        return None


def merge_into_archive(
    archive: dict[str, dict[str, Any]], fresh_records: list[dict[str, Any]], now: datetime
) -> None:
    now_iso = now.isoformat()
    for record in fresh_records:
        item_id = record["id"]
        existing = archive.get(item_id)
        if existing is None:
            record = dict(record)
            record["first_seen_at"] = now_iso
            record["last_seen_at"] = now_iso
            archive[item_id] = record
        else:
            existing.update({k: v for k, v in record.items() if k != "first_seen_at"})
            existing["last_seen_at"] = now_iso


def prune_archive(archive: dict[str, dict[str, Any]], now: datetime, retention_days: int) -> None:
    keep_after = now - timedelta(days=retention_days)
    stale = []
    for item_id, record in archive.items():
        ts_str = record.get("last_seen_at") or record.get("published_at") or record.get("first_seen_at")
        try:
            ts = datetime.fromisoformat(str(ts_str).replace("Z", "+00:00"))
        except (TypeError, ValueError):
            ts = now
        if ts < keep_after:
            stale.append(item_id)
    for item_id in stale:
        del archive[item_id]


def translate_new_titles(
    archive: dict[str, dict[str, Any]], max_new: int, max_workers: int = 12
) -> int:
    """Fill in title_en for surviving (non-junk) archive records missing it.

    The key's mere presence (even set to None) marks "translation attempted"
    so an already-English or untranslatable title isn't retried forever -
    each item only ever costs one translation call across its whole
    lifetime in the archive, regardless of how many runs it survives. Only
    translates records that pass is_junk (no point translating items that
    won't be shown), and parallelizes since a fresh deploy has a large
    one-time backlog to catch up on.
    """
    candidates = [
        record for record in archive.values()
        if "title_en" not in record and not is_junk(record)
    ]
    # Prioritize the most recent items first - dict iteration order is
    # insertion order (oldest-discovered first), which would otherwise
    # translate old, rarely-viewed items before the ones actually showing
    # at the top of the Hot tab.
    candidates.sort(key=event_time_str, reverse=True)
    candidates = candidates[:max_new]
    if not candidates:
        return 0

    def worker(record: dict[str, Any]) -> None:
        session = requests.Session()
        record["title_en"] = translate_to_en(session, str(record.get("title") or ""))

    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        list(executor.map(worker, candidates))
    return len(candidates)


def bootstrap_archive_from_seed(seed_path: Path) -> dict[str, dict[str, Any]]:
    seed = load_json(seed_path)
    if not seed:
        return {}
    archive: dict[str, dict[str, Any]] = {}
    for record in seed.get("items", []):
        item_id = f"{record.get('site_id')}::{record.get('url')}"
        entry = dict(record)
        entry.setdefault("first_seen_at", record.get("first_seen_at") or record.get("last_seen_at"))
        entry.setdefault("last_seen_at", record.get("last_seen_at") or record.get("first_seen_at"))
        archive[item_id] = entry
    return archive


def build(
    output_path: Path,
    state_path: Path,
    previous_state_path: Path | None,
    seed_path: Path | None,
    retention_days: int,
    translate_max_new: int,
) -> None:
    now = datetime.now(timezone.utc)

    previous_state = load_json(previous_state_path) if previous_state_path else None
    if previous_state and previous_state.get("archive"):
        archive: dict[str, dict[str, Any]] = previous_state["archive"]
    elif seed_path:
        print(f"No previous state found, bootstrapping from {seed_path}", file=sys.stderr)
        archive = bootstrap_archive_from_seed(seed_path)
    else:
        archive = {}

    fresh_records, statuses = run_all_fetchers(now)
    merge_into_archive(archive, fresh_records, now)
    prune_archive(archive, now, retention_days)

    translated_count = translate_new_titles(archive, translate_max_new)
    print(f"Translated {translated_count} new title(s) to English", file=sys.stderr)

    kept = [classify_and_tag(record) for record in archive.values() if not is_junk(record)]
    kept.sort(key=event_time_str, reverse=True)
    kept, duplicate_count = dedupe_by_title(kept)

    by_region = {code: 0 for code in REGION_ORDER}
    for item in kept:
        by_region[item["region"]] += 1

    ok_sources = sum(1 for s in statuses if s["ok"])
    payload = {
        "generated_at": now.isoformat(),
        "generated_note": (
            f"Live pipeline (scripts/update_game_news.py), rolling {retention_days}-day window. "
            "Ranking is recency-only as a first pass."
        ),
        "retention_days": retention_days,
        "total_items_kept": len(kept),
        "dropped_as_duplicate": duplicate_count,
        "by_region": by_region,
        "source_health": {
            "ok_count": ok_sources,
            "total_count": len(statuses),
            "sources": statuses,
        },
        "items": kept,
    }

    # State (raw archive, pre quality-gate) is written separately from the
    # public payload above - game.html never needs to download it, only the
    # next run reads it back for state continuity across commits.
    state_payload = {
        "generated_at": now.isoformat(),
        "retention_days": retention_days,
        "archive": archive,
    }

    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    state_path.parent.mkdir(parents=True, exist_ok=True)
    state_path.write_text(json.dumps(state_payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Archive size: {len(archive)} items, kept {len(kept)} after quality gate -> {output_path}")
    print(f"State written -> {state_path}")
    print(f"Source health: {ok_sources}/{len(statuses)} healthy")
    for status in statuses:
        flag = "OK" if status["ok"] else f"FAIL ({status['error']})"
        print(f"  {status['site_name']:<20} {status['item_count']:>5} items  {status['duration_ms']:>6}ms  {flag}")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=REPO_ROOT / "data" / "game-news.json",
                         help="Public payload game.html fetches")
    parser.add_argument("--state", type=Path, default=REPO_ROOT / "data" / "game-news-state.json",
                         help="Raw archive written for the next run to read back")
    parser.add_argument("--previous-state", type=Path, default=None,
                         help="Prior run's --state file, for state continuity across commits")
    parser.add_argument(
        "--seed", type=Path, default=REPO_ROOT / "data" / "game-news-seed.json",
        help="Bootstrap source used only when --previous-state is missing/empty",
    )
    parser.add_argument("--retention-days", type=int, default=DEFAULT_RETENTION_DAYS)
    parser.add_argument("--translate-max-new", type=int, default=DEFAULT_TRANSLATE_MAX_NEW,
                         help="Cap on new title translations per run, to avoid rate-limiting the free endpoint")
    args = parser.parse_args()
    build(args.output, args.state, args.previous_state, args.seed, args.retention_days, args.translate_max_new)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
