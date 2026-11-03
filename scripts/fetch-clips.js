// Converts MLB Film Room clips to WebM (VP9 + Opus) so the widget can play them.
// iCUE's built-in browser has no H.264 decoder, and every MLB video file is H.264.
//
// Writes clips/<gamePk>/<hash>.webm and clips/index.json:
//   { "updated": "...", "games": { "<gamePk>": { "<clip id>": { f: file, t: title, d: date, dur, th: thumb, p: [player ids] } } } }
// The clip id is the same one gameday.js uses (slug, else id, else title).
//
// Which games: the favorite team's recent games first, then every other game, newest first,
// until the size budget is full. Anything outside that set is deleted, so the folder stays bounded.
// Each run converts for at most TIME_BUDGET and the next run picks up where it stopped.
// Needs Node 20+ and ffmpeg.   node scripts/fetch-clips.js
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { execFile } = require("child_process");

const ROOT = path.join(__dirname, "..");
const DIR = path.join(ROOT, "clips");
const INDEX = path.join(DIR, "index.json");
const API = process.env.MLB_API || "https://statsapi.mlb.com";
const FAV = +(process.env.FAV_TEAM_ID || 117);          // Houston Astros
const FAV_GAMES = +(process.env.CLIP_FAV_GAMES || 5);    // favorite team games that always get clips
const DAYS = +(process.env.CLIP_DAYS || 21);            // how far back to look for games
const MAX_BYTES = +(process.env.CLIP_MAX_MB || 650) * 1e6;
const TIME_BUDGET = +(process.env.CLIP_MINUTES || 9) * 60e3;
const KBPS = 350 + 64;                                  // video + audio, for size estimates
const UA = "Mozilla/5.0 (XeneonWidget; personal use)";

const started = Date.now();
const json = async (url) => {
  const r = await fetch(url, { headers: { "User-Agent": UA } });
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return r.json();
};
const ymd = (d) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(d);
const secs = (d = "") => d.split(":").reduce((a, x) => a * 60 + (+x || 0), 0) || 30;

// Same filtering and ids as gameday.js.
const SKIP = /condensed game|game recap|postgame|press conference/i;
function mp4Of(it) {
  const pbs = (it.playbacks || []).filter((p) => p.url && /\.mp4/i.test(p.url) && !/trickplay/i.test(p.name || ""));
  return (pbs.find((p) => p.name === "mp4Avc") || pbs.find((p) => /_(1800|2500|1200)K/i.test(p.url)) || pbs[0] || {}).url;
}

function ffmpeg(src, out) {
  const args = ["-hide_banner", "-loglevel", "error", "-y", "-i", src,
    "-vf", "scale=-2:360", "-c:v", "libvpx-vp9", "-b:v", "350k", "-deadline", "realtime", "-cpu-used", "8", "-row-mt", "1",
    "-c:a", "libopus", "-b:a", "64k", "-ac", "2", out];
  return new Promise((res, rej) => execFile("ffmpeg", args, { timeout: 180e3 }, (e, _o, se) => (e ? rej(new Error(se || e.message)) : res())));
}

