#!/usr/bin/env python3
"""Build data/game-news.json (the file game.html reads) from a raw item pool.

Input today is the one-time historical seed (data/game-news-seed.json), which
was mined from git history and is intentionally raw/unfiltered. This script
is the quality gate + region classifier between that raw pool and anything
rendered on the public Game News page: it drops obvious non-news noise
(e-commerce listings, App Store charts, design portfolios) and tags each
surviving item with a region so game.html can filter by tab.

Region rule (in priority order):
  1. Recurring daily filler (Wordle/Quordle/Connections/Strands/"hints and
     answers" style posts) -> Misc, regardless of language. These are tech
     media reposting the same puzzle format daily, not game industry news.
  2. Explicit SEA country name/city in the title or source -> that country.
  3. Explicit China marker, or CJK script in the title -> China.
  4. Otherwise -> Others.
SEA sources are effectively absent from today's fetchers (see
docs/SOURCE_COVERAGE.md), so "Others" is expected to hold most items until
dedicated SEA sources are added.

Also tags a best-effort content_type (launch/update/business/platform/esports/
general) via keyword heuristics, and drops same-title duplicates that
different fetchers picked up under different site_ids (e.g. "少数派" and
"sspai" are the same outlet).

Usage: python scripts/build_game_news.py [--input PATH] [--output PATH]
"""
from __future__ import annotations

import argparse
import json
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parent.parent

# Source boards that are not game news even though a title matched the
# keyword regex during the raw seed extraction (e-commerce, app charts,
# design portfolios, generic forums).
JUNK_SOURCE_MARKERS = [
    "京东", "淘宝", "天猫", "拼多多", "苏宁",  # e-commerce bestseller lists
    "App Store",  # app ranking charts, not news
    "站酷",  # design-portfolio site
    "北大未名",  # general campus forum
]

SEA_COUNTRY_PATTERNS: list[tuple[str, str, str]] = [
    ("TH", "Thailand", r"thailand|\bthai\b|泰国|曼谷"),
    ("PH", "Philippines", r"philippines|filipino|菲律宾|马尼拉"),
    ("VN", "Vietnam", r"vietnam|越南|河内"),
    ("SG", "Singapore", r"singapore|新加坡"),
    ("MY", "Malaysia", r"malaysia|马来西亚|吉隆坡"),
    ("ID", "Indonesia", r"indonesia|印尼|印度尼西亚|雅加达"),
]
CN_PATTERN = re.compile(r"中国大陆|中国(?!台湾|香港)|国产游戏|大陆(?!.*(台|港))")
CJK_PATTERN = re.compile(r"[一-鿿]")

# Daily word/puzzle-game "hints and answers" posts. Tech media (TechRadar,
# Mashable, etc.) republishes these every single day for a handful of named
# puzzle brands - it's filler, not game industry news. Matched on brand name
# OR the generic recap phrasing so a new puzzle brand still gets caught.
MISC_PATTERN = re.compile(
    r"\b(wordle|quordle|octordle|connections|strands|nyt mini|spelling bee|"
    r"heardle|waffle|crossword)\b|hints and answers|answers for (monday|tuesday|"
    r"wednesday|thursday|friday|saturday|sunday)",
    re.I,
)

CONTENT_TYPE_PATTERNS: list[tuple[str, str]] = [
    ("launch", r"上线|发售|首发|公测|预约|首曝|launch|release[ds]?|out now|early access"),
    ("update", r"更新|补丁|改版|新赛季|dlc|hotfix|patch|update"),
    ("business", r"收购|投资|财报|营收|上市|裁员|acquisition|acquires|revenue|layoffs?|ipo|funding"),
    ("platform", r"steam|playstation|\bps5\b|\bps4\b|xbox|nintendo|switch\b|app store|平台|主机|store"),
    ("esports", r"电竞|esports?|赛事|冠军|锦标赛|tournament|championship"),
]

