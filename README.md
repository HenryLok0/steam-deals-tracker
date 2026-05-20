# Steam Deals Tracker

**[Visit the site →](https://steam-deals.henrylok.me/)**

A tracker for Steam games that are **temporarily free** or **on a limited-time sale**.

---

## What it does

Every **6 hours**, the site automatically refreshes its game list from Steam. You can browse current deals without opening the Steam store one by one.

### Deal types

| Type                 | Description                                                         |
| -------------------- | ------------------------------------------------------------------- |
| **Temporarily free** | Games that normally cost money but are free for a limited promotion |
| **On sale**          | Paid games with an active discount                                  |

### Website features

- **Search** — find games by name, genre, or description (supports multiple keywords)
- **Filters** — platform (Windows / macOS / Linux), genre, deal type, active/expired status, UI language support
- **Quick filters** — ending within 24h (when expiration data is available), wishlist, ≥75% off, under $5, Steam Deck, controller support
- **Sort** — best deals first (default), ending soon, name, date added, rating, review count, or discount
- **Countdown** — live countdown labels refresh every minute; deals ending within 24 hours are highlighted
- **Free today spotlight** — compact banner of currently free games when promotions are active
- **New today** — horizontal strip of games added in the last 24 hours
- **Wishlist** — save games locally in your browser; filter to “My wishlist”
- **Deal progress bar** — visual discount strength on cards and in the modal
- **Pagination** — load more results in batches of 24
- **Shareable links** — filter state and game modal sync to the URL; copy link preserves filters
- **Per-game pages** — `/games/{app_id}/` for OG/SEO previews (redirects to the main app)
- **Quick filters** — click the stat cards at the top to jump to all deals, free games, or sales
- **Game details** — click a card to open a modal with full description, genres, features, languages, and price
- **Accessibility** — modal focus trap, keyboard navigation, localized close labels
- **Languages** — UI available in English, Traditional Chinese, Simplified Chinese, Japanese, and Korean
- **Theme** — follows your browser light/dark mode automatically
- **Prices** — always shown in USD (when price data is available)
- **PWA** — installable on mobile/desktop; network-first app shell with cached data fallback
- **RSS feed** — subscribe at [feed.xml](https://steam-deals.henrylok.me/feed.xml) for free games and newly added sales

---

## Share URLs

| Format | Example |
| ------ | ------- |
| Main app with filters | `https://steam-deals.henrylok.me/?offer=free&sort=ending-soon` |
| Open a game modal | `https://steam-deals.henrylok.me/?app=570` |
| Per-game OG page | `https://steam-deals.henrylok.me/games/570/` |

Filter query params: `q`, `offer`, `status`, `sort`, `platform`, `genre`, `uiLang`, `ending`, `wishlist`, `deal`, `maxPrice`, `deck`, `controller`, `app`.

---

## RSS subscription

The feed includes all currently **free** promotions plus **sales added in the last 24 hours**.

Add this URL to your RSS reader:

```
https://steam-deals.henrylok.me/feed.xml
```

A link is also available in the site footer.

---

## What is not included

- Permanent **Free to Play** games
- Games outside the current Steam promotion/sale lists
- Accounts, purchases, webhooks, or email notifications — this site only helps you discover deals

---

## Data & updates

Deal data comes from public Steam store APIs.

| Schedule           | Job                  | Purpose                                               |
| ------------------ | -------------------- | ----------------------------------------------------- |
| Every 6 hours      | `update-games.yml`   | Refresh active deals (quick mode)                     |
| Daily at 03:00 UTC | `backfill-games.yml` | Fill in missing regional prices and HTML descriptions |

- **Last updated** time is shown on the site homepage
- Active deals load from `docs/data/games-active.json`; expired deals are lazy-loaded from `docs/data/games-expired.json` when you include expired results
- Per-game static pages and `sitemap.xml` are regenerated after each data update

---

## Cache bump discipline

When releasing frontend changes, keep these in sync:

| File | What to bump |
| ---- | ------------ |
| `docs/index.html` | `styles.css?v=` and `app.js?v=` query strings |
| `docs/app.js` | `i18n.js?v=`, `labels.js?v=`, `focus-trap.js?v=` imports |
| `docs/sw.js` | `CACHE_VERSION` (e.g. `steam-deals-v4`) |
| `docs/app.js` | `registerServiceWorker("./sw.js?v=4")` |

---

## About this repository

This GitHub repo hosts the live website via **GitHub Pages** at `steam-deals.henrylok.me`. The site reads from `docs/`; deal data is updated by scheduled GitHub Actions.

You do **not** need to clone this project to use it — just open the link above.

---

## License

MIT
