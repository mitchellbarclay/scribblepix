# Tiny Draw — iPadOS app

A thin native wrapper that runs the Tiny Draw web app fullscreen in a `WKWebView`.
The web app at the repo root stays the single source of truth; this project ships
an offline copy of it inside the app bundle.

## How it fits together

- **`TinyDraw/web/`** — a *generated* copy of the web app (`index.html`, `src/`,
  `icons/`, `app-icons/`, `manifest.json`, `version.json`). Never edit it by hand;
  it's git-ignored and rebuilt on every build.
- **`sync-web.sh`** — copies the canonical web files from the repo root into
  `TinyDraw/web/`. Runs automatically as the first Xcode build phase, so the app
  always bundles the latest web code. Run it manually anytime with `./sync-web.sh`.
- **`AppSchemeHandler.swift`** — serves `web/` over a custom `tinydraw-app://`
  origin. This is the important bit: loading from `file://` would break Tiny Draw's
  ES module imports, its module Web Worker (`fill-worker.js`), and `fetch()` of the
  `.riv` assets. A real origin makes them all work like they do under `npm start`.
- **`WebView.swift` / `ContentView.swift` / `TinyDrawApp.swift`** — fullscreen,
  no-scroll, no-bounce, no-zoom SwiftUI host.

## Run it

1. Open `TinyDraw.xcodeproj` in Xcode.
2. To run on a **real iPad** (free Apple ID is fine):
   - Select the target → **Signing & Capabilities** → check *Automatically manage
     signing* → pick your Team. Change the Bundle Identifier if `com.tinydraw.app`
     is taken (e.g. `com.yourname.tinydraw`).
   - Plug in the iPad, select it as the run destination, press **▶**.
   - First launch: on the iPad, trust the developer cert under
     *Settings → General → VPN & Device Management*.
   - Free signing expires after 7 days — just re-run from Xcode to refresh.
3. Or run on the **Simulator** (no signing needed) — pick any iPad simulator and ▶.

## Debugging on device

`isInspectable` is on, so with the iPad connected you can open
**Safari → Develop → [your iPad] → Tiny Draw** to get the full Web Inspector
(console, network, elements) against the running app.

## Not done yet

- **Offline is not fully offline.** The web app still loads three things from the
  internet at runtime: Google Fonts, `three.js` (jsdelivr), and Rive (unpkg).
  Without a network the fonts fall back and the 3D / Rive tools won't load. To ship
  a truly offline App Store build, these need to be vendored into the repo and the
  CDN `<script>`/`@import` references swapped for local paths.
- **App icon** is a placeholder (empty 1024 slot — builds with a warning). Drop your
  real art into `TinyDraw/Assets.xcassets/AppIcon.appiconset`.
- **No paid Apple Developer account needed yet** — only required to upload to
  TestFlight / the App Store.
