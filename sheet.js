// Full-screen pages that open over the tabs: game, team and player.
// They stack, so game → player → back returns to the game.
const Sheet = (() => {
  const pages = {};
  const stack = [];
  let cleanup = null;
  let token = 0;
  const root = () => document.getElementById("sheet");

  function register(name, page) { pages[name] = page; }

  async function show() {
    if (cleanup) { try { cleanup(); } catch {} cleanup = null; }
    const r = root();
    const top = stack[stack.length - 1];
    if (!top) { r.classList.remove("open"); r.querySelector(".s-body").innerHTML = ""; return; }
    r.classList.add("open");
    r.querySelector(".s-back").style.display = stack.length > 1 ? "" : "none";
    const body = r.querySelector(".s-body");
    body.innerHTML = `<div class="s-loading">Loading…</div>`;
    body.className = `s-body page-${top.type}`;
    const my = ++token;
    const alive = () => my === token;
    try {
      const c = await pages[top.type](body, top.args, alive);
      if (alive()) cleanup = typeof c === "function" ? c : null;
      else if (typeof c === "function") c();
    } catch (e) {
      console.warn(e);
      if (alive()) body.innerHTML = `<div class="s-loading">Couldn't load this from MLB. Try again in a moment.</div>`;
    }
  }

  function open(type, args) {
    // Don't stack the same page twice in a row.
    const top = stack[stack.length - 1];
    if (top && top.type === type && JSON.stringify(top.args) === JSON.stringify(args)) return;
    stack.push({ type, args });
    show();
  }
  function back() { stack.pop(); show(); }
  function close() { stack.length = 0; show(); }

  function init() {
    root().querySelector(".s-back").onclick = back;
    root().querySelector(".s-close").onclick = close;
    // Any element with data-open="type:json" inside a page opens another page.
    root().addEventListener("click", (e) => {
      const a = e.target.closest("[data-player],[data-team],[data-game]");
      if (!a || !root().contains(a)) return;
      if (a.dataset.player) open("player", { id: +a.dataset.player });
      else if (a.dataset.game) open("game", { pk: +a.dataset.game });
      else if (a.dataset.team) open("team", { id: +a.dataset.team });
    });
  }

  return { register, open, back, close, init, isOpen: () => stack.length > 0 };
})();

// Segmented control helper used by the pages: returns html; clicks are wired by the caller.
function seg(items, on, attr = "data-v") {
  return `<div class="seg">${items.map(([v, label]) => `<button ${attr}="${v}" class="${v === on ? "on" : ""}">${label}</button>`).join("")}</div>`;
}
