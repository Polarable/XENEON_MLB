# Xeneon Edge baseball widget

A 2560×720 page for the iCUE iFrame widget on the Corsair Xeneon Edge.

- `index.html`: the news page, with a team picker next to the title. It scales to fit the iFrame and remembers the team you pick.
- `teams.js`: the 30 teams (MLB ids, colors, MLB Trade Rumors feed names).
- `scripts/fetch-news.js`: pulls the newest MLB Trade Rumors articles (league-wide plus each team's feed), adds each article's thumbnail (its og:image), and writes `news.json`.
- `scripts/fetch-logos.js`: downloads each team's MLB logo into `logos/`, using MLB's dark-background ("on dark") versions where they exist.
- `.github/workflows/news.yml`: runs both scripts every 15 minutes on GitHub, saves `news.json` and new logos to the repo, and publishes the site to GitHub Pages.

The browser can't read MLB Trade Rumors directly (its RSS has no thumbnails and is blocked cross-origin), so the fetcher builds `news.json` ahead of time and the page just reads it.

## Setup
1. Push these files to a GitHub repo.
2. Settings → Pages → Source: **GitHub Actions**.
3. Actions → "Update news" → Run workflow (first fill and first publish).
4. In iCUE, add an iFrame widget at full width with the URL `https://<user>.github.io/<repo>/`.
