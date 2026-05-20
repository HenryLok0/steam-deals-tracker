#!/usr/bin/env python3
"""Generate per-game static pages for OG/SEO."""

from __future__ import annotations

import html
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA_FILE = ROOT / "docs" / "data" / "games-active.json"
GAMES_DIR = ROOT / "docs" / "games"
SITEMAP_FILE = ROOT / "docs" / "sitemap.xml"
SITE = "https://steam-deals.henrylok.me"


def render_page(game: dict) -> str:
    app_id = int(game["app_id"])
    name = html.escape(game.get("name") or f"App {app_id}")
    desc = html.escape((game.get("short_description") or game.get("descriptions", {}).get("en") or "")[:300])
    image = html.escape(game.get("header_image") or "")
    page_url = f"{SITE}/games/{app_id}/"
    redirect = f"{SITE}/?app={app_id}"

    return f"""<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>{name} — Steam Deals Tracker</title>
    <meta name="description" content="{desc}" />
    <link rel="canonical" href="{page_url}" />
    <meta property="og:type" content="website" />
    <meta property="og:url" content="{page_url}" />
    <meta property="og:title" content="{name}" />
    <meta property="og:description" content="{desc}" />
    <meta property="og:image" content="{image}" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="{name}" />
    <meta name="twitter:description" content="{desc}" />
    <meta name="twitter:image" content="{image}" />
    <meta http-equiv="refresh" content="0;url={redirect}" />
  </head>
  <body>
    <p><a href="{redirect}">{name}</a></p>
  </body>
</html>
"""


def render_sitemap(urls: list[str]) -> str:
    lines = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
        f"  <url><loc>{SITE}/</loc><changefreq>daily</changefreq><priority>1.0</priority></url>",
        f"  <url><loc>{SITE}/feed.xml</loc><changefreq>daily</changefreq><priority>0.8</priority></url>",
    ]
    for url in urls:
        lines.append(
            f'  <url><loc>{html.escape(url)}</loc><changefreq>weekly</changefreq><priority>0.6</priority></url>'
        )
    lines.append("</urlset>")
    return "\n".join(lines) + "\n"


def main() -> int:
    if not DATA_FILE.exists():
        print(f"[warn] Missing {DATA_FILE}, skipping game pages")
        return 0

    payload = json.loads(DATA_FILE.read_text(encoding="utf-8"))
    games = payload.get("games") or []
    active_ids = {int(g["app_id"]) for g in games}

    if GAMES_DIR.exists():
        for child in GAMES_DIR.iterdir():
            if child.is_dir() and child.name.isdigit() and int(child.name) not in active_ids:
                index = child / "index.html"
                if index.exists():
                    index.unlink()
                if not any(child.iterdir()):
                    child.rmdir()

    GAMES_DIR.mkdir(parents=True, exist_ok=True)
    sitemap_urls: list[str] = []

    for game in games:
        app_id = int(game["app_id"])
        out_dir = GAMES_DIR / str(app_id)
        out_dir.mkdir(parents=True, exist_ok=True)
        (out_dir / "index.html").write_text(render_page(game), encoding="utf-8")
        sitemap_urls.append(f"{SITE}/games/{app_id}/")

    SITEMAP_FILE.write_text(render_sitemap(sitemap_urls), encoding="utf-8")
    print(f"[info] Wrote {len(games)} game pages and sitemap")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
