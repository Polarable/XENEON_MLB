// Fetches the newest MLB Trade Rumors articles (league-wide + every team feed),
// finds each article's thumbnail (og:image), and writes news.json for the widget.
// Runs on Node 20+ with no dependencies:  node scripts/fetch-news.js
const fs = require("fs");
const path = require("path");
const { TEAMS } = require("../teams.js");

const ROOT = path.join(__dirname, "..");
const OUT = path.join(ROOT, "news.json");
const BASE = "https://www.mlbtraderumors.com";
const PER_TEAM = 15;      // newest articles kept per team
const LEAGUE = 40;        // newest league-wide articles kept
const UA = "Mozilla/5.0 (XeneonNewsWidget; personal use)";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function get(url) {
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.text();
}

const decode = (s) =>
  s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/&quot;/g, '"').replace(/&apos;|&#039;/g, "'")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&")
    .trim();

const tag = (xml, name) => {
  const m = xml.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`));
  return m ? decode(m[1]) : "";
};

// Turn an article's HTML into plain paragraphs for the in-widget preview.
function paragraphs(html) {
  return html.split(/<\/p>|<br\s*\/?>\s*<br\s*\/?>/i)
    .map((p) => decode(p.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").replace(/\s+([,.;:!?)\]’”])/g, "$1").replace(/([(\[“‘])\s+/g, "$1").trim())
    .filter((p) => p.length > 30 && !/^(photo courtesy|image courtesy|the post .* appeared first on)/i.test(p));
}
const MAX_BODY = 1600;    // characters of article text kept per story
function clip(paras) {
  const out = []; let n = 0;
  for (const p of paras) { if (n + p.length > MAX_BODY && out.length) break; out.push(p); n += p.length; }
  return out;
}

function parseFeed(xml) {
  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map(([, it]) => {
    const categories = [...it.matchAll(/<category>([\s\S]*?)<\/category>/g)].map((m) => decode(m[1]));
    return {
      title: tag(it, "title"),
      link: tag(it, "link"),
      date: (new Date(tag(it, "pubDate")).getTime() ? new Date(tag(it, "pubDate")) : new Date(0)).toISOString(),
      categories,
      body: clip(paragraphs(tag(it, "content:encoded") || tag(it, "description"))),
    };
  });
}

function teamsFor(categories) {
  return TEAMS.filter((t) => categories.some((c) => t.match.some((w) => c.includes(w)))).map((t) => t.abbr);
}

async function teamFeed(team) {
  for (const slug of team.slugs) {
    try {
      const items = parseFeed(await get(`${BASE}/${slug}/feed`));
      // Skip empty or abandoned feeds (e.g. an old team name whose newest post is years old).
      const fresh = items.length && Date.now() - new Date(items[0].date) < 365 * 864e5;
      if (fresh) return items;
    } catch (e) { /* try next slug */ }
  }
  console.warn(`No feed found for ${team.abbr}`);
  return [];
}

async function ogImage(link) {
  try {
    const html = await get(link);
    const m = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i)
      || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i);
    return m ? decode(m[1]) : null;
  } catch { return null; }
}

(async () => {
  // Reuse thumbnails we already found so each run only fetches new articles.
  let known = {};
  try { for (const a of JSON.parse(fs.readFileSync(OUT, "utf8")).articles) known[a.link] = a.image; } catch {}

  const byLink = new Map();
  const add = (item, fromTeam) => {
    if (!item.link) return;
    const prev = byLink.get(item.link);
    const teams = [...new Set([...(fromTeam ? [fromTeam] : []), ...teamsFor(item.categories)])];
    if (prev) prev.teams = [...new Set([...prev.teams, ...teams])];
    else byLink.set(item.link, { title: item.title, link: item.link, date: item.date, teams, body: item.body });
    if (prev && !prev.body?.length) prev.body = item.body;
  };

  (await get(`${BASE}/feed`).then(parseFeed).catch(() => [])).slice(0, LEAGUE).forEach((i) => add(i));
  for (const team of TEAMS) {
    (await teamFeed(team)).slice(0, PER_TEAM).forEach((i) => add(i, team.abbr));
    await sleep(300); // be polite
  }

  const articles = [...byLink.values()].sort((a, b) => b.date.localeCompare(a.date));
  for (const a of articles) {
    if (a.link in known && known[a.link]) { a.image = known[a.link]; continue; }
    a.image = await ogImage(a.link);
    await sleep(300);
  }

  fs.writeFileSync(OUT, JSON.stringify({ updated: new Date().toISOString(), articles }, null, 1));
  console.log(`Wrote ${articles.length} articles`);
})();
