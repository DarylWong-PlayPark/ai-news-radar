#!/usr/bin/env python3
"""Shared quality-gate + classification rules for Game News items.

Used by both build_game_news.py (one-time historical seed processing) and
update_game_news.py (the live pipeline), so the two never drift apart.

Region rule (in priority order):
  1. Recurring daily filler (Wordle/Quordle/Connections/Strands/"hints and
     answers" style posts) -> Misc, regardless of language or source.
  2. Source-level override - single-country outlets (game_sources.py) and
     confirmed hyperfocused global gaming media (region_override="GLOBAL")
     are trusted over guessing from text.
  3. Explicit SEA country name/city in the title or source -> that country.
  4. Explicit Taiwan name/city -> Taiwan (checked before the China fallback,
     since Taiwan content is also Chinese-script and would otherwise be
     miscategorized as China by the generic CJK catch-all).
  5. Explicit China marker, or CJK script in the title -> China.
  6. Otherwise -> Others. "Others" is the generic/unclassified catch-all;
     "Global" (via region_override, above) is reserved for sources already
     confirmed as dedicated gaming media that just aren't region-tied -
     e.g. Riot Games, PC Gamer - so the two don't blend together.
"""
from __future__ import annotations

import re
from typing import Any

# Source boards that are not game news even though a title matched the
# keyword regex (e-commerce, app charts, design portfolios, generic forums).
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
TW_PATTERN = re.compile(r"taiwan|台湾|臺灣|台北|高雄|巴哈姆特", re.I)
CN_PATTERN = re.compile(r"中国大陆|中国(?!台湾|香港)|国产游戏|大陆(?!.*(台|港))")
CJK_PATTERN = re.compile(r"[一-鿿]")

# Daily word/puzzle-game "hints and answers" posts. Tech media republishes
# these every day for a handful of named puzzle brands - it's filler, not
# game industry news. Matched on brand name OR generic recap phrasing so a
# new puzzle brand still gets caught.
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

# The seed matched a loose keyword regex against title+source combined,
# which lets a source/handle name merely containing "game" (e.g. a Twitter
# handle like "WoWGamerPVP") through even when the title has nothing to do
# with games. Re-check against the title alone as a quality gate.
TITLE_GAME_RE = re.compile(
    r"game|gaming|游戏|电竞|esport|手游|steam|playstation|\bps5\b|\bps4\b|xbox|nintendo|switch\b",
    re.I,
)

REGION_ORDER = ["CN", "TW", "TH", "PH", "VN", "SG", "MY", "ID", "GLOBAL", "OTHERS", "MISC"]
REGION_LABELS = {
    "CN": "China",
    "TW": "Taiwan",
    "TH": "Thailand",
    "PH": "Philippines",
    "VN": "Vietnam",
    "SG": "Singapore",
    "MY": "Malaysia",
    "ID": "Indonesia",
    "GLOBAL": "Global",
    "OTHERS": "Others",
    "MISC": "Misc",
}


def is_junk(record: dict[str, Any]) -> bool:
    source = str(record.get("source") or "")
    if any(marker in source for marker in JUNK_SOURCE_MARKERS):
        return True
    if record.get("source_dedicated"):
        # Entire site is game news (e.g. GamingPH.com) - trust it. The title
        # keyword gate below exists to filter noise out of broad aggregators
        # and would otherwise drop real articles like "GTA 6 PSN Prices
        # Revealed" just because the title doesn't literally say "game".
        return False
    title = str(record.get("title") or "")
    if not TITLE_GAME_RE.search(title):
        return True  # only matched via source/handle text, e.g. a "...Gamer..." username
    return False


def classify_region(record: dict[str, Any]) -> str:
    override = record.get("region_override")
    title = str(record.get("title") or "")
    blob = f"{title} {record.get('source', '')}"

    if MISC_PATTERN.search(title):
        return "MISC"
    if override:
        return override
    for code, _label, pattern in SEA_COUNTRY_PATTERNS:
        if re.search(pattern, blob, re.I):
            return code
    if TW_PATTERN.search(blob):
        return "TW"
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


def classify_and_tag(record: dict[str, Any]) -> dict[str, Any]:
    """Apply region + content_type tags to a copy of record. Does not dedupe/filter."""
    out = dict(record)
    region = classify_region(record)
    out["region"] = region
    out["region_label"] = REGION_LABELS[region]
    out["content_type"] = classify_content_type(record)
    return out


def dedupe_by_title(items: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], int]:
    """Drop same-title duplicates, keeping the first occurrence (call after sorting by recency)."""
    seen: set[str] = set()
    out: list[dict[str, Any]] = []
    dropped = 0
    for item in items:
        key = normalize_title_for_dedup(str(item.get("title") or ""))
        if key and key in seen:
            dropped += 1
            continue
        if key:
            seen.add(key)
        out.append(item)
    return out, dropped
