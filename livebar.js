// Live bar: the favorite team's game, small, on every tab while it's on (score, inning, bases, outs).
// Xeneon: a pill in the header next to the SHUTOUT mark. Phone: a strip just above the tab bar.
// Hidden on the My team tab (it already shows the game) and while no game is live. Tap to open the game.
const LiveBar = (() => {
  let timer = 0, game = null;
  const el = () => document.getElementById("livebar");

  async function load() {
    const fav = Settings.fav(); if (!fav) return null;
    const data = await api(`/api/v1/schedule?sportId=1&teamId=${fav.id}&date=${etYmd()}&hydrate=linescore`, { ttl: 8_000 });
    return (data.dates || []).flatMap((d) => d.games || []).find((g) => phaseOf(g.status) === "live") || null;
  }

  function draw() {
    const box = el(); if (!box) return;
    const show = !!game && activeTab !== "myteam" && !Sheet.isOpen();
    box.classList.toggle("on", show);
    document.body.classList.toggle("has-livebar", show);
    if (!game) { box.innerHTML = ""; return; }
    const ls = game.linescore || {};
    const half = /mid|end/i.test(ls.inningState || "") ? ls.inningState.slice(0, 3) : (ls.inningHalf || ls.inningState || "").startsWith("T") ? "▲" : "▼";
    const side = (k) => { const t = teamMeta(game.teams[k].team); return `<span class="lb-t">${logoImg(t)}<b>${esc(t.abbr)}</b><em>${num(ls.teams?.[k]?.runs)}</em></span>`; };
    const html = `${side("away")}${side("home")}<span class="lb-i">${esc(half)} ${esc(String(ls.currentInning || ""))}</span>${Scores.bases(ls.offense || {})}${Scores.outsDots(ls.outs)}`;
    if (box.dataset.h !== html) { box.dataset.h = html; box.innerHTML = html; box.dataset.pk = game.gamePk; }
  }

  async function tick() {
    clearTimeout(timer);
    try { game = await load(); } catch (e) { /* keep the last one */ }
    draw();
    timer = setTimeout(tick, game ? 10_000 : 120_000);
  }

  function init() {
    const box = document.createElement("button");
    box.id = "livebar";
    box.setAttribute("aria-label", "Open the live game");
    const brand = document.getElementById("brand");
    if (brand) brand.parentNode.insertBefore(box, brand); else document.getElementById("stage").appendChild(box);
    box.onclick = () => box.dataset.pk && Sheet.open("game", { pk: +box.dataset.pk });
    // Re-check visibility when tabs or pages change.
    new MutationObserver(draw).observe(document.getElementById("sheet"), { attributes: true, attributeFilter: ["class"] });
    document.addEventListener("favchange", () => { game = null; tick(); });
    document.addEventListener("tabchange", draw);
    tick();
  }
  return { init, refresh: tick };
})();
