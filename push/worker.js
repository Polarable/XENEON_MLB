// SHUTOUT push alerts: a Cloudflare Worker (free plan is enough).
//
// What it does:
//   POST /subscribe     the app sends its push subscription and alert choices; stored in KV
//   POST /unsubscribe   removes it
//   GET  /key           the public VAPID key the app subscribes with
//   POST /test          sends a test alert to one subscription
//   cron (every minute) checks the MLB Stats API and the site's news.json, and pushes:
//     - games: first pitch, every scoring play, and the final for the subscriber's team
//     - team news: every new MLB Trade Rumors story about the subscriber's team
//     - big news: league-wide signings, trades and extensions
//
// Bindings (set in the Cloudflare dashboard, see push/SETUP.md):
//   KV namespace  SUBS
//   variables     VAPID_PUBLIC (text), VAPID_PRIVATE (secret), VAPID_SUBJECT (text, mailto:you@example.com),
//                 SITE (text, https://polarable.github.io/XENEON_MLB/)
// The Web Push encryption (RFC 8291) and VAPID signing (RFC 8292) are done with WebCrypto, no libraries.

const API = "https://statsapi.mlb.com";
const BIG = /\b(sign|signs|signed|agree|agrees|trade|trades|traded|acquire|acquires|extension|extend|extends|deal with)\b/i;
const NOISE = /\b(minor league deal|minor league contract|outright|claim|claims|waivers|DFA|designat|option|non-roster)\b/i;

export default {
  async fetch(req, env) {
    const cors = { "access-control-allow-origin": "*", "access-control-allow-methods": "GET,POST,OPTIONS", "access-control-allow-headers": "content-type" };
    if (req.method === "OPTIONS") return new Response(null, { headers: cors });
    const url = new URL(req.url);
    const json = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { ...cors, "content-type": "application/json" } });
    try {
      if (url.pathname === "/key") return json({ key: env.VAPID_PUBLIC });
      if (req.method !== "POST") return json({ ok: true, service: "SHUTOUT alerts" });
      const body = await req.json();
      const sub = body.subscription;
      if (!sub?.endpoint || !/^https:\/\//.test(sub.endpoint)) return json({ error: "no subscription" }, 400);
      const key = "sub:" + (await hash(sub.endpoint));
      if (url.pathname === "/subscribe") {
        const prefs = { team: String(body.team || "").slice(0, 4).toUpperCase(), teamId: +body.teamId || 0,
          games: !!body.games, teamNews: !!body.teamNews, bigNews: !!body.bigNews };
        const all = await readSubs(env); all[key] = { sub, prefs, added: Date.now() };
        await env.SUBS.put("subs", JSON.stringify(all));
        return json({ ok: true });
      }
      if (url.pathname === "/unsubscribe") { const all = await readSubs(env); delete all[key]; await env.SUBS.put("subs", JSON.stringify(all)); return json({ ok: true }); }
      if (url.pathname === "/test") {
        const r = await push(env, sub, { title: "SHUTOUT alerts are on", body: "You'll get alerts here like this one.", tag: "test", url: "m/" });
        return json({ ok: r.ok, status: r.status });
      }
      return json({ error: "not found" }, 404);
    } catch (e) { return json({ error: String(e.message || e) }, 500); }
  },

  async scheduled(_ev, env, ctx) { ctx.waitUntil(tick(env)); },
};

