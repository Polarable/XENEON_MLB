// Graphic Builder: pick a player, the seasons and stats to show, and a look, then save the card as a PNG.
// The card is drawn straight onto a canvas, so the preview is exactly the image that gets saved.
// Data: the MLB Stats API (mlb.js) plus the minor league / international helpers in player.js.
(() => {
  const $ = (id) => document.getElementById(id);
  const canvas = $("card"), ctx = canvas.getContext("2d");

  /* ---------- Settings ---------- */
  const SIZES = {
    wide: { W: 1920, H: 1080, u: 1.15, label: "Wide", cols: 8, rows: 5 },
    square: { W: 1080, H: 1080, u: 1, label: "Square", cols: 5, rows: 5 },
    portrait: { W: 1080, H: 1350, u: 1, label: "Portrait", cols: 5, rows: 7 },
    story: { W: 1080, H: 1920, u: 1.05, label: "Story", cols: 5, rows: 9 },
  };
  const BGS = { photo: "Action photo", team: "Team color", black: "Black", upload: "Your image" };
  const TOGGLES = [["head", "Headshot"], ["team", "Team"], ["num", "Number and position"], ["status", "Roster status"], ["mark", "SHUTOUT mark"], ["credit", "Stats credit"]];
  const KEY = "graphic-style";
  const DEFAULTS = {
    size: "square", bg: "photo", dim: 35, blur: 0, focus: 30, oldestFirst: false,
    show: { head: true, team: true, num: true, status: true, mark: true, credit: true },
    cols: { hitting: ["AVG", "HR", "RBI", "OPS"], pitching: ["W-L", "ERA", "SO", "WHIP"] },
  };
  let st;
  try { const s = JSON.parse(localStorage.getItem(KEY) || "{}"); st = { ...DEFAULTS, ...s, show: { ...DEFAULTS.show, ...s.show }, cols: { ...DEFAULTS.cols, ...s.cols } }; }
  catch { st = structuredClone(DEFAULTS); }
  if (!SIZES[st.size]) st.size = "square";
  if (st.bg === "upload") st.bg = "photo";   // an uploaded image isn't kept between visits
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(st)); } catch {} };

  /* ---------- Stats ---------- */
  const val = (v) => (v == null || v === "" || v === "-.--" || v === ".---" ? "–" : String(v));
  const STATS = {
    hitting: [
      ["AVG", (s) => rate(s.avg)], ["HR", (s) => s.homeRuns], ["RBI", (s) => s.rbi], ["OPS", (s) => rate(s.ops)],
      ["H", (s) => s.hits], ["R", (s) => s.runs], ["SB", (s) => s.stolenBases], ["OBP", (s) => rate(s.obp)], ["SLG", (s) => rate(s.slg)],
      ["BB", (s) => s.baseOnBalls], ["SO", (s) => s.strikeOuts], ["2B", (s) => s.doubles], ["3B", (s) => s.triples],
      ["G", (s) => s.gamesPlayed], ["PA", (s) => s.plateAppearances], ["AB", (s) => s.atBats], ["TB", (s) => s.totalBases],
    ],
    pitching: [
      ["W-L", (s) => `${s.wins ?? 0}-${s.losses ?? 0}`], ["ERA", (s) => rate(s.era)], ["SO", (s) => s.strikeOuts], ["WHIP", (s) => rate(s.whip)],
      ["IP", (s) => s.inningsPitched], ["G", (s) => s.gamesPitched ?? s.gamesPlayed], ["GS", (s) => s.gamesStarted], ["SV", (s) => s.saves],
      ["BB", (s) => s.baseOnBalls], ["H", (s) => s.hits], ["HR", (s) => s.homeRuns], ["K/9", (s) => rate(s.strikeoutsPer9Inn)],
      ["BB/9", (s) => rate(s.walksPer9Inn)], ["SO/BB", (s) => rate(s.strikeoutWalkRatio)], ["OPP AVG", (s) => rate(s.avg)], ["HLD", (s) => s.holds],
    ],
  };
  const statFn = (g, h) => (STATS[g].find((x) => x[0] === h) || [])[1];

  /* ---------- Player data ---------- */
  let P = null;        // { p, team, groups, opts: {hitting:[...], pitching:[...]}, status }
  let group = "hitting";
  let picked = new Set();   // option keys shown on the card
  let text = { kicker: "", first: "", last: "" };
  let teamPick = "";        // "" = automatic, "none", or an MLB team id
  let upload = null;

  const pickTotal = (rows) => rows.find((r) => !r.team) || rows.slice().sort((a, b) =>
    ((b.stat.plateAppearances || b.stat.battersFaced || 0) - (a.stat.plateAppearances || a.stat.battersFaced || 0)))[0];
  const abbrOf = (t) => (t && (teamById[t.id]?.abbr || t.abbreviation || t.name)) || "";
  const played = (g, s) => g === "hitting" ? (s.plateAppearances > 0 || s.gamesPlayed > 0) : (s.battersFaced > 0 || parseFloat(s.inningsPitched) > 0 || s.gamesPitched > 0);

  // Every row the card can show for one stat group, in the order they appear on the card.
  function buildOptions(g, years, career, other) {
    const out = [];
    const bySeason = (splits, keyFn) => {
      const m = new Map();
      for (const s of splits) { const k = keyFn(s); if (!m.has(k)) m.set(k, []); m.get(k).push(s); }
      return [...m.values()];
    };
    // Majors
    for (const rows of bySeason(years.filter((s) => s.stat && played(g, s.stat)), (s) => s.season)) {
      const tot = pickTotal(rows), season = +tot.season;
      out.push({ key: `mlb|${season}`, kind: "season", level: "mlb", season, rank: 100, label: String(season),
        sub: rows.filter((r) => r.team).map((r) => abbrOf(r.team)).join("/"), stat: tot.stat, team: rows.filter((r) => r.team).pop()?.team });
    }
    if (career && out.length) out.push({ key: "mlb|career", kind: "career", level: "mlb", rank: 100, label: "Career", stat: career });
    // Minors, international and winter ball
    for (const [lv, L] of Object.entries(other || {})) {
      for (const rows of bySeason(L[g] || [], (s) => `${s.season}|${s.sportId}`)) {
        const tot = pickTotal(rows), season = +tot.season, lev = LEV[tot.sportId] || tot.sportAbbr || "";
        out.push({ key: `${tot.sportId}|${season}`, kind: "season", level: lv, season, rank: 50 - levelRank(tot.sportId), label: `${season} ${lev}`,
          sub: rows.filter((r) => r.team).map((r) => r.team.name).join(", "), stat: tot.stat });
      }
      for (const c of (L.careers || {})[g] || []) {
        const lev = LEV[c.sportId] || c.sportAbbr || "";
        out.push({ key: `${c.sportId}|career`, kind: "career", level: lv, rank: 50 - levelRank(c.sportId), label: `${lev} career`, stat: c.stat });
      }
    }
    return out;
  }

  async function loadPlayer(id) {
    $("note").textContent = "";
    $("empty").textContent = "Loading…"; $("empty").hidden = false;
    const [pd, sd, other] = await Promise.all([
      apiTry([`/api/v1/people/${id}?hydrate=currentTeam,rosterEntries`, `/api/v1/people/${id}`], { ttl: 3600_000 }),
      apiTry([`/api/v1/people/${id}/stats?stats=yearByYear,career&group=hitting,pitching&sportId=1`,
        `/api/v1/people/${id}/stats?stats=yearByYear,career&group=hitting,pitching`], { ttl: 600_000 }).catch(() => ({ stats: [] })),
      loadOtherLevels(id).catch(() => ({})),
    ]);
    const p = pd.people?.[0];
    if (!p) throw new Error("Player not found");
    const block = (type, g) => (sd.stats || []).find((s) => s.type?.displayName === type && s.group?.displayName === g)?.splits || [];
    const opts = {};
    for (const g of ["hitting", "pitching"]) {
      opts[g] = buildOptions(g, block("yearByYear", g).filter(mlbOnly), block("career", g)[0]?.stat, other);
    }
    // A pitcher's handful of plate appearances doesn't make him a hitter (same rule as the player page).
    const pos = p.primaryPosition?.abbreviation;
    const pa = opts.hitting.filter((o) => o.kind === "season").reduce((a, o) => a + (o.stat.plateAppearances || 0), 0);
    if (pos === "P" && pa < 50) opts.hitting = [];
    const groups = (pos === "P" || pos === "TWP" ? ["pitching", "hitting"] : ["hitting", "pitching"]).filter((g) => opts[g].length);

    // Team: his MLB club, the parent club of his minor league team, or (retired) his last MLB club.
    let team = null, affiliate = null;
    const ct = p.currentTeam;
    if (ct && teamById[ct.id]) team = teamById[ct.id];
    else if (ct?.id) {
      const t = await api(`/api/v1/teams/${ct.id}`, { ttl: 86_400_000 }).then((d) => d.teams?.[0]).catch(() => null);
      affiliate = t || ct;
      if (t?.parentOrgId && teamById[t.parentOrgId]) team = teamById[t.parentOrgId];
    }
    if (!team) {
      const last = [...(opts.pitching || []), ...(opts.hitting || [])].filter((o) => o.level === "mlb" && o.team).sort((a, b) => b.season - a.season)[0];
      if (last && teamById[last.team.id]) team = teamById[last.team.id];
    }
    // Roster status from the latest roster entry, worded like the player page.
    const entry = (p.rosterEntries || []).slice().sort((x, y) => String(x.startDate || "").localeCompare(String(y.startDate || ""))).filter((r) => !r.endDate || r.isActive).pop();
    let status = null;
    if (entry) {
      const code = entry.status?.code || "", d = entry.status?.description || "";
      const tone = /^D\d|injur/i.test(`${code} ${d}`) ? "bad" : /^(DES|DFA)|design|release|waiv|outright/i.test(`${code} ${d}`) ? "warn" : code === "A" ? "ok" : "";
      const parts = [code === "A" ? "Active roster" : d];
      if (entry.isActiveFortyMan && code !== "A") parts.push("40-man");
      status = { text: parts.filter(Boolean).join(" · "), tone };
    } else if (p.active === false) status = { text: "Retired", tone: "" };
    else if (!ct) status = { text: "Free agent", tone: "" };
    if (affiliate && !teamById[affiliate.id]) {
      const lev = LEV[affiliate.sport?.id] || affiliate.sport?.abbreviation || "";
      const where = `${affiliate.name || affiliate.teamName || ""}${lev ? ` (${lev})` : ""}`;
      status = { text: [status?.text, where].filter(Boolean).join(" · "), tone: status?.tone || "" };
    }

    P = { p, team, groups, opts, status };
    group = groups.includes(new URLSearchParams(location.search).get("g")) ? new URLSearchParams(location.search).get("g") : groups[0] || "hitting";
    text = { kicker: "", first: p.useName || p.firstName || (p.fullName || "").split(" ")[0], last: `${p.useLastName || p.lastName || ""}${p.nameSuffix ? ` ${p.nameSuffix}` : ""}` };
    teamPick = "";
    defaultRows();
    const url = new URL(location.href); url.searchParams.set("id", id); url.searchParams.set("g", group);
    history.replaceState(null, "", url);
    drawControls();
    render();
  }

  // Start with his latest season and his career, like the player page's summary.
  function defaultRows() {
    picked = new Set();
    const o = P?.opts[group] || [];
    const mlbSeasons = o.filter((x) => x.level === "mlb" && x.kind === "season");
    if (mlbSeasons.length) {
      picked.add(mlbSeasons.sort((a, b) => b.season - a.season)[0].key);
      if (o.some((x) => x.key === "mlb|career")) picked.add("mlb|career");
    } else {
      const seasons = o.filter((x) => x.kind === "season");
      const last = Math.max(...seasons.map((x) => x.season));
      seasons.filter((x) => x.season === last).sort((a, b) => b.rank - a.rank).slice(0, 2).forEach((x) => picked.add(x.key));
    }
  }

  // The rows on the card: seasons (newest first unless flipped), then careers, majors first.
  function cardRows() {
    const o = (P?.opts[group] || []).filter((x) => picked.has(x.key));
    const seasons = o.filter((x) => x.kind === "season").sort((a, b) => (b.season - a.season) || (b.rank - a.rank));
    if (st.oldestFirst) seasons.reverse();
    const careers = o.filter((x) => x.kind === "career").sort((a, b) => b.rank - a.rank);
    const onlyMlb = o.every((x) => x.level === "mlb");
    return [...seasons, ...careers].map((x) => ({ ...x, label: x.key === "mlb|career" && !onlyMlb ? "MLB career" : x.label }));
  }

  /* ---------- Controls ---------- */
  const seg = (el, items, cur, on) => {
    el.innerHTML = items.map(([k, l]) => `<button type="button" data-k="${esc(k)}" class="${k === cur ? "on" : ""}">${esc(l)}</button>`).join("");
    el.onclick = (e) => { const b = e.target.closest("button"); if (b) on(b.dataset.k); };
  };
  let showAllSeasons = false;

  function drawControls() {
    const has = !!P;
    $("opts").hidden = !has;
    if (!has) return;
    const { p } = P;
    $("picked").innerHTML = `<img src="${headshot(p.id, 60)}" alt=""><div><b>${esc(p.fullName)}</b><em>${esc([p.primaryPosition?.abbreviation, P.team && P.team.name].filter(Boolean).join(" · "))}</em></div>`;
    $("results").innerHTML = "";

    $("sec-group").hidden = P.groups.length < 2;
    seg($("group"), P.groups.map((g) => [g, g === "hitting" ? "Batting" : "Pitching"]), group, (g) => {
      group = g; defaultRows(); showAllSeasons = false;
      const url = new URL(location.href); url.searchParams.set("g", g); history.replaceState(null, "", url);
      drawControls(); render();
    });

    // Rows, grouped by level.
    const o = P.opts[group];
    const max = SIZES[st.size].rows;
    $("rows-n").textContent = `${picked.size} of ${max}`;
    const chip = (x) => `<button type="button" class="chip ${picked.has(x.key) ? "on" : ""}" data-row="${esc(x.key)}" title="${esc(x.sub || "")}" ${!picked.has(x.key) && picked.size >= max ? "disabled" : ""}>${esc(x.label)}${x.sub && x.level === "mlb" ? `<i>${esc(x.sub)}</i>` : ""}</button>`;
    const sec = (title, list, cap) => {
      if (!list.length) return "";
      const careers = list.filter((x) => x.kind === "career");
      let seasons = list.filter((x) => x.kind === "season").sort((a, b) => (b.season - a.season) || (b.rank - a.rank));
      const hidden = cap && !showAllSeasons && seasons.length > cap ? seasons.length - cap : 0;
      if (hidden) seasons = seasons.filter((x, i) => i < cap || picked.has(x.key));
      const careerChips = careers.map(chip).join("");
      return `<div class="grp"><span>${title}</span><div class="chips">${careerChips}${seasons.map(chip).join("")}</div>
        ${hidden ? `<button type="button" class="more" data-more>Show ${hidden} more</button>` : ""}</div>`;
    };
    $("rows").innerHTML = sec("Majors", o.filter((x) => x.level === "mlb"), 12)
      + sec("Minors", o.filter((x) => x.level === "minors"), 12)
      + sec("International and winter", o.filter((x) => x.level === "intl"), 8)
      + `<div class="row" style="margin-top:12px"><label>Oldest season first</label><button type="button" class="tog ${st.oldestFirst ? "on" : ""}" data-oldest aria-pressed="${st.oldestFirst}"></button></div>`;
    $("rows").onclick = (e) => {
      if (e.target.closest("[data-more]")) { showAllSeasons = true; drawControls(); return; }
      if (e.target.closest("[data-oldest]")) { st.oldestFirst = !st.oldestFirst; save(); drawControls(); render(); return; }
      const b = e.target.closest("[data-row]"); if (!b || b.disabled) return;
      const k = b.dataset.row;
      picked.has(k) ? picked.delete(k) : picked.add(k);
      drawControls(); render();
    };

    // Stat columns, in the order they were picked.
    const maxC = SIZES[st.size].cols;
    const cols = st.cols[group];
    $("cols-n").textContent = `${Math.min(cols.length, maxC)} of ${maxC}`;
    $("cols").innerHTML = STATS[group].map(([h]) => {
      const i = cols.indexOf(h);
      return `<button type="button" class="chip ${i >= 0 ? "on" : ""}" data-col="${esc(h)}" ${i < 0 && cols.length >= maxC ? "disabled" : ""}>${esc(h)}${i >= 0 ? `<i>${i + 1}</i>` : ""}</button>`;
    }).join("");
    $("cols").onclick = (e) => {
      const b = e.target.closest("[data-col]"); if (!b || b.disabled) return;
      const h = b.dataset.col, list = st.cols[group];
      const i = list.indexOf(h);
      if (i >= 0) list.splice(i, 1); else list.push(h);
      save(); drawControls(); render();
    };

    seg($("size"), Object.entries(SIZES).map(([k, s]) => [k, s.label]), st.size, (k) => {
      st.size = k; save();
      const s = SIZES[k];
      // Trim to what fits the new size.
      if (picked.size > s.rows) picked = new Set(cardRows().slice(0, s.rows).map((x) => x.key));
      drawControls(); render();
    });
    seg($("bg"), Object.entries(BGS), st.bg, (k) => {
      if (k === "upload") { $("upload").click(); return; }
      st.bg = k; save(); drawControls(); render();
    });
    $("bg-tune").hidden = st.bg === "team" || st.bg === "black";
    $("dim").value = st.dim; $("blur").value = st.blur; $("focus").value = st.focus;

    $("kicker").value = text.kicker; $("first").value = text.first; $("last").value = text.last;
    if (!$("team-pick")) {
      const row = document.createElement("div");
      row.className = "row";
      row.innerHTML = `<label for="team-pick">Team</label><select id="team-pick" style="flex:1;max-width:220px;height:38px;padding:0 10px;border-radius:10px;background:var(--input);border:1px solid rgba(255,255,255,.12)"></select>`;
      $("last").closest(".row").after(row);
      $("team-pick").onchange = (e) => { teamPick = e.target.value; render(); };
    }
    $("team-pick").innerHTML = `<option value="">${esc(P.team ? `${P.team.name} (current)` : "Automatic")}</option>`
      + TEAMS.slice().sort((a, b) => a.name.localeCompare(b.name)).map((t) => `<option value="${t.id}">${esc(t.name)}</option>`).join("")
      + `<option value="none">No team</option>`;
    $("team-pick").value = teamPick;

    $("toggles").innerHTML = TOGGLES.map(([k, l]) => `<div class="row"><label>${esc(l)}</label><button type="button" class="tog ${st.show[k] ? "on" : ""}" data-tog="${k}" aria-pressed="${!!st.show[k]}" aria-label="${esc(l)}"></button></div>`).join("");
    $("toggles").onclick = (e) => { const b = e.target.closest("[data-tog]"); if (!b) return; st.show[b.dataset.tog] = !st.show[b.dataset.tog]; save(); drawControls(); render(); };
  }

  for (const k of ["dim", "blur", "focus"]) $(k).oninput = (e) => { st[k] = +e.target.value; save(); render(); };
  for (const k of ["kicker", "first", "last"]) $(k).oninput = (e) => { text[k] = e.target.value; render(); };
  $("upload").onchange = (e) => {
    const f = e.target.files?.[0]; if (!f) return;
    if (upload) URL.revokeObjectURL(upload);
    upload = URL.createObjectURL(f);
    st.bg = "upload"; drawControls(); render();
    e.target.value = "";
  };

  /* ---------- Player search ---------- */
  const norm = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  let roster = null, timer = 0, remote = [], remoteQ = "";
  const loadRoster = () => roster || (roster = api(`/api/v1/sports/1/players?season=${currentSeason()}&fields=people,id,fullName,primaryPosition,abbreviation,currentTeam,id`, { ttl: 6 * 3600_000 })
    .then((d) => (d.people || []).map((p) => ({ id: p.id, name: p.fullName, n: norm(p.fullName), pos: p.primaryPosition?.abbreviation || "", team: p.currentTeam?.id })))
    .catch(() => []));
  const score = (n, s) => (n.startsWith(s) ? 0 : n.split(/\s+/).some((w) => w.startsWith(s)) ? 1 : n.includes(s) ? 2 : 9);
  async function drawResults() {
    const s = norm($("q").value.trim());
    if (!s) { $("results").innerHTML = ""; return; }
    const list = await loadRoster();
    if (norm($("q").value.trim()) !== s) return;
    let people = list.map((p) => ({ p, k: score(p.n, s) })).filter((x) => x.k < 9).sort((a, b) => a.k - b.k || a.p.name.localeCompare(b.p.name)).slice(0, 8).map((x) => x.p);
    if (remoteQ === s) people = people.concat(remote.filter((r) => !people.some((p) => p.id === r.id))).slice(0, 10);
    $("results").innerHTML = people.length ? people.map((p) => {
      const t = teamById[p.team];
      return `<button type="button" data-id="${p.id}"><img src="${headshot(p.id, 40)}" alt="" loading="lazy"><span><b>${esc(p.name)}</b><em>${esc([p.pos, t ? t.name : p.old ? "Retired" : p.minors ? "Minors" : ""].filter(Boolean).join(" · "))}</em></span></button>`;
    }).join("") : `<div class="empty" style="font-size:14px;padding:8px 4px;text-align:left">${s.length < 3 ? "Keep typing…" : "Searching…"}</div>`;
  }
  $("q").onfocus = () => loadRoster();
  $("q").oninput = () => {
    drawResults();
    clearTimeout(timer);
    const s = norm($("q").value.trim());
    if (s.length < 3) return;
    timer = setTimeout(() => {
      apiTry([`/api/v1/people/search?names=${encodeURIComponent(s)}&sportIds=1,11,12,13,14,15,16,5442`, `/api/v1/people/search?names=${encodeURIComponent(s)}&sportIds=1`], { ttl: 3600_000 })
        .then((d) => {
          remote = (d.people || []).map((p) => ({ id: p.id, name: p.fullName, pos: p.primaryPosition?.abbreviation || "", team: p.currentTeam?.id, old: p.active === false, minors: p.active !== false && !teamById[p.currentTeam?.id] }));
          remoteQ = s; drawResults();
        }).catch(() => {});
    }, 300);
  };
  $("q").onkeydown = (e) => { if (e.key === "Enter") $("results").querySelector("button")?.click(); };
  $("results").onclick = (e) => {
    const b = e.target.closest("[data-id]"); if (!b) return;
    $("q").value = ""; $("q").blur();
    choose(+b.dataset.id);
  };
  async function choose(id) {
    try { await loadPlayer(id); }
    catch (err) { $("empty").hidden = false; $("empty").textContent = "Couldn't load that player. Check the connection and try again."; console.error(err); }
  }

  /* ---------- Images ---------- */
  // Images are loaded with CORS so the canvas can be saved. If a host won't allow that, the image still
  // shows in the preview (marked "tainted") and is left out of the saved PNG.
  const imgCache = new Map();
  function loadImg(src, cors) {
    const key = `${cors ? 1 : 0}|${src}`;
    if (!imgCache.has(key)) imgCache.set(key, new Promise((res) => {
      const i = new Image();
      if (cors) i.crossOrigin = "anonymous";
      i.referrerPolicy = "no-referrer";
      i.decoding = "async";
      i.onload = () => res(i);
      i.onerror = () => res(null);
      i.src = src;
    }));
    return imgCache.get(key);
  }
  async function firstImg(srcs, minW = 0) {
    const ok = (i) => i && (!minW || i.naturalWidth >= minW);
    for (const s of srcs) { const i = await loadImg(s, true); if (ok(i)) return { img: i, clean: true }; }
    for (const s of srcs) { const i = await loadImg(s, false); if (ok(i)) return { img: i, clean: false }; }
    return null;
  }
  const banners = (id) => [
    `https://img.mlbstatic.com/mlb-photos/image/upload/t_16x9/t_w2208/v1/people/${id}/action/hero/current`,
    `https://img.mlbstatic.com/mlb-photos/image/upload/w_1800,q_auto:best/v1/people/${id}/action/hero/current`,
    `https://img.mlbstatic.com/mlb-photos/image/upload/w_1800,q_auto:best/v1/people/${id}/action/1/current`,
  ];
  const logoSrc = (t) => `../logos/${t.abbr}.svg`;

  /* ---------- Drawing ---------- */
  const FONT = '"Inter Tight", "Inter", system-ui, sans-serif';
  const font = (w, px) => `${w} ${Math.round(px)}px ${FONT}`;
  const fontsReady = Promise.all([300, 400, 500, 600, 700, 800].map((w) => document.fonts?.load(font(w, 40)))).catch(() => {});
  const TONE = { ok: "#7fdc9f", bad: "#f06a6a", warn: "#ffb35a", "": "rgba(255,255,255,.55)" };
  const filterOK = (() => { try { const c = document.createElement("canvas").getContext("2d"); c.filter = "blur(2px)"; return c.filter === "blur(2px)"; } catch { return false; } })();

  function cover(c, img, W, H, focusY, blur) {
    const iw = img.naturalWidth || img.width || W, ih = img.naturalHeight || img.height || H;
    const k = Math.max(W / iw, H / ih) * (blur ? 1.06 : 1);
    const dw = iw * k, dh = ih * k, dx = (W - dw) / 2, dy = (H - dh) * focusY;
    if (!blur) { c.drawImage(img, dx, dy, dw, dh); return; }
    if (filterOK) { c.save(); c.filter = `blur(${blur}px)`; c.drawImage(img, dx, dy, dw, dh); c.restore(); return; }
    // No canvas filter (older Safari): shrink and stretch back, which blurs.
    const f = Math.max(0.02, 1 / (1 + blur / 3));
    const t = document.createElement("canvas");
    t.width = Math.max(1, Math.round(W * f)); t.height = Math.max(1, Math.round(H * f));
    const tc = t.getContext("2d"); tc.imageSmoothingQuality = "high";
    tc.drawImage(img, dx * f, dy * f, dw * f, dh * f);
    c.imageSmoothingQuality = "high"; c.drawImage(t, 0, 0, W, H);
  }
  function fitFont(c, w, size, min, maxW, str) {
    let s = size;
    c.font = font(w, s);
    while (s > min && c.measureText(str).width > maxW) { s -= 2; c.font = font(w, s); }
    return s;
  }
  function spaced(c, px) { if ("letterSpacing" in c) c.letterSpacing = `${px}px`; }

  let renderId = 0;
  let tainted = false;
  async function render({ forExport = false } = {}) {
    const my = ++renderId;
    const has = !!P;
    $("empty").hidden = has;
    for (const b of ["dl", "copy", "share"]) $(b).disabled = !has;
    canvas.style.display = has ? "" : "none";
    if (!has) return null;
    await fontsReady;

    const S = SIZES[st.size], { W, H } = S, u = S.u;
    const { p } = P;
    const team = teamPick === "none" ? null : teamPick ? teamById[+teamPick] : P.team;
    const rows = cardRows();
    const cols = st.cols[group].slice(0, S.cols).map((h) => [h, statFn(group, h)]).filter((x) => x[1]);

    // Images (cached after the first load, so later redraws are instant).
    const [bgImg, headImg, logoImg, markImg] = await Promise.all([
      st.bg === "photo" ? firstImg(banners(p.id), 400) : st.bg === "upload" && upload ? firstImg([upload]) : null,
      st.show.head ? firstImg([headshot(p.id, 420)]) : null,
      st.show.team && team ? firstImg([logoSrc(team)]) : null,
      st.show.mark ? firstImg(["../brand/shutout-logo.png"]) : null,
    ]);
    if (my !== renderId && !forExport) return null;
    const use = (x) => x && (x.clean || !forExport) ? x.img : null;
    const dropped = [bgImg, headImg, logoImg].some((x) => x && !x.clean);

    const cv = forExport ? document.createElement("canvas") : canvas;
    cv.width = W; cv.height = H;
    const c = cv.getContext("2d");
    c.clearRect(0, 0, W, H);
    c.textBaseline = "alphabetic";

    /* Background */
    const tc = team?.color || "#333";
    c.fillStyle = "#0a0a0a"; c.fillRect(0, 0, W, H);
    const photo = use(bgImg);
    if (photo) {
      cover(c, photo, W, H, st.focus / 100, st.blur * u);
      c.fillStyle = `rgba(0,0,0,${st.dim / 100})`; c.fillRect(0, 0, W, H);
    } else if (st.bg === "team" || (st.bg !== "black" && !photo)) {
      const g = c.createLinearGradient(W, 0, 0, H);
      g.addColorStop(0, tc); g.addColorStop(0.75, "#000");
      c.fillStyle = g; c.fillRect(0, 0, W, H);
      c.fillStyle = "rgba(0,0,0,.35)"; c.fillRect(0, 0, W, H);
    } else {
      const g = c.createLinearGradient(0, 0, 0, H);
      g.addColorStop(0, "#161616"); g.addColorStop(1, "#000");
      c.fillStyle = g; c.fillRect(0, 0, W, H);
    }

    /* Layout, from the bottom up: footer, stat table, then the name block above it. */
    const pad = (st.size === "wide" ? 96 : 72) * u;
    const footH = st.show.mark || st.show.credit ? 64 * u : 0;
    const nR = rows.length, nC = cols.length;
    let rh = 132 * u;
    const tableMax = H * (st.size === "wide" ? 0.5 : st.size === "story" ? 0.5 : 0.48);
    if (nR * rh > tableMax) rh = Math.max(84 * u, tableMax / nR);
    const k = rh / (132 * u);           // shrinks type along with the rows
    const tableH = nR * rh;
    const tableTop = H - pad - footH - tableH;

    const D = (st.size === "wide" ? 250 : 210) * u;
    const headOn = st.show.head && use(headImg);
    const tx = pad + (headOn ? D + 46 * u : 0);
    const tw = W - pad - tx;
    // Text block
    const lines = [];
    if (text.kicker.trim()) lines.push({ kind: "kicker", h: 44 * u });
    const nameStr = `${text.first} ${text.last}`.trim();
    c.font = font(300, 100);
    const nf = Math.min(st.size === "wide" ? 124 * u : 104 * u, fitFont(c, 700, st.size === "wide" ? 124 * u : 104 * u, 40 * u, tw, nameStr || " "));
    lines.push({ kind: "name", h: nf * 1.06 });
    if (st.show.team && team) lines.push({ kind: "team", h: 64 * u });
    const numStr = [p.primaryNumber ? `#${p.primaryNumber}` : "", p.primaryPosition?.abbreviation || ""].filter(Boolean).join(" · ");
    if (st.show.num && numStr) lines.push({ kind: "num", h: 48 * u });
    if (st.show.status && P.status?.text) lines.push({ kind: "status", h: 46 * u });
    const th = lines.reduce((a, l) => a + l.h, 0) + (lines.length - 1) * 8 * u;
    const hh = Math.max(headOn ? D : 0, th);
    const headerBottom = tableTop - (nR ? 58 * u : 0);
    const headerTop = headerBottom - hh;

    // Darken behind the text so it always reads, strongest at the bottom and left, like the reference.
    if (photo) {
      const g = c.createLinearGradient(0, Math.max(0, headerTop - 260 * u), 0, H);
      g.addColorStop(0, "rgba(0,0,0,0)"); g.addColorStop(0.45, "rgba(0,0,0,.6)"); g.addColorStop(1, "rgba(0,0,0,.92)");
      c.fillStyle = g; c.fillRect(0, 0, W, H);
      const g2 = c.createLinearGradient(0, 0, W * 0.7, 0);
      g2.addColorStop(0, "rgba(0,0,0,.45)"); g2.addColorStop(1, "rgba(0,0,0,0)");
      c.fillStyle = g2; c.fillRect(0, 0, W, H);
    }

    /* Headshot */
    if (headOn) {
      const cx = pad + D / 2, cy = headerTop + hh / 2, r = D / 2;
      c.save();
      c.beginPath(); c.arc(cx, cy, r, 0, Math.PI * 2); c.closePath();
      const rg = c.createRadialGradient(cx, cy - r * 0.3, r * 0.1, cx, cy, r);
      rg.addColorStop(0, "#4a4a4a"); rg.addColorStop(1, "#262626");
      c.fillStyle = rg; c.fill();
      c.clip();
      const img = use(headImg), iw = img.naturalWidth || 213, ih = img.naturalHeight || 320;
      const dw = D * 1.02, dh = dw * ih / iw;
      c.drawImage(img, cx - dw / 2, cy - r + D * 0.05, dw, dh);
      c.restore();
      c.beginPath(); c.arc(cx, cy, r - u, 0, Math.PI * 2);
      c.strokeStyle = "rgba(255,255,255,.14)"; c.lineWidth = 2 * u; c.stroke();
    }

    /* Text */
    let y = headerTop + (hh - th) / 2;
    for (const l of lines) {
      const base = y + l.h * 0.78;
      if (l.kind === "kicker") {
        c.font = font(600, 30 * u); c.fillStyle = "rgba(255,255,255,.62)";
        c.fillText(text.kicker.trim(), tx, base);
      } else if (l.kind === "name") {
        const first = text.first.trim(), last = text.last.trim();
        c.font = font(300, nf); c.fillStyle = "rgba(255,255,255,.86)";
        c.fillText(first, tx, base);
        const fw = first ? c.measureText(first + " ").width : 0;
        c.font = font(700, nf); c.fillStyle = "#fff";
        c.fillText(last, tx + fw, base);
      } else if (l.kind === "team") {
        const ls = 50 * u, img = use(logoImg);
        let x = tx;
        if (img) { c.drawImage(img, x - 4 * u, y + (l.h - ls) / 2, ls, ls); x += ls + 16 * u; }
        c.font = font(500, 40 * u); c.fillStyle = "#fff";
        c.fillText(TEAM_FULL[team.abbr] || team.name, x, y + l.h * 0.72);
      } else if (l.kind === "num") {
        c.font = font(400, 34 * u); c.fillStyle = "rgba(255,255,255,.55)";
        c.fillText(numStr, tx, base);
      } else if (l.kind === "status") {
        c.font = font(500, 33 * u); c.fillStyle = TONE[P.status.tone] || TONE[""];
        c.fillText(P.status.text, tx, base);
      }
      y += l.h + 8 * u;
    }

    /* Stat table */
    if (nR) {
      c.font = font(500, 32 * u * Math.max(k, 0.8));
      const labW = Math.max(150 * u, ...rows.map((r) => c.measureText(r.label).width)) + 40 * u;
      const colsX = pad + labW, colsW = W - pad - colsX, cw = nC ? colsW / nC : 0;
      // Value size: as big as the narrowest column allows.
      let vf = 60 * u * k;
      c.font = font(700, vf);
      const widest = Math.max(1, ...rows.flatMap((r) => cols.map(([, f]) => c.measureText(val(f(r.stat))).width)));
      if (cw && widest > cw * 0.86) vf *= (cw * 0.86) / widest;
      const hf = Math.min(25 * u * k, vf * 0.5);
      const line = (yy) => { c.fillStyle = "rgba(255,255,255,.14)"; c.fillRect(pad, yy, W - 2 * pad, Math.max(1, 1.5 * u)); };
      line(tableTop);
      rows.forEach((r, i) => {
        const top = tableTop + i * rh, first = i === 0;
        const vBase = top + rh * 0.5 + hf * 0.6 + vf * 0.62;
        c.textAlign = "left";
        c.font = font(500, 32 * u * Math.max(k, 0.8)); c.fillStyle = "rgba(255,255,255,.55)";
        c.fillText(r.label, pad, top + rh / 2 + 11 * u * Math.max(k, 0.8));
        c.textAlign = "center";
        cols.forEach(([h, f], j) => {
          const cx = colsX + cw * (j + 0.5);
          c.font = font(600, hf); c.fillStyle = "rgba(255,255,255,.5)";
          c.fillText(h, cx, top + rh * 0.5 - vf * 0.36);
          c.font = font(first ? 700 : 500, vf); c.fillStyle = first ? "#fff" : "rgba(255,255,255,.7)";
          c.fillText(val(f(r.stat)), cx, vBase - hf * 0.3);
        });
        line(top + rh);
      });
      c.textAlign = "left";
    }

    /* Footer */
    if (footH) {
      const fy = H - pad * 0.62;
      const mark = use(markImg);
      if (st.show.mark) {
        let x = pad;
        if (mark) { const mh = 30 * u, mw = mh * (mark.naturalWidth / mark.naturalHeight || 1); c.globalAlpha = 0.8; c.drawImage(mark, x, fy - mh * 0.82, mw, mh); c.globalAlpha = 1; x += mw + 12 * u; }
        c.save(); spaced(c, 4.5 * u);
        c.font = font(700, 19 * u); c.fillStyle = "rgba(255,255,255,.72)";
        c.fillText("SHUTOUT", x, fy);
        c.restore();
      }
      if (st.show.credit) {
        c.textAlign = "right"; c.font = font(500, 20 * u); c.fillStyle = "rgba(255,255,255,.4)";
        c.fillText(`Stats: MLB${rows.some((r) => r.level !== "mlb") ? ", MiLB" : ""} · as of ${ymdLabel(etYmd(), { month: "short", day: "numeric", year: "numeric" })}`, W - pad, fy);
        c.textAlign = "left";
      }
    }

    tainted = [bgImg, headImg, logoImg].some((x) => x && !x.clean);
    if (!forExport) {
      $("note").textContent = st.bg === "photo" && !bgImg ? "No action photo for this player, so the card uses the team color. You can upload your own image."
        : tainted ? "Part of this image is blocked from being saved by MLB's photo server, so the PNG may leave it out." : "";
    }
    return { cv, dropped };
  }
  // Full team names for the logo row ("Toronto Blue Jays", not "Blue Jays").
  const TEAM_FULL = {
    ARI: "Arizona Diamondbacks", ATH: "Athletics", ATL: "Atlanta Braves", BAL: "Baltimore Orioles", BOS: "Boston Red Sox", CHC: "Chicago Cubs",
    CWS: "Chicago White Sox", CIN: "Cincinnati Reds", CLE: "Cleveland Guardians", COL: "Colorado Rockies", DET: "Detroit Tigers", HOU: "Houston Astros",
    KC: "Kansas City Royals", LAA: "Los Angeles Angels", LAD: "Los Angeles Dodgers", MIA: "Miami Marlins", MIL: "Milwaukee Brewers", MIN: "Minnesota Twins",
    NYM: "New York Mets", NYY: "New York Yankees", PHI: "Philadelphia Phillies", PIT: "Pittsburgh Pirates", SD: "San Diego Padres", SF: "San Francisco Giants",
    SEA: "Seattle Mariners", STL: "St. Louis Cardinals", TB: "Tampa Bay Rays", TEX: "Texas Rangers", TOR: "Toronto Blue Jays", WSH: "Washington Nationals",
  };

  /* ---------- Export ---------- */
  const fileName = () => `${[text.first, text.last].join("-").toLowerCase().replace(/[^a-z0-9-]+/g, "") || "player"}-${group}-${st.size}.png`;
  async function pngBlob() {
    const out = await render({ forExport: true });
    if (!out) return null;
    const blob = await new Promise((res) => { try { out.cv.toBlob(res, "image/png"); } catch { res(null); } });
    $("note").textContent = !blob ? "Couldn't save the image. Try a different background."
      : out.dropped ? "Saved. MLB's photo server didn't allow one of the photos to be saved, so it was left out. Uploading your own background works around it." : "Saved.";
    return blob;
  }
  $("dl").onclick = async () => {
    const blob = await pngBlob(); if (!blob) return;
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = fileName();
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
  };
  if (navigator.clipboard?.write && window.ClipboardItem) {
    $("copy").hidden = false;
    $("copy").onclick = async () => {
      try { await navigator.clipboard.write([new ClipboardItem({ "image/png": pngBlob().then((b) => b || Promise.reject()) })]); $("note").textContent = "Copied to the clipboard."; }
      catch { $("note").textContent = "Couldn't copy here. Use Download instead."; }
    };
  }
  try {
    if (navigator.canShare?.({ files: [new File([new Blob()], "a.png", { type: "image/png" })] })) {
      $("share").hidden = false;
      $("share").onclick = async () => {
        const blob = await pngBlob(); if (!blob) return;
        try { await navigator.share({ files: [new File([blob], fileName(), { type: "image/png" })] }); } catch {}
      };
    }
  } catch {}

  /* ---------- Start ---------- */
  // Back goes to wherever the builder was opened from (a player page keeps its place).
  $("back").onclick = (e) => { if (document.referrer && new URL(document.referrer).origin === location.origin && history.length > 1) { e.preventDefault(); history.back(); } };
  drawControls();
  render();
  const startId = +new URLSearchParams(location.search).get("id");
  if (startId) choose(startId); else setTimeout(() => $("q").focus(), 50);
})();