async function main() {
  fs.mkdirSync(DIR, { recursive: true });
  const old = fs.existsSync(INDEX) ? JSON.parse(fs.readFileSync(INDEX, "utf8")) : { games: {} };

  // Recent finished or live games, favorite team first, then newest first.
  const end = ymd(new Date()), start = ymd(new Date(Date.now() - DAYS * 864e5));
  const sched = await json(`${API}/api/v1/schedule?sportId=1&startDate=${start}&endDate=${end}`);
  const games = (sched.dates || []).flatMap((d) => d.games || [])
    .filter((g) => ["Live", "Final"].includes(g.status?.abstractGameState))
    .map((g) => ({ pk: g.gamePk, date: g.gameDate || "", fav: [g.teams?.away?.team?.id, g.teams?.home?.team?.id].includes(FAV) }))
    .sort((a, b) => b.date.localeCompare(a.date));
  // The favorite team's last few games go first, then everything else, newest first.
  const favs = games.filter((g) => g.fav).slice(0, FAV_GAMES);
  games.sort((a, b) => (favs.includes(b) - favs.includes(a)) || b.date.localeCompare(a.date));

  // Plan: every clip of each game in order, until the size budget is used up.
  const plan = [];
  let est = 0;
  for (const g of games) {
    if (est >= MAX_BYTES) break;
    let items = [];
    try { items = (await json(`${API}/api/v1/game/${g.pk}/content`)).highlights?.highlights?.items || []; } catch (e) { console.log(`skip ${g.pk}: ${e.message}`); continue; }
    for (const it of items) {
      if ((it.type && it.type !== "video") || SKIP.test(`${it.title} ${it.headline}`)) continue;
      const src = mp4Of(it);
      if (!src) continue;
      const id = it.slug || it.id || it.title;
      const file = `clips/${g.pk}/${crypto.createHash("sha1").update(`${g.pk}|${id}|${src}`).digest("hex").slice(0, 16)}.webm`;
      const players = (it.keywordsAll || []).filter((k) => /player_id/i.test(k.type || "")).map((k) => +k.value);
      const cuts = it.image?.cuts || [];
      const thumb = (cuts.find((x) => x.aspectRatio === "16:9" && x.width >= 320 && x.width <= 800) || cuts[0] || {}).src || "";
      plan.push({ pk: g.pk, id, src, file, meta: { f: file, t: it.title || it.headline || "", d: it.date || "", dur: it.duration || "", th: thumb, p: players } });
      est += (secs(it.duration) * KBPS * 1000) / 8;
    }
  }

  // Convert what's missing, newest-priority first, within this run's time budget.
  let made = 0, failed = 0;
  for (const c of plan) {
    const out = path.join(ROOT, c.file);
    if (fs.existsSync(out)) continue;
    if (Date.now() - started > TIME_BUDGET) break;
    fs.mkdirSync(path.dirname(out), { recursive: true });
    const tmp = out + ".src.mp4";
    try {
      // Download first: some MP4s keep their index at the end, which ffmpeg can't reach over a plain stream.
      const r = await fetch(c.src, { headers: { "User-Agent": UA } });
      if (!r.ok) throw new Error(`${r.status} ${c.src}`);
      fs.writeFileSync(tmp, Buffer.from(await r.arrayBuffer()));
      await ffmpeg(tmp, out + ".tmp.webm"); fs.renameSync(out + ".tmp.webm", out); made++;
    } catch (e) { failed++; fs.rmSync(out + ".tmp.webm", { force: true }); console.log(`fail ${c.id}: ${String(e.message).slice(0, 200)}`); }
    fs.rmSync(tmp, { force: true });
  }

  // Index what exists, and delete anything outside the plan.
  const keep = new Set(plan.map((c) => c.file));
  const index = { updated: new Date().toISOString(), games: {} };
  for (const c of plan) if (fs.existsSync(path.join(ROOT, c.file))) (index.games[c.pk] ||= {})[c.id] = c.meta;
  let removed = 0, bytes = 0;
  for (const pk of fs.readdirSync(DIR)) {
    const sub = path.join(DIR, pk);
    if (!fs.statSync(sub).isDirectory()) continue;
    for (const f of fs.readdirSync(sub)) {
      const rel = `clips/${pk}/${f}`;
      if (!keep.has(rel)) { fs.rmSync(path.join(sub, f)); removed++; } else bytes += fs.statSync(path.join(sub, f)).size;
    }
    if (!fs.readdirSync(sub).length) fs.rmdirSync(sub);
  }
  fs.writeFileSync(INDEX, JSON.stringify(index));
  const changed = made > 0 || removed > 0 || JSON.stringify(old.games) !== JSON.stringify(index.games);
  console.log(`games ${games.length} · planned ${plan.length} · converted ${made} · failed ${failed} · removed ${removed} · on disk ${(bytes / 1e6).toFixed(0)} MB`);
  if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `changed=${changed}\n`);
}

main().catch((e) => { console.error(e); process.exit(1); });
