#!/usr/bin/env python3
"""Generate RSS feed for Steam deals."""

from __future__ import annotations

import json
import sys
from datetime import datetime, timezone
from email.utils import format_datetime
from pathlib import Path
from xml.sax.saxutils import escape

ROOT = Path(__file__).resolve().parents[1]
DATA_FILE = ROOT / "data" / "games.json"
FEED_FILE = ROOT / "docs" / "feed.xml"
SITE_URL = "https://steam-deals.henrylok.me/"


def parse_dt(value: str | None) -> datetime:
    if not value:
        return datetime.now(timezone.utc)
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def is_new_today(game: dict, now: datetime) -> bool:
    first_seen = game.get("first_seen")
    if not first_seen:
        return False
    seen = parse_dt(first_seen)
    return (now - seen).total_seconds() <= 86400


def build_items(games: list[dict], now: datetime) -> list[dict]:
    items: list[dict] = []
    seen_ids: set[int] = set()

    for game in games:
        if not game.get("is_active"):
            continue
        app_id = int(game["app_id"])
        if app_id in seen_ids:
            continue

        include = game.get("offer_type") == "free" or is_new_today(game, now)
        if not include:
            continue

        seen_ids.add(app_id)
        items.append(
            {
                "title": game.get("name", f"App {app_id}"),
                "link": game.get("steam_url") or f"https://store.steampowered.com/app/{app_id}/",
                "description": game.get("short_description") or "",
                "pub_date": parse_dt(game.get("first_seen")),
                "guid": str(app_id),
            }
        )

    items.sort(key=lambda item: item["pub_date"], reverse=True)
    return items


def render_feed(items: list[dict], updated_at: str) -> str:
    updated = parse_dt(updated_at)
    lines = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<rss version="2.0">',
        "<channel>",
        f"<title>{escape('Steam Deals Tracker')}</title>",
        f"<link>{escape(SITE_URL)}</link>",
        f"<description>{escape('Temporarily free and newly added Steam deals.')}</description>",
        f"<lastBuildDate>{format_datetime(updated)}</lastBuildDate>",
    ]

    for item in items:
        lines.extend(
            [
                "<item>",
                f"<title>{escape(item['title'])}</title>",
                f"<link>{escape(item['link'])}</link>",
                f"<guid isPermaLink=\"false\">{escape(item['guid'])}</guid>",
                f"<pubDate>{format_datetime(item['pub_date'])}</pubDate>",
                f"<description>{escape(item['description'])}</description>",
                "</item>",
            ]
        )

    lines.extend(["</channel>", "</rss>"])
    return "\n".join(lines) + "\n"


def main() -> int:
    payload = json.loads(DATA_FILE.read_text(encoding="utf-8"))
    games = payload.get("games") or []
    now = parse_dt(payload.get("updated_at"))
    items = build_items(games, now)
    FEED_FILE.write_text(render_feed(items, payload.get("updated_at") or now.isoformat()), encoding="utf-8")
    print(f"[info] Wrote {len(items)} RSS items to {FEED_FILE}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
