#!/usr/bin/env python3
"""One-time processor for the historical seed (data/game-news-seed.json).

Superseded by scripts/update_game_news.py, which is the live, recurring
pipeline going forward (see docs/SOURCE_COVERAGE.md). This script is kept so
the historical seed can still be reprocessed on its own if needed - it shares
its quality-gate and classification rules with the live pipeline via
scripts/game_news_classify.py so the two never disagree.

Usage: python scripts/build_game_news.py [--input PATH] [--output PATH]
"""
from __future__ import annotations

import argparse
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from game_news_classify import (
    REGION_ORDER,
    classify_and_tag,
    dedupe_by_title,
    event_time_str,
    is_junk,
)

REPO_ROOT = Path(__file__).resolve().parent.parent


def build(input_path: Path, output_path: Path) -> None:
    raw = json.loads(input_path.read_text(encoding="utf-8"))
    raw_items = raw.get("items", [])

    kept: list[dict[str, Any]] = [
        classify_and_tag(record) for record in raw_items if not is_junk(record)
    ]
    kept.sort(key=event_time_str, reverse=True)
    kept, duplicate_count = dedupe_by_title(kept)

    by_region = {code: 0 for code in REGION_ORDER}
    for item in kept:
        by_region[item["region"]] += 1

    payload = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "generated_note": (
            "Built from a one-time historical seed (data/game-news-seed.json). "
            "Superseded by scripts/update_game_news.py going forward."
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
        print(f"  {code:<8} {by_region[code]}")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, default=REPO_ROOT / "data" / "game-news-seed.json")
    parser.add_argument("--output", type=Path, default=REPO_ROOT / "data" / "game-news.json")
    args = parser.parse_args()
    build(args.input, args.output)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
