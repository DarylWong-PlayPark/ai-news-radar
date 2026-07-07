#!/usr/bin/env python3
"""Configurable source registry for the live Game News pipeline.

This is the ONE place to edit when adding or removing a plain RSS/Atom game
source - no new fetcher code needed. Each entry is fetched by the single
generic `fetch_rss_source()` function in update_game_news.py.

Sources that need bespoke scraping (TopHub, Iris, etc.) are NOT config-driven
here - they're imported directly from scripts/update_news.py and wired in
update_game_news.py, since they aren't plain RSS feeds.

To add a source: append an entry below with a unique site_id.
To remove a source: delete its entry (or comment it out).

Fields:
  site_id   - short stable id, used in output data and dedup keys
  site_name - display name
  feed_url  - RSS/Atom feed URL, fetched directly (verified working via curl,
              no login/cookies/JS challenge as of the date noted)
  region    - authoritative region for every item from this source (these are
              single-country outlets, so trust the source over keyword
              guessing - unlike TopHub/Iris, which cover many countries and
              need per-item classification instead)
  dedicated - True if the ENTIRE site is game news (e.g. GamingPH.com), so
              the generic "does the title mention a game keyword" quality
              gate should be skipped - it exists to filter noise out of
              broad aggregators, and would otherwise wrongly drop real
              articles like "GTA 6 PSN Prices Revealed" just because the
              title doesn't literally say "game". False for mixed-topic
              portals like Pokde.Net, where that gate still earns its keep.
  language  - source language, informational only today
  verified  - date this feed URL was last confirmed to return valid XML
"""
from __future__ import annotations

from typing import Any

SEA_RSS_SOURCES: list[dict[str, Any]] = [
    {
        "site_id": "gamingph",
        "site_name": "GamingPH.com",
        "feed_url": "https://gamingph.com/feed/",
        "region": "PH",
        "dedicated": True,
        "language": "en",
        "verified": "2026-07-07",
    },
    {
        "site_id": "gamingpinas",
        "site_name": "Gaming Pinas",
        "feed_url": "https://gamingpinas.com/feed/",
        "region": "PH",
        "dedicated": True,
        "language": "en",
        "verified": "2026-07-07",
    },
    {
        "site_id": "pokde",
        "site_name": "Pokde.Net",
        "feed_url": "https://pokde.net/feed",
        "region": "MY",
        "dedicated": False,
        "language": "en",
        "verified": "2026-07-07",
    },
    {
        "site_id": "gamingdose",
        "site_name": "GamingDose",
        "feed_url": "https://www.gamingdose.com/feed/",
        "region": "TH",
        "dedicated": True,
        "language": "th",
        "verified": "2026-07-07",
    },
    {
        "site_id": "gamestation_id",
        "site_name": "GameStation.co.id",
        "feed_url": "https://gamestation.co.id/feed/",
        "region": "ID",
        "dedicated": True,
        "language": "id",
        "verified": "2026-07-07",
    },
    {
        "site_id": "gamebrott",
        "site_name": "Gamebrott.com",
        "feed_url": "https://gamebrott.com/feed/",
        "region": "ID",
        "dedicated": True,
        "language": "id",
        "verified": "2026-07-07",
    },
    {
        "site_id": "gamelade",
        "site_name": "Gamelade",
        "feed_url": "https://gamelade.vn/feed/",
        "region": "VN",
        "dedicated": True,
        "language": "vi",
        "verified": "2026-07-07",
    },
]

# No verified, unblocked RSS source exists for Singapore as of 2026-07-07
# (see docs/SOURCE_COVERAGE.md game-news research notes) - SG items will
# continue to fall through to keyword-based classification from other
# sources until one is found.
