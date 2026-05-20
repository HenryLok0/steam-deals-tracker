#!/usr/bin/env python3
"""Fetch temporarily free and discounted Steam games."""

from __future__ import annotations

import argparse
import html as html_lib
import json
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA_FILE = ROOT / "data" / "games.json"
META_FILE = ROOT / "data" / "meta.json"
QUEUE_FILE = ROOT / "data" / "fetch_queue.json"

HEADERS = {
    "User-Agent": "Mozilla/5.0 (compatible; SteamFreeGamesBot/1.0; +https://github.com)",
    "Accept-Language": "en-US,en;q=0.9",
}
REQUEST_DELAY = 1.0
BACKFILL_LIMIT = 80
SEARCH_PAGE_SIZE = 50
MAX_SALE_RESULTS = 350

# UI language -> (supported_language key, Steam API locale)
LOCALIZED_DESCRIPTIONS = {
    "zh-Hant": [
        ("tchinese", "tchinese"),
        ("schinese", "schinese"),
    ],
    "ja": [("japanese", "japanese")],
    "ko": [("korean", "koreana")],
}

# UI language -> (Steam country code, default currency)
PRICE_REGIONS = {
    "en": ("US", "USD"),
    "zh-Hant": ("TW", "TWD"),
    "ja": ("JP", "JPY"),
    "ko": ("KR", "KRW"),
}

LANGUAGE_ALIASES = {
    "english": "english",
    "french": "french",
    "italian": "italian",
    "german": "german",
    "spanish - spain": "spanish-spain",
    "spanish - latin america": "spanish-latin",
    "arabic": "arabic",
    "bulgarian": "bulgarian",
    "czech": "czech",
    "danish": "danish",
    "dutch": "dutch",
    "finnish": "finnish",
    "greek": "greek",
    "hungarian": "hungarian",
    "indonesian": "indonesian",
    "japanese": "japanese",
    "korean": "korean",
    "norwegian": "norwegian",
    "polish": "polish",
    "portuguese - brazil": "portuguese-brazil",
    "portuguese": "portuguese",
    "romanian": "romanian",
    "russian": "russian",
    "simplified chinese": "schinese",
    "traditional chinese": "tchinese",
    "swedish": "swedish",
    "thai": "thai",
    "turkish": "turkish",
    "ukrainian": "ukrainian",
    "vietnamese": "vietnamese",
}


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def fetch_json(url: str, retries: int = 4) -> dict | list | None:
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, headers=HEADERS)
            with urllib.request.urlopen(req, timeout=45) as resp:
                return json.loads(resp.read().decode("utf-8"))
        except urllib.error.HTTPError as exc:
            if exc.code == 429 and attempt < retries - 1:
                wait = 2.5 * (attempt + 1)
                print(f"[warn] Rate limited, retrying in {wait:.1f}s: {url}", file=sys.stderr)
                time.sleep(wait)
                continue
            print(f"[warn] Failed to fetch {url}: {exc}", file=sys.stderr)
            return None
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as exc:
            if attempt == retries - 1:
                print(f"[warn] Failed to fetch {url}: {exc}", file=sys.stderr)
                return None
            time.sleep(1.5 * (attempt + 1))
    return None


def normalize_language_key(raw_key: str) -> str | None:
    if not raw_key:
        return None

    key = re.sub(r"\*.*$", "", raw_key).strip().lower()
    key = re.sub(r"-languages-with-full-audio-support.*$", "", key).strip()
    if not key or "full-audio" in key or "languages-with" in key:
        return None

    slug_fixes = {
        "simplified-chinese": "schinese",
        "traditional-chinese": "tchinese",
    }
    return slug_fixes.get(key, key)


