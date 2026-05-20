#!/usr/bin/env python3
"""One-off migration: split docs list JSON and per-app detail files."""

from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DOCS_DATA = ROOT / "docs" / "data"
ARCHIVE = ROOT / "data" / "games.json"
ACTIVE = DOCS_DATA / "games-active.json"
EXPIRED = DOCS_DATA / "games-expired.json"
LEGACY = DOCS_DATA / "games.json"

sys.path.insert(0, str(ROOT / "scripts"))
from fetch_games import (  # noqa: E402
    save_docs_json,
    strip_list_record,
    utc_now_iso,
    write_detail_files,
)


def load_games() -> list[dict]:
    if ARCHIVE.exists():
        payload = json.loads(ARCHIVE.read_text(encoding="utf-8"))
        return payload.get("games") or []

    games: dict[int, dict] = {}
    for path in (ACTIVE, EXPIRED, LEGACY):
        if not path.exists():
            continue
        payload = json.loads(path.read_text(encoding="utf-8"))
        for game in payload.get("games") or []:
            games[int(game["app_id"])] = game
    return list(games.values())


def main() -> int:
    games = load_games()
    if not games:
        print("[error] No games found to migrate", file=sys.stderr)
        return 1

    now = utc_now_iso()
    active = [game for game in games if game.get("is_active")]
    expired = [game for game in games if not game.get("is_active")]

    write_detail_files(games, DOCS_DATA / "details")
    save_docs_json(
        ACTIVE,
        {
            "updated_at": now,
            "total_count": len(active),
            "games": [strip_list_record(game) for game in active],
        },
    )
    save_docs_json(
        EXPIRED,
        {
            "updated_at": now,
            "total_count": len(expired),
            "games": [strip_list_record(game) for game in expired],
        },
    )

    active_kb = ACTIVE.stat().st_size / 1024
    print(f"[info] Migrated {len(games)} games ({len(active)} active, {len(expired)} expired)")
    print(f"[info] games-active.json: {active_kb:.0f} KB")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
