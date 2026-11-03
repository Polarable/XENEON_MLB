// Gameday view inside the game page:
//   left: a hero strike zone seen from behind the plate, with a batter silhouette on his side
//         and every pitch flying in from its real release point along its real path;
//   middle: play cards (recent plays first, then the game's impact plays);
//   right: MLB Film Room video with the game's clips.
// Also renders the live field (runners' photos on the bases, big ball/strike/out dots) for the left panel.
const Gameday = (pk) => {
  let clips = [];             // newest last
  let clipTimer = 0;
  let sel = null;             // atBatIndex the user tapped; null = follow the live at-bat
  let playingId = null;
  let userPicked = false;
  let muted = true;

  /* ================= Film Room video (persistent, so refreshes never restart it) ================= */
  const vbox = document.createElement("div");
  vbox.className = "gd-video";
  vbox.innerHTML = `<video playsinline muted autoplay preload="auto"></video>
    <div class="gd-vempty"><div class="fr">Film Room</div><div>Clips show up here as MLB posts them, usually a few minutes after the play.</div></div>
    <div class="gd-vcap"><span class="t"></span></div>
    <button class="gd-mute" aria-label="Sound">Sound off</button>`;
  const video = vbox.querySelector("video");
  video.addEventListener("ended", () => { const i = clips.findIndex((c) => c.id === playingId); if (i >= 0 && clips[i + 1]) play(clips[i + 1]); });
  vbox.querySelector(".gd-mute").onclick = (e) => {
    e.stopPropagation();
    muted = !muted; video.muted = muted;
    vbox.querySelector(".gd-mute").textContent = muted ? "Sound off" : "Sound on";
  };

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
          id: it.slug || it.id || it.title, title: it.title || it.headline || "Highlight",
          url: pickMp4(it), thumb: pickThumb(it), date: it.date || "", dur: it.duration || "",
          players: (it.keywordsAll || []).filter((k) => /player_id/i.test(k.type || "")).map((k) => +k.value),
        }))
        .sort((a, b) => String(a.date).localeCompare(String(b.date)));
      const fresh = next.length !== clips.length;
      clips = next;
      return fresh;
    } catch { return false; }
  }
  // A clip belongs to the last play by one of its players that ended before the clip was published.
  function clipFor(play, plays) {
    if (!clips.length || !play.about?.isComplete) return null;
    const ids = [play.matchup?.batter?.id, play.matchup?.pitcher?.id];
    const end = Date.parse(play.about?.endTime || "") || 0;
    return clips.find((c) => {
      if (!c.players.some((id) => ids.includes(id))) return false;
      const t = Date.parse(c.date) || Infinity;
      if (t < end) return false;
      const later = plays.find((p) => p !== play && p.about?.atBatIndex > play.about?.atBatIndex && c.players.includes(p.matchup?.batter?.id) &&
        (Date.parse(p.about?.endTime || "") || Infinity) <= t && isImpact(p));
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

  /* ================= Strike zone (persistent canvas, catcher's view) ================= */
  const zbox = document.createElement("div");
  zbox.className = "gd-zonebox";
  zbox.innerHTML = `<canvas width="1400" height="1200"></canvas><div class="gd-zinfo"></div><div class="gd-seq"></div><button class="gd-replay">Replay</button>`;
  const cv = zbox.querySelector("canvas");
  const ctx = cv.getContext("2d");
  const CW = 700, CH = 600;          // drawing units (canvas is 2x for sharpness)
  ctx.scale(2, 2);
  // Camera behind the plate: f chosen so the plate plane is ~150 px per foot (zone ≈ 210 px wide).
  const CAM_Y = -10, CAM_Z = 2.6, PX_FT = 150, PLATE_Y = 17 / 12;
  const F = PX_FT * (PLATE_Y - CAM_Y);
  const CX = CW / 2, CY = 315;
  const proj = (x, y, z) => { const d = y - CAM_Y; return [CX + (x * F) / d, CY - ((z - CAM_Z) * F) / d, F / d]; };

  let zAb = null;                    // at-bat being shown
  let zKey = "";                     // which at-bat + how many pitches are drawn
  let anim = null;                   // { list: [pitchIdx...], i, t0 }
  let raf = 0;

  const pitchesOf = (ab) => (ab?.playEvents || []).filter((e) => e.isPitch);
  const callOf = (d = {}) => (d.isInPlay ? "inplay" : d.isStrike ? "strike" : d.isBall ? "ball" : "other");
  const COLOR = { ball: "#4fc37a", strike: "#ef5b5b", inplay: "#5b9cff", other: "#b0b0b0" };

  // Pitch path from the Statcast release model: position(t) = p0 + v0 t + a t²/2, from the release point to the front of the plate.
  function path(p) {
    const c = p.pitchData?.coordinates || {};
    if ([c.x0, c.y0, c.z0, c.vX0, c.vY0, c.vZ0, c.aX, c.aY, c.aZ].some((v) => v == null)) {
      // No physics: straight in from a generic release point.
      const end = [c.pX ?? 0, PLATE_Y, c.pZ ?? 2.5];
      return { at: (u) => [end[0] * u + 1.8 * (1 - u), 54 - (54 - PLATE_Y) * u, end[2] * u + 5.8 * (1 - u)], T: 0.42 };
    }
    // Back up from y0 (50 ft) to the real release point using the pitcher's extension.
    const yRel = 60.5 - (p.pitchData.extension || 6.3);
    const A = 0.5 * c.aY, B = c.vY0;
    const tAt = (y) => { const C = c.y0 - y; const disc = B * B - 4 * A * C; return (-B - Math.sqrt(Math.max(0, disc))) / (2 * A); };
    const t0 = tAt(yRel), t1 = tAt(PLATE_Y);
    const pos = (t) => [c.x0 + c.vX0 * t + 0.5 * c.aX * t * t, c.y0 + c.vY0 * t + 0.5 * c.aY * t * t, c.z0 + c.vZ0 * t + 0.5 * c.aZ * t * t];
    return { at: (u) => pos(t0 + (t1 - t0) * u), T: Math.max(0.35, t1 - t0) };
  }

  function drawBatter(side) {
    // A clean silhouette in a batting stance, standing in the box beside the plate (feet, catcher's view).
    // Right-handed hitters stand on the catcher's left.
    // Drawn smaller than life (like a broadcast inset) so the whole stance fits beside the zone.
    const s = side === "L" ? -1 : 1;        // mirror for lefties
    const K = 82;                            // px per foot for the figure
    const bx = CX - s * (0.708 * PX_FT + 1.05 * K);
    const P = (x, z) => [bx + s * x * K, CH - 8 - z * K];
    ctx.save();
    const g = ctx.createLinearGradient(0, 0, 0, CH);
    g.addColorStop(0, "rgba(255,255,255,.13)"); g.addColorStop(1, "rgba(255,255,255,.05)");
    ctx.fillStyle = g; ctx.strokeStyle = g; ctx.lineCap = "round"; ctx.lineJoin = "round";
    const limb = (pts, w) => { ctx.lineWidth = w * K; ctx.beginPath(); pts.forEach(([x, z], i) => { const [a, b] = P(x, z); i ? ctx.lineTo(a, b) : ctx.moveTo(a, b); }); ctx.stroke(); };
    const poly = (pts) => { ctx.beginPath(); pts.forEach(([x, z], i) => { const [a, b] = P(x, z); i ? ctx.lineTo(a, b) : ctx.moveTo(a, b); }); ctx.closePath(); ctx.fill(); };
    // legs (front leg toward the plate), slightly bent
    limb([[0.25, 3.15], [0.75, 1.75], [0.95, 0.15]], 0.42);
    limb([[-0.3, 3.15], [-0.65, 1.7], [-0.8, 0.15]], 0.42);
    // hips and torso, leaning over the plate a little
    poly([[-0.55, 3.35], [0.5, 3.35], [0.62, 4.55], [0.35, 5.15], [-0.45, 5.2], [-0.62, 4.5]]);
    // arms up to the hands behind the back shoulder
    limb([[0.3, 4.95], [0.05, 4.55], [-0.45, 5.0]], 0.3);
    limb([[-0.3, 5.0], [-0.6, 4.75], [-0.5, 5.05]], 0.3);
    // helmet with brim toward the pitcher
    const [hx, hy] = P(0.05, 5.62);
    ctx.beginPath(); ctx.arc(hx, hy, 0.38 * K, 0, Math.PI * 2); ctx.fill();
    poly([[0.2, 5.45], [0.62, 5.42], [0.6, 5.52], [0.2, 5.6]]);
    // bat, cocked back over the shoulder
    limb([[-0.5, 5.05], [-1.25, 6.9]], 0.16);
    ctx.restore();
  }

  function drawScene(ab) {
    ctx.clearRect(0, 0, CW, CH);
    const ps = pitchesOf(ab);
    const top = ps.find((p) => p.pitchData?.strikeZoneTop)?.pitchData.strikeZoneTop || 3.45;
    const bot = ps.find((p) => p.pitchData?.strikeZoneBottom)?.pitchData.strikeZoneBottom || 1.6;
    drawBatter(ab?.matchup?.batSide?.code || "R");
    // plate
    const pl = [[-0.708, 0], [0.708, 0], [0.708, -0.5], [0, -1.2], [-0.708, -0.5]].map(([x, yy]) => proj(x, PLATE_Y - yy * 0.6, 0));
    ctx.fillStyle = "rgba(255,255,255,.22)"; ctx.beginPath(); pl.forEach(([a, b], i) => (i ? ctx.lineTo(a, b) : ctx.moveTo(a, b))); ctx.closePath(); ctx.fill();
    // zone with a 3x3 grid
    const [x1, y1] = proj(-0.708, PLATE_Y, top), [x2, y2] = proj(0.708, PLATE_Y, bot);
    ctx.fillStyle = "rgba(255,255,255,.035)"; ctx.fillRect(x1, y1, x2 - x1, y2 - y1);
    ctx.strokeStyle = "rgba(255,255,255,.12)"; ctx.lineWidth = 1;
    for (let i = 1; i < 3; i++) {
      ctx.beginPath(); ctx.moveTo(x1 + (x2 - x1) * i / 3, y1); ctx.lineTo(x1 + (x2 - x1) * i / 3, y2); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x1, y1 + (y2 - y1) * i / 3); ctx.lineTo(x2, y1 + (y2 - y1) * i / 3); ctx.stroke();
    }
    ctx.strokeStyle = "rgba(255,255,255,.85)"; ctx.lineWidth = 2.5; ctx.strokeRect(x1, y1, x2 - x1, y2 - y1);
  }

  function ball(p, idx, u = 1, trail = true, fade = 1) {
    const pt = path(p);
    const col = COLOR[callOf(p.details)];
    if (trail && u > 0) {
      // Trail: the path so far, thicker and brighter near the ball.
      const N = 40;
      for (let k = 1; k <= N; k++) {
        const ua = (u * (k - 1)) / N, ub = (u * k) / N;
        const [ax, ay, as] = proj(...pt.at(ua)), [bx, by] = proj(...pt.at(ub));
        ctx.strokeStyle = col; ctx.globalAlpha = (k / N) * 0.55 * fade; ctx.lineWidth = Math.max(1, 0.24 * as * (k / N));
        ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }
    const [x, y, sc] = proj(...pt.at(u));
    const r = Math.max(2.5, 0.121 * sc);
    ctx.globalAlpha = Math.max(fade, 0.55);
    ctx.fillStyle = col; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    ctx.lineWidth = 2; ctx.strokeStyle = "rgba(0,0,0,.6)"; ctx.stroke();
    if (u >= 1) {
      ctx.fillStyle = "#000"; ctx.font = `700 ${Math.round(r * 1.05)}px "Inter Tight", sans-serif`; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText(String(idx + 1), x, y + 1);
    }
    ctx.globalAlpha = 1;
  }

  function frame(now) {
    const ps = pitchesOf(zAb);
    drawScene(zAb);
    const animating = anim && anim.i < anim.list.length;
    const cur = animating ? anim.list[anim.i] : -1;
    // Pitches already thrown sit at the plate with faint trails; the newest keeps a brighter one.
    ps.forEach((p, i) => {
      if (animating && i >= cur) return;
      ball(p, i, 1, true, i === ps.length - 1 ? 0.9 : 0.3);
    });
    if (animating) {
      const p = ps[cur];
      const dur = path(p).T * 2200;            // about 2x slower than real life so you can follow the break
      const u = Math.min(1, (now - anim.t0) / dur);
      ball(p, cur, u, true, 1);
      if (u >= 1 && now - anim.t0 > dur + 350) { anim.i++; anim.t0 = now; }
      raf = requestAnimationFrame(frame);
    }
  }
  function animate(list) {
    cancelAnimationFrame(raf);
    anim = { list, i: 0, t0: performance.now() };
    raf = requestAnimationFrame(frame);
  }

  function zoneInfo(ab) {
    const m = ab?.matchup || {}, ps = pitchesOf(ab);
    const last = ps[ps.length - 1];
    const hit = (ab?.playEvents || []).map((e) => e.hitData).filter(Boolean).pop();
    const bat = m.batSide?.code === "L" ? "Bats left" : "Bats right";
    const br = last?.pitchData?.breaks;
    zbox.querySelector(".gd-zinfo").innerHTML = `
      <div class="zp lnk" data-player="${m.pitcher?.id}"><img src="${headshot(m.pitcher?.id, 120)}" alt="" onerror="this.style.visibility='hidden'">
        <div><span>Pitching · ${m.pitchHand?.code === "L" ? "LHP" : "RHP"}</span><b>${esc(m.pitcher?.fullName || "")}</b></div></div>
      <div class="zp lnk" data-player="${m.batter?.id}"><img src="${headshot(m.batter?.id, 120)}" alt="" onerror="this.style.visibility='hidden'">
        <div><span>Batting · ${bat}</span><b>${esc(m.batter?.fullName || "")}</b></div></div>
      ${last ? `<div class="zl"><b>${esc(last.details?.type?.description || "")}</b>${last.pitchData?.startSpeed ? ` ${last.pitchData.startSpeed.toFixed(1)} mph` : ""}
        ${br?.breakVerticalInduced != null ? `<span>${br.breakVerticalInduced.toFixed(0)}" induced vertical · ${Math.abs(br.breakHorizontal || 0).toFixed(0)}" horizontal</span>` : ""}</div>` : ""}
      ${hit ? `<div class="zh">${[hit.launchSpeed && `<b>${hit.launchSpeed.toFixed(1)}</b> mph off the bat`, hit.launchAngle != null && `<b>${Math.round(hit.launchAngle)}°</b>`, hit.totalDistance && `<b>${Math.round(hit.totalDistance)}</b> ft`].filter(Boolean).join(" · ")}</div>` : ""}`;
    zbox.querySelector(".gd-seq").innerHTML = ps.map((e, i) => {
      const d = e.details || {}, pd = e.pitchData || {};
      return `<div class="sq"><i class="${callOf(d)}">${i + 1}</i><div><b>${esc(d.type?.description || "Pitch")}</b><span>${pd.startSpeed ? `${pd.startSpeed.toFixed(1)} · ` : ""}${esc(d.description || "")}</span></div></div>`;
    }).reverse().join("");
    // Put the pitch list on the side away from the batter.
    zbox.classList.toggle("lefty", m.batSide?.code === "L");
  }

  // Show an at-bat: animate only new pitches if it's the same at-bat, or the whole sequence for a new one.
  function setZone(ab, replay = false) {
    if (!ab) return;
    const ps = pitchesOf(ab);
    const key = `${ab.about?.atBatIndex}:${ps.length}`;
    if (key === zKey && !replay) return;
    const sameAb = zAb && zAb.about?.atBatIndex === ab.about?.atBatIndex && zKey;
    const prevCount = sameAb ? pitchesOf(zAb).length : 0;
    zAb = ab; zKey = key;
    zoneInfo(ab);
    animate(ps.map((_, i) => i).slice(replay ? 0 : prevCount));
  }
  zbox.querySelector(".gd-replay").onclick = (e) => { e.stopPropagation(); setZone(zAb, true); };

  /* ================= Plays ================= */
  const RISP = (p) => (p.runners || []).some((r) => /2B|3B/.test(r.movement?.originBase || ""));
  function isImpact(p) {
    const r = p.result || {}, ab = p.about || {};
    if (ab.isScoringPlay) return true;
    if (/home_run|triple|double$|grounded_into_double_play|double_play|triple_play|caught_stealing/.test(r.eventType || "")) return true;
    if (/strikeout/.test(r.eventType || "") && (RISP(p) || p.count?.outs === 3)) return true;
    return (ab.captivatingIndex || 0) >= 30;
  }

  // Situational headline in the style of the big sports apps.
  function headline(p, before, isLast, teams) {
    const r = p.result || {}, ab = p.about || {};
    const bat = lastName(p.matchup?.batter?.fullName || ""), pit = lastName(p.matchup?.pitcher?.fullName || "");
    const team = teamMeta(ab.halfInning === "top" ? teams.away : teams.home).name;
    const rbi = r.rbi || 0;
    const [a0, h0] = before, a1 = r.awayScore ?? a0, h1 = r.homeScore ?? h0;
    const top = ab.halfInning === "top";
    const leadBefore = Math.sign(a0 - h0), leadAfter = Math.sign(a1 - h1);
    const battingLeadsAfter = top ? leadAfter > 0 : leadAfter < 0;
    if (!ab.isComplete) return `${bat} at the plate`;
    if (isLast && !top && h1 > a1 && ab.isScoringPlay) return r.eventType === "home_run" ? `Walk-off homer! ${bat} wins it` : `Walk-off! ${bat} wins it for the ${team}`;
    if (r.eventType === "home_run") {
      const kind = rbi === 4 ? "Grand slam" : rbi === 3 ? "Three-run homer" : rbi === 2 ? "Two-run homer" : "Solo shot";
      if (leadBefore !== leadAfter && battingLeadsAfter) return `${kind} puts the ${team} ahead`;
      if (leadAfter === 0) return `${kind} ties it`;
      return `${kind} for ${bat}`;
    }
    if (ab.isScoringPlay) {
      if (leadBefore !== leadAfter && battingLeadsAfter) return `${bat} puts the ${team} ahead`;
      if (leadAfter === 0 && leadBefore !== 0) return `${bat} ties it`;
      const ev = (r.event || "").toLowerCase();
      if (rbi > 1) return `${bat} drives in ${rbi} with a ${ev}`;
      if (rbi === 1) return `RBI ${ev} for ${bat}`;
      return `${team} score on a ${ev}`;
    }
    if (/strikeout/.test(r.eventType || "")) {
      if (RISP(p) && p.count?.outs === 3) return `${pit} strands the runners`;
      if (p.count?.outs === 3) return `${pit} strikes out ${bat} to end the inning`;
      return `${pit} punches out ${bat}`;
    }
    if (/double_play/.test(r.eventType || "")) return p.count?.outs === 3 ? "Inning-ending double play" : "Double play";
    if (r.eventType === "triple") return `${bat} legs out a triple`;
    if (r.eventType === "double") return `${bat} doubles`;
    if (/caught_stealing/.test(r.eventType || "")) return "Runner caught stealing";
    return `${r.event || "Play"}`;
  }

  function miniBases(p) {
    const on = { "1B": 0, "2B": 0, "3B": 0 };
    (p.runners || []).forEach((r) => { if (r.movement?.end && !r.movement.isOut && on[r.movement.end] != null) on[r.movement.end] = 1; });
    return Scores.bases({ first: on["1B"], second: on["2B"], third: on["3B"] });
  }

  function card(p, plays, before, teams, current, isLast) {
    const ab = p.about || {}, r = p.result || {}, m = p.matchup || {};
    const c = clipFor(p, plays);
    const ps = pitchesOf(p), last = ps[ps.length - 1];
    const hit = (p.playEvents || []).map((e) => e.hitData).filter(Boolean).pop();
    const on = current && current.about?.atBatIndex === ab.atBatIndex;
    const bat = teamMeta(ab.halfInning === "top" ? teams.away : teams.home);
    const stats = [
      ps.length && `${ps.length} pitch${ps.length === 1 ? "" : "es"}`,
      last?.pitchData?.startSpeed && `${esc(last.details?.type?.description || "")} ${last.pitchData.startSpeed.toFixed(0)} mph`,
      hit?.launchSpeed && `${hit.launchSpeed.toFixed(1)} mph off the bat`,
      hit?.totalDistance && `${Math.round(hit.totalDistance)} ft`,
    ].filter(Boolean);
    return `<div class="pc ${ab.isScoringPlay ? "scoring" : ""} ${on ? "on" : ""} ${ab.isComplete ? "" : "now"}" data-ab="${ab.atBatIndex}" role="button" style="${vars(bat)}">
      <div class="pc-top"><span class="inn">${logoImg(bat)}${ab.halfInning === "top" ? "Top" : "Bot"} ${ab.inning}</span>
        ${ab.isComplete ? "" : `<span class="nowtag"><i class="dot"></i>Now</span>`}
        ${ab.isScoringPlay ? `<span class="score">${esc(teamMeta(teams.away).abbr)} ${r.awayScore} · ${esc(teamMeta(teams.home).abbr)} ${r.homeScore}</span>` : ""}
        ${c ? `<span class="film" data-clip="${esc(c.id)}">▶ Film Room</span>` : ""}</div>
      <div class="pc-main">
        <div class="pc-pics"><img class="b" src="${headshot(m.batter?.id, 160)}" alt="" onerror="this.style.visibility='hidden'">
          <img class="p" src="${headshot(m.pitcher?.id, 100)}" alt="" onerror="this.style.visibility='hidden'"></div>
        <div class="pc-txt"><div class="hl">${esc(headline(p, before, isLast, teams))}</div>
          <div class="ds">${esc(r.description || `${m.batter?.fullName || ""} vs. ${m.pitcher?.fullName || ""}`)}</div>
          <div class="st">${stats.join(`<span class="dotsep"></span>`)}</div></div>
        <div class="pc-sit">${miniBases(p)}${Scores.outsDots(p.count?.outs)}</div>
      </div></div>`;
  }

  const playsOf = (feed) => (feed.liveData?.plays?.allPlays || []).filter((p) => p.result?.description || (p.playEvents || []).length);

  // mode: "gameday" (recent + impact), "scoring", "all"
  function cards(feed, mode, current = currentAb(feed)) {
    const teams = feed.gameData.teams;
    const plays = playsOf(feed);
    const before = [];
    let a = 0, h = 0;
    plays.forEach((p) => { before.push([a, h]); if (p.result?.awayScore != null) { a = p.result.awayScore; h = p.result.homeScore; } });
    const final = phaseOf(feed.gameData.status) === "final";
    const idx = plays.map((_, i) => i).reverse();
    let pick;
    if (mode === "all") pick = idx;
    else if (mode === "scoring") pick = idx.filter((i) => plays[i].about?.isScoringPlay);
    else pick = [...idx.slice(0, 3), ...idx.slice(3).filter((i) => isImpact(plays[i]))];
    if (!pick.length) return `<div class="s-loading">${mode === "scoring" ? "No runs scored yet" : "No plays yet"}</div>`;
    const lastIdx = plays.length - 1;
    let out = "";
    pick.forEach((i, k) => {
      if (mode === "gameday" && k === 3) out += `<div class="pc-sep">Key plays</div>`;
      out += card(plays[i], plays, before[i], teams, current, final && i === lastIdx);
    });
    return out;
  }

  function currentAb(feed) {
    const plays = playsOf(feed);
    const live = phaseOf(feed.gameData.status) === "live";
    if (sel != null) return plays.find((p) => p.about?.atBatIndex === sel) || plays[plays.length - 1];
    return (live ? feed.liveData?.plays?.currentPlay : null) || plays[plays.length - 1];
  }

  function html(feed) {
    const live = phaseOf(feed.gameData.status) === "live";
    return `<div class="gd">
      <div class="gd-zcol"><div class="gd-zone-slot"></div>
        ${sel != null && live ? `<button class="gd-follow">Follow live</button>` : ""}</div>
      <div class="gd-feed vscroll">${cards(feed, "gameday")}</div>
      <div class="gd-vcol"><div class="gd-video-slot"></div>
        <div class="gd-clips vscroll">${clips.slice().reverse().map((c) => `<div class="gd-clip ${c.id === playingId ? "on" : ""}" data-clip="${esc(c.id)}" role="button">
          <div class="th" style="background-image:url('${esc(c.thumb)}')"><span>${esc(c.dur.replace(/^00:/, ""))}</span></div><div class="tt">${esc(c.title)}</div></div>`).join("") ||
          `<div class="gd-noclips muted">No Film Room clips for this game yet</div>`}</div></div>
    </div>`;
  }

  // Tap handling shared by Gameday and the Scoring / All plays tabs.
  function onClick(e, rerender, goGameday) {
    const film = e.target.closest("[data-clip]");
    const pc = e.target.closest(".pc");
    if (film && !pc) { play(clips.find((c) => c.id === film.dataset.clip), true); return true; }
    if (pc) {
      sel = +pc.dataset.ab;
      const c = pc.querySelector("[data-clip]");
      if (c) play(clips.find((x) => x.id === c.dataset.clip), true);
      zKey = "";                       // force the sequence to animate
      goGameday ? goGameday() : rerender();
      return true;
    }
    if (e.target.closest(".gd-follow")) { sel = null; zKey = ""; rerender(); return true; }
    return false;
  }

  function mount(root, feed) {
    root.querySelector(".gd-video-slot")?.appendChild(vbox);
    root.querySelector(".gd-zone-slot")?.appendChild(zbox);
    const cur = currentAb(feed);
    if (cur) setZone(cur);
    if (clips.length && !playingId) play(clips[clips.length - 1]);
  }

  /* ================= Live field for the left panel ================= */
  function field(ls) {
    const o = ls.offense || {}, d = ls.defense || {};
    const person = (r, cls, w = 160) => r ? `<div class="fr-run ${cls} lnk" data-player="${r.id}"><img src="${headshot(r.id, w)}" alt="" onerror="this.style.visibility='hidden'"><span>${esc(lastName(r.fullName))}</span></div>` : "";
    const base = (on, cls) => `<i class="fb ${cls} ${on ? "on" : ""}"></i>`;
    const dots = (n, max, cls) => Array.from({ length: max }, (_, i) => `<i class="${i < n ? `on ${cls}` : ""}"></i>`).join("");
    return `<div class="g-field">
      <div class="fd">
        <svg viewBox="0 0 380 280" class="fd-lines"><path d="M190 250 L320 136 L190 22 L60 136 Z"/><circle cx="190" cy="136" r="15"/></svg>
        ${base(o.first, "b1")}${base(o.second, "b2")}${base(o.third, "b3")}<i class="fb home"></i>
        ${person(o.first, "r1")}${person(o.second, "r2")}${person(o.third, "r3")}${person(o.batter, "rh")}
        ${d.pitcher ? `<div class="fr-mound lnk" data-player="${d.pitcher.id}"><img src="${headshot(d.pitcher.id, 120)}" alt="" onerror="this.style.visibility='hidden'"></div>` : ""}
      </div>
      <div class="bso">
        <div><b>B</b>${dots(ls.balls ?? 0, 4, "ball")}</div>
        <div><b>S</b>${dots(ls.strikes ?? 0, 3, "strike")}</div>
        <div><b>O</b>${dots(ls.outs ?? 0, 3, "out")}</div>
        ${d.pitcher ? `<div class="bso-p"><span>Pitching</span> ${esc(lastName(d.pitcher.fullName))}${o.onDeck ? `<br><span>On deck</span> ${esc(lastName(o.onDeck.fullName))}` : ""}</div>` : ""}
      </div></div>`;
  }

  return {
    html, mount, cards, field, onClick,
    async start(rerender, isLive) {
      const changed = await loadClips();
      if (changed) {
        // New clips during a live game play on their own unless the user is watching one they picked.
        if (!userPicked && clips.length && (video.paused || video.ended)) play(clips[clips.length - 1]);
        rerender();
      }
      clearTimeout(clipTimer);
      if (isLive()) clipTimer = setTimeout(() => this.start(rerender, isLive), 45_000);
    },
    stop() { clearTimeout(clipTimer); cancelAnimationFrame(raf); video.pause(); video.removeAttribute("src"); },
  };
};
