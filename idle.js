// Idle behavior for the Xeneon strip (Settings can turn each part off):
//   Return home: after IDLE_MS untouched, close the game / team / player page, the story reader and any popover,
//                so the strip never sits on an old page (and the self-update can run).
//   Show my team live: while the favorite team is playing and nobody is touching the screen, open their game.
//                The page stays up through the final for FINAL_HOLD_MS, then idle return closes it.
const Idle = (() => {
  const IDLE_MS = 3 * 60_000;
  const FINAL_HOLD_MS = 20 * 60_000;
  const CHECK_MS = 15_000;
  let last = Date.now();
  let shown = 0;          // gamePk this module opened, or 0
  let finalAt = 0;        // when that game went final

  const idleFor = () => Date.now() - last;
  const isIdle = () => idleFor() >= IDLE_MS;
  const touched = () => { last = Date.now(); };

  // Today's game for the favorite team (a doubleheader: the live one, else the latest started).
  async function favGame() {
    const fav = Settings.fav(); if (!fav) return null;
    const data = await api(`/api/v1/schedule?sportId=1&teamId=${fav.id}&date=${etYmd()}`, { ttl: 20_000 });
    const games = (data.dates || []).flatMap((d) => d.games || []);
    const live = games.find((g) => phaseOf(g.status) === "live");
    return live || games.filter((g) => phaseOf(g.status) === "final").pop() || null;
  }

  function closeAll() {
    if (Sheet.isOpen()) Sheet.close();
    document.getElementById("reader")?.classList.remove("open");
    Settings.close();
    document.querySelectorAll(".pop.open").forEach((el) => el.classList.remove("open"));
    document.getElementById("picker")?.classList.remove("open");
    document.getElementById("scrim")?.classList.remove("open");
  }

  async function check() {
    if (!isIdle()) return;
    if (Settings.opt("takeover")) {
      try {
        const g = await favGame();
        if (!isIdle()) return;   // touched while we were asking
        const ph = g ? phaseOf(g.status) : "";
        if (ph === "live") {
          finalAt = 0;
          if (shown !== g.gamePk || !Sheet.isOpen()) {
            closeAll();
            Sheet.open("game", { pk: g.gamePk });
            shown = g.gamePk;
          }
          return;
        }
        if (shown && g && g.gamePk === shown && ph === "final") {
          if (!finalAt) finalAt = Date.now();
          if (Date.now() - finalAt < FINAL_HOLD_MS && Sheet.isOpen()) return;   // let the final sit for a while
        }
      } catch (e) { console.warn(e); }
    }
    if (Settings.opt("idle") && (Sheet.isOpen() || document.querySelector("#reader.open, .pop.open, #picker.open"))) closeAll();
    shown = 0; finalAt = 0;
  }

  function init() {
    ["pointerdown", "wheel", "keydown"].forEach((t) => addEventListener(t, touched, { capture: true, passive: true }));
    setInterval(check, CHECK_MS);
  }

  return { init, isIdle };
})();
