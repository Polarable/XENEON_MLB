// Gameday view inside the game page: Film Room video, a live strike zone for the current
// (or tapped) at-bat, and a play-by-play feed. Clips come from MLB's game content endpoint
// (the same source the SHUTOUT hub's Film Room used) and are matched to plays by player and time.
const Gameday = (pk) => {
  let clips = [];             // newest last
  let clipTimer = 0;
  let sel = null;             // atBatIndex the user tapped; null = follow the live at-bat
  let playingId = null;
  let userPicked = false;     // once the user taps a clip, stop auto-advancing to new ones
  let muted = true;

  // The video lives outside the re-rendered HTML so live refreshes never restart it.
  const vbox = document.createElement("div");
  vbox.className = "gd-video";
  vbox.innerHTML = `<video playsinline muted autoplay preload="auto"></video>
    <div class="gd-vempty"><div class="fr">Film Room</div><div>Highlights show up here as MLB posts them, usually a few minutes after the play.</div></div>
    <div class="gd-vcap"><span class="t"></span></div>
    <button class="gd-mute" aria-label="Sound">Sound off</button>`;
  const video = vbox.querySelector("video");
  video.addEventListener("ended", () => { const i = clips.findIndex((c) => c.id === playingId); if (i >= 0 && clips[i + 1]) play(clips[i + 1]); });
  vbox.querySelector(".gd-mute").onclick = (e) => {
    e.stopPropagation();
    muted = !muted; video.muted = muted;
    vbox.querySelector(".gd-mute").textContent = muted ? "Sound off" : "Sound on";
  };

  // ---- Clips ----
  function pickMp4(item) {
    const pbs = (item.playbacks || []).filter((p) => /\.mp4/.test(p.url || "") && !/trickplay/i.test(p.name || ""));
    return (pbs.find((p) => p.name === "mp4Avc") || pbs.find((p) => /_(1800|2500|1200)K/i.test(p.url)) || pbs[0] || {}).url;
  }
  function pickThumb(item) {
    const cuts = item.image?.cuts || [];
    return (cuts.find((c) => c.aspectRatio === "16:9" && c.width >= 320 && c.width <= 800) || cuts.find((c) => c.aspectRatio === "16:9") || cuts[0] || {}).src || "";
  }
  async function loadClips() {
    try {
      const data = await api(`/api/v1/game/${pk}/content`, { ttl: 30_000 });
      const items = data.highlights?.highlights?.items || [];
      const next = items.filter((it) => (!it.type || it.type === "video") && pickMp4(it))
        .filter((it) => !/condensed game|game recap|postgame|press conference/i.test(`${it.title} ${it.headline}`))
        .map((it) => ({
          id: it.slug || it.id || it.title, title: it.title || it.headline || "Highlight", blurb: it.blurb || it.description || "",
          url: pickMp4(it), thumb: pickThumb(it), date: it.date || "", dur: it.duration || "",
          players: (it.keywordsAll || []).filter((k) => /player_id/i.test(k.type || "")).map((k) => +k.value),
        }))
        .sort((a, b) => String(a.date).localeCompare(String(b.date)));
      const fresh = next.length !== clips.length;
      clips = next;
      return fresh;
    } catch { return false; }
  }

  // Match each clip to the play it shows: same batter or pitcher, the last such play that ended before the clip was published.
  function clipFor(play, plays) {
    if (!clips.length) return null;
    const ids = [play.matchup?.batter?.id, play.matchup?.pitcher?.id];
    const end = Date.parse(play.about?.endTime || "") || 0;
    return clips.find((c) => {
      if (!c.players.some((id) => ids.includes(id))) return false;
      const t = Date.parse(c.date) || Infinity;
      if (t < end) return false;
      // No later play by the same batter that also fits better.
      const later = plays.find((p) => p !== play && p.about?.atBatIndex > play.about?.atBatIndex && c.players.includes(p.matchup?.batter?.id) &&
        (Date.parse(p.about?.endTime || "") || Infinity) <= t && (p.about?.isScoringPlay || /home_run|double|triple|strikeout/.test(p.result?.eventType || "")));
      return !later;
    }) || null;
  }

  function play(c, user = false) {
    if (!c) return;
    if (user) userPicked = true;
    playingId = c.id;
    vbox.classList.add("has");
    if (video.dataset.src !== c.url) { video.dataset.src = c.url; video.src = c.url; video.poster = c.thumb; }
    video.muted = muted;
    video.play().catch(() => {});
    vbox.querySelector(".gd-vcap .t").textContent = c.title;
    document.querySelectorAll(".gd-clip").forEach((el) => el.classList.toggle("on", el.dataset.clip === c.id));
  }

  // ---- Strike zone ----
  const callClass = (d) => (d.isInPlay ? "inplay" : d.isStrike ? "strike" : d.isBall ? "ball" : "other");
  function zone(ab) {
    const pitches = (ab?.playEvents || []).filter((e) => e.isPitch);
    const W = 300, H = 300;
    // Feet → px: plate is 17 in wide (±0.708 ft). Show x in [-1.6, 1.6] ft, z in [0.9, 4.1] ft.
    const sx = (x) => W / 2 + x * (W / 3.2), sz = (z) => H - (z - 0.9) * (H / 3.2);
    const top = pitches.find((p) => p.pitchData?.strikeZoneTop)?.pitchData.strikeZoneTop || 3.4;
    const bot = pitches.find((p) => p.pitchData?.strikeZoneBottom)?.pitchData.strikeZoneBottom || 1.6;
    const zx = sx(-0.708), zw = sx(0.708) - zx, zy = sz(top), zh = sz(bot) - zy;
    const grid = [1, 2].map((i) => `<line x1="${zx + zw * i / 3}" y1="${zy}" x2="${zx + zw * i / 3}" y2="${zy + zh}"/><line x1="${zx}" y1="${zy + zh * i / 3}" x2="${zx + zw}" y2="${zy + zh * i / 3}"/>`).join("");
    const dots = pitches.map((p, i) => {
      const c = p.pitchData?.coordinates; if (!c || c.pX == null) return "";
      const last = i === pitches.length - 1;
      return `<g class="pt ${callClass(p.details || {})} ${last ? "last" : ""}"><circle cx="${sx(c.pX)}" cy="${sz(c.pZ)}" r="15"/>
        <text x="${sx(c.pX)}" y="${sz(c.pZ) + 6}">${i + 1}</text></g>`;
    }).join("");
    const plate = `<path class="plate" d="M${sx(-0.708)} ${H + 4} L${sx(0.708)} ${H + 4} L${sx(0.708)} ${H + 9} L${W / 2} ${H + 18} L${sx(-0.708)} ${H + 9} Z"/>`;
    return `<svg class="zone" viewBox="0 0 ${W} ${H + 20}"><rect class="sz" x="${zx}" y="${zy}" width="${zw}" height="${zh}"/>
      <g class="grid">${grid}</g>${plate}${dots}</svg>`;
  }
  function pitchList(ab) {
    const evs = (ab?.playEvents || []).filter((e) => e.isPitch);
    return evs.map((e, i) => {
      const d = e.details || {}, pd = e.pitchData || {};
      return `<div class="gd-pitch"><span class="n ${callClass(d)}">${i + 1}</span>
        <div><div class="pn">${esc(d.type?.description || "Pitch")}${pd.startSpeed ? ` <span class="mph">${pd.startSpeed.toFixed(1)} mph</span>` : ""}</div>
        <div class="pc">${esc(d.description || d.call?.description || "")}${e.count ? ` <span class="muted">· ${e.count.balls}-${e.count.strikes}</span>` : ""}</div></div></div>`;
    }).reverse().join("");
  }
  function hitLine(ab) {
    const h = (ab?.playEvents || []).map((e) => e.hitData).filter(Boolean).pop();
    if (!h) return "";
    return `<div class="gd-hit">${[h.launchSpeed && `<b>${h.launchSpeed.toFixed(1)}</b> mph exit velo`, h.launchAngle != null && `<b>${Math.round(h.launchAngle)}°</b> launch`, h.totalDistance && `<b>${Math.round(h.totalDistance)}</b> ft`].filter(Boolean).join(`<span class="dotsep"></span>`)}</div>`;
  }

  // ---- Play feed ----
  const ICON = { home_run: "HR", strikeout: "K", strikeout_double_play: "K", walk: "BB", intent_walk: "IBB", single: "1B", double: "2B", triple: "3B", hit_by_pitch: "HBP", stolen_base_2b: "SB", field_error: "E" };
  function feedList(plays, teams, current) {
    return plays.slice().reverse().map((p) => {
      const ab = p.about || {}, r = p.result || {};
      const c = clipFor(p, plays);
      const on = current && current.about?.atBatIndex === ab.atBatIndex;
      const bat = teamMeta(ab.halfInning === "top" ? teams.away : teams.home);
      return `<div class="gd-play ${ab.isScoringPlay ? "scoring" : ""} ${on ? "on" : ""}" data-ab="${ab.atBatIndex}" role="button">
        <span class="ic">${esc(ICON[r.eventType] || (r.event ? r.event.split(" ").map((w) => w[0]).join("").slice(0, 3) : "•"))}</span>
        <div class="bd"><div class="ev">${esc(r.event || (ab.isComplete ? "" : "At bat"))}${c ? `<span class="film" data-clip="${esc(c.id)}">▶ Watch</span>` : ""}</div>
          <div class="ds">${esc(r.description || `${p.matchup?.batter?.fullName || ""} batting`)}</div>
          <div class="mt">${logoImg(bat)}${ab.halfInning === "top" ? "Top" : "Bot"} ${ab.inning}${ab.isScoringPlay ? ` · <b>${esc(teamMeta(teams.away).abbr)} ${r.awayScore}, ${esc(teamMeta(teams.home).abbr)} ${r.homeScore}</b>` : ""}</div></div></div>`;
    }).join("");
  }

  function html(feed) {
    const ld = feed.liveData || {}, gd = feed.gameData;
    const plays = (ld.plays?.allPlays || []).filter((p) => p.result?.description || p.playEvents?.length);
    const live = phaseOf(gd.status) === "live";
    const current = sel != null ? plays.find((p) => p.about?.atBatIndex === sel) : (live ? ld.plays?.currentPlay : plays[plays.length - 1]) || plays[plays.length - 1];
    const m = current?.matchup || {};
    const cnt = current?.count || {};
    const head = current ? `<div class="gd-mu">
        <div class="who"><img src="${headshot(m.pitcher?.id, 120)}" alt="" onerror="this.style.visibility='hidden'"><div><span>Pitching</span><b class="lnk" data-player="${m.pitcher?.id}">${esc(lastName(m.pitcher?.fullName || ""))}</b></div></div>
        <div class="who"><img src="${headshot(m.batter?.id, 120)}" alt="" onerror="this.style.visibility='hidden'"><div><span>Batting</span><b class="lnk" data-player="${m.batter?.id}">${esc(lastName(m.batter?.fullName || ""))}</b></div></div>
      </div>
      <div class="gd-count"><span>${cnt.balls ?? 0}-${cnt.strikes ?? 0}</span>${Scores.outsDots(cnt.outs)}<span class="muted">${current.about?.halfInning === "top" ? "Top" : "Bot"} ${current.about?.inning}</span>
        ${sel != null && live ? `<button class="gd-follow">Follow live</button>` : ""}</div>` : "";
    return `<div class="gd">
      <div class="gd-col1"><div class="gd-video-slot"></div>
        <div class="gd-clips hscroll">${clips.slice().reverse().map((c) => `<div class="gd-clip ${c.id === playingId ? "on" : ""}" data-clip="${esc(c.id)}" role="button">
          <div class="th" style="background-image:url('${esc(c.thumb)}')"><span>${esc(c.dur.replace(/^00:/, ""))}</span></div><div class="tt">${esc(c.title)}</div></div>`).join("") ||
          `<div class="gd-noclips muted">No clips for this game yet</div>`}</div></div>
      <div class="gd-col2">${head}<div class="gd-zone">${current ? zone(current) : ""}</div>
        <div class="gd-result">${current?.result?.description ? esc(current.result.description) : ""}${hitLine(current)}</div>
        <div class="gd-pitches vscroll">${pitchList(current)}</div></div>
      <div class="gd-col3 vscroll">${feedList(plays, gd.teams, current)}</div>
    </div>`;
  }

  function mount(root, feed, rerender) {
    root.querySelector(".gd-video-slot")?.appendChild(vbox);
    const gd = root.querySelector(".gd");
    if (!gd) return;
    gd.onclick = (e) => {
      const film = e.target.closest("[data-clip]");
      if (film && !film.closest(".gd-play")) { play(clips.find((c) => c.id === film.dataset.clip), true); return; }
      const pl = e.target.closest(".gd-play");
      if (pl) {
        sel = +pl.dataset.ab;
        const c = pl.querySelector("[data-clip]");
        if (c) play(clips.find((x) => x.id === c.dataset.clip), true);
        rerender(); return;
      }
      if (e.target.closest(".gd-follow")) { sel = null; rerender(); }
    };
    // Start on the newest clip.
    if (clips.length && !playingId) play(clips[clips.length - 1]);
  }

  return {
    html, mount,
    async start(rerender, isLive) {
      const changed = await loadClips();
      if (changed) {
        // A new highlight during a live game plays automatically unless the user is watching something they picked.
        if (!userPicked && clips.length && (video.paused || video.ended)) play(clips[clips.length - 1]);
        rerender();
      }
      clearTimeout(clipTimer);
      if (isLive()) clipTimer = setTimeout(() => this.start(rerender, isLive), 45_000);
    },
    stop() { clearTimeout(clipTimer); video.pause(); video.removeAttribute("src"); },
  };
};
