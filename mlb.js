// Shared helpers for the Scores, Standings and Rosters tabs.
// Everything comes straight from the MLB Stats API (statsapi.mlb.com allows browser requests),
// so these tabs stay live even when the scheduled news job is late.
const API = "https://statsapi.mlb.com";

// Small in-memory cache so flipping between tabs and pages doesn't refetch everything.
const apiCache = new Map();
async function api(path, { ttl = 60_000 } = {}) {
  const hit = apiCache.get(path);
  if (hit && Date.now() - hit.at < ttl) return hit.data;
  const res = await fetch(API + path);
  if (!res.ok) throw new Error(`${res.status} ${path}`);
  const data = await res.json();
  apiCache.set(path, { at: Date.now(), data });
  return data;
}
// Try a richer request first and fall back to a plain one if the API rejects the hydrate.
async function apiTry(paths, opts) {
  let err;
  for (const p of paths) { try { return await api(p, opts); } catch (e) { err = e; } }
  throw err;
}

const teamById = Object.fromEntries(TEAMS.map((t) => [t.id, t]));
const DIVISIONS = [
  { id: 201, name: "AL East", lg: "AL" }, { id: 202, name: "AL Central", lg: "AL" }, { id: 200, name: "AL West", lg: "AL" },
  { id: 204, name: "NL East", lg: "NL" }, { id: 205, name: "NL Central", lg: "NL" }, { id: 203, name: "NL West", lg: "NL" },
];

// Dates: the MLB calendar runs on US Eastern time.
function etYmd(d = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" })
    .formatToParts(d).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}`;
}
function shiftYmd(ymd, days) {
  const d = new Date(`${ymd}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
function ymdLabel(ymd, opts = { weekday: "short", month: "short", day: "numeric" }) {
  return new Date(`${ymd}T12:00:00Z`).toLocaleDateString("en-US", { ...opts, timeZone: "UTC" });
}
function relDay(ymd) {
  const today = etYmd();
  if (ymd === today) return "Today";
  if (ymd === shiftYmd(today, -1)) return "Yesterday";
  if (ymd === shiftYmd(today, 1)) return "Tomorrow";
  return ymdLabel(ymd);
}
const timeLabel = (iso) => new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

// The current season: the latest one whose spring training has started (see Season below).
// Until Season has loaded, guess: before March, the most recent finished season is the interesting one.
function currentSeason() {
  if (Season.info) return Season.info.season;
  const [y, m] = etYmd().split("-").map(Number);
  return m >= 3 ? y : y - 1;
}

/* ---- Season phase ----
   Read from MLB's own season dates, so the widget moves through spring training, the regular season,
   the postseason and the offseason by itself. A season "starts" on its first spring training day;
   until the next one does, the last season stays current (so the offseason shows the World Series). */
const Season = {
  info: null,
  async load() {
    const today = etYmd();
    const y = +today.slice(0, 4);
    const get = (yr) => api(`/api/v1/seasons/${yr}?sportId=1`, { ttl: 6 * 3600_000 })
      .then((d) => (d.seasons || [])[0] || null).catch(() => null);
    const [prev, cur, nxt] = await Promise.all([get(y - 1), get(y), get(y + 1)]);
    const starts = (x) => x && (x.springStartDate || x.preSeasonStartDate || x.regularSeasonStartDate);
    const begun = (x) => starts(x) && starts(x) <= today;
    const s = begun(cur) ? cur : prev || cur;
    if (!s) return null;
    const next = s === cur ? nxt : cur;
    const end = s.postSeasonEndDate || s.seasonEndDate || s.regularSeasonEndDate;
    const phase = today < (s.regularSeasonStartDate || "") ? "spring"
      : today <= (s.regularSeasonEndDate || "") ? "regular"
      : today <= (end || "") ? "postseason" : "offseason";
    this.info = {
      season: +s.seasonId, phase, start: starts(s), end,
      regStart: s.regularSeasonStartDate, regEnd: s.regularSeasonEndDate, postStart: s.postSeasonStartDate,
      nextStart: next ? starts(next) : null,
    };
    return this.info;
  },
  label() {
    const i = this.info; if (!i) return "";
    return { spring: "Spring training", regular: "Regular season", postseason: "Postseason", offseason: "Offseason" }[i.phase];
  },
};

