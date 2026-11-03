// Turns player names in a news story into links to their player pages.
// fetch-news.js stores each article's names as `players: [["Kyle Tucker", 663656], ...]`.
// Returns escaped HTML; any element with data-player opens that player's page.
function linkPlayers(text, players, esc) {
  if (!text || !players?.length) return esc(text || "");
  const ids = new Map(players);
  const rx = new RegExp(`(${[...ids.keys()].sort((a, b) => b.length - a.length)
    .map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`, "g");
  return text.split(rx).map((part, i) => i % 2
    ? `<a class="plink" role="button" data-player="${ids.get(part)}">${esc(part)}</a>`
    : esc(part)).join("");
}
