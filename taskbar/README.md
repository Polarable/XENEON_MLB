# SHUTOUT taskbar widget (Windhawk mod)

`shutout-taskbar.wh.cpp` is a Windhawk mod that puts a small SHUTOUT bar at the left end of the Windows 11
taskbar, where the weather widget usually sits. The bar is the web page in [`bar/`](../bar/), so it updates
itself whenever the site does. You can preview it in any browser at
https://polarable.github.io/XENEON_MLB/bar/.

## Install
1. Turn off the Windows weather widget: **Settings > Personalization > Taskbar > Widgets: Off**.
2. In Windhawk, press **Create a new mod**. Replace the template with the whole of `shutout-taskbar.wh.cpp`, then press **Compile mod** and **Exit editing mode**.
3. The bar should appear within a few seconds. If it doesn't, open the mod's **Log** tab. Then follow the WebView2 steps in the mod's **Details** tab.

## Using it
- Scroll over the bar to switch between **Auto**, **Game**, **Latest**, **My team** and **Carousel**.
- Click the bar to open the tall view above it. Click again, or anywhere else, to close it.
- The sliders icon in the open view picks your team and turns the big-play callouts on or off.
- Player names and **Open in SHUTOUT** open the page in the installed app, or in your browser. See **App command** in the Details tab to send them to the app.

## How it works
The mod starts a thread inside explorer.exe. That thread creates a small window owned by the taskbar, so the
window always stays above it, and hosts WebView2 inside it. The page tells the mod how tall to be: the
taskbar's height while collapsed, or the open view's height. The window grows upward from the taskbar. A
one-second timer keeps the window lined up with the taskbar, and hides it while the taskbar is auto-hidden
or while a fullscreen app or game is running.
