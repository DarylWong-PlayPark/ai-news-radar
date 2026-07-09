#!/usr/bin/env python3
"""Configurable source registry for the live Game News pipeline.

This is the ONE place to edit when adding or removing a plain RSS/Atom game
source - no new fetcher code needed. Each entry is fetched by the single
generic `fetch_rss_source()` function in update_game_news.py. Despite the
name, this now covers more than SEA: single-country outlets (SEA + Taiwan),
mixed general-news portals filtered by keyword, and confirmed hyperfocused
global gaming media (region="GLOBAL") - anything that's a plain RSS/Atom
feed belongs here; sites with no native feed go through the RSSHub bridge
in scripts/rsshub_sources.py instead.

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
  region    - authoritative region for every item from this source: a
              country code for single-country outlets (trust the source over
              keyword guessing), or "GLOBAL" for confirmed dedicated gaming
              media that isn't region-tied (kept separate from "Others",
              which is the generic/unclassified catch-all - see
              game_news_classify.py)
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

DIRECT_RSS_SOURCES: list[dict[str, Any]] = [
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
    # General-interest news sites, added as dedicated=False (2026-07-08):
    # each covers gaming rarely, but the existing TITLE_GAME_RE keyword gate
    # already filters a mixed feed down to just the game-relevant items (the
    # same mechanism proven on Pokde.Net above) - no new code needed, just
    # accept a low, high-precision trickle rather than rejecting the source
    # outright. Genuinely fills SG/MY, the thinnest regions.
    {
        "site_id": "mothership_sg",
        "site_name": "Mothership.sg",
        "feed_url": "https://mothership.sg/feed/",
        "region": "SG",
        "dedicated": False,
        "language": "en",
        "verified": "2026-07-08",
    },
    {
        "site_id": "siakapkeli",
        "site_name": "Siakap Keli",
        "feed_url": "https://siakapkeli.my/feed/",
        "region": "MY",
        "dedicated": False,
        "language": "ms",
        "verified": "2026-07-08",
    },
    {
        "site_id": "medcom",
        "site_name": "Medcom.id",
        "feed_url": "https://www.medcom.id/feed",
        "region": "ID",
        "dedicated": False,
        "language": "id",
        "verified": "2026-07-08",
    },
    {
        "site_id": "genmuda",
        "site_name": "Genmuda.com",
        "feed_url": "https://www.genmuda.com/feed/",
        "region": "ID",
        "dedicated": False,
        "language": "id",
        "verified": "2026-07-08",
    },
    {
        "site_id": "kaorinusantara",
        "site_name": "Kaori Nusantara",
        "feed_url": "https://www.kaorinusantara.or.id/feed",
        "region": "ID",
        "dedicated": False,
        "language": "id",
        "verified": "2026-07-08",
    },
    # More general-news portals, added same day, same dedicated=False
    # treatment, verified against live feeds first:
    # inet_detik 6/100, kontan_lifestyle 11/300, mediaindonesia 1/100 passed
    # the keyword gate with genuine hits; liputan6 and straitstimes showed
    # 0/50 and 0/10 in their current window (no ongoing cost to keeping them
    # wired in - see game_news_classify.py's is_junk for why a dry spell
    # isn't a problem). hardwarezone_sg 1/10 - Singapore's biggest tech/
    # gadget forum, same tier as Lowyat.
    {
        "site_id": "inet_detik",
        "site_name": "detikInet",
        "feed_url": "https://inet.detik.com/rss/",
        "region": "ID",
        "dedicated": False,
        "language": "id",
        "verified": "2026-07-08",
    },
    {
        "site_id": "kontan_lifestyle",
        "site_name": "Kontan Lifestyle",
        "feed_url": "https://lifestyle.kontan.co.id/rss/",
        "region": "ID",
        "dedicated": False,
        "language": "id",
        "verified": "2026-07-08",
    },
    {
        "site_id": "mediaindonesia",
        "site_name": "Media Indonesia",
        "feed_url": "https://mediaindonesia.com/feed/",
        "region": "ID",
        "dedicated": False,
        "language": "id",
        "verified": "2026-07-08",
    },
    {
        "site_id": "liputan6",
        "site_name": "Liputan6.com",
        "feed_url": "https://feed.liputan6.com/rss/news",
        "region": "ID",
        "dedicated": False,
        "language": "id",
        "verified": "2026-07-08",
    },
    {
        "site_id": "straitstimes",
        "site_name": "The Straits Times",
        "feed_url": "https://www.straitstimes.com/rss.xml",
        "region": "SG",
        "dedicated": False,
        "language": "en",
        "verified": "2026-07-08",
    },
    {
        "site_id": "hardwarezone_sg",
        "site_name": "HardwareZone.com.sg",
        "feed_url": "https://www.hardwarezone.com.sg/feed/",
        "region": "SG",
        "dedicated": False,
        "language": "en",
        "verified": "2026-07-08",
    },
    # Taiwan -巴哈姆特GNN, Taiwan's largest dedicated gaming news portal.
    # Also the reason TW is a first-class region now: it was being silently
    # miscategorized as China by the generic CJK fallback before this.
    {
        "site_id": "gnn_tw",
        "site_name": "巴哈姆特 GNN",
        "feed_url": "https://gnn.gamer.com.tw/rss_utf8.xml",
        "region": "TW",
        "dedicated": True,
        "language": "zh-tw",
        "verified": "2026-07-08",
    },
    # Confirmed hyperfocused global gaming media - region="GLOBAL" (not
    # "Others"), since these are already known-dedicated gaming journalism,
    # just not tied to one country. GameSpot, PocketGamer, and ClutchPoints
    # were checked the same day but dropped: GameSpot and PocketGamer are
    # Cloudflare-blocked (403), ClutchPoints is rate-limited (429).
    {
        "site_id": "pcgamer",
        "site_name": "PC Gamer",
        "feed_url": "https://www.pcgamer.com/rss/",
        "region": "GLOBAL",
        "dedicated": True,
        "language": "en",
        "verified": "2026-07-08",
    },
    {
        "site_id": "gamerant",
        "site_name": "Game Rant",
        "feed_url": "https://www.gamerant.com/feed/",
        "region": "GLOBAL",
        "dedicated": True,
        "language": "en",
        "verified": "2026-07-08",
    },
    {
        "site_id": "gamesradar",
        "site_name": "GamesRadar+",
        "feed_url": "https://www.gamesradar.com/feeds.xml",
        "region": "GLOBAL",
        "dedicated": True,
        "language": "en",
        "verified": "2026-07-08",
    },
    {
        "site_id": "polygon",
        "site_name": "Polygon",
        "feed_url": "https://www.polygon.com/feed/",
        "region": "GLOBAL",
        "dedicated": True,
        "language": "en",
        "verified": "2026-07-08",
    },
    {
        "site_id": "shacknews",
        "site_name": "Shacknews",
        "feed_url": "https://www.shacknews.com/feed/rss",
        "region": "GLOBAL",
        "dedicated": True,
        "language": "en",
        "verified": "2026-07-08",
    },
    {
        "site_id": "siliconera",
        "site_name": "Siliconera",
        "feed_url": "https://www.siliconera.com/feed/",
        "region": "GLOBAL",
        "dedicated": True,
        "language": "en",
        "verified": "2026-07-08",
    },
    {
        "site_id": "pockettactics",
        "site_name": "Pocket Tactics",
        "feed_url": "https://www.pockettactics.com/mainrss.xml",
        "region": "GLOBAL",
        "dedicated": True,
        "language": "en",
        "verified": "2026-07-08",
    },
    # ── Round 2 additions (2026-07-09) — 11 candidates researched, 8 verified ──
    # Failures: GamerBraves (403 Cloudflare), Gadget Pilipinas (403 Cloudflare),
    # VALO2ASIA (404 — no RSS feed exists). All 8 below returned 200 via curl.

    # Singapore — Geek Culture fills the dedicated-SG gap. Not a pure game
    # outlet, but the /games/ category feed isolates gaming content cleanly.
    {
        "site_id": "geekculture_sg",
        "site_name": "Geek Culture",
        "feed_url": "https://geekculture.co/games/feed/",
        "region": "SG",
        "dedicated": False,
        "language": "en",
        "verified": "2026-07-09",
    },
    # Thailand — GameMonday is a dedicated mobile/MMO outlet (ROV, Free Fire,
    # mobile anime RPG). Blognone covers platform policy, studio business, and
    # app store regulation — strong for "business" content type.
    {
        "site_id": "gamemonday",
        "site_name": "GameMonday",
        "feed_url": "https://www.gamemonday.com/feed/",
        "region": "TH",
        "dedicated": True,
        "language": "th",
        "verified": "2026-07-09",
    },
    {
        "site_id": "blognone",
        "site_name": "Blognone",
        "feed_url": "https://www.blognone.com/atom.xml",
        "region": "TH",
        "dedicated": False,
        "language": "th",
        "verified": "2026-07-09",
    },
    # Vietnam — Kenh14 is a major Vietnamese media network; the /sport.rss
    # category covers esports (VCS LoL, Arena of Valor, MLBB) alongside
    # traditional sport. dedicated=False so TITLE_GAME_RE keyword gate filters
    # the non-game sport items.
    {
        "site_id": "kenh14",
        "site_name": "Kenh14 Sport & Esports",
        "feed_url": "https://kenh14.vn/rss/sport.rss",
        "region": "VN",
        "dedicated": False,
        "language": "vi",
        "verified": "2026-07-09",
    },
    # Malaysia — Lowyat.NET gaming category. Malaysia's largest consumer tech
    # portal; gaming subsection covers platform news, console/PC launches,
    # regional market activities. GamerBraves (the dedicated MY outlet) was
    # 403 Cloudflare-blocked during verification.
    {
        "site_id": "lowyat",
        "site_name": "Lowyat.NET Gaming",
        "feed_url": "https://www.lowyat.net/category/gaming/feed/",
        "region": "MY",
        "dedicated": False,
        "language": "en",
        "verified": "2026-07-09",
    },
    # Philippines — Ungeek covers tech + gaming + geek culture; editorial team
    # with strong mobile and local event coverage.
    {
        "site_id": "ungeek",
        "site_name": "Ungeek",
        "feed_url": "https://www.ungeek.ph/feed/",
        "region": "PH",
        "dedicated": False,
        "language": "en",
        "verified": "2026-07-09",
    },
    # Global mobile — TouchArcade is the reference outlet for iOS/Android
    # gaming globally. Soft launches and mobile patches surface here first,
    # acting as an early indicator before SEA localised coverage catches up.
    {
        "site_id": "toucharcade",
        "site_name": "TouchArcade",
        "feed_url": "https://toucharcade.com/feed/",
        "region": "GLOBAL",
        "dedicated": True,
        "language": "en",
        "verified": "2026-07-09",
    },
    # Global esports — AFK Gaming covers mobile esports (MLBB, Wild Rift,
    # PUBG Mobile) with strong SEA team coverage that Western outlets skip.
    {
        "site_id": "afkgaming",
        "site_name": "AFK Gaming",
        "feed_url": "https://afkgaming.com/feed/",
        "region": "GLOBAL",
        "dedicated": True,
        "language": "en",
        "verified": "2026-07-09",
    },
]

# Singapore status as of 2026-07-09: Geek Culture (/games/ category feed)
# added as the closest functional dedicated-games outlet for SG. Still no
# unblocked pure-gaming outlet found — SCOGA (rsshub_sources.py), Mothership,
# Straits Times, HardwareZone, and Geek Culture remain the SG signal pool.
