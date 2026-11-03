// Shared team table for the page and the fetcher.
// id = MLB Stats API team id (also used for logos), slugs = MLBTR category feed slugs to try in order,
// match = words that identify the team in an MLBTR <category>.
// color = primary team color, bright = a vivid team color that stays visible on black (used for the accent tick and team-mode wash).
const TEAMS = [
  { abbr: "ARI", name: "Diamondbacks", id: 109, color: "#A71930", bright: "#E03A3E", slugs: ["arizona-diamondbacks"], match: ["Diamondbacks"] },
  { abbr: "ATH", name: "Athletics", id: 133, color: "#003831", bright: "#EFB21E", slugs: ["athletics", "sacramento-athletics", "las-vegas-athletics", "oakland-athletics"], match: ["Athletics"] },
  { abbr: "ATL", name: "Braves", id: 144, color: "#CE1141", bright: "#EB3349", slugs: ["atlanta-braves"], match: ["Braves"] },
  { abbr: "BAL", name: "Orioles", id: 110, color: "#DF4601", bright: "#FF6B1A", slugs: ["baltimore-orioles"], match: ["Orioles"] },
  { abbr: "BOS", name: "Red Sox", id: 111, color: "#BD3039", bright: "#E03A44", slugs: ["boston-red-sox"], match: ["Red Sox"] },
  { abbr: "CHC", name: "Cubs", id: 112, color: "#0E3386", bright: "#4B7BE5", slugs: ["chicago-cubs"], match: ["Cubs"] },
  { abbr: "CWS", name: "White Sox", id: 145, color: "#27251F", bright: "#C4CED4", slugs: ["chicago-white-sox"], match: ["White Sox"] },
  { abbr: "CIN", name: "Reds", id: 113, color: "#C6011F", bright: "#E8243F", slugs: ["cincinnati-reds"], match: ["Cincinnati Reds"] },
  { abbr: "CLE", name: "Guardians", id: 114, color: "#E31937", bright: "#E8304A", slugs: ["cleveland-guardians", "cleveland-indians"], match: ["Guardians", "Cleveland Indians"] },
  { abbr: "COL", name: "Rockies", id: 115, color: "#33006F", bright: "#8A5CD6", slugs: ["colorado-rockies"], match: ["Rockies"] },
  { abbr: "DET", name: "Tigers", id: 116, color: "#0C2340", bright: "#FA4616", slugs: ["detroit-tigers"], match: ["Tigers"] },
  { abbr: "HOU", name: "Astros", id: 117, color: "#EB6E1F", bright: "#F4813A", slugs: ["houston-astros"], match: ["Astros"] },
  { abbr: "KC", name: "Royals", id: 118, color: "#004687", bright: "#4A90E2", slugs: ["kansas-city-royals"], match: ["Royals"] },
  { abbr: "LAA", name: "Angels", id: 108, color: "#BA0021", bright: "#E8263A", slugs: ["los-angeles-angels", "los-angeles-angels-of-anaheim"], match: ["Angels"] },
  { abbr: "LAD", name: "Dodgers", id: 119, color: "#005A9C", bright: "#2F8BE0", slugs: ["los-angeles-dodgers"], match: ["Dodgers"] },
  { abbr: "MIA", name: "Marlins", id: 146, color: "#00A3E0", bright: "#00A3E0", slugs: ["miami-marlins"], match: ["Marlins"] },
  { abbr: "MIL", name: "Brewers", id: 158, color: "#12284B", bright: "#FFC52F", slugs: ["milwaukee-brewers"], match: ["Brewers"] },
  { abbr: "MIN", name: "Twins", id: 142, color: "#002B5C", bright: "#E8355A", slugs: ["minnesota-twins"], match: ["Twins"] },
  { abbr: "NYM", name: "Mets", id: 121, color: "#FF5910", bright: "#FF5910", slugs: ["new-york-mets"], match: ["Mets"] },
  { abbr: "NYY", name: "Yankees", id: 147, color: "#0C2340", bright: "#D0D8E4", slugs: ["new-york-yankees"], match: ["Yankees"] },
  { abbr: "PHI", name: "Phillies", id: 143, color: "#E81828", bright: "#FF2D3D", slugs: ["philadelphia-phillies"], match: ["Phillies"] },
  { abbr: "PIT", name: "Pirates", id: 134, color: "#FDB827", bright: "#FDB827", slugs: ["pittsburgh-pirates"], match: ["Pirates"] },
  { abbr: "SD", name: "Padres", id: 135, color: "#FFC425", bright: "#FFC425", slugs: ["san-diego-padres"], match: ["Padres"] },
  { abbr: "SF", name: "Giants", id: 137, color: "#FD5A1E", bright: "#FD5A1E", slugs: ["san-francisco-giants"], match: ["San Francisco Giants"] },
  { abbr: "SEA", name: "Mariners", id: 136, color: "#005C5C", bright: "#00A3AD", slugs: ["seattle-mariners"], match: ["Mariners"] },
  { abbr: "STL", name: "Cardinals", id: 138, color: "#C41E3A", bright: "#E8283F", slugs: ["st-louis-cardinals"], match: ["Cardinals"] },
  { abbr: "TB", name: "Rays", id: 139, color: "#092C5C", bright: "#8FBCE6", slugs: ["tampa-bay-rays"], match: ["Rays"] },
  { abbr: "TEX", name: "Rangers", id: 140, color: "#003278", bright: "#E8344A", slugs: ["texas-rangers"], match: ["Texas Rangers"] },
  { abbr: "TOR", name: "Blue Jays", id: 141, color: "#134A8E", bright: "#3D7BE0", slugs: ["toronto-blue-jays"], match: ["Blue Jays"] },
  { abbr: "WSH", name: "Nationals", id: 120, color: "#AB0003", bright: "#E0283A", slugs: ["washington-nationals"], match: ["Nationals"] },
];

if (typeof module !== "undefined") module.exports = { TEAMS };