def parse_supported_languages(raw: str) -> list[str]:
    if not raw:
        return []

    cleaned = html_lib.unescape(re.sub(r"<[^>]+>", "", raw))
    cleaned = re.sub(
        r"\*?\s*languages?\s+with\s+full\s+audio\s+support.*",
        "",
        cleaned,
        flags=re.I,
    )
    keys: list[str] = []
    seen: set[str] = set()

    for part in cleaned.split(","):
        label = re.sub(r"\*+.*$", "", part.strip()).strip()
        if not label or "full audio" in label.lower():
            continue
        key = LANGUAGE_ALIASES.get(label.lower(), label.lower().replace(" ", "-"))
        key = normalize_language_key(key)
        if key and key not in seen:
            seen.add(key)
            keys.append(key)
    return keys


def parse_search_html(raw_html: str) -> list[dict]:
    blocks = re.split(r'(?=data-ds-appid="\d+")', raw_html)
    games: list[dict] = []

    for block in blocks:
        app_match = re.search(r'data-ds-appid="(\d+)"', block)
        if not app_match:
            continue

        title_match = re.search(r'<span class="title">([^<]+)</span>', block)
        review_match = re.search(r'data-tooltip-html="([^"]+)"', block)
        discount_match = re.search(r'data-discount="(\d+)"', block)
        final_match = re.search(r'data-price-final="(\d+)"', block)

        review_hint = html_lib.unescape(review_match.group(1)) if review_match else ""
        discount_percent = int(discount_match.group(1)) if discount_match else 0
        final_price = int(final_match.group(1)) if final_match else 0

        games.append(
            {
                "app_id": int(app_match.group(1)),
                "name": html_lib.unescape(title_match.group(1).strip()) if title_match else "",
                "review_hint": review_hint,
                "discount_percent": discount_percent,
                "final_price": final_price,
            }
        )

    return games


def fetch_search_games(params: dict[str, str], max_results: int | None = None) -> list[dict]:
    collected: dict[int, dict] = {}
    start = 0

    while True:
        query = urllib.parse.urlencode(
            {
                **params,
                "json": "1",
                "count": str(SEARCH_PAGE_SIZE),
                "start": str(start),
                "infinite": "1",
                "cc": "US",
                "l": "english",
            }
        )
        url = f"https://store.steampowered.com/search/results/?{query}"
        payload = fetch_json(url)
        if not payload or not payload.get("success"):
            break

        page_games = parse_search_html(payload.get("results_html", ""))
        if not page_games:
            break

        for game in page_games:
            collected[game["app_id"]] = game
            if max_results and len(collected) >= max_results:
                return list(collected.values())[:max_results]

        total_count = int(payload.get("total_count") or 0)
        start += SEARCH_PAGE_SIZE
        if start >= total_count:
            break
        time.sleep(REQUEST_DELAY)

    return list(collected.values())


def fetch_featured_specials() -> list[dict]:
    payload = fetch_json(
        "https://store.steampowered.com/api/featuredcategories/?l=english&cc=US"
    )
    if not payload:
        return []

    games: list[dict] = []
    for item in payload.get("specials", {}).get("items", []):
        discount_percent = int(item.get("discount_percent") or 0)
        final_price = int(item.get("final_price") or 0)
        original_price = int(item.get("original_price") or 0)
        if discount_percent <= 0:
            continue

        games.append(
            {
                "app_id": int(item["id"]),
                "name": item.get("name", ""),
                "header_image": item.get("header_image", ""),
                "windows": bool(item.get("windows_available")),
                "mac": bool(item.get("mac_available")),
                "linux": bool(item.get("linux_available")),
                "original_price": original_price,
                "final_price": final_price,
                "discount_percent": discount_percent,
                "discount_expiration": item.get("discount_expiration"),
            }
        )
    return games


def fetch_app_details(
    app_id: int,
    locale: str = "english",
    cc: str = "US",
) -> dict | None:
    url = (
        "https://store.steampowered.com/api/appdetails"
        f"?appids={app_id}&l={locale}&cc={cc}"
    )
    payload = fetch_json(url)
    if not payload:
        return None

    entry = payload.get(str(app_id), {})
    if not entry.get("success"):
        return None
    return entry.get("data") or None


