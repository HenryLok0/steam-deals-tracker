#!/usr/bin/env python3
"""Fetch daily USD-based exchange rates for supported display currencies."""

from __future__ import annotations

import json
import sys
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUTPUT_FILE = ROOT / "docs" / "data" / "exchange-rates.json"
ARCHIVE_FILE = ROOT / "data" / "exchange-rates.json"

TARGET_CURRENCIES = ("HKD", "TWD", "CNY", "JPY", "KRW")
API_URL = (
    "https://api.frankfurter.app/latest?"
    + urllib.parse.urlencode({"from": "USD", "to": ",".join(TARGET_CURRENCIES)})
)

# Reasonable fallback if the API is unavailable.
FALLBACK_RATES = {
    "HKD": 7.85,
    "TWD": 32.0,
    "CNY": 7.25,
    "JPY": 156.0,
    "KRW": 1380.0,
}


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def fetch_rates() -> dict[str, float]:
    req = urllib.request.Request(
        API_URL,
        headers={"User-Agent": "Mozilla/5.0 (compatible; SteamDealsBot/1.0)"},
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        payload = json.loads(resp.read().decode("utf-8"))
    rates = payload.get("rates") or {}
    return {code: float(rates[code]) for code in TARGET_CURRENCIES if code in rates}


def save_json(path: Path, data: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as fh:
        json.dump(data, fh, ensure_ascii=False, indent=2)
        fh.write("\n")


def main() -> int:
    now = utc_now_iso()
    try:
        rates = fetch_rates()
        if len(rates) < len(TARGET_CURRENCIES):
            missing = [code for code in TARGET_CURRENCIES if code not in rates]
            print(f"[warn] Missing rates for {missing}, using fallback values", file=sys.stderr)
            for code in missing:
                rates[code] = FALLBACK_RATES[code]
        source = "frankfurter"
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError, ValueError) as exc:
        print(f"[warn] Failed to fetch live rates: {exc}", file=sys.stderr)
        rates = dict(FALLBACK_RATES)
        source = "fallback"

    output = {
        "updated_at": now,
        "base": "USD",
        "source": source,
        "rates": rates,
    }

    save_json(OUTPUT_FILE, output)
    save_json(ARCHIVE_FILE, output)
    print(f"[info] Saved exchange rates ({source}) to {OUTPUT_FILE}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