# The historical seed matched a loose keyword regex against title+source
# combined, which lets a source/handle name merely containing "game" (e.g. a
# Twitter handle like "WoWGamerPVP") through even when the title has nothing
# to do with games. Re-check against the title alone as a quality gate.
TITLE_GAME_RE = re.compile(
    r"game|gaming|游戏|电竞|esport|手游|steam|playstation|\bps5\b|\bps4\b|xbox|nintendo|switch\b",
    re.I,
)

REGION_ORDER = ["CN", "TH", "PH", "VN", "SG", "MY", "ID", "OTHERS", "MISC"]
REGION_LABELS = {
    "CN": "China",
    "TH": "Thailand",
    "PH": "Philippines",
    "VN": "Vietnam",
    "SG": "Singapore",
    "MY": "Malaysia",
    "ID": "Indonesia",
    "OTHERS": "Others",
    "MISC": "Misc",
}


def is_junk(record: dict[str, Any]) -> bool:
    source = str(record.get("source") or "")
    if any(marker in source for marker in JUNK_SOURCE_MARKERS):
        return True
    title = str(record.get("title") or "")
    if not TITLE_GAME_RE.search(title):
        return True  # only matched via source/handle text, e.g. a "...Gamer..." username
    return False


def classify_region(record: dict[str, Any]) -> str:
    title = str(record.get("title") or "")
    blob = f"{title} {record.get('source', '')}"
    if MISC_PATTERN.search(title):
        return "MISC"
    for code, _label, pattern in SEA_COUNTRY_PATTERNS:
        if re.search(pattern, blob, re.I):
            return code
    if CN_PATTERN.search(blob) or CJK_PATTERN.search(blob):
        return "CN"
    return "OTHERS"


def classify_content_type(record: dict[str, Any]) -> str:
    title = str(record.get("title") or "")
    for content_type, pattern in CONTENT_TYPE_PATTERNS:
        if re.search(pattern, title, re.I):
            return content_type
    return "general"


def event_time_str(record: dict[str, Any]) -> str:
    return str(record.get("published_at") or record.get("last_seen_at") or record.get("first_seen_at") or "")


def normalize_title_for_dedup(title: str) -> str:
    return re.sub(r"[^\w一-鿿]+", "", title).lower()


def build(input_path: Path, output_path: Path) -> None:
    raw = json.loads(input_path.read_text(encoding="utf-8"))
    raw_items = raw.get("items", [])

    kept: list[dict[str, Any]] = []
    for record in raw_items:
        if is_junk(record):
            continue
        region = classify_region(record)
        out = dict(record)
        out["region"] = region
        out["region_label"] = REGION_LABELS[region]
        out["content_type"] = classify_content_type(record)
        kept.append(out)

    kept.sort(key=event_time_str, reverse=True)

    seen_titles: set[str] = set()
    deduped: list[dict[str, Any]] = []
    duplicate_count = 0
    for item in kept:
        key = normalize_title_for_dedup(str(item.get("title") or ""))
        if key and key in seen_titles:
            duplicate_count += 1
            continue
        if key:
            seen_titles.add(key)
        deduped.append(item)
    kept = deduped

    by_region = {code: 0 for code in REGION_ORDER}
    for item in kept:
        by_region[item["region"]] += 1

    payload = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "generated_note": (
            "Built from a one-time historical seed (data/game-news-seed.json), "
            "not a live 24h feed yet. Ranking is recency-only as a first pass; "
            "revisit once dedicated SEA sources exist and a real 'hot' signal "
            "is defined."
        ),
        "total_items_considered": len(raw_items),
        "total_items_kept": len(kept),
        "dropped_as_junk_source": len(raw_items) - len(kept) - duplicate_count,
        "dropped_as_duplicate": duplicate_count,
        "by_region": by_region,
        "items": kept,
    }

    output_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Kept {len(kept)}/{len(raw_items)} items ({duplicate_count} duplicates dropped) -> {output_path}")
    for code in REGION_ORDER:
        print(f"  {REGION_LABELS[code]:<12} {by_region[code]}")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, default=REPO_ROOT / "data" / "game-news-seed.json")
    parser.add_argument("--output", type=Path, default=REPO_ROOT / "data" / "game-news.json")
    args = parser.parse_args()
    build(args.input, args.output)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
