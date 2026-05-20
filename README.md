# Steam Deals Tracker

**[Visit the site →](https://henrylok0.github.io/steam-deals-tracker/)**

A simple tracker for Steam games that are **temporarily free** or **on a limited-time sale**.

It focuses on paid games with active promotions — not permanent Free to Play titles.

---

## What it does

Every **6 hours**, the site automatically refreshes its game list from Steam. You can browse current deals without opening the Steam store one by one.

### Deal types

| Type | Description |
|------|-------------|
| **Temporarily free** | Games that normally cost money but are free for a limited promotion |
| **On sale** | Paid games with an active discount |

### Website features

- **Search** — find games by name, genre, or description (supports multiple keywords)
- **Filters** — platform (Windows / macOS / Linux), genre, deal type, active/expired status
- **Sort** — by name, date added, rating, review count, or discount
- **Quick filters** — click the stat cards at the top to jump to all deals, free games, or sales
- **Game details** — click a card to open a modal with full description, genres, features, languages, and price
- **Languages** — UI available in English, Traditional Chinese, Japanese, and Korean
- **Theme** — follows your browser light/dark mode automatically
- **Prices** — shown in USD, TWD, JPY, or KRW depending on your selected UI language (when regional data is available)

---

## What is not included

- Permanent **Free to Play** games
- Games outside the current Steam promotion/sale lists
- Wishlist, accounts, or purchase features — this site only helps you discover deals

---

## Data & updates

Deal data comes from public Steam store APIs. The list is refreshed automatically; you do not need to install or run anything.

- **Last updated** time is shown on the site homepage
- Expired deals can still be viewed using the status filter

---

## About this repository

This GitHub repo hosts the live website via **GitHub Pages**. The site reads from `docs/`; deal data is updated by a scheduled GitHub Action.

You do **not** need to clone this project to use it — just open the link above.

---

## License

MIT
