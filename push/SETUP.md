# Setting up SHUTOUT push alerts on Cloudflare

This takes about 15 minutes, all in the browser. The free Cloudflare plan covers it.

When you're done, the app can send three kinds of alerts, each with its own switch in Settings:

- **Game alerts**: first pitch, every run scored, and the final for your favorite team.
- **Team news**: each new MLB Trade Rumors story about your favorite team.
- **Big league news**: signings, trades and extensions across MLB.

A small Cloudflare Worker checks the MLB Stats API and the site's news feed once a minute and sends the alerts. Tapping an alert opens the game or the news in the app.

## 1. Make your alert keys

1. Open https://polarable.github.io/XENEON_MLB/push/keys.html (once this update is live).
2. Press **Generate keys**.
3. Leave the tab open. You'll paste both keys in step 4.

The keys are made in your browser and are never sent anywhere. Keep the private one to yourself.

## 2. Create the Worker

1. Sign in at https://dash.cloudflare.com.
2. In the left menu, open **Compute (Workers)** and then **Workers & Pages**.
3. Press **Create**, then **Create Worker** (some accounts show this as "Start with Hello World").
4. Name it `shutout-alerts` and press **Deploy**.
5. Press **Edit code**. Delete everything in the editor and paste the whole of [`push/worker.js`](https://github.com/Polarable/XENEON_MLB/blob/main/push/worker.js). To copy it, open that GitHub page and use the copy button above the code.
6. Press **Deploy** (top right).

## 3. Give it storage (KV)

1. In the left menu, open **Storage & Databases** and then **KV**.
2. Press **Create** (or **Create a namespace**), name it `shutout-alerts`, and save.
3. Go back to your Worker (**Workers & Pages**, then `shutout-alerts`) and open **Settings**, then **Bindings**.
4. Press **Add**, choose **KV namespace**, set **Variable name** to `SUBS`, pick the `shutout-alerts` namespace, and save.

## 4. Add the settings

Still in the Worker's **Settings**, find **Variables and Secrets** and add these four:

| Name | Type | Value |
| --- | --- | --- |
| `VAPID_PUBLIC` | Text | the public key from step 1 |
| `VAPID_PRIVATE` | Secret | the private key from step 1 |
| `VAPID_SUBJECT` | Text | `mailto:` plus your email, e.g. `mailto:you@example.com` |
| `SITE` | Text | `https://polarable.github.io/XENEON_MLB/` |

Press **Deploy** (or **Save and deploy**) when Cloudflare asks.

## 5. Run it every minute

1. In the Worker's **Settings**, find **Trigger Events** (older dashboards call it **Triggers**).
2. Press **Add**, choose **Cron Triggers**, and enter `* * * * *` (five stars separated by spaces, which means every minute).
3. Save.

## 6. Point the app at the Worker

1. On the Worker's overview page, copy its address. It looks like `https://shutout-alerts.YOUR-NAME.workers.dev`.
2. Open it in a browser tab. You should see `{"ok":true,"service":"SHUTOUT alerts"}`.
3. Send that address to Claude in the SHUTOUT thread, and it will be wired into the app. If you'd rather do it yourself, edit `push-config.js` in the repo on GitHub and set `window.PUSH_WORKER = "https://shutout-alerts.YOUR-NAME.workers.dev";`.

## 7. Turn alerts on

- **Desktop**: open https://polarable.github.io/XENEON_MLB/m/ in Chrome or Edge and install it with the install icon at the right end of the address bar. Open Settings (the sliders icon), then turn on the alerts you want under **Alerts**. Allow notifications when the browser asks.
- **iPhone**: alerts only work in the Home Screen app (iOS 16.4 or later). Open the site in Safari, then Share, then **Add to Home Screen**. Open SHUTOUT from the Home Screen, go to Settings, and turn alerts on there.
- **Android**: open the site in Chrome, install it from the menu, then turn the alerts on in Settings.

Make sure a favorite team is picked at the top of Settings. Game alerts and team news follow that team.

Press **Send a test** in the Alerts section. A test alert should arrive within a few seconds.

## If something goes wrong

- **The test never arrives**: in the Worker, open **Logs** (or **Observability**) and press **Begin log stream**, then press Send a test again. Errors show up there.
- **"Couldn't reach the alerts service"**: check the address in step 6 and that the Worker is deployed.
- **"Notifications are blocked"**: allow notifications for polarable.github.io in your browser or phone settings.
- **Windows shows nothing**: check that notifications are on for Chrome or Edge in Windows Settings, under System, then Notifications, and that Focus is off.

The free plan's limits (100,000 requests and 1,000 storage writes a day) are far above what this uses. The Worker only writes to storage when a game or the news actually changes.