// Game state from a schedule or live-feed status block.
function phaseOf(status = {}) {
  const a = status.abstractGameState || "";
  const d = status.detailedState || "";
  if (a === "Final" || /final|game over|completed/i.test(d)) return "final";
  if (a === "Live" || /in progress|warmup|challenge|review/i.test(d)) return "live";
  return "preview";
}
const isPostponed = (status = {}) => /postponed|cancelled|suspended/i.test(status.detailedState || "");

// Short "Lastname" for tight spots.
const lastName = (full = "") => full.replace(/\s+(Jr\.?|Sr\.?|II|III|IV)$/i, "").split(" ").slice(1).join(" ") || full;

// Team helpers that work for any team id, including ones not in TEAMS (All-Star squads, etc.).
function teamMeta(t = {}) {
  const known = teamById[t.id];
  return known || { abbr: t.abbreviation || (t.name || "").slice(0, 3).toUpperCase(), name: t.teamName || t.name || "", id: t.id, color: "#444", bright: "#888" };
}
const fullTeamName = (t) => (t && t.locationName ? `${t.locationName} ${t.teamName}` : (t && t.name) || "");

// Player photos (MLB's transparent cut-outs, with MLB's generic silhouette as the fallback).
const headshot = (id, w = 360) =>
  `https://img.mlbstatic.com/mlb-photos/image/upload/d_people:generic:headshot:67:current.png/w_${w},q_auto:best/v1/people/${id}/headshot/67/current`;

// Number formatting in the Baseball Reference style: rates without the leading zero, blanks for missing.
const dash = "";
function rate(v) {
  if (v == null || v === "" || v === "-.--" || v === ".---") return dash;
  return String(v);
}
function num(v) { return v == null || v === "" ? dash : v; }
function pct(w, l) { const g = w + l; return g ? (w / g).toFixed(3).replace(/^0/, "") : dash; }

// Age as Baseball Reference counts it: the player's age on June 30 of that season.
function seasonAge(birthDate, season) {
  if (!birthDate) return dash;
  const b = new Date(`${birthDate}T12:00:00Z`);
  const ref = new Date(`${season}-06-30T12:00:00Z`);
  let age = ref.getUTCFullYear() - b.getUTCFullYear();
  if (ref.getUTCMonth() < b.getUTCMonth() || (ref.getUTCMonth() === b.getUTCMonth() && ref.getUTCDate() < b.getUTCDate())) age--;
  return age;
}
function ageToday(birthDate) {
  if (!birthDate) return dash;
  const b = new Date(`${birthDate}T12:00:00Z`), now = new Date();
  let age = now.getFullYear() - b.getUTCFullYear();
  if (now.getMonth() < b.getUTCMonth() || (now.getMonth() === b.getUTCMonth() && now.getDate() < b.getUTCDate())) age--;
  return age;
}
const longDate = (ymd) => (ymd ? ymdLabel(ymd, { month: "long", day: "numeric", year: "numeric" }) : "");
const shortDate = (ymd) => (ymd ? ymdLabel(ymd, { month: "short", day: "numeric", year: "numeric" }) : "");

/* ---- Touch scrolling ----
   The Xeneon is a touchscreen inside an iFrame, so scrolling is handled here instead of relying on native overflow.
   Works for finger, pen and mouse, adds momentum, and swallows the click that ends a drag. */