def strip_html(raw: str) -> str:
    cleaned = html_lib.unescape(re.sub(r"<[^>]+>", " ", raw or ""))
    return re.sub(r"\s+", " ", cleaned).strip()


def extract_localized_fields(data: dict) -> dict[str, str]:
    detailed_raw = data.get("about_the_game") or data.get("detailed_description") or ""
    return {
        "name": data.get("name", "").strip(),
        "description": data.get("short_description", "").strip(),
        "detailed_description": strip_html(detailed_raw),
        "detailed_description_html": detailed_raw.strip(),
    }


def make_price_entry(overview: dict, base: dict, default_currency: str) -> dict:
    original = int(base.get("original_price") or overview.get("initial") or 0)
    final = int(
        base.get("final_price")
        if base.get("final_price") is not None
        else overview.get("final") or 0
    )
    if not original and overview.get("initial") is not None:
        original = int(overview.get("initial") or 0)
    if base.get("final_price") is None and overview.get("final") is not None:
        final = int(overview.get("final") or 0)
    return {
        "currency": overview.get("currency") or default_currency,
        "original": original,
        "final": final,
    }


def fetch_regional_prices(
    app_id: int,
    data: dict,
    base: dict,
    existing: dict | None,
) -> dict[str, dict]:
    previous_prices = (existing or {}).get("prices") or {}
    if previous_prices and all(lang in previous_prices for lang in PRICE_REGIONS):
        return previous_prices

    prices: dict[str, dict] = {}
    us_overview = data.get("price_overview") or {}
    prices["en"] = make_price_entry(us_overview, base, "USD")

    for ui_lang, (cc, currency) in PRICE_REGIONS.items():
        if ui_lang == "en":
            continue
        if previous_prices.get(ui_lang):
            prices[ui_lang] = previous_prices[ui_lang]
            continue

        regional_data = fetch_app_details(app_id, locale="english", cc=cc)
        time.sleep(REQUEST_DELAY)
        if regional_data:
            overview = regional_data.get("price_overview") or {}
            prices[ui_lang] = make_price_entry(overview, {}, currency)
        else:
            prices[ui_lang] = prices["en"]

    return prices


def fetch_localized_content(
    app_id: int,
    supported_languages: list[str],
    english_data: dict,
    existing: dict | None,
) -> dict[str, dict[str, str]]:
    previous = existing or {}
    cached_names = previous.get("names", {})
    cached_descriptions = previous.get("descriptions", {})
    cached_detailed = previous.get("detailed_descriptions", {})
    cached_detailed_html = previous.get("detailed_descriptions_html", {})

    english_fields = extract_localized_fields(english_data)
    names = {"en": english_fields["name"] or previous.get("name", "")}
    descriptions = {"en": english_fields["description"] or previous.get("short_description", "")}
    detailed_descriptions = {
        "en": english_fields["detailed_description"] or descriptions["en"]
    }
    detailed_descriptions_html = {
        "en": english_fields["detailed_description_html"] or detailed_descriptions["en"]
    }

    for ui_lang, locale_options in LOCALIZED_DESCRIPTIONS.items():
        if (
            cached_names.get(ui_lang)
            and cached_descriptions.get(ui_lang)
            and cached_detailed.get(ui_lang)
            and cached_detailed_html.get(ui_lang)
        ):
            names[ui_lang] = cached_names[ui_lang]
            descriptions[ui_lang] = cached_descriptions[ui_lang]
            detailed_descriptions[ui_lang] = cached_detailed[ui_lang]
            detailed_descriptions_html[ui_lang] = cached_detailed_html[ui_lang]
            continue

        steam_locale = None
        for language_key, steam_language in locale_options:
            if language_key in supported_languages:
                steam_locale = steam_language
                break
        if not steam_locale:
            continue

        localized = fetch_app_details(app_id, steam_locale)
        time.sleep(REQUEST_DELAY)
        if not localized:
            continue

        fields = extract_localized_fields(localized)
        if fields["name"]:
            names[ui_lang] = fields["name"]
        if fields["description"]:
            descriptions[ui_lang] = fields["description"]
        if fields["detailed_description"]:
            detailed_descriptions[ui_lang] = fields["detailed_description"]
        elif fields["description"]:
            detailed_descriptions[ui_lang] = fields["description"]
        if fields["detailed_description_html"]:
            detailed_descriptions_html[ui_lang] = fields["detailed_description_html"]
        elif fields["detailed_description"]:
            detailed_descriptions_html[ui_lang] = fields["detailed_description"]
        elif fields["description"]:
            detailed_descriptions_html[ui_lang] = fields["description"]

    return {
        "names": names,
        "descriptions": descriptions,
        "detailed_descriptions": detailed_descriptions,
        "detailed_descriptions_html": detailed_descriptions_html,
    }


