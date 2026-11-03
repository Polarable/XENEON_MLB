// League leaders: the fourth Standings view. Top 5 in the main hitting and pitching stats, for MLB, the AL or the NL.
// Tap a player to open his page.
const Leaders = (() => {
  const HIT = [["battingAverage", "Batting average"], ["homeRuns", "Home runs"], ["runsBattedIn", "RBI"], ["onBasePlusSlugging", "OPS"], ["stolenBases", "Stolen bases"]];
  const PIT = [["earnedRunAverage", "ERA"], ["strikeouts", "Strikeouts"], ["wins", "Wins"], ["saves", "Saves"], ["walksAndHitsPerInningPitched", "WHIP"]];
  const LG = { mlb: "", al: "&leagueId=103", nl: "&leagueId=104" };
  let token = 0;

  async function fetchGroup(cats, group, season, lg) {
    const data = await api(`/api/v1/stats/leaders?leaderCategories=${cats.map((c) => c[0]).join(",")}&season=${season}&statGroup=${group}&sportId=1&limit=5${LG[lg] || ""}`, { ttl: 30 * 60_000 });
    const by = {};
    for (const l of data.leagueLeaders || []) if (!by[l.leaderCategory] && (!l.statGroup || l.statGroup === group)) by[l.leaderCategory] = l.leaders || [];
    return cats.map(([k, label]) => ({ label, rows: by[k] || [] }));
  }
  function card({ label, rows }) {
    const r = rows.map((x) => {
      const t = teamMeta(x.team || {});
      return `<div class="ld-r lnk" data-player="${x.person?.id}"><span class="rk">${esc(x.rank)}</span>
        <img class="hs" src="${headshot(x.person?.id, 100)}" alt="" onerror="this.style.visibility='hidden'">
        <span class="nm">${esc(x.person?.fullName || "")}</span>${x.team ? logoImg(t, "tl") : ""}<span class="v">${esc(x.value)}</span></div>`;
    }).join("");
    return `<div class="ld-card"><div class="ld-h">${esc(label)}</div>${r || `<div class="muted">No leaders yet</div>`}</div>`;
  }
  async function render(box, season, lg) {
    const my = ++token;
    box.innerHTML = `<div class="s-loading">Loading leaders…</div>`;
    try {
      const [h, p] = await Promise.all([fetchGroup(HIT, "hitting", season, lg), fetchGroup(PIT, "pitching", season, lg)]);
      if (my !== token) return;
      box.innerHTML = `<div class="ld-grid">${h.map(card).join("")}${p.map(card).join("")}</div>`;
    } catch (e) {
      console.warn(e);
      if (my === token) box.innerHTML = `<div class="empty"><div>Couldn't load leaders. Try again in a moment.</div></div>`;
    }
  }
  return { render };
})();
