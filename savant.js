// Baseball Savant data for the player page's Savant tab. Savant allows cross-site requests, so the
// widget reads its CSV exports directly:
//   percentile rankings (one file per season for all players), and the player's every pitch for a season
//   (statcast_search), which gives the spray chart, batted-ball numbers, pitch movement and arsenal.
const Savant = (() => {
  const BASE = "https://baseballsavant.mlb.com";
  const cache = new Map();
  const FIRST_YEAR = 2015;   // the Statcast era

  // RFC 4180-ish CSV parser (quoted fields, doubled quotes), returning objects keyed by header.
  function parseCsv(text) {
    text = text.replace(/^﻿/, "");
    const rows = [];
    let row = [], f = "", q = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) {
        if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; }
        else f += c;
      } else if (c === '"') q = true;
      else if (c === ",") { row.push(f); f = ""; }
      else if (c === "\n") { row.push(f); rows.push(row); row = []; f = ""; }
      else if (c !== "\r") f += c;
    }
    if (f || row.length) { row.push(f); rows.push(row); }
    const head = rows.shift() || [];
    return rows.filter((r) => r.length > 1).map((r) => Object.fromEntries(head.map((h, i) => [h, r[i]])));
  }
  async function csv(url, ttl = 3600_000) {
    const hit = cache.get(url);
    if (hit && Date.now() - hit.at < ttl) return hit.p;
    const p = fetch(url).then((r) => { if (!r.ok) throw new Error(`${r.status} ${url}`); return r.text(); }).then(parseCsv);
    cache.set(url, { at: Date.now(), p });
    p.catch(() => cache.delete(url));
    return p;
  }
  const percentiles = (type, year) => csv(`${BASE}/leaderboard/percentile-rankings?type=${type}&year=${year}&csv=true`, 6 * 3600_000);
  const pitches = (id, type, year) => csv(`${BASE}/statcast_search/csv?all=true&hfSea=${year}%7C&hfGT=R%7CF%7CD%7CL%7CW%7C&player_type=${type}&${type === "pitcher" ? "pitchers" : "batters"}_lookup%5B%5D=${id}&type=details`, 30 * 60_000);

  const PCT = {
    batter: [
      ["xwoba", "xwOBA"], ["xba", "xBA"], ["xslg", "xSLG"], ["exit_velocity", "Avg exit velocity"], ["brl_percent", "Barrel %"],
      ["hard_hit_percent", "Hard-hit %"], ["bat_speed", "Bat speed"], ["squared_up_rate", "Squared-up %"], ["chase_percent", "Chase %"],
      ["whiff_percent", "Whiff %"], ["k_percent", "K %"], ["bb_percent", "BB %"], ["sprint_speed", "Sprint speed"], ["oaa", "Range (OAA)"], ["arm_strength", "Arm strength"],
    ],
    pitcher: [
      ["xera", "xERA"], ["xba", "xBA"], ["fb_velocity", "Fastball velo"], ["exit_velocity", "Avg exit velocity"], ["chase_percent", "Chase %"],
      ["whiff_percent", "Whiff %"], ["k_percent", "K %"], ["bb_percent", "BB %"], ["brl_percent", "Barrel %"], ["hard_hit_percent", "Hard-hit %"],
      ["fb_spin", "Fastball spin"], ["curve_spin", "Curveball spin"],
    ],
  };
  // Savant's scale: blue (poor) through gray to red (great).
  function pctColor(p) {
    const t = Math.max(0, Math.min(100, p)) / 100;
    const lerp = (a, b, k) => Math.round(a + (b - a) * k);
    const [a, b, k] = t < 0.5 ? [[52, 94, 172], [170, 170, 170], t / 0.5] : [[170, 170, 170], [214, 41, 41], (t - 0.5) / 0.5];
    return `rgb(${lerp(a[0], b[0], k)},${lerp(a[1], b[1], k)},${lerp(a[2], b[2], k)})`;
  }
  function pctBars(row, type) {
    const items = PCT[type].filter(([k]) => row && row[k] !== "" && row[k] != null);
    if (!items.length) return `<div class="sv-empty muted">No percentile rankings this season (not enough playing time)</div>`;
    return items.map(([k, label], i) => {
      const v = +row[k], c = pctColor(v);
      return `<div class="sv-pr" style="animation-delay:${i * 30}ms"><span class="lb">${esc(label)}</span>
        <span class="tr"><span class="fl" style="width:${Math.max(2, v)}%;background:${c}"></span><span class="dt" style="left:${Math.max(2, v)}%;background:${c}">${v}</span></span></div>`;
    }).join("");
  }

  // Pitch colors close to Savant's.
  const PITCH = { FF: "#d22d49", SI: "#fe9d00", FC: "#933f2c", SL: "#eee716", ST: "#ddb33a", SV: "#93afd4", CU: "#00d1ed", KC: "#6236cd",
    CH: "#1dbe3a", FS: "#3bacac", FO: "#55ccab", SC: "#60db33", KN: "#3c44cd", EP: "#888", CS: "#0068ff" };

  // Spray chart: Statcast hit coordinates (home plate at 125, 204; ~2.5 ft per unit).
  function spray(rows) {
    const bb = rows.filter((r) => r.hc_x && r.hc_y && r.type === "X");
    if (!bb.length) return `<div class="sv-empty muted">No batted balls</div>`;
    const W = 520, H = 470, S = 2.1, ox = W / 2, oy = H - 24;
    const pt = (r) => [ox + (+r.hc_x - 125.42) * S, oy - (204 - +r.hc_y) * S];
    const col = (e) => (e === "home_run" ? "#d82929" : e === "triple" ? "#f2a33a" : e === "double" ? "#2f9be0" : e === "single" ? "#5cc38b" : "rgba(255,255,255,.28)");
    // Field: foul lines, a 400 ft fence arc, infield diamond.
    const ft = (d) => (d / 2.5) * S;
    const fence = (a) => [ox + Math.sin(a) * ft(395), oy - Math.cos(a) * ft(395)];
    const [lx, ly] = fence(-Math.PI / 4), [rx, ry] = fence(Math.PI / 4), [cx, cy] = fence(0);
    const inf = ft(90 / Math.SQRT2);
    const dots = bb.sort((a, b) => (a.events === "home_run") - (b.events === "home_run"))
      .map((r) => { const [x, y] = pt(r); return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${r.events === "home_run" ? 5 : 3.6}" fill="${col(r.events)}"/>`; }).join("");
    return `<svg class="sv-svg" viewBox="0 0 ${W} ${H}">
      <path d="M${ox} ${oy} L${lx} ${ly} Q${cx} ${cy - (ly - cy) * 0.55} ${rx} ${ry} Z" fill="rgba(255,255,255,.035)" stroke="rgba(255,255,255,.18)"/>
      <path d="M${ox} ${oy} l${-inf} ${-inf} l${inf} ${-inf} l${inf} ${inf} Z" fill="none" stroke="rgba(255,255,255,.18)"/>
      ${dots}</svg>
      <div class="sv-key">${[["Single", "single"], ["Double", "double"], ["Triple", "triple"], ["Home run", "home_run"], ["Out", "out"]]
        .map(([l, e]) => `<span><i style="background:${col(e)}"></i>${l}</span>`).join("")}</div>`;
  }

  // Pitch movement, catcher's view: horizontal and induced vertical break in inches, one dot per pitch.
  function movement(rows) {
    const ps = rows.filter((r) => r.pfx_x !== "" && r.pfx_z !== "" && r.pitch_type);
    if (!ps.length) return `<div class="sv-empty muted">No pitches</div>`;
    const W = 520, H = 470, R = 24, s = (Math.min(W, H) - 40) / (2 * R), cx = W / 2, cy = H / 2;
    const X = (v) => cx + v * s, Y = (v) => cy - v * s;
    let grid = "";
    for (let v = -R; v <= R; v += 6) grid += `<line x1="${X(v)}" y1="${Y(-R)}" x2="${X(v)}" y2="${Y(R)}"/><line x1="${X(-R)}" y1="${Y(v)}" x2="${X(R)}" y2="${Y(v)}"/>`;
    const dots = ps.map((r) => `<circle cx="${X(+r.pfx_x * 12).toFixed(1)}" cy="${Y(+r.pfx_z * 12).toFixed(1)}" r="2.6" fill="${PITCH[r.pitch_type] || "#999"}" fill-opacity=".55"/>`).join("");
    return `<svg class="sv-svg" viewBox="0 0 ${W} ${H}"><g class="sv-grid">${grid}</g>
      <line x1="${X(-R)}" y1="${cy}" x2="${X(R)}" y2="${cy}" class="sv-axis"/><line x1="${cx}" y1="${Y(-R)}" x2="${cx}" y2="${Y(R)}" class="sv-axis"/>
      ${dots}
      <text x="${X(R) - 4}" y="${cy - 6}" text-anchor="end">${R}"</text><text x="${cx + 6}" y="${Y(R) + 14}">${R}"</text>
      </svg><div class="sv-key muted">Catcher's view · horizontal and induced vertical break (inches)</div>`;
  }
  const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
  const nums = (rows, k) => rows.map((r) => parseFloat(r[k])).filter((v) => !isNaN(v));
  function arsenal(rows) {
    const by = {};
    rows.forEach((r) => { if (r.pitch_type) (by[r.pitch_type] ||= []).push(r); });
    const list = Object.entries(by).sort((a, b) => b[1].length - a[1].length);
    if (!list.length) return "";
    return `<table class="sv-tab"><tr><th class="left">Pitch</th><th>%</th><th>MPH</th><th>Spin</th><th>IVB</th><th>HB</th><th>Whiff %</th></tr>${list.map(([t, rs]) => {
      const sw = rs.filter((r) => /swinging_strike|foul|hit_into_play|missed_bunt/.test(r.description)).length;
      const wh = rs.filter((r) => /swinging_strike|missed_bunt/.test(r.description)).length;
      const f = (k, m = 1, d = 1) => { const v = avg(nums(rs, k)); return v == null ? "" : (v * m).toFixed(d); };
      return `<tr><td class="left"><i style="background:${PITCH[t] || "#999"}"></i>${esc(rs[0].pitch_name || t)}</td><td>${((rs.length / rows.length) * 100).toFixed(1)}</td>
        <td>${f("release_speed")}</td><td>${f("release_spin_rate", 1, 0)}</td><td>${f("pfx_z", 12)}</td><td>${f("pfx_x", 12)}</td><td>${sw ? Math.round((wh / sw) * 100) : ""}</td></tr>`;
    }).join("")}</table>`;
  }
  function battedBall(rows) {
    const bb = rows.filter((r) => r.type === "X");
    const ev = nums(bb, "launch_speed"), la = nums(bb, "launch_angle"), dist = nums(bb.filter((r) => r.events === "home_run"), "hit_distance_sc");
    const brl = bb.filter((r) => r.launch_speed_angle === "6").length;
    const hh = ev.filter((v) => v >= 95).length;
    const bs = nums(rows, "bat_speed");
    const cells = [
      ["Batted balls", bb.length], ["Avg exit velo", ev.length ? avg(ev).toFixed(1) : "–"], ["Max exit velo", ev.length ? Math.max(...ev).toFixed(1) : "–"],
      ["Avg launch angle", la.length ? `${avg(la).toFixed(1)}°` : "–"], ["Barrel %", bb.length ? ((brl / bb.length) * 100).toFixed(1) : "–"],
      ["Hard-hit %", ev.length ? ((hh / ev.length) * 100).toFixed(1) : "–"], ["Longest HR", dist.length ? `${Math.max(...dist)} ft` : "–"],
      ["Avg bat speed", bs.length ? avg(bs).toFixed(1) : "–"],
    ];
    return `<div class="sv-cells">${cells.map(([l, v]) => `<div><b>${v}</b><span>${l}</span></div>`).join("")}</div>`;
  }

  // Draw the tab into `body`. type: "batter" | "pitcher". years: seasons the player played (MLB).
  async function render(body, { id, type, years, year, onYear, alive }) {
    const ys = years.filter((y) => y >= FIRST_YEAR).sort((a, b) => b - a);
    if (!ys.length) { body.innerHTML = `<div class="s-loading">No Statcast seasons</div>`; return; }
    if (!ys.includes(year)) year = ys[0];
    body.innerHTML = `<div class="sv">
      <div class="sv-years hscroll">${ys.map((y) => `<button data-sy="${y}" class="${y === year ? "on" : ""}">${y}</button>`).join("")}</div>
      <div class="sv-cols"><div class="sv-col sv-pct"><h4>Percentile rankings <span class="muted">${year}</span></h4><div class="sv-in s-loading">Loading…</div></div>
        <div class="sv-col sv-chart"><h4>${type === "pitcher" ? "Pitch movement" : "Spray chart"}</h4><div class="sv-in s-loading">Loading every ${type === "pitcher" ? "pitch" : "batted ball"} from Savant…</div></div>
        <div class="sv-col sv-side"><h4>${type === "pitcher" ? "Arsenal" : "Batted balls"}</h4><div class="sv-in"></div></div></div></div>`;
    body.querySelector(".sv-years").onclick = (e) => { const b = e.target.closest("[data-sy]"); if (b) onYear(+b.dataset.sy); };
    const live = () => alive() && body.querySelector(".sv");
    percentiles(type, year).then((rows) => {
      if (!live()) return;
      body.querySelector(".sv-pct .sv-in").className = "sv-in";
      body.querySelector(".sv-pct .sv-in").innerHTML = pctBars(rows.find((r) => +r.player_id === +id), type);
    }).catch(() => { if (live()) body.querySelector(".sv-pct .sv-in").innerHTML = `<div class="sv-empty muted">Savant didn't answer. Try again in a bit.</div>`; });
    pitches(id, type, year).then((rows) => {
      if (!live()) return;
      const chart = body.querySelector(".sv-chart .sv-in"), side = body.querySelector(".sv-side .sv-in");
      chart.className = "sv-in";
      chart.innerHTML = type === "pitcher" ? movement(rows) : spray(rows);
      side.innerHTML = type === "pitcher" ? arsenal(rows) : battedBall(rows);
    }).catch(() => { if (live()) body.querySelector(".sv-chart .sv-in").innerHTML = `<div class="sv-empty muted">Savant didn't answer. Try again in a bit.</div>`; });
  }

  /* ---------- Highlights (MLB's Film Room search; it allows our site) ---------- */
  // Each play's id is its Statcast playId, so the link opens Savant's video of that exact pitch.
  // Editorial packages (gamePk -1, like "best moments of 2025") only exist on MLB.com.
  const GQL = "https://fastball-gateway.mlb.com/graphql";
  async function search(q, limit) {
    const query = `query { search(query: ${JSON.stringify(q)}, limit: ${limit}) { plays { id gamePk mediaPlayback { slug title date } } } }`;
    const r = await fetch(GQL, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query }) });
    const d = await r.json();
    return d.data?.search?.plays || [];
  }
  // How much a clip is worth showing: the big, rare and fun moments first, then recency.
  const WOW = [
    [/walk-?off/i, 12], [/grand slam/i, 10], [/no-?hitter|perfect game|immaculate|cycle/i, 12], [/rob|steals? a homer|home run-robbing/i, 9],
    [/diving|leaping|sliding|barehand|spectacular|incredible|amazing|wild|unreal|insane/i, 6], [/best moments|top plays|highlights of/i, 7],
    [/\b(career|milestone)\b|\b\d{3,4}(th|st|nd|rd)\b/i, 6], [/go-ahead|game-tying|clutch|late/i, 5], [/home run|homer|\bHR\b|blast|crush|smash|moonshot/i, 5],
    [/strikes out|fans|K's|strikeouts|whiff/i, 3], [/funny|hilarious|reacts?|celebrat|bat flip|dance|mic'?d up|blooper|dugout/i, 6],
    [/\b(4\d\d|5\d\d)-?(ft|foot)\b/i, 6], [/\b1[12]\d(\.\d)? ?mph\b/i, 5],
  ];
  const score = (title, date) => WOW.reduce((a, [rx, w]) => a + (rx.test(title) ? w : 0), 0) - (Date.now() - Date.parse(date || 0)) / (30 * 864e5);
  async function highlights(id, isPitcher, season) {
    const role = isPitcher ? "PitcherId" : "BatterId";
    const qs = [
      search(`PlayerId = [${id}] AND Season = [${season}] Order By Timestamp DESC`, 40),
      isPitcher ? Promise.resolve([]) : search(`${role} = [${id}] AND Season = [${season}] Order By ExitVelocity DESC`, 8),
    ];
    const lists = await Promise.all(qs.map((p) => p.catch(() => [])));
    const seen = new Set(), out = [];
    lists.flat().forEach((pl) => {
      const m = (pl.mediaPlayback || [])[0];
      if (!m || seen.has(pl.id)) return;
      seen.add(pl.id);
      const url = pl.gamePk > 0 ? `${BASE}/sporty-videos?playId=${encodeURIComponent(pl.id)}` : `https://www.mlb.com/video/${encodeURIComponent(m.slug)}`;
      out.push({ id: pl.id, title: (m.title || "").trim(), date: m.date || "", url, score: score(m.title || "", m.date) });
    });
    return out.sort((a, b) => b.score - a.score);
  }

  return { render, percentiles, pitches, parseCsv, highlights };
})();
