#!/usr/bin/env python3
"""Generate per-game static pages for OG/SEO."""

from __future__ import annotations

import html
import json
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA_FILE = ROOT / "docs" / "data" / "games-active.json"
META_FILE = ROOT / "docs" / "data" / "meta.json"
GAMES_DIR = ROOT / "docs" / "games"
SITEMAP_FILE = ROOT / "docs" / "sitemap.xml"
SITE = "https://steam-deals.henrylok.me"


def format_usd(cents: int) -> str:
    return f"${cents / 100:.2f}"


def format_expiration(value: object | None) -> str | None:
    if value is None:
        return None
    if isinstance(value, int):
        return datetime.fromtimestamp(value, tz=timezone.utc).date().isoformat()
    if isinstance(value, str):
        return value[:10]
    return None


def lastmod(value: str | None) -> str | None:
    if not value:
        return None
    return value[:10]


def build_page_title(game: dict) -> str:
    app_id = int(game["app_id"])
    name = game.get("name") or f"App {app_id}"
    offer_type = game.get("offer_type")
    discount = int(game.get("discount_percent") or 0)
    if offer_type == "free":
        return f"{name} — Free on Steam | Steam Deals Tracker"
    if discount > 0:
        return f"{name} — {discount}% Off on Steam | Steam Deals Tracker"
    return f"{name} — Steam Deal | Steam Deals Tracker"


def build_meta_description(game: dict) -> str:
    app_id = int(game["app_id"])
    name = game.get("name") or f"App {app_id}"
    offer_type = game.get("offer_type")
    discount = int(game.get("discount_percent") or 0)
    original = int(game.get("original_price") or 0)
    final = int(game.get("final_price") or 0)
    summary = (
        game.get("short_description")
        or game.get("descriptions", {}).get("en")
        or ""
    ).strip()

    if offer_type == "free":
        lead = f"Get {name} free on Steam for a limited time."
    elif discount > 0 and original > 0:
        lead = (
            f"{name} is {discount}% off on Steam "
            f"({format_usd(final)} from {format_usd(original)})."
        )
    else:
        lead = f"Track the latest Steam deal for {name}."

    text = f"{lead} {summary}".strip()
    return text[:300]


def build_deal_label(game: dict) -> tuple[str, str]:
    offer_type = game.get("offer_type")
    discount = int(game.get("discount_percent") or 0)
    if offer_type == "free":
        return "Limited-time free", "badge-free"
    if discount > 0:
        return f"{discount}% off", "badge-sale"
    return "Steam deal", "badge-sale"


def build_price_line(game: dict) -> str:
    offer_type = game.get("offer_type")
    original = int(game.get("original_price") or 0)
    final = int(game.get("final_price") or 0)
    if offer_type == "free":
        if original > 0:
            return f'<strong>Free</strong> <span class="muted">(was {format_usd(original)})</span>'
        return "<strong>Free</strong>"
    if original > 0 and final >= 0:
        return (
            f"<strong>{format_usd(final)}</strong> "
            f'<span class="muted">(was {format_usd(original)})</span>'
        )
    return ""


def build_json_ld(game: dict, page_url: str, meta_description: str) -> str:
    app_id = int(game["app_id"])
    name = game.get("name") or f"App {app_id}"
    image = game.get("header_image") or f"{SITE}/icons/og-image.png"
    steam_url = game.get("steam_url") or f"https://store.steampowered.com/app/{app_id}/"
    final = int(game.get("final_price") or 0)
    offer_type = game.get("offer_type")
    price = "0.00" if offer_type == "free" else f"{final / 100:.2f}"

    offer: dict[str, object] = {
        "@type": "Offer",
        "url": steam_url,
        "priceCurrency": "USD",
        "price": price,
        "availability": "https://schema.org/InStock",
        "seller": {"@type": "Organization", "name": "Steam"},
    }
    expiration = format_expiration(game.get("discount_expiration"))
    if expiration:
        offer["priceValidUntil"] = expiration

    payload = {
        "@context": "https://schema.org",
        "@graph": [
            {
                "@type": "BreadcrumbList",
                "itemListElement": [
                    {
                        "@type": "ListItem",
                        "position": 1,
                        "name": "Steam Deals Tracker",
                        "item": f"{SITE}/",
                    },
                    {
                        "@type": "ListItem",
                        "position": 2,
                        "name": name,
                        "item": page_url,
                    },
                ],
            },
            {
                "@type": "Product",
                "name": name,
                "description": meta_description,
                "image": image,
                "url": page_url,
                "brand": {"@type": "Brand", "name": "Steam"},
                "offers": offer,
            },
        ],
    }
    return json.dumps(payload, ensure_ascii=False)


