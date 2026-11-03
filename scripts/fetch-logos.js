// Downloads each team's logo, preferring MLB's versions made for dark backgrounds,
// into logos/<ABBR>.svg so the widget serves them itself. Skips logos already present.
// Run: node scripts/fetch-logos.js   (add --force to re-download all)
const fs = require("fs");
const path = require("path");
const { TEAMS } = require("../teams.js");

const DIR = path.join(__dirname, "..", "logos");
const force = process.argv.includes("--force");
// Picked by hand (user's choice), never overwritten: Astros star-H and Cubs "C" cap insignias
// (Wikimedia Commons, background square removed), Mets orange NY (MLB team-cap-on-light), Marlins
// (MLB default). Each is cropped to the same ~77% fill as the others.
const CUSTOM = new Set(["HOU", "CHC", "NYM", "MIA"]);
const variants = (id) => [
  `https://www.mlbstatic.com/team-logos/team-cap-on-dark/${id}.svg`,
  `https://www.mlbstatic.com/team-logos/team-primary-on-dark/${id}.svg`,
  `https://www.mlbstatic.com/team-logos/${id}.svg`,
];

(async () => {
  fs.mkdirSync(DIR, { recursive: true });
  for (const t of TEAMS) {
    const out = path.join(DIR, `${t.abbr}.svg`);
    if (CUSTOM.has(t.abbr) || (!force && fs.existsSync(out))) continue;
    let saved = false;
    for (const url of variants(t.id)) {
      try {
        const res = await fetch(url);
        const body = await res.text();
        if (res.ok && /<svg[\s>]/i.test(body)) {
          fs.writeFileSync(out, body);
          console.log(`${t.abbr}: ${url}`);
          saved = true;
          break;
        }
      } catch {}
    }
    if (!saved) console.warn(`${t.abbr}: no logo found`);
  }
})();