function dragScroll(el, axis = "x") {
  el.style.touchAction = "none";
  let drag = null, vel = 0, raf = 0;
  const prop = axis === "x" ? "scrollLeft" : "scrollTop";
  const coord = (e) => (axis === "x" ? e.clientX : e.clientY);
  const glide = () => {
    cancelAnimationFrame(raf);
    let prev = performance.now();
    const step = (t) => {
      const dt = Math.min(48, t - prev); prev = t;
      if (Math.abs(vel) < 0.02) return;
      const before = el[prop];
      el[prop] += vel * dt;
      if (el[prop] === before) return;
      vel *= Math.pow(0.95, dt / 16);
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
  };
  el.addEventListener("pointerdown", (e) => {
    if (e.button > 0) return;
    cancelAnimationFrame(raf);
    drag = { start: coord(e), scroll: el[prop], last: coord(e), t: e.timeStamp, id: e.pointerId, moved: 0 };
    vel = 0;
  });
  el.addEventListener("pointermove", (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const s = typeof scale === "number" && scale > 0 ? scale : 1;
    const d = (coord(e) - drag.start) / s;
    drag.moved = Math.max(drag.moved, Math.abs(d));
    if (drag.moved > 8) { el.classList.add("dragging"); el.setPointerCapture?.(e.pointerId); }
    el[prop] = drag.scroll - d;
    const dt = e.timeStamp - drag.t;
    if (dt > 0) vel = vel * 0.6 + 0.4 * (-(coord(e) - drag.last) / s / dt);
    drag.last = coord(e); drag.t = e.timeStamp;
  });
  const end = (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const wasDrag = drag.moved > 8;
    if (!wasDrag || e.timeStamp - drag.t > 80) vel = 0;
    drag = null;
    if (wasDrag) {
      // Swallow the click that follows a drag so it doesn't open a card.
      const block = (ev) => { ev.stopPropagation(); ev.preventDefault(); };
      el.addEventListener("click", block, { capture: true, once: true });
      setTimeout(() => el.removeEventListener("click", block, { capture: true }), 50);
    }
    el.classList.remove("dragging");
    glide();
  };
  el.addEventListener("pointerup", end);
  el.addEventListener("pointercancel", end);
  el.addEventListener("wheel", (e) => {
    e.preventDefault();
    cancelAnimationFrame(raf);
    el[prop] += axis === "x" ? (Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY) : e.deltaY;
  }, { passive: false });
}

// Tables shared by the box score, team and player pages.
// cols: [{ k: key, h: header, cls, f: (row) => cell html, title }]
function table(cols, rows, { foot = [], cls = "", sortable = false, id = "" } = {}) {
  const head = `<tr>${cols.map((c, i) => `<th class="${c.cls || ""}" ${sortable && !c.nosort ? `data-sort="${i}"` : ""} ${c.title ? `title="${esc(c.title)}"` : ""}>${c.h}</th>`).join("")}</tr>`;
  const cell = (c, r, i) => `<td class="${c.cls || ""}">${c.f ? c.f(r, i) : esc(num(r[c.k]))}</td>`;
  let n = 0;
  const body = rows.map((r) => r.__section
    ? `<tr class="section"><td colspan="${cols.length}">${esc(r.__section)}</td></tr>`
    : ((i) => `<tr class="${r.__cls || ""}" ${r.__attrs || ""}>${cols.map((c) => cell(c, r, i)).join("")}</tr>`)(n++)).join("");
  const tfoot = foot.length ? `<tfoot>${foot.map((r) => `<tr class="${r.__cls || ""}">${cols.map((c) => cell(c, r)).join("")}</tr>`).join("")}</tfoot>` : "";
  return `<table class="stats ${cls}" ${id ? `id="${id}"` : ""}><thead>${head}</thead><tbody>${body}</tbody>${tfoot}</table>`;
}
// Render a table into a container and let a tap on a header sort it (high to low first, tap again
// to flip), like Baseball Reference. Totals in opts.foot stay at the bottom.
function sortableTable(container, cols, rows, opts = {}) {
  let cur = rows, state = { i: -1, dir: -1 };
  const val = (c, r) => {
    const v = c.sv ? c.sv(r) : r[c.k];
    if (v === "" || v == null || v === "-.--" || v === ".---") return null;
    const n = typeof v === "number" ? v : parseFloat(v);
    return Number.isFinite(n) && /^-?[\d.]+$/.test(String(v).trim()) ? n : String(v);
  };
  const draw = () => {
    container.innerHTML = table(cols, cur, { ...opts, sortable: true });
    const th = container.querySelector(`th[data-sort="${state.i}"]`);
    if (th) th.classList.add(state.dir > 0 ? "asc" : "desc");
  };
  container.onclick = (e) => {
    const th = e.target.closest("th[data-sort]"); if (!th) return;
    const i = +th.dataset.sort, c = cols[i];
    state = { i, dir: state.i === i ? -state.dir : (c.asc ? 1 : -1) };
    cur = rows.filter((r) => !r.__section).sort((a, b) => {
      const x = val(c, a), y = val(c, b);
      if (x == null && y == null) return 0; if (x == null) return 1; if (y == null) return -1;
      return (typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y))) * state.dir;
    });
    draw();
  };
  draw();
}
