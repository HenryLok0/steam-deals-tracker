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
- **Sort** — best deals first (default), ending soon, name, date added, rating, review count, or discount
- **Countdown** — see how long each deal has left; deals ending within 24 hours are highlighted
- **New today** — horizontal strip of games added in the last 24 hours
- **Pagination** — load more results in batches of 24
- **Shareable links** — filter state syncs to the URL; copy a direct link to any game modal
- **Quick filters** — click the stat cards at the top to jump to all deals, free games, or sales
- **Game details** — click a card to open a modal with full description, genres, features, languages, and price
- **Languages** — UI available in English, Traditional Chinese, Japanese, and Korean
- **Theme** — follows your browser light/dark mode automatically
- **Prices** — always shown in USD (when price data is available)
- **PWA** — installable on mobile/desktop; offline shell with cached deal data fallback
- **RSS feed** — subscribe at [feed.xml](https://steam-deals.henrylok.me/feed.xml) for free games and newly added sales

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
- Wishlist, accounts, or purchase features — this site only helps you discover deals

---

## Data & updates

Deal data comes from public Steam store APIs.


| Schedule           | Job                  | Purpose                                               |
| ------------------ | -------------------- | ----------------------------------------------------- |
| Every 6 hours      | `update-games.yml`   | Refresh active deals (quick mode)                     |
| Daily at 03:00 UTC | `backfill-games.yml` | Fill in missing regional prices and HTML descriptions |


- **Last updated** time is shown on the site homepage
- Expired deals can still be viewed using the status filter

---

## About this repository

This GitHub repo hosts the live website via **GitHub Pages** at `steam-deals.henrylok.me`. The site reads from `docs/`; deal data is updated by scheduled GitHub Actions.

You do **not** need to clone this project to use it — just open the link above.

---

## License

MIT