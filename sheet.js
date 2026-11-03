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
    // Back is always there: on the first page it closes the sheet and returns to the tabs.
    const body = r.querySelector(".s-body");
    body.innerHTML = `<div class="s-loading">Loading…</div>`;
    body.className = `s-body page-${top.type}`;
    const my = ++token;
    const alive = () => my === token;
    try {
      // top.state lives on the stack entry, so a page can remember things (like its open tab) for when Back returns to it.
      const c = await pages[top.type](body, top.args, alive, top.state);
      if (alive()) cleanup = typeof c === "function" ? c : null;
      else if (typeof c === "function") c();
    } catch (e) {
      console.warn(e);
      if (alive()) body.innerHTML = `<div class="s-loading">Couldn't load this from MLB. Try again in a moment.</div>`;
    }
  }

  // onBack (optional) runs when Back leaves this page, e.g. to reopen the news story it came from.
  function open(type, args, onBack) {
    // Don't stack the same page twice in a row.
    const top = stack[stack.length - 1];
    if (top && top.type === type && JSON.stringify(top.args) === JSON.stringify(args)) return;
    stack.push({ type, args, state: {}, onBack });
    if (hist) history.pushState({ sheet: stack.length }, "");
    show();
  }
  function pop(runOnBack = true) { const top = stack.pop(); show(); if (runOnBack) top?.onBack?.(); }
  // With history on (the phone app), Back and Close go through the browser history, so the iOS edge swipe
  // and Android's Back button do the same thing as the on-screen buttons.
  let hist = false, closing = false;
  const inHist = () => hist && (history.state?.sheet || 0) > 0;
  function back() { if (inHist()) history.back(); else pop(); }
  function close() {
    if (inHist()) { closing = true; history.go(-Math.min(stack.length, history.state.sheet)); }
    else { stack.length = 0; show(); }
  }
  function useHistory() {
    hist = true;
    addEventListener("popstate", (e) => {
      const d = e.state?.sheet || 0;
      while (stack.length > d) pop(!closing);
      closing = false;
    });
  }

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

  return { register, open, back, close, init, useHistory, refresh: show, isOpen: () => stack.length > 0, depth: () => stack.length };
})();

// Segmented control helper used by the pages: returns html; clicks are wired by the caller.
function seg(items, on, attr = "data-v") {
  return `<div class="seg">${items.map(([v, label]) => `<button ${attr}="${v}" class="${v === on ? "on" : ""}">${label}</button>`).join("")}</div>`;
}
