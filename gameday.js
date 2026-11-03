// Gameday view inside the game page, laid out like the Real app's feed but stretched for a wide screen:
//   left:   "Now batting": the at-bat in a big strike zone seen from the pitcher's side (TV view),
//           batter standing on his real side, pitches flying in along their Statcast paths;
//           on deck / in the hole underneath.
//   middle: the feed: Real-style play cards (photo, distance + direction headline, batter and
//           pitcher game lines, pitch list next to a mini strike zone, tidbits).
// Tapping a card shows that at-bat on the left. Every pitch (and each card's Video button) opens its
// Baseball Savant video in a browser tab. Also renders the live field
// (runners' photos on the bases, big ball/strike/out dots) for the game page's left panel.
//
// The batter silhouette (img/batter-hd.png) is cut from the reference image the user supplied (pitcher's view, right-handed stance).
const BATTER_IMG = new Image();
BATTER_IMG.src = "img/batter-hd.png";   // 3x the original cut, edges re-smoothed so it stays sharp at full size

const Gameday = (pk) => {
  let feed = null;
  let sel = null;             // atBatIndex the user tapped; null = follow the live at-bat

  const COLOR = { ball: "#4fc37a", strike: "#ef5b5b", inplay: "#4b8dff", other: "#9aa0a6" };
  const pitchesOf = (ab) => (ab?.playEvents || []).filter((e) => e.isPitch);
  const callOf = (d = {}) => (d.isInPlay ? "inplay" : d.isStrike ? "strike" : d.isBall ? "ball" : "other");
  const playsOf = (f) => (f.liveData?.plays?.allPlays || []).filter((p) => p.result?.description || (p.playEvents || []).length);
  const short = (n = "") => { const parts = n.split(" "); return parts.length > 1 ? `${parts[0][0]}. ${parts.slice(1).join(" ")}` : n; };

  /* ================= Persistent DOM (so refreshes never restart video or animations) ================= */
  const root = document.createElement("div");
  root.className = "gd";
  root.innerHTML = `
    <div class="gd-now">
      <div class="gd-now-head"></div>
      <div class="gd-now-body">
        <div class="gd-seq"></div>
        <div class="gd-stage"><canvas width="840" height="1040"></canvas><button class="gd-replay">Replay</button></div>
      </div>
      <div class="gd-now-foot"></div>
    </div>
    <div class="gd-feed vscroll"></div>`;
  const $ = (s) => root.querySelector(s);
  dragScroll($(".gd-feed"), "y");

  /* ================= Video (Baseball Savant) ================= */
  // Savant has a video for every pitch, keyed by the pitch's Statcast playId. The widget can't play
  // them (iCUE's browser has no H.264), so a tap opens the Savant page in a real browser tab.
  const savant = (id) => `https://baseballsavant.mlb.com/sporty-videos?playId=${encodeURIComponent(id)}`;
  const lastPitchId = (p) => { const ps = pitchesOf(p); for (let i = ps.length - 1; i >= 0; i--) if (ps[i].playId) return ps[i].playId; return null; };
  const PLAY_ICON = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13l11-6.5z"/></svg>`;
  const vidLink = (id, inner, cls = "") => `<a class="${cls}" href="${savant(id)}" target="_blank" rel="noopener" data-savant>${inner}</a>`;

  /* ================= Strike zone, pitcher's view ================= */
  // A telephoto camera far behind the mound (like the TV center-field shot): little perspective, real paths.
  const PLATE_Y = 17 / 12, CAM_Y = 400;
  function camera(w, h, pxFt, cz, shift = 0) {
    const F = pxFt * (CAM_Y - PLATE_Y), cx = w / 2 + shift;
    // Pitcher's view: the catcher's left is our right, so x is mirrored.
    return (x, y, z) => { const d = CAM_Y - y; return [cx - (x * F) / d, cz - ((z - 2.5) * F) / d, F / d]; };
  }
  // Pitch path from the Statcast model: position(t) = p0 + v0·t + a·t²/2, from release to the front of the plate.
  function path(p) {
    const c = p.pitchData?.coordinates || {};
    if ([c.x0, c.y0, c.z0, c.vX0, c.vY0, c.vZ0, c.aX, c.aY, c.aZ].some((v) => v == null)) {
      const ex = c.pX ?? 0, ez = c.pZ ?? 2.5;
      return { at: (u) => [ex * u - 1.8 * (1 - u), 54 - (54 - PLATE_Y) * u, ez * u + 5.8 * (1 - u)], T: 0.42 };
    }
    const yRel = 60.5 - (p.pitchData.extension || 6.3);
    const A = 0.5 * c.aY, B = c.vY0;
    const tAt = (y) => { const C = c.y0 - y; return (-B - Math.sqrt(Math.max(0, B * B - 4 * A * C))) / (2 * A); };
    const t0 = tAt(yRel), t1 = tAt(PLATE_Y);
    const pos = (t) => [c.x0 + c.vX0 * t + 0.5 * c.aX * t * t, c.y0 + c.vY0 * t + 0.5 * c.aY * t * t, c.z0 + c.vZ0 * t + 0.5 * c.aZ * t * t];
    return { at: (u) => pos(t0 + (t1 - t0) * u), T: Math.max(0.35, t1 - t0) };
  }

  // Tinted copies of the batter silhouette.
  const tinted = {};
  function batterImg(color) {
    if (tinted[color] || !BATTER_IMG.complete || !BATTER_IMG.naturalWidth) return tinted[color];
    const c = document.createElement("canvas");
    c.width = BATTER_IMG.naturalWidth; c.height = BATTER_IMG.naturalHeight;
    const x = c.getContext("2d");
    x.drawImage(BATTER_IMG, 0, 0); x.globalCompositeOperation = "source-in"; x.fillStyle = color; x.fillRect(0, 0, c.width, c.height);
    return (tinted[color] = c);
  }

  // Draw the zone, batter and plate. Returns the projection so pitches can be drawn on top.
  function scene(ctx, w, h, ab, pxFt, cz) {
    // Batter: righties stand on our right from the pitcher's side, lefties on our left.
    // The zone sits a little off-center so the batter fits beside it.
    const side = ab?.matchup?.batSide?.code || "R";
    const P = camera(w, h, pxFt, cz, (side === "L" ? 1 : -1) * 1.0 * pxFt);
    ctx.clearRect(0, 0, w, h);
    const ps = pitchesOf(ab);
    const top = ps.find((p) => p.pitchData?.strikeZoneTop)?.pitchData.strikeZoneTop || 3.4;
    const bot = ps.find((p) => p.pitchData?.strikeZoneBottom)?.pitchData.strikeZoneBottom || 1.6;
    const img = batterImg("#3d3d40");
    if (img) {
      const bh = 6.3 * pxFt, bw = bh * (img.width / img.height);
      const [, footY] = P(0, PLATE_Y, 0);
      const [plateX] = P(0, PLATE_Y, 0);
      const edge = 0.95 * pxFt;                  // inner edge of the figure, just past the plate's corner
      ctx.save();
      ctx.translate(plateX, 0);
      if (side === "L") ctx.scale(-1, 1);
      ctx.drawImage(img, edge, footY - bh, bw, bh);
      ctx.restore();
    }
    // Plate (seen from the mound: flat edge toward us).
    const pl = [[-0.708, 0], [0.708, 0], [0.708, 0.5], [0, 1.2], [-0.708, 0.5]].map(([x, d]) => P(x, PLATE_Y + d * 0.35, 0));
    ctx.fillStyle = "#3d3d40"; ctx.beginPath(); pl.forEach(([a, b], i) => (i ? ctx.lineTo(a, b) : ctx.moveTo(a, b))); ctx.closePath(); ctx.fill();
    // Zone: a flat light fill, a 3x3 grid and a crisp outline (no hatching: it shimmered when scaled).
    const [x1, y1] = P(0.708, PLATE_Y, top), [x2, y2] = P(-0.708, PLATE_Y, bot);
    ctx.fillStyle = "rgba(255,255,255,.06)"; ctx.fillRect(x1, y1, x2 - x1, y2 - y1);
    ctx.strokeStyle = "rgba(255,255,255,.14)"; ctx.lineWidth = 1;
    for (let i = 1; i < 3; i++) {
      ctx.beginPath(); ctx.moveTo(x1 + (x2 - x1) * i / 3, y1); ctx.lineTo(x1 + (x2 - x1) * i / 3, y2); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x1, y1 + (y2 - y1) * i / 3); ctx.lineTo(x2, y1 + (y2 - y1) * i / 3); ctx.stroke();
    }
    ctx.strokeStyle = "rgba(255,255,255,.55)"; ctx.lineWidth = 1.5; ctx.strokeRect(x1, y1, x2 - x1, y2 - y1);
    return P;
  }

  function ballAt(ctx, P, p, idx, u, { trail = true, alpha = 1, label = true } = {}) {
    const pt = path(p);
    const col = COLOR[callOf(p.details)];
    if (trail && u > 0) {
      // One smooth streak: a tapered ribbon along the path that fades in toward the ball
      // (drawing it as stacked segments left visible beads where they overlapped).
      const N = 48, pts = [];
      for (let k = 0; k <= N; k++) {
        const [px, py, ps] = P(...pt.at((u * k) / N));
        pts.push([px, py, Math.max(0.3, 0.121 * ps * 1.15 * 0.85) * Math.pow(k / N, 1.4)]);
      }
      const L = [], R = [];
      pts.forEach(([px, py, hw], k) => {
        const [qx, qy] = pts[Math.min(N, k + 1)], [ox, oy] = pts[Math.max(0, k - 1)];
        let dx = qx - ox, dy = qy - oy; const len = Math.hypot(dx, dy) || 1; dx /= len; dy /= len;
        L.push([px - dy * hw, py + dx * hw]); R.push([px + dy * hw, py - dx * hw]);
      });
      const [tx, ty] = pts[0], [hx, hy] = pts[N];
      const g = ctx.createLinearGradient(tx, ty, hx, hy);
      const n = parseInt(col.slice(1), 16), rgb = `${n >> 16 & 255},${n >> 8 & 255},${n & 255}`;
      g.addColorStop(0, `rgba(${rgb},0)`); g.addColorStop(1, `rgba(${rgb},${0.6 * alpha})`);
      ctx.fillStyle = g; ctx.beginPath();
      L.forEach(([x0, y0], i) => (i ? ctx.lineTo(x0, y0) : ctx.moveTo(x0, y0)));
      for (let i = R.length - 1; i >= 0; i--) ctx.lineTo(R[i][0], R[i][1]);
      ctx.closePath(); ctx.fill();
    }
    const [x, y, sc] = P(...pt.at(u));
    const r = Math.max(3, 0.121 * sc * 1.15);
    ctx.globalAlpha = alpha;
    ctx.fillStyle = col; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    if (label && u >= 1) {
      ctx.fillStyle = "#fff"; ctx.font = `700 ${Math.round(r * 1.1)}px "Inter Tight", sans-serif`; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText(String(idx + 1), x, y + 1);
    }
    ctx.globalAlpha = 1;
  }

  // Static mini zone for a play card (final pitch locations, like Real's cards).
  function paintMini(canvas, ab) {
    // Logical size 220x260, shown at 170x201 (views.css): draw at exactly the screen's pixel count,
    // since the browser's downscale of a bigger canvas is what made these look soft.
    const w = 220, h = 260;
    const k = Math.max(0.5, (170 / w) * (typeof scale === "number" && scale > 0 ? scale : 1) * (window.devicePixelRatio || 1));
    canvas.width = Math.round(w * k); canvas.height = Math.round(h * k);
    const ctx = canvas.getContext("2d");
    ctx.setTransform(canvas.width / w, 0, 0, canvas.height / h, 0, 0);
    const P = scene(ctx, w, h, ab, 40, h - 112);
    pitchesOf(ab).forEach((p, i, a) => ballAt(ctx, P, p, i, 1, { trail: false, alpha: i === a.length - 1 ? 1 : 0.85 }));
  }

  // The big animated zone for the "Now batting" panel.
  const stage = $(".gd-stage canvas");
  const sctx = stage.getContext("2d");
  const SW = 420, SH = 520;
  // Match the canvas's pixels to the screen's (box size x zoom x devicePixelRatio) so nothing is resampled.
  function sizeStage() {
    const r = stage.getBoundingClientRect();
    const fit = r.width && r.height ? Math.min(r.width / SW, r.height / SH) : 1;
    const k = Math.min(6, Math.max(0.5, fit * (window.devicePixelRatio || 1)));
    const w = Math.round(SW * k), h = Math.round(SH * k);
    if (stage.width !== w || stage.height !== h) { stage.width = w; stage.height = h; }
    sctx.setTransform(w / SW, 0, 0, h / SH, 0, 0);
    if (zAb) frame(performance.now());
  }
  if (window.ResizeObserver) new ResizeObserver(() => sizeStage()).observe(stage);
  requestAnimationFrame(sizeStage);
  let zAb = null, zKey = "", anim = null, raf = 0;
  function frame(now) {
    const ps = pitchesOf(zAb);
    const P = scene(sctx, SW, SH, zAb, 74, 236);
    const animating = anim && anim.i < anim.list.length;
    const cur = animating ? anim.list[anim.i] : -1;
    ps.forEach((p, i) => { if (!animating || i < cur) ballAt(sctx, P, p, i, 1, { trail: i === ps.length - 1, alpha: i === ps.length - 1 ? 1 : 0.8 }); });
    if (animating) {
      const p = ps[cur];
      const dur = path(p).T * 2400;       // a bit over 2x slower than life so the break is easy to see
      const u = Math.min(1, (now - anim.t0) / dur);
      ballAt(sctx, P, p, cur, u, { trail: true });
      if (u >= 1 && now - anim.t0 > dur + 380) { anim.i++; anim.t0 = now; }
      raf = requestAnimationFrame(frame);
    }
  }
  function animate(list) { cancelAnimationFrame(raf); anim = { list, i: 0, t0: performance.now() }; raf = requestAnimationFrame(frame); }
  function setZone(ab, replay = false) {
    if (!ab) return;
    const ps = pitchesOf(ab);
    const key = `${ab.about?.atBatIndex}:${ps.length}`;
    if (key === zKey && !replay) return;
    const same = zAb && zKey && zAb.about?.atBatIndex === ab.about?.atBatIndex;
    const from = replay ? 0 : same ? pitchesOf(zAb).length : 0;
    zAb = ab; zKey = key;
    animate(ps.map((_, i) => i).slice(from));
  }
  $(".gd-replay").onclick = (e) => { e.stopPropagation(); setZone(zAb, true); };
  BATTER_IMG.addEventListener("load", () => {
    if (zAb) frame(performance.now());
    root.querySelectorAll("canvas.mini").forEach((c) => { const p = playsOf(feed || {}).find((x) => x.about?.atBatIndex === +c.dataset.ab); if (p) paintMini(c, p); });
  });

  /* ================= Game lines (computed up to each play) ================= */
  const NOT_AB = /walk|hit_by_pitch|sac_fly|sac_bunt|catcher_interf|intent_walk/;
  const HIT = /^(single|double|triple|home_run)$/;
  function gameLines(plays) {
    const bat = {}, pit = {};
    let outs = 0, halfKey = "";
    return plays.map((p) => {
      const ab = p.about || {}, r = p.result || {};
      const hk = `${ab.inning}${ab.halfInning}`;
      if (hk !== halfKey) { halfKey = hk; outs = 0; }
      if (ab.isComplete) {
        const b = (bat[p.matchup?.batter?.id] ||= { ab: 0, h: 0, rbi: 0, hr: 0, bb: 0, k: 0 });
        const t = r.eventType || "";
        if (!NOT_AB.test(t)) b.ab++;
        if (HIT.test(t)) b.h++;
        if (t === "home_run") b.hr++;
        if (/walk/.test(t)) b.bb++;
        if (/strikeout/.test(t)) b.k++;
        b.rbi += r.rbi || 0;
        const pc = (pit[p.matchup?.pitcher?.id] ||= { outs: 0, k: 0, r: 0, h: 0, bb: 0, p: 0 });
        pc.p += pitchesOf(p).length;
        const after = p.count?.outs ?? outs;
        pc.outs += Math.max(0, after - outs); outs = after;
        if (/strikeout/.test(t)) pc.k++;
        if (HIT.test(t)) pc.h++;
        if (/walk/.test(t)) pc.bb++;
        pc.r += (p.runners || []).filter((x) => x.movement?.end === "score").length;
      }
      return { bat: { ...(bat[p.matchup?.batter?.id] || { ab: 0, h: 0, rbi: 0 }) }, pit: { ...(pit[p.matchup?.pitcher?.id] || { outs: 0, k: 0, r: 0, h: 0, p: 0 }) } };
    });
  }
  const batLine = (b) => [`${b.h}/${b.ab}`, b.hr && `${b.hr > 1 ? `${b.hr} ` : ""}hr`, b.rbi && `${b.rbi} rbi`, b.bb && `${b.bb} bb`, b.k && `${b.k} k`].filter(Boolean).join(", ");
  const pitLine = (q) => [`${Math.floor(q.outs / 3)}.${q.outs % 3} ip`, `${q.h || 0} h`, q.r ? `${q.r} r` : "", `${q.k} k`, q.p ? `${q.p} p` : ""].filter(Boolean).join(", ");

  /* ================= Challenges and reviews ================= */
  // ABS ball/strike challenges (batter, pitcher or catcher taps the helmet or cap; 2 per team, kept when they win)
  // come through as reviewType "MJ" or as "Is Challenge: Batter - Challenge Overturned" text on the pitch.
  // Everything else is a replay review: a manager's challenge (challengeTeamId set) or one the umpires start.
  const ABS_TXT = /Is Challenge: (\w+) - Challenge (Confirmed|Overturned)/i;
  function reviewsOf(p) {
    const out = [], seen = new Set();
    const add = (rd, idx, txt) => {
      const m = txt ? ABS_TXT.exec(txt) : null;
      if (!rd && !m) return;
      const abs = !!m || rd?.reviewType === "MJ";
      const key = `${abs}:${idx}`;
      if (seen.has(key)) return; seen.add(key);
      const team = rd?.challengeTeamId ? teamById[rd.challengeTeamId] : null;
      out.push({ abs, idx, inProgress: !!rd?.inProgress, overturned: m ? /overturned/i.test(m[2]) : !!rd?.isOverturned,
        who: m ? m[1] : rd?.player?.fullName ? short(rd.player.fullName) : "", team: team?.abbr || "", manager: !abs && !!rd?.challengeTeamId });
    };
    const evs = p.playEvents || [];
    let pi = -1;
    evs.forEach((e) => { if (e.isPitch) pi++; add(e.reviewDetails, e.isPitch ? pi : -1, e.details?.description); });
    (p.runners || []).forEach((r) => add(r.reviewDetails, -1));
    add(p.reviewDetails, p.reviewDetails?.reviewType === "MJ" ? pitchesOf(p).length - 1 : -1);
    return out;
  }
  const reviewText = (rv) => rv.abs
    ? `ABS challenge${rv.who ? ` by ${/^(batter|pitcher|catcher|fielder)$/i.test(rv.who) ? rv.who.toLowerCase() : rv.who}` : ""}`
    : rv.manager ? `${rv.team ? `${rv.team} ` : ""}manager challenge` : "Umpire review";
  const reviewPill = (rv) => `<span class="rv ${rv.inProgress ? "wait" : rv.overturned ? "won" : "lost"}">${esc(reviewText(rv))} · ${rv.inProgress ? "under review" : rv.overturned ? "overturned" : "call stands"}</span>`;

  /* ================= Headlines ================= */
  const RISP = (p) => (p.runners || []).some((r) => /2B|3B/.test(r.movement?.originBase || ""));
  function isImpact(p) {
    const r = p.result || {}, ab = p.about || {};
    if (ab.isScoringPlay) return true;
    if (reviewsOf(p).some((rv) => rv.overturned)) return true;
    if (/home_run|triple|double$|double_play|triple_play|caught_stealing/.test(r.eventType || "")) return true;
    if (/strikeout/.test(r.eventType || "") && (RISP(p) || p.count?.outs === 3)) return true;
    const h = (p.playEvents || []).map((e) => e.hitData).filter(Boolean).pop();
    if (h && h.launchSpeed >= 105) return true;
    return (ab.captivatingIndex || 0) >= 30;
  }
  function direction(h) {
    const c = h?.coordinates;
    if (!c || c.coordX == null) return "";
    const ang = (Math.atan2(c.coordX - 125.42, 198.27 - c.coordY) * 180) / Math.PI;
    const infield = (h.totalDistance || 0) < 160 || h.trajectory === "ground_ball";
    if (infield) return ang < -22 ? "third" : ang < -6 ? "short" : ang < 6 ? "up the middle" : ang < 22 ? "second" : "first";
    return ang < -28 ? "left" : ang < -10 ? "left-center" : ang < 10 ? "center" : ang < 28 ? "right-center" : "right";
  }
  // Real-style headline: "417' grand slam to right-center", "Strikeout swinging", "RBI single to left".
  function title(p) {
    const r = p.result || {}, ab = p.about || {};
    if (!ab.isComplete) return "At bat";
    const h = (p.playEvents || []).map((e) => e.hitData).filter(Boolean).pop();
    const t = r.eventType || "";
    const dir = direction(h);
    const dist = h?.totalDistance ? `${Math.round(h.totalDistance)}' ` : "";
    const to = dir ? (/up the middle/.test(dir) ? ` ${dir}` : ` to ${dir}`) : "";
    if (t === "home_run") return `${dist}${r.rbi === 4 ? "grand slam" : r.rbi === 3 ? "3-run homer" : r.rbi === 2 ? "2-run homer" : "solo homer"}${to}`;
    if (/strikeout/.test(t)) return /called|looking/i.test(r.description || "") ? "Strikeout looking" : "Strikeout swinging";
    const rbi = r.rbi ? (r.rbi > 1 ? `${r.rbi}-run ` : "RBI ") : "";
    const ev = (r.event || "Play").toLowerCase();
    if (h && /single|double|triple|out|error|choice|sac/.test(ev)) return `${dist && /double|triple|fly|line/.test(ev) ? dist : ""}${rbi}${ev}${to}`.replace(/^./, (c) => c.toUpperCase());
    return `${rbi}${ev}`.replace(/^./, (c) => c.toUpperCase());
  }
  // A small situational tag: lead change, tie, walk-off, inning-ender with runners on.
  function situation(p, before, isLast) {
    const r = p.result || {}, ab = p.about || {};
    const [a0, h0] = before, a1 = r.awayScore ?? a0, h1 = r.homeScore ?? h0;
    const top = ab.halfInning === "top";
    const lb = Math.sign(a0 - h0), la = Math.sign(a1 - h1);
    if (isLast && !top && h1 > a1 && ab.isScoringPlay) return "Walk-off";
    if (ab.isScoringPlay && lb !== la && (top ? la > 0 : la < 0)) return "Takes the lead";
    if (ab.isScoringPlay && la === 0 && lb !== 0) return "Ties it";
    if (/strikeout|out|double_play/.test(r.eventType || "") && p.count?.outs === 3 && RISP(p)) return "Strands runners";
    return "";
  }
  const ordinal = (n) => n + (["th", "st", "nd", "rd"][(n % 100 > 10 && n % 100 < 14) ? 0 : n % 10] || "th");
  function tidbits(p) {
    const r = p.result || {}, out = [];
    const hr = /homers? \((\d+)\)/i.exec(r.description || "");
    if (hr) out.push(`${ordinal(+hr[1])} homer this season`);
    const h = (p.playEvents || []).map((e) => e.hitData).filter(Boolean).pop();
    if (h?.launchSpeed) out.push(`${h.launchSpeed.toFixed(1)} mph off the bat${h.launchAngle != null ? ` · ${Math.round(h.launchAngle)}° launch` : ""}`);
    const ps = pitchesOf(p);
    if (ps.length >= 8) out.push(`${ps.length}-pitch at-bat`);
    return out;
  }
  const ago = (iso) => { const m = Math.round((Date.now() - Date.parse(iso)) / 60000); return !iso || isNaN(m) ? "" : m < 1 ? "now" : m < 60 ? `${m}m` : m < 1440 ? `${Math.round(m / 60)}h` : ""; };

  // Game-flow notes that appear between pitches, like Real: challenges, reviews, delays, mound visits.
  const NOTE_RX = /challenge|review|delay|injur|ejected|mound visit|pitching change|offensive substitution|defensive switch|pickoff|stolen base|caught stealing|wild pitch|passed ball|balk|timeout/i;
  function pitchRows(ab, limit = 99) {
    const rvs = reviewsOf(ab).filter((rv) => rv.abs);
    const flip = (t) => (/strike/i.test(t) ? "Ball" : /ball/i.test(t) ? "Called Strike" : t);
    const rows = [];
    let i = -1;
    (ab?.playEvents || []).forEach((e) => {
      const d = e.details || {};
      if (!e.isPitch) {
        const txt = d.description || d.event || "";
        if (NOTE_RX.test(txt)) { const t = esc(txt.replace(/\s+/g, " ").trim()); rows.push(e.playId ? vidLink(e.playId, `${t}${PLAY_ICON}`, "pr-note") : `<div class="pr-note">${t}</div>`); }
        return;
      }
      i++;
      const pd = e.pitchData || {};
      const rv = rvs.find((x) => x.idx === i);
      const orig = String(d.description || d.call?.description || "").replace(ABS_TXT, "").replace(/[\s-]+$/, "") || d.call?.description || "";
      // ABS pitch: "Called Strike - In review", then "Ball - Overturned" or "Called Strike - Upheld".
      let call = orig, state = "";
      if (rv) {
        if (rv.inProgress) state = "In review";
        else if (rv.overturned) { call = d.isBall ? "Ball" : d.isStrike ? "Called Strike" : flip(orig); if (call === orig) call = flip(orig); state = "Overturned"; }
        else state = "Upheld";
      }
      const tag = e.playId ? "a" : "div";
      rows.push(`<${tag} class="pr"${e.playId ? ` href="${savant(e.playId)}" target="_blank" rel="noopener" data-savant` : ""}><i style="background:${COLOR[callOf(d)]}">${i + 1}</i><div><b>${esc(call)}${state ? ` <em class="abs ${rv.inProgress ? "wait" : rv.overturned ? "won" : "lost"}">– ${state}</em>` : ""}</b>
        <span>${esc(d.type?.description || "")}${pd.startSpeed ? ` · ${pd.startSpeed.toFixed(1)} mph` : ""}</span></div>${e.playId ? `<span class="pv">${PLAY_ICON}</span>` : ""}</${tag}>`);
    });
    return rows.reverse().slice(0, limit).join("");
  }

  /* ================= Play cards ================= */
  function card(p, ctx) {
    const { plays, lines, before, teams, isLast } = ctx;
    const ab = p.about || {}, r = p.result || {}, m = p.matchup || {};
    const i = plays.indexOf(p);
    const vid = ab.isComplete && lastPitchId(p);
    const batTeam = teamMeta(ab.halfInning === "top" ? teams.away : teams.home);
    const a1 = r.awayScore ?? before[i][0], h1 = r.homeScore ?? before[i][1];
    const tag = situation(p, before[i], isLast);
    const outs = p.count?.outs ?? 0;
    const tb = tidbits(p);
    const rvs = reviewsOf(p);
    return `<div class="pc ${isImpact(p) ? "impact" : ""}" data-ab="${ab.atBatIndex}" role="button" style="${vars(batTeam)}">
      <div class="pc-top">
        <span class="sc">${logoImg(teamMeta(teams.away))}${a1}-${h1}${logoImg(teamMeta(teams.home))}</span>
        <span>${ab.halfInning === "top" ? "Top" : "Bot"} ${ab.inning} · ${outs} out${outs === 1 ? "" : "s"}${ago(ab.endTime) ? ` · ${ago(ab.endTime)}` : ""}</span>
        ${tag ? `<span class="tag">${esc(tag)}</span>` : ""}
        ${vid ? vidLink(vid, `${PLAY_ICON}Video`, "film") : ""}
      </div>
      <div class="pc-head">
        <div class="pc-pic"><img src="${headshot(m.batter?.id, 160)}" alt="" onerror="this.style.visibility='hidden'">${logoImg(batTeam, "badge")}</div>
        <div class="pc-id"><div class="hl">${esc(title(p))}</div>
          <div class="ln"><b>${esc(short(m.batter?.fullName))}</b> · ${esc(batLine(lines[i].bat))}</div>
          <div class="ln muted">${esc(short(m.pitcher?.fullName))} · ${esc(pitLine(lines[i].pit))}</div></div>
      </div>
      ${tb.length || rvs.length ? `<div class="pc-tb">${rvs.map(reviewPill).join("")}${tb.map((t) => `<div>${esc(t)}</div>`).join("")}</div>` : ""}
      <div class="pc-more"><div class="pc-in">
        <div class="pc-pitches">${pitchRows(p) || `<div class="muted">${esc(r.description || "")}</div>`}</div>
        <canvas class="mini" data-ab="${ab.atBatIndex}" width="440" height="520"></canvas>
      </div></div>
    </div>`;
  }

  function context(f) {
    const plays = playsOf(f);
    const before = [];
    let a = 0, h = 0;
    plays.forEach((p) => { before.push([a, h]); if (p.result?.awayScore != null) { a = p.result.awayScore; h = p.result.homeScore; } });
    return { plays, before, lines: gameLines(plays), teams: f.gameData.teams, final: phaseOf(f.gameData.status) === "final" };
  }

  // Which plays a list shows. Gameday: the 3 most recent, then key plays. "scoring" and "all" for the other tabs.
  function pickPlays(ctx, mode) {
    const idx = ctx.plays.filter((p) => p.about?.isComplete).reverse();
    if (mode === "all") return idx;
    if (mode === "scoring") return idx.filter((p) => p.about?.isScoringPlay);
    return [...idx.slice(0, 3), ...idx.slice(3).filter(isImpact)];
  }

  // Render cards into a container, reusing card elements whose content hasn't changed (keeps minis drawn).
  const cardCache = new Map();
  const opened = new Set();          // cards expanded to show their pitches (Real keeps cards compact until tapped)
  const seenCards = new Set();       // cards already shown once, so only new plays slide in
  const firstPaint = new Set();      // the first render of a list doesn't animate
  function renderCards(box, f, mode) {
    const ctx = context(f);
    const list = pickPlays(ctx, mode);
    if (!list.length) { box.innerHTML = `<div class="s-loading">${mode === "scoring" ? "No runs scored yet" : "No plays yet"}</div>`; return; }
    const last = ctx.plays[ctx.plays.length - 1];
    const nodes = [];
    list.forEach((p, k) => {
      if (mode === "gameday" && k === 3) { const s = document.createElement("div"); s.className = "pc-sep"; s.textContent = "Key plays"; nodes.push(s); }
      const key = `${mode}:${p.about.atBatIndex}:${pitchesOf(p).length}:${ago(p.about.endTime)}:${reviewsOf(p).map((x) => `${x.inProgress}${x.overturned}`).join()}`;
      let el = cardCache.get(key);
      if (!el) {
        const t = document.createElement("div");
        t.innerHTML = card(p, { ...ctx, isLast: ctx.final && p === last });
        el = t.firstElementChild;
        cardCache.set(key, el);
        const cv = el.querySelector("canvas.mini");
        if (cv) paintMini(cv, p);
        const ab = p.about.atBatIndex;
        if (!seenCards.has(`${mode}:${ab}`)) {
          seenCards.add(`${mode}:${ab}`);
          if (!firstPaint.has(mode)) { el.classList.add("enter"); el.addEventListener("animationend", () => el.classList.remove("enter"), { once: true }); }
        }
      }
      el.classList.toggle("open", opened.has(p.about.atBatIndex));
      el.classList.toggle("on", sel === p.about.atBatIndex);
      nodes.push(el);
    });
    if (cardCache.size > 600) cardCache.clear();
    box.replaceChildren(...nodes);
    firstPaint.add(mode);
  }

  /* ================= Now batting panel ================= */
  function currentAb(f) {
    const plays = playsOf(f);
    if (sel != null) return plays.find((p) => p.about?.atBatIndex === sel) || plays[plays.length - 1];
    const live = phaseOf(f.gameData.status) === "live";
    return (live ? f.liveData?.plays?.currentPlay : null) || plays[plays.length - 1];
  }
  // Game status worth flagging (manager challenge, umpire review, rain or injury delay...). Stays up while it lasts.
  function gameStatus(f) {
    const st = f.gameData?.status || {};
    if (phaseOf(st) !== "live") return "";
    const d = st.detailedState || "";
    if (/^(in progress|warmup|live)$/i.test(d)) {
      const live = (f.liveData?.plays?.currentPlay?.playEvents || []).filter((e) => !e.isPitch).pop();
      const t = live?.details?.description || "";
      return /challenge|review|delay/i.test(t) && (live.reviewDetails?.inProgress || /delay/i.test(t)) ? t : "";
    }
    return st.reason && !d.includes(st.reason) ? `${d}: ${st.reason}` : d;
  }
  function drawNow(f) {
    const ctx = context(f);
    const cur = currentAb(f);
    const live = phaseOf(f.gameData.status) === "live";
    if (!cur) { $(".gd-now-head").innerHTML = ""; return; }
    const i = ctx.plays.indexOf(cur);
    const m = cur.matchup || {};
    const ln = ctx.lines[i] || { bat: { ab: 0, h: 0, rbi: 0 }, pit: { outs: 0, k: 0, r: 0 } };
    const showingLive = live && sel == null;
    const label = showingLive ? `<span class="live"><i class="dot"></i>Now batting</span>` : sel != null ? "Replay" : "Last at-bat";
    const boxP = (id) => { const t = f.liveData?.boxscore?.teams || {}; return t.away?.players?.[`ID${id}`] || t.home?.players?.[`ID${id}`]; };
    const sAvg = (id) => boxP(id)?.seasonStats?.batting?.avg;
    // Live: the pitcher's line today from the box score (innings, hits, runs, strikeouts, pitch count).
    const todayPit = (id) => {
      const q = showingLive ? boxP(id)?.stats?.pitching : null;
      if (!q || q.inningsPitched == null) return "";
      return [`${q.inningsPitched} ip`, `${q.hits ?? 0} h`, q.runs ? `${q.runs} r` : "", `${q.strikeOuts ?? 0} k`, q.numberOfPitches != null ? `${q.numberOfPitches} p` : ""].filter(Boolean).join(", ");
    };
    $(".gd-now-head").innerHTML = `
      <div class="nh-top">${label}${!showingLive && cur.about?.isComplete ? `<span class="hl">${esc(title(cur))}</span>` : ""}${gameStatus(f) ? `<span class="gstat">${esc(gameStatus(f))}</span>` : ""}
        ${sel != null && live ? `<button class="gd-follow">Follow live</button>` : ""}</div>
      <div class="nh-mu">
        <div class="who lnk" data-player="${m.batter?.id}"><img src="${headshot(m.batter?.id, 160)}" alt="" onerror="this.style.visibility='hidden'">
          <div><b>${esc(m.batter?.fullName || "")}</b><span>${esc(batLine(ln.bat))}${sAvg(m.batter?.id) ? ` · ${esc(sAvg(m.batter?.id))}` : ""} · bats ${m.batSide?.code === "L" ? "left" : "right"}</span></div></div>
        <div class="who p lnk" data-player="${m.pitcher?.id}"><img src="${headshot(m.pitcher?.id, 120)}" alt="" onerror="this.style.visibility='hidden'">
          <div><b>${esc(m.pitcher?.fullName || "")}</b><span>${esc(todayPit(m.pitcher?.id) || pitLine(ln.pit))}</span></div></div>
      </div>`;
    $(".gd-seq").innerHTML = pitchRows(cur) || `<div class="muted pad">First pitch coming up</div>`;
    // Challenges and reviews on this at-bat (a live one pulses while the call is being checked).
    $(".gd-now-foot").innerHTML = reviewsOf(cur).map(reviewPill).join("");
    setZone(cur);
  }

  /* ================= Public ================= */
  function update(f) {
    feed = f;
    drawNow(f);
    renderCards($(".gd-feed"), f, "gameday");
  }

  // Taps on cards (here or in the Scoring / All plays tabs) and the Follow live button.
  // Video links are plain links to Savant: let the browser open them, and don't toggle the card.
  function onClick(e, goGameday) {
    if (e.target.closest("[data-savant]")) return true;
    const pc = e.target.closest(".pc");
    if (pc) {
      const ab = +pc.dataset.ab;
      if (opened.has(ab) && sel === ab) opened.delete(ab); else opened.add(ab);
      sel = ab;
      zKey = "";
      goGameday ? goGameday() : update(feed);
      return true;
    }
    if (e.target.closest(".gd-follow")) { sel = null; zKey = ""; update(feed); return true; }
    return false;
  }
  root.addEventListener("click", (e) => { if (onClick(e)) e.stopPropagation(); });

  /* ================= Live field for the left panel (Real-style) ================= */
  // Three bases like Real's; a runner's photo fills his base. The element persists between refreshes so
  // runners slide from base to base, scorers slide home, and the count dots fade in and out.
  const fieldEl = document.createElement("div");
  fieldEl.className = "g-field";
  fieldEl.innerHTML = `<div class="fd"><i class="fb b3"></i><i class="fb b2"></i><i class="fb b1"></i></div>
    <div class="bso">${[["B", 4, "ball"], ["S", 3, "strike"], ["O", 3, "out"]].map(([l, n, c]) => `<div data-k="${c}"><b>${l}</b>${"<i></i>".repeat(n)}</div>`).join("")}</div>
    <div class="g-extra"></div><div class="g-next"></div>`;
  const BASE_POS = { first: [134, 88], second: [88, 42], third: [42, 88], home: [88, 134] };
  const runnerEls = new Map();   // player id -> element
  let lastRuns = null;
  function updateField(f) {
    const ls = f.liveData?.linescore || {};
    const o = ls.offense || {};
    const runs = (ls.teams?.away?.runs || 0) + (ls.teams?.home?.runs || 0);
    const scored = lastRuns != null && runs > lastRuns;
    lastRuns = runs;
    const fd = fieldEl.querySelector(".fd");
    const now = new Map();
    ["first", "second", "third"].forEach((b) => { if (o[b]?.id) now.set(o[b].id, b); });
    // Runners who left: slide home if runs scored, otherwise just fade.
    runnerEls.forEach((el, id) => {
      if (now.has(id)) return;
      runnerEls.delete(id);
      if (scored) { const [x, y] = BASE_POS.home; el.style.left = `${x}px`; el.style.top = `${y}px`; }
      el.classList.add("gone");
      setTimeout(() => el.remove(), 900);
    });
    now.forEach((b, id) => {
      let el = runnerEls.get(id);
      if (!el) {
        el = document.createElement("div");
        el.className = "fr-run lnk"; el.dataset.player = id;
        el.innerHTML = `<img src="${headshot(id, 160)}" alt="" onerror="this.style.visibility='hidden'">`;
        // New runners come up the line from home plate.
        const [hx, hy] = BASE_POS.home; el.style.left = `${hx}px`; el.style.top = `${hy}px`; el.classList.add("gone");
        fd.appendChild(el); runnerEls.set(id, el);
        el.getBoundingClientRect();
        el.classList.remove("gone");
      }
      const [x, y] = BASE_POS[b]; el.style.left = `${x}px`; el.style.top = `${y}px`;
    });
    const counts = { ball: ls.balls ?? 0, strike: ls.strikes ?? 0, out: ls.outs ?? 0 };
    fieldEl.querySelectorAll(".bso [data-k]").forEach((row) => row.querySelectorAll("i").forEach((d, i) => d.classList.toggle("on", i < counts[row.dataset.k])));
    // Beside the count: the pitcher's pitch count and each side's win probability.
    drawExtra(f);
    // On deck and in the hole, side by side: today's line and the season slash line.
    const box = f.liveData?.boxscore?.teams || {};
    const bp = (id) => box.away?.players?.[`ID${id}`] || box.home?.players?.[`ID${id}`];
    const nx = (pp, lbl) => {
      if (!pp) return "";
      const p = bp(pp.id) || {}, ss = p.seasonStats?.batting || {}, t = p.stats?.batting || {};
      const today = t.atBats != null || t.baseOnBalls ? [`${t.hits ?? 0}-${t.atBats ?? 0}`, t.homeRuns && `${t.homeRuns > 1 ? t.homeRuns : ""}HR`, t.rbi && `${t.rbi} RBI`, t.baseOnBalls && `${t.baseOnBalls} BB`, t.strikeOuts && `${t.strikeOuts} K`].filter(Boolean).join(", ") : "";
      const pos = p.position?.abbreviation || "";
      const bats = p.person?.batSide?.code || "";
      return `<div class="nx lnk" data-player="${pp.id}">
        <div class="nx-top"><img src="${headshot(pp.id, 120)}" alt="" onerror="this.style.visibility='hidden'">
          <div><span>${lbl}</span><b>${esc(pp.fullName)}</b><em>${esc([pos, today && `${today} today`].filter(Boolean).join(" · "))}</em></div></div>
        <div class="nx-stats">${[["AVG", ss.avg], ["OBP", ss.obp], ["SLG", ss.slg], ["HR", ss.homeRuns], ["RBI", ss.rbi]].map(([k, v]) => `<div><small>${k}</small>${esc(v ?? "–")}</div>`).join("")}</div>
      </div>`;
    };
    const nextHtml = `${nx(o.onDeck, "On deck")}${nx(o.inHole, "In the hole")}`;
    const nextEl = fieldEl.querySelector(".g-next");
    if (nextEl.dataset.h !== nextHtml) { nextEl.dataset.h = nextHtml; nextEl.innerHTML = nextHtml; nextEl.classList.remove("swap"); nextEl.getBoundingClientRect(); nextEl.classList.add("swap"); }
  }

  // Win probability graph beside the count: home team above the midline, away below, in team colors.
  let wpList = [], wpAt = -1;
  async function loadWp(f) {
    const n = (f.liveData?.plays?.allPlays || []).length;
    if (n === wpAt) return;
    wpAt = n;
    try {
      const list = await api(`/api/v1/game/${pk}/winProbability?fields=homeTeamWinProbability,atBatIndex,about,inning`, { ttl: 10_000 });
      wpList = (Array.isArray(list) ? list : []).filter((x) => x.homeTeamWinProbability != null);
      drawExtra(f, true);
    } catch {}
  }
  function drawExtra(f, fromWp = false) {
    const el = fieldEl.querySelector(".g-extra");
    const teams = f.gameData?.teams || {};
    const away = teamMeta(teams.away), home = teamMeta(teams.home);
    if (wpList.length > 1) {
      const W = 200, H = 96, n = wpList.length;
      const pts = wpList.map((x, i) => [(i / (n - 1)) * W, H - (x.homeTeamWinProbability / 100) * H]);
      const line = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`).join(" ");
      const area = `${line} L${W} ${H / 2} L0 ${H / 2} Z`;
      const h = Math.round(wpList[n - 1].homeTeamWinProbability);
      const lead = h >= 50 ? { t: home, v: h } : { t: away, v: 100 - h };
      el.innerHTML = `<div class="wp-head"><small>Win probability</small><b style="color:${lead.t.bright}">${esc(lead.t.abbr)} ${lead.v}%</b></div>
        <div class="wp-box"><svg class="wp" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">
          <defs><clipPath id="wpt${pk}"><rect x="0" y="0" width="${W}" height="${H / 2}"/></clipPath><clipPath id="wpb${pk}"><rect x="0" y="${H / 2}" width="${W}" height="${H / 2}"/></clipPath></defs>
          <path d="${area}" fill="${home.bright}" opacity=".28" clip-path="url(#wpt${pk})"/>
          <path d="${area}" fill="${away.bright}" opacity=".28" clip-path="url(#wpb${pk})"/>
          <line x1="0" x2="${W}" y1="${H / 2}" y2="${H / 2}" class="mid"/>
          <path d="${line}" class="ln" pathLength="1"/>
          <circle cx="${pts[n - 1][0]}" cy="${pts[n - 1][1]}" r="3.5" fill="#fff"/>
        </svg><span class="wt top">${esc(home.abbr)}</span><span class="wt bot">${esc(away.abbr)}</span></div>`;
    }
    if (!fromWp) loadWp(f);
  }

  return {
    update, onClick, renderCards,
    // The left panel's live field: game.js puts this element in its slot after each render.
    field(slot, f) { slot.replaceWith(fieldEl); updateField(f); },
    mount(slot, f) { slot.appendChild(root); update(f); },
    start() {},
    stop() { cancelAnimationFrame(raf); },
  };
};
