// SHUTOUT taskbar widget. Runs inside the Windhawk mod's WebView2 window (see taskbar/), or in any
// browser for a look. Talks to the mod with window.chrome.webview.postMessage:
//   {type:"size", h}   window height in CSS px (the bar alone, or bar + panel)
//   {type:"open", url} open a page in the SHUTOUT app or the browser
// and the mod calls Bar.collapse() when the window loses focus.
const Bar = (() => {
  const API = "https://statsapi.mlb.com";
  const SITE = new URL("../", location.href).href;
  const qs = new URLSearchParams(location.search);
  const BAR_H = Math.max(32, Math.min(96, +qs.get("h") || 48));
  const PANEL_H = Math.max(300, Math.min(900, +qs.get("ph") || 540));
  document.documentElement.style.setProperty("--bar-h", BAR_H + "px");
  const host = window.chrome && window.chrome.webview;
  const send = (m) => { if (host) host.postMessage(JSON.stringify(m)); };
  const openUrl = (path) => { const url = new URL(path, SITE).href; host ? send({ type: "open", url }) : window.open(url, "_blank"); };

  // ---------- settings (kept in the widget's own browser profile) ----------
  const S = (() => {
    let o = {}; try { o = JSON.parse(localStorage.getItem("bar") || "{}"); } catch (e) {}
    o = { mode: "auto", fav: qs.get("team") || "HOU", callouts: true, pin: null, ...o };
    return { get: (k) => o[k], set: (k, v) => { o[k] = v; try { localStorage.setItem("bar", JSON.stringify(o)); } catch (e) {} } };
  })();
  const MODES = [["auto", "Auto"], ["game", "Game"], ["latest", "Latest"], ["team", "My team"], ["carousel", "Carousel"]];

  // ---------- helpers ----------
  const esc = (s = "") => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const byId = Object.fromEntries(TEAMS.map((t) => [t.id, t]));
  const byAbbr = Object.fromEntries(TEAMS.map((t) => [t.abbr, t]));
  const meta = (t = {}) => byId[t.id] || { abbr: t.abbreviation || "", name: t.teamName || t.name || "", id: t.id, bright: "#888" };
  const logo = (t, cls = "") => t && t.id ? `<img class="${cls}" src="../logos/${t.abbr}.svg" alt="" onerror="this.onerror=null;this.src='https://www.mlbstatic.com/team-logos/team-cap-on-dark/${t.id}.svg'">` : "";
  const rgb = (hex) => { const n = parseInt(hex.slice(1), 16); return `${n >> 16 & 255},${n >> 8 & 255},${n & 255}`; };
  const etYmd = () => new Date(Date.now() - 5 * 3600e3).toISOString().slice(0, 10);
  const last = (n = "") => n.split(" ").slice(1).join(" ") || n;
  const ago = (iso) => { const m = Math.max(1, Math.round((Date.now() - new Date(iso)) / 60000)); return m < 60 ? `${m}m ago` : m < 1440 ? `${Math.round(m / 60)}h ago` : `${Math.round(m / 1440)}d ago`; };
  const time = (iso) => new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const phase = (st = {}) => st.abstractGameState === "Final" || /final|game over/i.test(st.detailedState || "") ? "final"
    : st.abstractGameState === "Live" ? "live" : "pre";
  async function get(path) { const r = await fetch(path.startsWith("http") ? path : API + path); if (!r.ok) throw new Error(r.status); return r.json(); }
  const bases = (o = {}) => { const b = (on, cx, cy) => `<rect x="${cx - 5.5}" y="${cy - 5.5}" width="11" height="11" transform="rotate(45 ${cx} ${cy})" class="${on ? "on" : ""}"/>`;
    return `<svg class="bases" viewBox="0 0 46 34">${b(o.second, 23, 9)}${b(o.third, 11, 22)}${b(o.first, 35, 22)}</svg>`; };
  const outs = (n = 0) => `<span class="outs">${[0, 1, 2].map((i) => `<i class="${i < n ? "on" : ""}"></i>`).join("")}</span>`;
  const hs = (id) => `https://img.mlbstatic.com/mlb-photos/image/upload/d_people:generic:headshot:silo:current.png/w_120,q_auto:best,f_png/v1/people/${id}/headshot/silo/current`;
  const callCls = (p) => p?.details?.isBall ? "b" : p?.details?.isInPlay ? "x" : "s";

  // ---------- data ----------
  let games = [], feed = null, feedPk = 0, articles = [], seenPlay = null, newsIdx = 0;

  function pickGame() {
    const pin = S.get("pin");
    if (pin && pin.day === etYmd()) { const g = games.find((x) => x.gamePk === pin.pk); if (g) return g; }
    const fav = byAbbr[S.get("fav")];
    const mine = games.filter((g) => fav && (g.teams.away.team.id === fav.id || g.teams.home.team.id === fav.id));
    return mine.find((g) => phase(g.status) === "live") || mine.find((g) => phase(g.status) === "pre") || mine[mine.length - 1] || null;
  }
  async function loadGames() {
    try { games = (await get(`/api/v1/schedule?sportId=1&date=${etYmd()}&hydrate=linescore,team,probablePitcher`)).dates?.[0]?.games || []; } catch (e) {}
  }
  async function loadFeed() {
    const g = pickGame();
    if (!g || phase(g.status) === "pre") { feed = null; feedPk = 0; return; }
    try {
      const f = await get(`/api/v1.1/game/${g.gamePk}/feed/live`);
      if (feedPk !== g.gamePk) { seenPlay = null; feedPk = g.gamePk; }
      feed = f; detectBigPlay();
    } catch (e) {}
  }
  async function loadNews() {
    try { const d = await (await fetch(`${SITE}news.json?t=${Date.now()}`, { cache: "no-store" })).json(); articles = (d.articles || []).filter((a) => a.title); } catch (e) {}
  }
  const teamStories = () => articles.filter((a) => (a.teams || []).includes(S.get("fav")));

  // What the bar shows right now
  function effectiveMode() {
    const m = S.get("mode");
    if (m !== "auto") return m;
    const g = pickGame();
    return g && phase(g.status) === "live" ? "game" : "carousel";
  }

  // ---------- big plays ----------
  function bigLabel(p) {
    const ev = p.result?.eventType || "", rbi = p.result?.rbi || 0, a = p.about || {};
    if (ev === "home_run") return rbi === 4 ? "Grand slam" : rbi > 1 ? `${rbi}-run homer` : "Home run";
    if (ev === "triple_play") return "Triple play";
    if (/double_play/.test(ev)) return "Double play";
    if (ev === "triple") return "Triple";
    if (a.isScoringPlay || p.about?.isScoringPlay) return rbi > 1 ? `${p.result.event} · ${rbi} score` : `${p.result.event} · run scores`;
    if (ev === "strikeout" && p.count?.outs === 3 && (p.runners || []).some((r) => r.movement?.start && r.movement.start !== "1B")) return "Strikeout · stranded";
    if ((a.captivatingIndex || 0) >= 80) return p.result?.event;
    return "";
  }
  function detectBigPlay() {
    const plays = (feed?.liveData?.plays?.allPlays || []).filter((p) => p.about?.isComplete);
    const top = plays.length ? plays[plays.length - 1].about.atBatIndex : -1;
    if (seenPlay === null) { seenPlay = top; return; }   // first look: don't replay old plays
    const fresh = plays.filter((p) => p.about.atBatIndex > seenPlay);
    seenPlay = Math.max(seenPlay, top);
    if (!S.get("callouts")) return;
    const big = fresh.map((p) => [p, bigLabel(p)]).filter(([, l]) => l).pop();
    if (big) callout(big[0], big[1]);
  }
  function callout(p, label) {
    const t = meta((p.about.isTopInning ? feed.gameData.teams.away : feed.gameData.teams.home));
    const el = document.getElementById("callout"), bar = document.getElementById("bar");
    el.style.setProperty("--tc", t.bright); el.style.setProperty("--tc-rgb", rgb(t.bright));
    el.querySelector("b").textContent = label;
    const aw = feed.gameData.teams.away, hm = feed.gameData.teams.home;
    el.querySelector("span").textContent = `${p.matchup?.batter?.fullName || ""} · ${meta(aw).abbr} ${p.result.awayScore}, ${meta(hm).abbr} ${p.result.homeScore}`;
    el.classList.remove("on"); bar.classList.remove("calling"); void el.offsetWidth;
    el.classList.add("on"); bar.classList.add("calling");
    clearTimeout(callout.t); callout.t = setTimeout(() => { el.classList.remove("on"); bar.classList.remove("calling"); }, 6300);
  }

  // ---------- the bar ----------
  let shown = "";
  function swap(html, animate) {
    const box = document.getElementById("content");
    if (html === shown) return;
    shown = html;
    if (!animate || !box.firstElementChild) { box.innerHTML = `<div class="slide">${html}</div>`; return; }
    const old = box.firstElementChild; old.classList.add("out"); setTimeout(() => old.remove(), 400);
    const n = document.createElement("div"); n.className = "slide in"; n.innerHTML = html; box.appendChild(n);
  }
  function scorebug() {
    const g = pickGame();
    if (!g) return `<div class="sb-pre"><b>No ${esc(byAbbr[S.get("fav")]?.name || "")} game today</b><span>Click to pick another game</span></div>`;
    const ph = phase(g.status), a = meta(g.teams.away.team), h = meta(g.teams.home.team);
    if (ph === "pre") {
      const pp = (s) => s.probablePitcher ? last(s.probablePitcher.fullName) : "TBD";
      return `${logo(a)}<div class="sb-pre"><b>${esc(a.name)} at ${esc(h.name)}</b><span>${time(g.gameDate)} · ${esc(pp(g.teams.away))} vs ${esc(pp(g.teams.home))}</span></div>${logo(h)}`;
    }
    const ls = (feed && feedPk === g.gamePk ? feed.liveData.linescore : g.linescore) || {};
    const as = ls.teams?.away?.runs ?? g.teams.away.score ?? 0, hs = ls.teams?.home?.runs ?? g.teams.home.score ?? 0;
    const row = (t, s, lose) => `${logo(t)}<span class="ab ${lose ? "lose" : ""}">${t.abbr}</span><span class="sc tn ${lose ? "lose" : ""}">${s}</span>`;
    const teams = `<div class="sb-teams">${row(a, as, ph === "final" && as < hs)}${row(h, hs, ph === "final" && hs < as)}</div>`;
    if (ph === "final") return `${teams}<div class="sep"></div><div class="sb-pre"><b>Final${ls.currentInning > 9 ? `/${ls.currentInning}` : ""}</b><span>${esc(decision(g))}</span></div>`;
    const cp = feed?.liveData?.plays?.currentPlay;
    const pitch = (cp?.playEvents || []).filter((e) => e.isPitch).pop();
    const mid = ls.inningState === "Middle" || ls.inningState === "End";
    const inn = `<div class="sb-inn"><span class="tri">${mid ? (ls.inningState === "Middle" ? "MID" : "END") : ls.isTopInning ? "▲" : "▼"}</span><b class="tn">${ls.currentInning || ""}</b></div>`;
    const state = mid ? "" : `<div class="sb-state">${bases(ls.offense)}<div class="cnt"><span class="c tn">${ls.balls ?? 0}-${ls.strikes ?? 0}</span>${outs(ls.outs)}</div></div>`;
    const bt = cp?.matchup?.batter?.fullName, pt = cp?.matchup?.pitcher?.fullName;
    const pinfo = pitch ? `<div class="top"><span class="mph tn">${pitch.pitchData?.startSpeed ? pitch.pitchData.startSpeed.toFixed(1) + "<small>mph</small>" : ""}</span><span class="ty">${esc(pitch.details?.type?.description || "")}</span><span class="call ${callCls(pitch)}">${esc(pitch.details?.call?.description || pitch.details?.description || "")}</span></div>`
      : `<div class="top"><span class="ty">${mid ? "Between innings" : "Waiting for the pitch"}</span></div>`;
    return `${teams}<div class="sep"></div>${inn}${state}<div class="sep"></div><div class="sb-pitch">${pinfo}<div class="bot">${bt ? `${esc(last(bt))} vs ${esc(last(pt || ""))}` : ""}</div></div>`;
  }
  function decision(g) {
    const d = (feed && feedPk === g.gamePk && feed.liveData.decisions) || g.decisions || {};
    return [d.winner && `W ${last(d.winner.fullName)}`, d.loser && `L ${last(d.loser.fullName)}`, d.save && `SV ${last(d.save.fullName)}`].filter(Boolean).join(" · ") || "";
  }
  function newsList() { const m = effectiveMode(); const t = teamStories(); return m === "team" ? (t.length ? t : articles) : m === "latest" ? articles.slice(0, 1) : articles.slice(0, 8); }
  function newsSlide(a) {
    if (!a) return `<div class="nw"><div class="tx"><span class="hd">No stories yet</span></div></div>`;
    const t = byAbbr[(a.teams || [])[0]];
    return `<div class="nw"><div class="tx"><span class="hd">${esc(a.title)}</span><span class="mt">${t ? logo(t) + esc(t.name) + " · " : ""}${ago(a.date)}</span></div></div>`;
  }
  function drawBar(animate) {
    const m = effectiveMode();
    if (m === "game") return swap(scorebug(), animate);
    const list = newsList();
    if (newsIdx >= list.length) newsIdx = 0;
    const dots = m === "carousel" && list.length > 1 ? `<span class="dots">${list.map((_, i) => `<i class="${i === newsIdx ? "on" : ""}"></i>`).join("")}</span>` : "";
    swap(newsSlide(list[newsIdx]) + dots, animate);
  }
  setInterval(() => { if (effectiveMode() === "carousel" && !document.body.classList.contains("open")) { newsIdx++; drawBar(true); } }, 8000);

  // ---------- the panel ----------
  let view = "game", storyAt = 0;
  function expand(v) {
    view = v || (effectiveMode() === "game" ? "game" : "story");
    if (view === "story") { const l = newsList(); storyAt = Math.max(0, articles.indexOf(l[newsIdx] || articles[0])); }
    clearTimeout(collapse.t); document.body.classList.remove("closing");
    send({ type: "size", h: PANEL_H + BAR_H + 8 });
    document.body.classList.add("open"); document.getElementById("panel").setAttribute("aria-hidden", "false");
    drawPanel(); tick();
  }
  function collapse() {
    if (!document.body.classList.contains("open") || document.body.classList.contains("closing")) return;
    // Play the close animation, then shrink the window back to the bar
    document.body.classList.add("closing");
    collapse.t = setTimeout(() => {
      document.body.classList.remove("open", "closing"); document.getElementById("panel").setAttribute("aria-hidden", "true");
      send({ type: "size", h: BAR_H });
    }, 220);
  }
  // The mod tells the page how wide the bar may be (it stops before the Start button); the open view can be wider.
  function setBarWidth(px) { document.documentElement.style.setProperty("--bar-w", px > 0 ? px + "px" : "100%"); }
  function drawModes() {
    document.getElementById("modes").innerHTML = MODES.map(([k, l]) => `<button data-mode="${k}" class="${S.get("mode") === k ? "on" : ""}">${l}</button>`).join("");
    document.getElementById("gear").classList.toggle("on", view === "settings");
  }
  function drawPanel() {
    drawModes();
    const box = document.getElementById("pbody"), top = box.scrollTop;
    box.innerHTML = view === "settings" ? settingsView() : view === "story" ? storyView() : gameView();
    box.scrollTop = top;
  }

  function gameView() {
    const g = pickGame();
    const pick = `<div class="h-lbl">Today's games</div><div class="gpick">${games.map((x) => {
      const a = meta(x.teams.away.team), h = meta(x.teams.home.team), ph = phase(x.status);
      const st = ph === "pre" ? time(x.gameDate) : ph === "final" ? "F" : `${x.linescore?.isTopInning ? "▲" : "▼"}${x.linescore?.currentInning || ""}`;
      return `<button data-pick="${x.gamePk}" class="${g && x.gamePk === g.gamePk ? "on" : ""}">${logo(a)}${a.abbr}${ph !== "pre" ? ` ${x.teams.away.score ?? 0}` : ""} ${logo(h)}${h.abbr}${ph !== "pre" ? ` ${x.teams.home.score ?? 0}` : ""} <em>${st}</em></button>`;
    }).join("") || `<span class="empty">No games today</span>`}</div>`;
    if (!g) return `<div class="empty">No game to show. Pick one below.</div>${pick}`;
    const a = meta(g.teams.away.team), h = meta(g.teams.home.team), ph = phase(g.status);
    const f = feed && feedPk === g.gamePk ? feed : null, ls = f?.liveData?.linescore || g.linescore || {};
    const rec = (s) => s.leagueRecord ? `${s.leagueRecord.wins}-${s.leagueRecord.losses}` : "";
    const sc = (side) => ph === "pre" ? "" : `<span class="sc tn">${ls.teams?.[side]?.runs ?? g.teams[side].score ?? 0}</span>`;
    const mid = ph === "pre" ? `<b>${time(g.gameDate)}</b>${esc(g.venue?.name || "")}` : ph === "final" ? `<b>Final</b>${esc(decision(g))}`
      : `<b><span class="live-dot"></span>${ls.isTopInning ? "Top" : "Bot"} ${ls.currentInningOrdinal || ls.currentInning || ""}</b>${ls.outs ?? 0} out`;
    let html = `<div class="gv-head"><div class="gv-t">${logo(a)}<div><div class="nm">${esc(a.name)}</div><div class="rec">${rec(g.teams.away)}</div></div>${sc("away")}</div>
      <div class="gv-mid">${mid}</div>
      <div class="gv-t h">${logo(h)}<div><div class="nm">${esc(h.name)}</div><div class="rec">${rec(g.teams.home)}</div></div>${sc("home")}</div></div>`;
    if (ph !== "pre" && ls.innings?.length) {
      const n = Math.max(9, ls.innings.length), cols = [...Array(n)].map((_, i) => i + 1);
      const cell = (i, side) => { const x = ls.innings[i - 1]; return x ? (x[side]?.runs ?? "") : ""; };
      html += `<table class="ls"><tr><th></th>${cols.map((c) => `<th>${c}</th>`).join("")}<th>R</th><th>H</th><th>E</th></tr>
        ${["away", "home"].map((s) => `<tr><td>${(s === "away" ? a : h).abbr}</td>${cols.map((c) => `<td>${cell(c, s)}</td>`).join("")}
          <td class="rhe">${ls.teams?.[s]?.runs ?? 0}</td><td class="rhe">${ls.teams?.[s]?.hits ?? 0}</td><td class="rhe">${ls.teams?.[s]?.errors ?? 0}</td></tr>`).join("")}</table>`;
    }
    if (ph === "pre") {
      const pp = (s, t) => `<div><em>${t.abbr}</em><b>${esc(s.probablePitcher?.fullName || "TBD")}</b></div>`;
      html += `<div class="gv-sit"><div class="mu"><div><span>Probable pitchers</span></div>${pp(g.teams.away, a)}${pp(g.teams.home, h)}</div></div>`;
    }
    if (ph === "live" && f) {
      const cp = f.liveData.plays.currentPlay || {};
      const bt = cp.matchup?.batter, pt = cp.matchup?.pitcher;
      html += `<div class="gv-sit">${bases(ls.offense)}<div class="cnt"><span class="c tn">${ls.balls ?? 0}-${ls.strikes ?? 0}</span>${outs(ls.outs)}</div>
        </div>
        <div class="mus">${[[bt, "At bat", "batting"], [pt, "Pitching", "pitching"]].filter(([x]) => x).map(([x, l, k]) =>
          `<div class="muc lnk" data-player="${x.id}"><img src="${hs(x.id)}" alt="" onerror="this.style.visibility='hidden'"><div><em>${l}</em><b>${esc(x.fullName)}</b><span>${esc(line(f, x.id, k))}</span></div></div>`).join("")}</div>`;
      const ps = (cp.playEvents || []).filter((e) => e.isPitch).reverse();
      if (ps.length) html += `<div class="h-lbl">This at-bat</div><ul class="pl">${ps.map((p, i) => `<li><span class="n ${callCls(p)}">${p.pitchNumber || ps.length - i}</span>
          <span class="d"><b>${esc(p.details?.call?.description || p.details?.description || "")}</b><span>${esc(p.details?.type?.description || "")}</span></span>
          <span class="v tn">${p.pitchData?.startSpeed ? p.pitchData.startSpeed.toFixed(1) + "<small>mph</small>" : ""}</span></li>`).join("")}</ul>`;
    }
    if (f) {
      const done = f.liveData.plays.allPlays.filter((p) => p.about?.isComplete).slice(-6).reverse();
      if (done.length) html += `<div class="h-lbl">Recent plays</div><div class="plays">${done.map((p) =>
        `<div class="play ${p.about.isScoringPlay ? "sc" : ""}">${p.matchup?.batter ? `<img src="${hs(p.matchup.batter.id)}" alt="" onerror="this.style.visibility='hidden'">` : ""}<i>${p.about.isTopInning ? "▲" : "▼"}${p.about.inning}</i><span>${esc(p.result.description || p.result.event || "")}</span></div>`).join("")}</div>`;
    }
    html += `<div class="foot"><button class="btn" data-open="m/?game=${g.gamePk}">Open in SHUTOUT</button></div>${pick}`;
    return html;
  }
  function line(f, id, kind) {
    const side = ["away", "home"].find((s) => f.liveData.boxscore?.teams?.[s]?.players?.[`ID${id}`]);
    const st = side && f.liveData.boxscore.teams[side].players[`ID${id}`].stats?.[kind];
    if (!st) return "";
    return kind === "batting" ? `${st.hits ?? 0}-${st.atBats ?? 0} today` : `${st.inningsPitched ?? "0.0"} IP · ${st.strikeOuts ?? 0} K · ${st.numberOfPitches ?? st.pitchesThrown ?? 0} pitches`;
  }

  function storyView() {
    const N = Math.min(articles.length, 30), a = articles[storyAt];
    if (!a) return `<div class="empty">No stories yet</div>`;
    const t = byAbbr[(a.teams || [])[0]];
    // Player names become links to their pages in the app
    const names = (a.players || []).filter((p) => p[0] && p[1]).sort((x, y) => y[0].length - x[0].length);
    const link = (txt) => { let out = esc(txt); for (const [n, id] of names) out = out.split(esc(n)).join(`<span class="pn" data-player="${id}">${esc(n)}</span>`); return out; };
    const more = articles.slice(0, N).map((x, i) => [x, i]).filter(([, i]) => i !== storyAt).slice(0, 5);
    const thumb = (x) => x.image ? `<img class="th" src="${esc(x.image)}" alt="" loading="lazy" onerror="this.remove()">` : `<span class="th none">${byAbbr[(x.teams || [])[0]] ? logo(byAbbr[(x.teams || [])[0]]) : ""}</span>`;
    return `<article class="st">${a.image ? `<div class="st-hero"><img src="${esc(a.image)}" alt="" onerror="this.parentNode.remove()"></div>` : ""}<div class="st-k">${t ? logo(t) + `<b>${esc(t.name)}</b> · ` : ""}${ago(a.date)}
        <span class="st-nav"><button class="ic" data-story="-1" aria-label="Newer">‹</button>${storyAt + 1}/${N}<button class="ic" data-story="1" aria-label="Older">›</button></span></div>
      <h2>${esc(a.title)}</h2>${(a.body || []).slice(0, 8).map((p) => `<p>${link(p)}</p>`).join("")}
      <div class="foot"><button class="btn" data-open="m/?story=${encodeURIComponent(a.link)}">Open in SHUTOUT</button><button class="btn ghost" data-ext="${esc(a.link)}">Read on MLB Trade Rumors</button></div></article>
      ${more.length ? `<div class="h-lbl">More stories</div><div class="more">${more.map(([x, i]) => `<button class="mr" data-goto="${i}">${thumb(x)}<span><b>${esc(x.title)}</b><em>${byAbbr[(x.teams || [])[0]] ? esc(byAbbr[(x.teams || [])[0]].name) + " · " : ""}${ago(x.date)}</em></span></button>`).join("")}</div>` : ""}`;
  }

  function settingsView() {
    const fav = S.get("fav");
    return `<div class="h-lbl" style="margin-top:0">Your team</div>
      <div class="tg">${[...TEAMS].sort((x, y) => x.name.localeCompare(y.name)).map((t) => `<button data-fav="${t.abbr}" class="${t.abbr === fav ? "on" : ""}">${logo(t)}${t.abbr}</button>`).join("")}</div>
      <div class="h-lbl">Bar</div>
      <button class="tog ${S.get("callouts") ? "on" : ""}" data-tog="callouts"><span class="sw"><i></i></span><span><b>Big play callouts</b><em>Animate the bar and name the play on homers, big hits and runs</em></span></button>
      <div class="h-lbl">Tip</div><div style="color:var(--fg-2);font-size:12.5px;line-height:1.45">Scroll over the bar to switch what it shows. Click it for the full view.</div>`;
  }

  // ---------- input ----------
  document.getElementById("bar").addEventListener("click", () => document.body.classList.contains("open") ? collapse() : expand());
  document.getElementById("bar").addEventListener("wheel", (e) => {
    e.preventDefault();
    const i = MODES.findIndex(([k]) => k === S.get("mode"));
    S.set("mode", MODES[(i + (e.deltaY > 0 ? 1 : MODES.length - 1)) % MODES.length][0]);
    newsIdx = 0; drawBar(true); tick();
    if (document.body.classList.contains("open")) drawPanel();
  }, { passive: false });
  document.getElementById("close").onclick = collapse;
  document.getElementById("gear").onclick = () => { view = view === "settings" ? (effectiveMode() === "game" ? "game" : "story") : "settings"; drawPanel(); };
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") collapse(); });
  document.getElementById("panel").addEventListener("click", (e) => {
    const q = (s) => e.target.closest(s);
    let el;
    if ((el = q("[data-mode]"))) { S.set("mode", el.dataset.mode); newsIdx = 0; view = effectiveMode() === "game" ? "game" : "story";
      if (view === "story") { const l = newsList(); storyAt = Math.max(0, articles.indexOf(l[0])); } drawBar(true); drawPanel(); tick(); return; }
    if ((el = q("[data-pick]"))) { S.set("pin", { pk: +el.dataset.pick, day: etYmd() }); if (S.get("mode") !== "game") S.set("mode", "game"); feed = null; drawBar(true); drawPanel(); tick(); return; }
    if ((el = q("[data-player]"))) return openUrl(`m/?player=${el.dataset.player}`);
    if ((el = q("[data-open]"))) return openUrl(el.dataset.open);
    if ((el = q("[data-ext]"))) return host ? send({ type: "open", url: el.dataset.ext }) : window.open(el.dataset.ext, "_blank");
    if ((el = q("[data-goto]"))) { storyAt = +el.dataset.goto; document.getElementById("pbody").scrollTop = 0; drawPanel(); return; }
    if ((el = q("[data-story]"))) { const N = Math.min(articles.length, 30); storyAt = (storyAt + +el.dataset.story + N) % N; document.getElementById("pbody").scrollTop = 0; drawPanel(); return; }
    if ((el = q("[data-fav]"))) { S.set("fav", el.dataset.fav); S.set("pin", null); feed = null; drawPanel(); drawBar(true); tick(); return; }
    if ((el = q("[data-tog]"))) { S.set(el.dataset.tog, !S.get(el.dataset.tog)); drawPanel(); }
  });

  // ---------- refresh loop ----------
  let lastGames = 0, lastNews = 0, busy = false;
  async function tick() {
    if (busy) return; busy = true;
    try {
      const now = Date.now();
      const live = pickGame() && phase(pickGame().status) === "live";
      if (now - lastGames > (live ? 20e3 : 60e3)) { await loadGames(); lastGames = now; }
      if (now - lastNews > 5 * 60e3) { await loadNews(); lastNews = now; }
      if (effectiveMode() === "game" || view === "game") await loadFeed();
      drawBar(false);
      if (document.body.classList.contains("open") && view !== "settings") drawPanel();
    } finally { busy = false; }
  }
  // Live games refresh every 6 s; otherwise the loop idles along
  setInterval(() => { const g = pickGame(); if ((g && phase(g.status) === "live") || Date.now() - lastGames > 60e3) tick(); }, 6000);
  send({ type: "size", h: BAR_H, init: 1 });
  tick();

  // Self-update: reload when a new version of the site is out (only while collapsed)
  setInterval(async () => {
    if (typeof BUILD !== "string" || BUILD.startsWith("__") || document.body.classList.contains("open")) return;
    try { const v = await (await fetch(`${SITE}version.json?t=${Date.now()}`, { cache: "no-store" })).json();
      if (v.build && v.build !== BUILD) location.replace(`${location.pathname}?${qs.toString()}`); } catch (e) {}
  }, 10 * 60e3);

  // A browser tab (not the widget) shows the bar on a dark strip so it can be previewed
  if (qs.get("bg") === "solid") document.body.classList.add("solid");
  if (!host) document.body.style.background = matchMedia("(prefers-color-scheme: light)").matches ? "#e9e9e9" : "#1c1c1c";

  return { expand, collapse, setBarWidth };
})();