def fetch_review_stats(app_id: int) -> dict:
    url = (
        "https://store.steampowered.com/appreviews/"
        f"{app_id}?json=1&language=english&purchase_type=all"
    )
    payload = fetch_json(url)
    if not payload or not payload.get("success"):
        return {}

    summary = payload.get("query_summary") or {}
    total = int(summary.get("total_reviews") or 0)
    positive = int(summary.get("total_positive") or 0)
    percent = round((positive / total) * 100, 1) if total else None

    return {
        "review_count": total,
        "review_positive": positive,
        "review_percent": percent,
        "review_score": summary.get("review_score"),
        "review_label": summary.get("review_score_desc", ""),
    }


def is_free_to_play(data: dict) -> bool:
    categories = [c.get("description", "") for c in data.get("categories", [])]
    genres = [g.get("description", "") for g in data.get("genres", [])]
    joined = " ".join(categories + genres).lower()
    return "free to play" in joined


def classify_offer(base: dict, data: dict) -> str | None:
    if is_free_to_play(data):
        return None

    price = data.get("price_overview") or {}
    discount_percent = int(base.get("discount_percent") or price.get("discount_percent") or 0)
    final_price = int(base.get("final_price") if base.get("final_price") is not None else price.get("final") or 0)
    original_price = int(base.get("original_price") or price.get("initial") or 0)

    if data.get("is_free") and original_price > 0:
        return "free"
    if data.get("is_free") and discount_percent >= 100 and original_price > 0:
        return "free"
    if data.get("is_free") and discount_percent >= 100:
        return "free"
    if final_price == 0 and discount_percent >= 100 and not data.get("is_free"):
        return None
    if final_price == 0 and discount_percent >= 100:
        return "free"
    if discount_percent > 0 and final_price > 0:
        return "sale"
    if discount_percent > 0 and original_price > 0 and final_price >= 0:
        return "sale"
    return None


