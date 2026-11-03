// Push alerts for the phone and desktop app (H2). The Cloudflare Worker in push/ does the watching;
// this file asks for permission, subscribes the browser and keeps the worker's copy of the choices current.
const Alerts = (() => {
  const W = () => (window.PUSH_WORKER || "").replace(/\/+$/, "");
  const KEYS = { games: "Game alerts", teamNews: "Team news", bigNews: "Big league news" };
  const NOTES = { games: "First pitch, every run and the final for your team", teamNews: "New stories about your team", bigNews: "Signings, trades and extensions across MLB" };
  const get = (k) => { try { return localStorage.getItem("m-al-" + k) === "1"; } catch (e) { return false; } };
  const put = (k, v) => { try { localStorage.setItem("m-al-" + k, v ? "1" : "0"); } catch (e) {} };
  let status = "";

  const supported = () => "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
  const standaloneNeeded = () => /iPhone|iPad/.test(navigator.userAgent) && !navigator.standalone;
  const b64 = (s) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4)), (c) => c.charCodeAt(0));

  async function subscription(create) {
    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (!sub && create) {
      const { key } = await (await fetch(W() + "/key")).json();
      sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64(key) });
    }
    return sub;
  }
  async function post(path, sub, extra = {}) {
    const r = await fetch(W() + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ subscription: sub, ...extra }) });
    if (!r.ok) throw new Error("worker " + r.status);
    return r.json();
  }
  async function sync() {
    if (!W() || !supported()) return;
    const any = Object.keys(KEYS).some(get);
    const sub = await subscription(any);
    if (!sub) return;
    if (!any) { await post("/unsubscribe", sub).catch(() => {}); await sub.unsubscribe(); return; }
    const fav = typeof Settings !== "undefined" ? Settings.fav() : null;
    await post("/subscribe", sub, { team: fav?.abbr || "", teamId: fav?.id || 0, games: get("games"), teamNews: get("teamNews"), bigNews: get("bigNews") });
  }

  async function toggle(k, redraw) {
    const on = !get(k);
    if (on && Notification.permission !== "granted") {
      const p = await Notification.requestPermission();
      if (p !== "granted") { status = "Notifications are blocked for this site. Allow them in your browser settings, then try again."; redraw(); return; }
    }
    put(k, on); status = "Saving…"; redraw();
    try {
      await sync();
      const fav = typeof Settings !== "undefined" ? Settings.fav() : null;
      status = on && k !== "bigNews" && !fav ? "Pick a favorite team above so there's a team to follow." : on ? "Saved. Alerts arrive even when the app is closed." : "Saved.";
    } catch (e) { put(k, !on); status = "Couldn't reach the alerts service. Try again in a minute."; }
    redraw();
  }
  async function test(redraw) {
    status = "Sending a test…"; redraw();
    try { const sub = await subscription(false); if (!sub) throw 0; await post("/test", sub); status = "Test sent. It should pop up in a few seconds."; }
    catch (e) { status = "Turn on an alert first."; }
    redraw();
  }

  function html() {
    if (!W()) return "";
    const head = `<div class="set-head al-head"><span class="set-title">Alerts</span>${Object.keys(KEYS).some(get) ? `<button class="set-none" data-al-test>Send a test</button>` : ""}</div>`;
    if (!supported() || standaloneNeeded())
      return `${head}<div class="set-note">${standaloneNeeded() ? "On iPhone, add SHUTOUT to your Home Screen (Share, then Add to Home Screen) and open it from there to turn on alerts." : "This browser can't show push alerts."}</div>`;
    return `${head}<div class="set-opts">${Object.entries(KEYS).map(([k, label]) =>
      `<button class="set-tog ${get(k) ? "on" : ""}" data-al="${k}"><span class="sw"><i></i></span><span class="tl"><b>${label}</b><em>${NOTES[k]}</em></span></button>`).join("")}</div>
      ${status ? `<div class="set-note al-status">${status}</div>` : ""}`;
  }

  // Keep the worker's team in step with the favorite
  document.addEventListener("favchange", () => { sync().catch(() => {}); });
  return { html, toggle, test, sync };
})();
