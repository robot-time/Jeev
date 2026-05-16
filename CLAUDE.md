# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm start          # run the app (also starts the Express search server automatically)
npm install        # install dependencies after adding new ones to package.json
```

To kill a leftover search server before restarting:
```bash
lsof -ti :7429 | xargs kill -9
```

## Architecture

Jeev is an Electron browser. Two processes run simultaneously:

**1. Electron main process — `main.js`**
Spawns `server.js` as a child process via `child_process.spawn` with `ELECTRON_RUN_AS_NODE=1` before the window opens. Creates a single `BrowserWindow` loading `renderer.html`. All IPC handlers live here (window controls, file read/write, extension management, permissions). Extensions and downloads go through `session.fromPartition('persist:main')` — this named session must match the `partition="persist:main"` attribute set on every `<webview>` element; if they diverge, extensions stop working.

**2. Express search server — `server.js`**
Runs on `http://127.0.0.1:7429`. Serves `GET /search?q=` (Brave Search API → parallel page fetch → TF-IDF scoring → best verbatim chunk) and also serves `newtab.html` / `newtab.js` / `newtab.css` as static files at `GET /newtab.html` etc. Requires `BRAVE_API_KEY` in `.env`. Uses an in-memory URL cache. No cheerio — HTML stripping is done with plain regex in `extractText()`.

**3. Renderer — `renderer.html` + `renderer.js` + `styles.css`**
All browser UI logic in `renderer.js` (no framework). Key concepts:
- **Spaces** — named tab groups with emoji icons. State in `state.spaces[]`. Active space controls which tabs are visible in the sidebar.
- **Tabs** — each tab has a corresponding `<webview partition="persist:main">` in the DOM. Webviews are created without `src` and loaded lazily: `activateTab()` sets `src="about:blank"` to boot the guest process, the `dom-ready` handler fires and calls `loadURL(pendingUrl)`. Never set `wv.src` directly to a real URL — this causes `ERR_ABORTED`.
- **Command bar** (Cmd+L/K) — fuzzy search over tabs, history, bookmarks. Typing a URL navigates the active tab; anything else does a Google search.
- **Snippet Search overlay** (Cmd+Shift+S) — floating modal that calls `localhost:7429/search`, shows a verbatim TF-IDF-scored quote with source attribution and 👍/👎 feedback saved to `userData/feedback.json`.
- **Persistence** — tabs, history, bookmarks, settings, permissions all read/written as JSON files in Electron's `userData` via IPC handlers `read-file` / `write-file`.

**4. New tab page — `newtab.html` + `newtab.js` + `newtab.css`**
Served from `http://localhost:7429/newtab.html` (not `file://`). Shows a clock and date only. The snippet search is a separate overlay in the main renderer, not part of this page.

**5. Preload — `preload.js`**
Exposes `window.electronAPI` via `contextBridge`. Any new IPC channel needs a handler in `main.js` and an exposure here.

## Key constraints

- **Electron version is 28, bundled Node is v18.** Avoid any npm dependency that requires Node 20+ globals (`File`, `ReadableStream` from undici, etc.). This is why cheerio was removed — cheerio 1.2+ pulls in undici which crashes on Node 18.
- **`node-fetch` must stay at v2** (CommonJS). v3 is ESM-only and won't work with `require()`.
- **Never use `wv.src = realUrl`** at webview creation time. Always go through the `dom-ready` → `loadURL` lazy pattern in `makeWebview()` / `triggerLoad()`.
- **Extensions require `partition="persist:main"`** on webviews AND `session.fromPartition(MAIN_SESSION)` in main.js. The constant `MAIN_SESSION = 'persist:main'` in main.js is the source of truth.
- **Webviews sit above all HTML z-index** (out-of-process). The webview container starts at `top: 60px` in CSS to leave room for the floating toolbar, which is absolutely positioned in that 60px zone.