def build_game_record(
    base: dict,
    data: dict,
    reviews: dict,
    localized: dict[str, dict[str, str]],
    offer_type: str,
    prices: dict[str, dict],
    now: str,
) -> dict:
    app_id = int(base["app_id"])
    genres = [g.get("description", "") for g in data.get("genres", []) if g.get("description")]
    categories = [
        c.get("description", "") for c in data.get("categories", []) if c.get("description")
    ]

    platforms = []
    platform_data = data.get("platforms") or {}
    if platform_data.get("windows") or base.get("windows"):
        platforms.append("windows")
    if platform_data.get("mac") or base.get("mac"):
        platforms.append("mac")
    if platform_data.get("linux") or base.get("linux"):
        platforms.append("linux")

    price = data.get("price_overview") or {}
    original_price = int(base.get("original_price") or price.get("initial") or 0)
    final_price = int(base.get("final_price") if base.get("final_price") is not None else price.get("final") or 0)
    discount_percent = int(base.get("discount_percent") or price.get("discount_percent") or 0)
    supported_languages = parse_supported_languages(data.get("supported_languages", ""))

    names = localized.get("names", {})
    descriptions = localized.get("descriptions", {})
    detailed_descriptions = localized.get("detailed_descriptions", {})
    detailed_descriptions_html = localized.get("detailed_descriptions_html", {})

    record = {
        "app_id": app_id,
        "name": names.get("en") or data.get("name") or base.get("name", ""),
        "names": names,
        "offer_type": offer_type,
        "short_description": descriptions.get("en", data.get("short_description", "")),
        "descriptions": descriptions,
        "detailed_descriptions": detailed_descriptions,
        "detailed_descriptions_html": detailed_descriptions_html,
        "header_image": data.get("header_image")
        or base.get("header_image")
        or (
            f"https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/"
            f"{app_id}/header.jpg"
        ),
        "genres": genres,
        "categories": categories,
        "platforms": platforms,
        "supported_languages": supported_languages,
        "steam_url": f"https://store.steampowered.com/app/{app_id}/",
        "release_date": (data.get("release_date") or {}).get("date", ""),
        "discount_expiration": base.get("discount_expiration"),
        "original_price": original_price,
        "final_price": final_price,
        "discount_percent": discount_percent,
        "prices": prices,
        "review_hint": base.get("review_hint", ""),
        "review_count": reviews.get("review_count", 0),
        "review_positive": reviews.get("review_positive", 0),
        "review_percent": reviews.get("review_percent"),
        "review_score": reviews.get("review_score"),
        "review_label": reviews.get("review_label", ""),
        "is_active": True,
    }

    record["search_text"] = " ".join(
        filter(
            None,
            [
                record["name"],
                " ".join(names.values()),
                " ".join(descriptions.values()),
                " ".join(record["genres"]),
                " ".join(record["categories"]),
                " ".join(record["supported_languages"]),
                record["review_label"],
                record["review_hint"],
            ],
        )
    ).lower()
    return record


def load_json(path: Path, default: dict | list) -> dict | list:
    if not path.exists():
        return default
    with path.open("r", encoding="utf-8") as fh:
        return json.load(fh)


def save_json(path: Path, data: dict | list) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as fh:
        json.dump(data, fh, ensure_ascii=False, indent=2)
        fh.write("\n")


def merge_records(existing: dict[str, dict], incoming: dict, now: str) -> None:
    app_id = str(incoming["app_id"])
    previous = existing.get(app_id)
    incoming["first_seen"] = previous.get("first_seen", now) if previous else now
    incoming["last_seen"] = now
    incoming["updated_at"] = now
    existing[app_id] = incoming


def mark_inactive(existing: dict[str, dict], active_ids: set[int], now: str) -> None:
    for app_id, game in existing.items():
        if int(app_id) not in active_ids:
            game["is_active"] = False
            game["last_seen"] = now
            game["updated_at"] = now


def needs_localized_content(
    supported_languages: list[str],
    existing: dict | None,
) -> bool:
    previous = existing or {}
    descriptions = previous.get("descriptions", {})
    names = previous.get("names", {})
    detailed = previous.get("detailed_descriptions", {})
    detailed_html = previous.get("detailed_descriptions_html", {})

    if not descriptions.get("en") or not names.get("en"):
        return True

    for ui_lang, locale_options in LOCALIZED_DESCRIPTIONS.items():
        if any(key in supported_languages for key, _ in locale_options):
            if not descriptions.get(ui_lang) or not names.get(ui_lang):
                return True
    if not detailed.get("en") or not detailed_html.get("en"):
        return True
    return False


def needs_regional_prices(existing: dict | None) -> bool:
    if not existing:
        return True
    prices = existing.get("prices") or {}
    return not all(lang in prices for lang in PRICE_REGIONS)


def needs_details(app_id: int, existing_games: dict[str, dict]) -> bool:
    previous = existing_games.get(str(app_id))
    if not previous:
        return True
    if not previous.get("genres"):
        return True
    if not previous.get("supported_languages"):
        return True
    if not previous.get("short_description"):
        return True
    if needs_regional_prices(previous):
        return True
    if not previous.get("detailed_descriptions_html"):
        return True
    return False


