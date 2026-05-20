# Steam Deals Tracker

An auto-updating GitHub repository that tracks **temporarily free** and **on-sale** Steam games (excluding permanent Free to Play titles).

## Features

- Auto-updates every 6 hours via GitHub Actions
- Temporarily free: paid games available for $0 during a promotion
- On sale: paid games with active discounts
- Website highlights:
  - UI in English, Traditional Chinese, Japanese, and Korean
  - Localized genre tags and supported game languages
  - Light/dark mode follows browser `prefers-color-scheme`
  - Multi-select platform and genre filters
  - Sort by rating, discount, reviews, and date added
  - Clickable stat cards, search debounce, game detail modal
  - Regional price display (USD / TWD / JPY / KRW)

## Project Structure

```text
steam-free-games/
├── .github/workflows/update-games.yml  # Auto-update workflow
├── data/                               # Source data in the repo
├── docs/                               # GitHub Pages site
│   ├── index.html
│   ├── app.js
│   ├── styles.css
│   └── data/                           # Site data copy
└── scripts/fetch_games.py              # Fetch script
```

## Quick Start

### 1. Push to GitHub

```bash
git add .
git commit -m "feat: initial Steam deals tracker"
git push -u origin main
```

### 2. Enable GitHub Pages

1. Open repo **Settings → Pages**
2. Under **Build and deployment → Source**, choose `Deploy from a branch`
3. Select branch `main` and folder `/docs`
4. Save

After a few minutes, the site will be available at:

`https://<your-username>.github.io/steam-free-games/`

### 3. Run the first update manually

1. Go to the **Actions** tab
2. Select **Update Steam Free Games**
3. Click **Run workflow**

The first run may take several minutes because it fetches all current deals.

## Local Testing

```bash
python scripts/fetch_games.py
```

Then serve the `docs/` folder with any static server:

```bash
python -m http.server 8080 --directory docs
```

Open `http://localhost:8080`

## Data Sources

- Steam Store Search API (free promos and sales)
- Steam Featured Categories API (featured specials)
- Steam App Details API (game metadata, prices, descriptions)

## License

MIT
