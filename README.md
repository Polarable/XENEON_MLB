# Xeneon Edge baseball widget

A 2560×720 page for the iCUE iFrame widget on the Corsair Xeneon Edge.

- `index.html`: the news page. Swipe the row and whichever story is leftmost grows into the double-wide headliner with a text preview; tap any story to read its opening paragraphs. It scales to fit the iFrame and remembers the team you pick.
- **Scores** (`scores.js`): the day's games as cards (Final, live with bases/outs/count, or upcoming with probable pitchers); arrows jump between game days, and in the offseason it opens on the last day games were played. Pick a team to see its whole season instead. Refreshes every 8 seconds while games are live.
- **Standings** (`standings.js`): AL and NL divisions, or the wild card races.
- **Rosters** (`team.js`): all 30 teams by division.
- Tapping a game opens the game page (`game.js`): linescore, decisions and a Baseball Reference style box score, plus scoring plays and play-by-play; live games check for new pitches every 3 seconds. Tapping a team opens its team page (`team.js`): 40-man/active roster, standard batting, standard pitching, and schedule & results. Tapping a player opens their player page (`player.js`): bio, year-by-year stats and this season's game log. Pages stack, so Back returns to where you were.
- **Gameday** (`gameday.js`, the first view on a live game page), laid out like the Real app's feed: a "Now batting" panel with the pitch list and a strike zone seen from the pitcher's side (the batter silhouette in `img/batter-hd.png` stands on the hitter's real side, and every pitch flies in from its Statcast release point with trails and break), plus on deck and in the hole; Real-style play cards (photo, headline like "417' grand slam to right-center", batter and pitcher game lines, pitch list next to a mini zone, tidbits), showing recent plays and then key plays; and MLB Film Room video on the right. Tapping a card replays that at-bat and its clip. The left panel shows the live field with runners' photos on their bases and large ball/strike/out dots.
- Game times are shown in the device's local time zone.
- `mlb.js` holds the shared MLB Stats API helpers, touch scrolling and tables; `views.css` styles all of the above.
- Scores, standings and rosters read the MLB Stats API (statsapi.mlb.com) directly from the browser, so they stay live even if the scheduled news job runs late.
- `teams.js`: the 30 teams (MLB ids, colors, MLB Trade Rumors feed names).
- `scripts/fetch-news.js`: pulls the newest MLB Trade Rumors articles (league-wide plus each team's feed), adds each article's thumbnail (its og:image) and opening paragraphs from the feed, and writes `news.json`.
- `scripts/fetch-logos.js`: downloads each team's MLB logo into `logos/`, using MLB's dark-background ("on dark") versions where they exist.
- `.github/workflows/news.yml`: runs both scripts every 15 minutes on GitHub, saves `news.json` and new logos to the repo, and publishes the site to GitHub Pages.

The browser can't read MLB Trade Rumors directly (its RSS has no thumbnails and is blocked cross-origin), so the fetcher builds `news.json` ahead of time and the page just reads it.

## Setup
1. Push these files to a GitHub repo.
2. Settings → Pages → Source: **GitHub Actions**.
3. Actions → "Update news" → Run workflow (first fill and first publish).
4. In iCUE, add an iFrame widget at full width with the URL `https://<user>.github.io/<repo>/`.