def needs_backfill(game: dict) -> bool:
    if needs_regional_prices(game):
        return True
    if not game.get("detailed_descriptions_html", {}).get("en"):
        return True
    descriptions = game.get("descriptions", {})
    names = game.get("names", {})
    if not descriptions.get("en") or not names.get("en"):
        return True
    for ui_lang, locale_options in LOCALIZED_DESCRIPTIONS.items():
        if any(key in (game.get("supported_languages") or []) for key, _ in locale_options):
            if not descriptions.get(ui_lang) or not names.get(ui_lang):
                return True
    return False


def count_backfill_pending(games: list[dict]) -> int:
    return sum(1 for game in games if needs_backfill(game))


def load_queue() -> list[int]:
    payload = load_json(QUEUE_FILE, {"app_ids": []})
    return [int(item) for item in payload.get("app_ids", [])]


def save_queue(app_ids: list[int]) -> None:
    unique_ids = sorted({int(item) for item in app_ids})
    save_json(QUEUE_FILE, {"app_ids": unique_ids})


def add_to_queue(app_id: int) -> None:
    queue = load_queue()
    if app_id not in queue:
        queue.append(app_id)
    save_queue(queue)


def remove_from_queue(app_id: int) -> None:
    queue = [item for item in load_queue() if item != app_id]
    save_queue(queue)


def compute_meta(games: list[dict], now: str) -> dict:
    now_dt = datetime.fromisoformat(now.replace("Z", "+00:00"))
    new_today = 0
    new_free_today = 0
    for game in games:
        first_seen = game.get("first_seen")
        if not first_seen:
            continue
        seen_dt = datetime.fromisoformat(first_seen.replace("Z", "+00:00"))
        if (now_dt - seen_dt).total_seconds() <= 86400 and game.get("is_active"):
            new_today += 1
            if game.get("offer_type") == "free":
                new_free_today += 1

    return {
        "updated_at": now,
        "active_count": sum(1 for g in games if g.get("is_active")),
        "total_count": len(games),
        "free_active": sum(
            1 for g in games if g.get("is_active") and g.get("offer_type") == "free"
        ),
        "sale_active": sum(
            1 for g in games if g.get("is_active") and g.get("offer_type") == "sale"
        ),
        "new_today_count": new_today,
        "new_free_today": new_free_today,
        "backfill_pending": count_backfill_pending(games),
    }


def save_outputs(existing_games: dict[str, dict], now: str) -> dict:
    games = sorted(
        existing_games.values(),
        key=lambda g: (not g.get("is_active", False), g.get("name", "").lower()),
    )
    output = {
        "updated_at": now,
        "total_count": len(games),
        "active_count": sum(1 for g in games if g.get("is_active")),
        "games": games,
    }
    save_json(DATA_FILE, output)

    meta = compute_meta(games, now)
    save_json(META_FILE, meta)

    docs_data_dir = ROOT / "docs" / "data"
    save_json(docs_data_dir / "games.json", output)
    save_json(docs_data_dir / "meta.json", meta)
    return output


def run_backfill(existing_games: dict[str, dict], now: str) -> int:
    queue = load_queue()
    candidates: list[int] = []
    for app_id in queue:
        if str(app_id) in existing_games and app_id not in candidates:
            candidates.append(app_id)
    for app_id_str, game in existing_games.items():
        app_id = int(app_id_str)
        if needs_backfill(game) and app_id not in candidates:
            candidates.append(app_id)

    processed = 0
    for app_id in candidates[:BACKFILL_LIMIT]:
        previous = existing_games.get(str(app_id))
        if not previous:
            continue

        data = fetch_app_details(app_id)
        time.sleep(REQUEST_DELAY)
        if not data:
            add_to_queue(app_id)
            continue

        supported_languages = parse_supported_languages(data.get("supported_languages", ""))
        localized = fetch_localized_content(app_id, supported_languages, data, previous)
        prices = fetch_regional_prices(app_id, data, previous, previous)

        previous.update(
            {
                "names": localized.get("names", previous.get("names", {})),
                "descriptions": localized.get("descriptions", previous.get("descriptions", {})),
                "detailed_descriptions": localized.get(
                    "detailed_descriptions", previous.get("detailed_descriptions", {})
                ),
                "detailed_descriptions_html": localized.get(
                    "detailed_descriptions_html",
                    previous.get("detailed_descriptions_html", {}),
                ),
                "prices": prices,
                "supported_languages": supported_languages or previous.get("supported_languages", []),
                "updated_at": now,
            }
        )
        existing_games[str(app_id)] = previous
        remove_from_queue(app_id)
        processed += 1

    save_outputs(existing_games, now)
    print(f"[info] Backfill processed {processed} games")
    return 0


