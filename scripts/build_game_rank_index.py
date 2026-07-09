#!/usr/bin/env python3
"""Convert a Sensor Tower top-games CSV export to a compact browser-ready JSON index.

Input:  data/SEA6 Jan2014 to Jul2026 Top 10000 Games.csv
        (UTF-16 LE, tab-separated, columns: Unified Name / Unified Publisher Name /
        Downloads (Absolute) / Revenue (Absolute); rank = row order, row 1 = #1 by revenue)

Output: data/game-rank-index.json
        Consumed by assets/game.js at page load to boost signal scores for news articles
        that mention a known high-revenue game. The CSV itself is gitignored (Sensor Tower
        data is proprietary); this derived JSON is the only artifact committed to master.

Usage:
    python scripts/build_game_rank_index.py [path/to/csv]

Re-run whenever you export a fresh file from Sensor Tower — the output is a static
snapshot and does not need to be regenerated on every pipeline run.
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

DEFAULT_CSV = Path("data/SEA6 Jan2014 to Jul2026 Top 10000 Games.csv")
OUT_PATH = Path("data/game-rank-index.json")

# Known publisher prefixes that appear in game names but aren't part of the
# searchable title (e.g. "Garena Free Fire" → also match on "Free Fire").
PUBLISHER_PREFIXES = {"garena", "line", "nexon", "bandai namco", "square enix"}


def normalize(name: str) -> str:
    """Lowercase + collapse punctuation to spaces for substring matching."""
    s = name.lower()
    # Remove common trademark symbols and punctuation that won't appear in article titles
    s = re.sub(r"[™®’‘™®:!?,.'`\-]", " ", s)
    s = re.sub(r"\s+", " ", s).strip()
    return s


def is_latin(s: str) -> bool:
    """True if the string contains mostly ASCII characters (not CJK/Korean/etc.)."""
    latin_chars = sum(1 for c in s if ord(c) < 128)
    return latin_chars / max(len(s), 1) >= 0.6


def needs_word_boundary(key: str) -> bool:
    """Short Latin keys must match as whole words to avoid false positives.

    'HIT' (rank 517) would otherwise match 'hits' or 'exhibit'.
    CJK keys are fine even if short — they won't accidentally substring-match
    inside unrelated words.
    """
    return len(key) <= 6 and is_latin(key)


def short_key(name_key: str) -> str | None:
    """Strip a known publisher prefix to generate a shorter alternate match key.

    e.g. 'garena free fire' → 'free fire'
    Returns None if no known prefix matches.
    """
    for prefix in PUBLISHER_PREFIXES:
        if name_key.startswith(prefix + " "):
            candidate = name_key[len(prefix) + 1:]
            if len(candidate) >= 4:  # skip if remainder is too short to be meaningful
                return candidate
    return None


def main(csv_path: Path = DEFAULT_CSV) -> None:
    if not csv_path.exists():
        print(f"ERROR: CSV not found at {csv_path}", file=sys.stderr)
        sys.exit(1)

    entries: list[dict] = []
    skipped = 0

    with open(csv_path, encoding="utf-16") as f:
        f.readline()  # skip header row

        for rank, line in enumerate(f, start=1):
            parts = line.rstrip("\n").split("\t")
            if len(parts) < 4:
                skipped += 1
                continue

            name = parts[0].strip()
            revenue_raw = parts[3].strip().replace(",", "")

            if not name:
                skipped += 1
                continue

            try:
                revenue = int(float(revenue_raw))
            except ValueError:
                revenue = 0

            key = normalize(name)
            alt = short_key(key)

            entry: dict = {"rank": rank, "name": name, "key": key, "revenue": revenue}
            if alt:
                entry["alt"] = alt
            if needs_word_boundary(key):
                entry["boundary"] = True
            entries.append(entry)

    out = {
        "source": "Sensor Tower SEA6 (TH+PH+VN+MY+SG+ID) Jan2014-Jul2026 revenue-ranked",
        "count": len(entries),
        "entries": entries,
    }

    OUT_PATH.write_text(
        json.dumps(out, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )
    print(f"OK: {len(entries)} entries written to {OUT_PATH} (skipped {skipped} malformed rows)")


if __name__ == "__main__":
    csv_arg = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_CSV
    main(csv_arg)