def render_page(game: dict) -> str:
    app_id = int(game["app_id"])
    name = html.escape(game.get("name") or f"App {app_id}")
    desc = html.escape(
        (game.get("short_description") or game.get("descriptions", {}).get("en") or "").strip()
    )
    image = html.escape(game.get("header_image") or "")
    page_url = f"{SITE}/games/{app_id}/"
    tracker_url = f"{SITE}/?app={app_id}"
    steam_url = html.escape(game.get("steam_url") or f"https://store.steampowered.com/app/{app_id}/")
    page_title = html.escape(build_page_title(game))
    meta_description = html.escape(build_meta_description(game))
    deal_label, badge_class = build_deal_label(game)
    price_line = build_price_line(game)
    genres = ", ".join(html.escape(g) for g in (game.get("genres") or [])[:6])
    review_label = html.escape(str(game.get("review_label") or ""))
    json_ld = build_json_ld(game, page_url, build_meta_description(game))

    genre_block = f"<li><strong>Genres:</strong> {genres}</li>" if genres else ""
    review_block = f"<li><strong>Reviews:</strong> {review_label}</li>" if review_label else ""
    price_block = f'<p class="price-line">{price_line}</p>' if price_line else ""

    return f"""<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>{page_title}</title>
    <meta name="description" content="{meta_description}" />
    <meta name="robots" content="index,follow" />
    <link rel="canonical" href="{page_url}" />
    <meta property="og:type" content="website" />
    <meta property="og:site_name" content="Steam Deals Tracker" />
    <meta property="og:url" content="{page_url}" />
    <meta property="og:title" content="{page_title}" />
    <meta property="og:description" content="{meta_description}" />
    <meta property="og:image" content="{image}" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="{page_title}" />
    <meta name="twitter:description" content="{meta_description}" />
    <meta name="twitter:image" content="{image}" />
    <link rel="icon" href="/favicon.ico" sizes="any" />
    <link rel="icon" href="/icons/favicon-48.png" sizes="48x48" type="image/png" />
    <link rel="stylesheet" href="../../seo-game.css" />
    <script type="application/ld+json">{json_ld}</script>
  </head>
  <body>
    <main class="page">
      <nav class="breadcrumb" aria-label="Breadcrumb">
        <a href="{SITE}/">Steam Deals Tracker</a> / {name}
      </nav>
      <article class="hero">
        <img src="{image}" alt="{name} header art" width="460" height="215" loading="eager" />
        <div>
          <span class="badge {badge_class}">{html.escape(deal_label)}</span>
          <h1>{name}</h1>
          {price_block}
          <p class="description">{desc}</p>
          <ul class="meta-list">
            {genre_block}
            {review_block}
          </ul>
          <div class="actions">
            <a class="button button-primary" href="{html.escape(tracker_url)}">View deal details</a>
            <a class="button button-secondary" href="{steam_url}" rel="noopener noreferrer">Open on Steam</a>
          </div>
        </div>
      </article>
      <footer class="site-footer">
        <p>
          Deal tracked by
          <a href="{SITE}/">Steam Deals Tracker</a>.
          Prices and availability may change on Steam.
        </p>
      </footer>
    </main>
  </body>
</html>
"""


def render_sitemap(home_lastmod: str | None, entries: list[tuple[str, str | None]]) -> str:
    lines = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ]

    home_lastmod_tag = f"<lastmod>{home_lastmod}</lastmod>" if home_lastmod else ""
    lines.append(
        f"  <url><loc>{SITE}/</loc>{home_lastmod_tag}<changefreq>daily</changefreq><priority>1.0</priority></url>"
    )
    lines.append(
        f"  <url><loc>{SITE}/feed.xml</loc>{home_lastmod_tag}<changefreq>daily</changefreq><priority>0.8</priority></url>"
    )

    for url, entry_lastmod in entries:
        lastmod_tag = f"<lastmod>{entry_lastmod}</lastmod>" if entry_lastmod else ""
        changefreq = "daily" if "/games/" in url else "weekly"
        lines.append(
            f'  <url><loc>{html.escape(url)}</loc>{lastmod_tag}<changefreq>{changefreq}</changefreq><priority>0.6</priority></url>'
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

    meta = {}
    if META_FILE.exists():
        meta = json.loads(META_FILE.read_text(encoding="utf-8"))
    home_lastmod = lastmod(meta.get("updated_at") or payload.get("updated_at"))

    if GAMES_DIR.exists():
        for child in GAMES_DIR.iterdir():
            if child.is_dir() and child.name.isdigit() and int(child.name) not in active_ids:
                index = child / "index.html"
                if index.exists():
                    index.unlink()
                if not any(child.iterdir()):
                    child.rmdir()

    GAMES_DIR.mkdir(parents=True, exist_ok=True)
    sitemap_entries: list[tuple[str, str | None]] = []

    for game in games:
        app_id = int(game["app_id"])
        out_dir = GAMES_DIR / str(app_id)
        out_dir.mkdir(parents=True, exist_ok=True)
        (out_dir / "index.html").write_text(render_page(game), encoding="utf-8")
        entry_lastmod = lastmod(game.get("updated_at") or game.get("first_seen"))
        sitemap_entries.append((f"{SITE}/games/{app_id}/", entry_lastmod))

    SITEMAP_FILE.write_text(render_sitemap(home_lastmod, sitemap_entries), encoding="utf-8")
    print(f"[info] Wrote {len(games)} game pages and sitemap")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