def run_quick(existing_games: dict[str, dict], now: str) -> int:
    free_search = fetch_search_games({"query": "", "specials": "1", "maxprice": "free"})
    sale_search = fetch_search_games({"query": "", "specials": "1"}, max_results=MAX_SALE_RESULTS)
    featured = fetch_featured_specials()

    print(f"[info] Found {len(free_search)} free promo search results")
    print(f"[info] Found {len(sale_search)} sale search results")
    print(f"[info] Found {len(featured)} featured specials")

    candidate_map: dict[int, dict] = {}
    for item in free_search + sale_search + featured:
        candidate_map[item["app_id"]] = {**candidate_map.get(item["app_id"], {}), **item}

    active_ids: set[int] = set()
    kept_free = 0
    kept_sale = 0
    skipped = 0

    for base in candidate_map.values():
        app_id = base["app_id"]
        data = fetch_app_details(app_id)
        time.sleep(REQUEST_DELAY)
        if not data:
            add_to_queue(app_id)
            skipped += 1
            continue

        offer_type = classify_offer(base, data)
        if not offer_type:
            skipped += 1
            continue

        if needs_details(app_id, existing_games) or offer_type == "free":
            reviews = fetch_review_stats(app_id)
            time.sleep(REQUEST_DELAY)
        else:
            reviews = {
                "review_count": existing_games.get(str(app_id), {}).get("review_count", 0),
                "review_positive": existing_games.get(str(app_id), {}).get("review_positive", 0),
                "review_percent": existing_games.get(str(app_id), {}).get("review_percent"),
                "review_score": existing_games.get(str(app_id), {}).get("review_score"),
                "review_label": existing_games.get(str(app_id), {}).get("review_label", ""),
            }

        supported_languages = parse_supported_languages(data.get("supported_languages", ""))
        previous = existing_games.get(str(app_id))
        localized = fetch_localized_content(app_id, supported_languages, data, previous)
        prices = (
            previous.get("prices")
            if previous and not needs_regional_prices(previous)
            else fetch_regional_prices(app_id, data, base, previous)
        )

        record = build_game_record(base, data, reviews, localized, offer_type, prices, now)
        active_ids.add(app_id)
        merge_records(existing_games, record, now)
        remove_from_queue(app_id)
        if offer_type == "free":
            kept_free += 1
        else:
            kept_sale += 1

    mark_inactive(existing_games, active_ids, now)
    output = save_outputs(existing_games, now)

    print(f"[info] Kept {kept_free} free + {kept_sale} sale games, skipped {skipped}")
    print(
        f"[info] Saved {output['active_count']} active / {output['total_count']} total games"
    )
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="Fetch Steam deals data")
    parser.add_argument(
        "--mode",
        choices=("quick", "backfill"),
        default="quick",
        help="quick: refresh active deals; backfill: enrich cached games",
    )
    args = parser.parse_args()

    now = utc_now_iso()
    print(f"[info] Fetch started at {now} (mode={args.mode})")

    existing_data = load_json(DATA_FILE, {"games": [], "updated_at": None})
    existing_games = {
        str(item["app_id"]): item for item in existing_data.get("games", [])
    }

    if args.mode == "backfill":
        return run_backfill(existing_games, now)

    return run_quick(existing_games, now)


if __name__ == "__main__":
    raise SystemExit(main())