// ---------------------------------------------------------------- the minute check
async function tick(env) {
  const all = await readSubs(env);
  const subs = Object.entries(all).map(([key, r]) => ({ key, ...r }));
  if (!subs.length) return;
  const state = JSON.parse((await env.SUBS.get("state")) || "{}");
  state.games ||= {};
  const before = JSON.stringify(state);
  const out = []; // [sub record, payload]

  // Games for every team someone follows
  const teams = [...new Set(subs.filter((s) => s.prefs.games && s.prefs.teamId).map((s) => s.prefs.teamId))];
  if (teams.length) {
    const day = new Date(Date.now() - 5 * 3600e3).toISOString().slice(0, 10); // US date
    const sch = await getJSON(`${API}/api/v1/schedule?sportId=1&date=${day}&teamId=${teams.join(",")}&hydrate=linescore,team`);
    for (const g of (sch?.dates || []).flatMap((d) => d.games)) {
      const pk = g.gamePk, st = g.status?.abstractGameState, prev = state.games[pk] || { s: "Preview", n: 0 };
      if (st === "Preview") continue;
      const away = g.teams.away, home = g.teams.home;
      const who = subs.filter((s) => s.prefs.games && (s.prefs.teamId === away.team.id || s.prefs.teamId === home.team.id));
      const line = `${away.team.abbreviation} ${away.score ?? 0}, ${home.team.abbreviation} ${home.score ?? 0}`;
      const url = `m/?game=${pk}`;
      if (prev.s === "Preview" && st === "Live")
        for (const s of who) out.push([s, { title: `${away.team.teamName} at ${home.team.teamName}`, body: "First pitch. Tap to follow along.", tag: `g${pk}`, url }]);
      if (st === "Live" || (st === "Final" && prev.s !== "Final")) {
        const feed = await getJSON(`${API}/api/v1/game/${pk}/playByPlay?fields=allPlays,result,description,about,inning,halfInning,isScoringPlay,awayScore,homeScore,scoringPlays`);
        const scoring = feed?.scoringPlays || [];
        for (const i of scoring.slice(prev.n)) {
          const p = feed.allPlays[i]; if (!p) continue;
          const half = p.about.halfInning === "top" ? "Top" : "Bot";
          for (const s of who) out.push([s, { title: `${away.team.abbreviation} ${p.result.awayScore}, ${home.team.abbreviation} ${p.result.homeScore} · ${half} ${p.about.inning}`,
            body: p.result.description, tag: `g${pk}`, url }]);
        }
        prev.n = scoring.length;
      }
      if (st === "Final" && prev.s !== "Final") {
        const winner = (away.score ?? 0) > (home.score ?? 0) ? away.team.teamName : home.team.teamName;
        for (const s of who) out.push([s, { title: `Final: ${line}`, body: `${winner} win.`, tag: `g${pk}`, url }]);
      }
      prev.s = st; state.games[pk] = prev;
    }
    // forget games older than two days
    const keep = new Set((sch?.dates || []).flatMap((d) => d.games.map((g) => String(g.gamePk))));
    for (const pk of Object.keys(state.games)) if (!keep.has(pk) && Date.now() - (state.games[pk].t ||= Date.now()) > 2 * 86400e3) delete state.games[pk];
  }

  // News from the site's own feed
  if (subs.some((s) => s.prefs.teamNews || s.prefs.bigNews)) {
    const news = await getJSON(new URL("news.json", env.SITE).href + `?t=${Date.now()}`);
    const arts = (news?.articles || []).slice(0, 30);
    if (arts.length) {
      const seen = new Set(state.seen || []);
      const fresh = state.seen ? arts.filter((a) => !seen.has(a.link)) : []; // first run: remember, send nothing
      for (const a of fresh.reverse()) {
        const big = BIG.test(a.title) && !NOISE.test(a.title);
        const body = (a.body?.[0] || "").slice(0, 180);
        for (const s of subs) {
          const mine = s.prefs.teamNews && s.prefs.team && (a.teams || []).includes(s.prefs.team);
          if (mine || (s.prefs.bigNews && big)) out.push([s, { title: a.title, body, tag: `n${(await hash(a.link)).slice(0, 8)}`, url: "m/?tab=news" }]);
        }
      }
      state.seen = arts.map((a) => a.link);
    }
  }

  // Send; drop subscriptions the push service says are gone
  let gone = 0;
  for (const [s, payload] of out.slice(0, 40)) {
    const r = await push(env, s.sub, payload).catch(() => null);
    if (r && (r.status === 404 || r.status === 410) && all[s.key]) { delete all[s.key]; gone++; }
  }
  if (gone) await env.SUBS.put("subs", JSON.stringify(all));
  if (JSON.stringify(state) !== before) await env.SUBS.put("state", JSON.stringify(state)); // KV free plan: write only on change
}

// All subscriptions live in one KV value, so the minute check costs one read (KV's free plan caps list calls).
async function readSubs(env) { try { return JSON.parse((await env.SUBS.get("subs")) || "{}"); } catch { return {}; } }
async function getJSON(u) { try { const r = await fetch(u, { headers: { accept: "application/json" } }); return r.ok ? r.json() : null; } catch { return null; } }

// ---------------------------------------------------------------- Web Push
const enc = new TextEncoder();
const b64u = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const unb64u = (s) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4)), (c) => c.charCodeAt(0));
const cat = (...a) => { const o = new Uint8Array(a.reduce((n, x) => n + x.length, 0)); let i = 0; for (const x of a) { o.set(x, i); i += x.length; } return o; };
async function hash(s) { return [...new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(s)))].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 32); }
async function hkdf(salt, ikm, info, bytes) {
  const k = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info }, k, bytes * 8));
}

async function vapidHeader(env, endpoint) {
  const pub = unb64u(env.VAPID_PUBLIC);
  const jwk = { kty: "EC", crv: "P-256", d: env.VAPID_PRIVATE, x: b64u(pub.slice(1, 33)), y: b64u(pub.slice(33, 65)) };
  const key = await crypto.subtle.importKey("jwk", jwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const head = b64u(enc.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const claims = b64u(enc.encode(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: env.VAPID_SUBJECT || "mailto:alerts@example.com" })));
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, enc.encode(`${head}.${claims}`));
  return `vapid t=${head}.${claims}.${b64u(sig)}, k=${env.VAPID_PUBLIC}`;
}

async function encrypt(sub, text) {
  const uaPub = unb64u(sub.keys.p256dh), auth = unb64u(sub.keys.auth);
  const as = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const asPub = new Uint8Array(await crypto.subtle.exportKey("raw", as.publicKey));
  const uaKey = await crypto.subtle.importKey("raw", uaPub, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: uaKey }, as.privateKey, 256));
  const ikm = await hkdf(auth, shared, cat(enc.encode("WebPush: info\0"), uaPub, asPub), 32);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, enc.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, ikm, enc.encode("Content-Encoding: nonce\0"), 12);
  const key = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, key, cat(enc.encode(text), new Uint8Array([2]))));
  const rs = new Uint8Array([0, 0, 16, 0]); // record size 4096
  return cat(salt, rs, new Uint8Array([asPub.length]), asPub, ct);
}

async function push(env, sub, payload) {
  return fetch(sub.endpoint, {
    method: "POST",
    headers: { authorization: await vapidHeader(env, sub.endpoint), "content-encoding": "aes128gcm", "content-type": "application/octet-stream", ttl: "3600", urgency: "high" },
    body: await encrypt(sub, JSON.stringify(payload)),
  });
}
