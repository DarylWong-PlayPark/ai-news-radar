#!/usr/bin/env python3
"""Curated RSSHub bridge source registry - the private optional bridge layer.

Kept deliberately separate from game_sources.py's direct-feed list: these
sites have no native RSS/Atom feed, so each entry here is turned into one by
RSSHub's built-in, no-fork-needed generic route
(/rsshub/transform/html/:url/:routeParams - see
https://github.com/DIYgod/RSSHub/blob/master/lib/routes/rsshub/transform/html.ts),
driven by hand-verified CSS selectors instead of RSSHub's community-maintained
native routes. That means WE own fixing selectors when a site's HTML changes -
there's no upstream community route to inherit a fix from.

Each entry was verified by hand on 2026-07-07: fetched directly (not via
RSSHub, which has no locally-runnable instance in a plain Python dev
environment) to confirm (a) not blocked by Cloudflare/bot-protection, and
(b) the given CSS selectors actually match real article listings in the raw
HTML. Sources that failed verification and were dropped for this pilot:
- Krafton (krafton.com/en/news/press) - HTTP 403
- Bandai Namco SEA (bandainamcoent.asia/sea/news) - HTTP 429 (rate limited)
- Singapore Games Association / SGGA (sgga.org.sg/news) - WildApricot SPA,
  news list is rendered client-side via React; RSSHub's plain transform/html
  route has no JS engine, so this would need the heavier chromium-bundled
  RSSHub image, which defeats the "lightweight" goal. Revisit if a headless
  variant is ever justified.

Selector fields map directly to RSSHub's transform/html route params:
  item           - CSS selector for each repeating article container
  item_title     - CSS selector for the title within an item
  item_link      - CSS selector for the link within an item (href by default)
  item_pub_date  - CSS selector for the publish date within an item (optional)

To add a source: verify it the same way (fetch directly, check for a 200
without a bot-challenge, inspect the HTML for a real repeating selector),
then append an entry. To remove one: delete its entry.
"""
from __future__ import annotations

from typing import Any

RSSHUB_BRIDGE_SOURCES: list[dict[str, Any]] = [
    {
        "site_id": "rsshub_riotgames",
        "site_name": "Riot Games News",
        "target_url": "https://www.riotgames.com/en/news",
        "region_override": "GLOBAL",  # confirmed dedicated gaming publisher, not region-tied
        "item": ".summary",
        "item_title": ".summary__overlay-link",
        "item_link": ".summary__overlay-link",
        "item_pub_date": None,  # not exposed in the listing HTML
        "verified": "2026-07-07",
    },
    {
        "site_id": "rsshub_scoga",
        "site_name": "SCOGA (Singapore Cyber-sports & Online Gaming Association)",
        "target_url": "https://scoga.org/news",
        "region_override": "SG",  # single-country outlet - trust the source over keyword guessing
        "item": ".w-dyn-item",
        "item_title": ".heading-14",
        "item_link": "a.button",
        "item_pub_date": ".paragraph-12",
        "verified": "2026-07-07",
    },
    {
        "site_id": "rsshub_zynga",
        "site_name": "Zynga News",
        "target_url": "https://www.zynga.com/news/",
        "region_override": "GLOBAL",  # confirmed dedicated gaming publisher, not region-tied
        "item": ".post",
        "item_title": ".title h2 a",
        "item_link": ".title h2 a",
        "item_pub_date": ".date",
        "verified": "2026-07-07",
    },
]
