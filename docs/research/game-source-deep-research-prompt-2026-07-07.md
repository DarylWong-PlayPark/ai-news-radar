# Game News Source Deep Research Prompt

Use this prompt in GPT/Gemini Deep Research to expand the Game News source
inventory without directly bulk-importing noisy or duplicate sources into the
live crawler.

## Prompt

You are helping build a canonical source inventory for a static "Game News
Radar" site and crawl pipeline.

The current site is not a generic gaming database. It is a curated, crawlable
news pipeline. Your job is to find and normalize high-signal, crawlable gaming
news sources for the regions below, while avoiding duplicates and avoiding
sources that are operationally expensive to maintain.

Primary target regions:
- Thailand
- Philippines
- Vietnam
- Singapore
- Malaysia
- Indonesia
- China

Secondary watchlist regions:
- Taiwan
- Korea

Important constraints:
- Prefer crawlable websites first.
- Prefer RSS, Atom, or stable newsroom/news/blog pages with timestamps.
- Avoid login-gated sources, cookie-gated sources, browser-only flows, and
  sources that require heavy JavaScript rendering unless there is no practical
  alternative.
- Do not recommend bulk-importing social media/video/community sources into the
  default crawler. Keep those in a separate optional lane.
- X/Twitter is allowed only as an optional advanced lane, not the default
  public crawler. If you include X/Twitter ideas, separate them clearly and
  prefer public generated feeds or narrowly-scoped official API patterns over a
  raw firehose.
- Treat repeated publisher/newsroom links across multiple country lists as ONE
  canonical source family, not multiple different sources.

Current live Game News sources already in the pipeline:
- GamingPH.com -> https://gamingph.com/feed/
- Gaming Pinas -> https://gamingpinas.com/feed/
- Pokde.Net -> https://pokde.net/feed
- GamingDose -> https://www.gamingdose.com/feed/
- GameStation.co.id -> https://gamestation.co.id/feed/
- Gamebrott.com -> https://gamebrott.com/feed/
- Gamelade -> https://gamelade.vn/feed/

Current broad/general sources already reused by the Game pipeline:
- TopHub
- Iris / Info Flow
- Buzzing
- TechURLs
- NewsNow
- Zeli

Known existing duplication families already observed across region lists:
- PlayStation
- 2K
- Capcom
- Century Games
- Com2uS
- Devsisters
- Gravity
- Krafton
- Larian Studios
- Liquipedia
- NCSoft
- Nexon
- Neowiz
- Pearl Abyss
- Perfect World
- Playrix
- Rockstar Games
- Shift Up
- Square Enix
- Valve
- Warner Bros Games
- Kakao Games
- Kuro Games

Source-selection objective:
Build a canonical source inventory that can later be reviewed and admitted into
the crawler in stages. Do not assume every source should be added.

I want you to separate the output into four buckets:

1. Add-now candidates
Only sources that are all of the following:
- crawlable
- stable
- timestamped
- not obviously duplicate of an already-known canonical source
- either RSS/Atom directly, or a stable newsroom/news/blog page that can be
  fetched without browser automation

2. Feed-discovery candidates
Good websites, but RSS/Atom/feed path is not immediately obvious. These are
worth manual verification later.

3. Optional advanced / social / community lane
X/Twitter accounts, YouTube channels, Facebook pages, Discord/community/forum
sites, livestream/video platforms, or other high-noise/high-maintenance paths.
These should NOT be part of the default public crawler.

4. Skip / duplicate / low-fit
Sources that are duplicate of something stronger, not reliably crawlable, too
noisy, too community-driven, too marketplace/app-store-like, or otherwise poor
fits for a public default pipeline.

For every recommended source, return these fields in a table:
- region
- source_name
- canonical_source_family
- homepage_url
- best_crawl_url
- crawl_type (`rss`, `atom`, `stable newsroom page`, `blog page`, `json`, `social optional`, `skip`)
- source_class (`regional game media`, `official publisher newsroom`, `platform/store newsroom`, `mixed tech portal`, `community`, `social`, `video`, `wiki`, `aggregator`)
- language
- timestamps_visible (`yes` / `no` / `unclear`)
- login_required (`no` / `yes` / `unclear`)
- heavy_js_risk (`low` / `medium` / `high`)
- duplicate_of_existing_source (`yes` / `no` / `possible`)
- recommended_action (`add_now`, `feed_discovery`, `optional_social`, `skip`)
- rationale

Important dedupe rules:
- If the same publisher/newsroom appears in multiple country lists, collapse it
  into one canonical source family and note the regional variants instead of
  listing it as a separate source each time.
- Prefer the most canonical news URL. For example, use a newswire/newsroom/blog
  page instead of a generic corporate homepage when possible.
- Separate "regional editorial media" from "global publisher/platform
  newsrooms." They serve different roles and should not be mixed together.

Output expectations:
- Keep the list manageable and opinionated.
- For each primary region, prioritize the best 10-20 crawlable website
  candidates, not every possible site on the internet.
- For secondary watchlist regions (Taiwan, Korea), provide high-signal
  candidates, but mark them clearly as watchlist/phase-2 if they are outside
  the current UI scope.
- Include a short section at the end:
  - "Best immediate additions"
  - "Best RSS/Atom wins"
  - "Likely duplicate families to collapse"
  - "Optional X/Twitter lane"
  - "Risky sources not worth default crawl"

Do not give vague suggestions. I need concrete, crawlable source candidates
with URLs and a recommendation on whether they belong in the default public
pipeline.
