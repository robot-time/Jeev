# Jeev

A minimal Electron browser with a sidebar, spaces, Chrome extension support, and a quote-first new tab search engine.

## Quick Start

```bash
npm install
npm start
```

## Setup

### Brave Search API Key (required for new tab search)

1. Go to [https://api.search.brave.com/](https://api.search.brave.com/) and sign up for a free API key
2. Copy `.env.example` to `.env`:
   ```bash
   cp .env.example .env
   ```
3. Edit `.env` and add your key:
   ```
   BRAVE_API_KEY=your_actual_key_here
   ```

The key can also be set in the Settings panel (gear icon in the sidebar) — it's saved to your user data directory.

## Features

### Jeev

- **Sidebar navigation** — vertical tab list with Spaces (named tab groups), pinned tabs, and stale tab dimming
- **Floating toolbar** — overlaid over the webpage with autohide, contains back/forward/refresh and the command bar trigger
- **Command bar (Cmd+L or Cmd+K)** — fuzzy search across open tabs, history, and bookmarks. Type a URL to navigate, type anything else to Google search
- **Multiple spaces** — Personal, Work, and any you add. Each space has its own tab list
- **Tab persistence** — open tabs are restored across restarts, per space
- **Bookmarks** — star icon in toolbar; view/manage in the bookmarks panel

### Search (new tab page)

The new tab page is a quote-first search tool. It:
1. Queries Brave Search for the top 5 results
2. Fetches each page's HTML in parallel
3. Extracts clean body text, strips navigation/boilerplate
4. Scores all text chunks using TF-IDF against your query
5. Returns the single highest-scoring verbatim passage

This is NOT the default search. Typing in the command bar uses Google. The quote search is a tool on the new tab page only.

### Chrome Extensions

Extensions are loaded from the app's `userData/extensions/` folder (Electron manages the path per OS).

**Install an extension:**
1. Click the puzzle piece icon in the sidebar
2. Click "Install from Folder"
3. Select the unpacked extension directory

**Tested with:** uBlock Origin (download unpacked from [gorhill/uBlock releases](https://github.com/gorhill/uBlock/releases))

The Chrome Web Store button opens the store in a tab, but direct installation from CWS won't work — you need to use unpacked extensions.

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| Cmd/Ctrl+T | New tab |
| Cmd/Ctrl+W | Close tab |
| Cmd/Ctrl+L or Cmd+K | Open command bar |
| Cmd/Ctrl+B | Toggle sidebar |
| Cmd/Ctrl+F | Find in page |
| Cmd/Ctrl+R | Reload |
| Cmd/Ctrl+[ | Go back |
| Cmd/Ctrl+] | Go forward |
| Cmd/Ctrl++ | Zoom in |
| Cmd/Ctrl+- | Zoom out |
| Cmd/Ctrl+0 | Reset zoom |
| Cmd/Ctrl+Shift+] | Next tab |
| Cmd/Ctrl+Shift+[ | Previous tab |

## File Structure

```
main.js         — Electron main process, window creation, server spawn, extensions
preload.js      — contextBridge API exposed to renderer
renderer.html   — App shell HTML
renderer.js     — All browser UI logic (tabs, spaces, command bar, etc.)
styles.css      — All UI styles
newtab.html     — New tab / search page HTML
newtab.js       — Search page logic
newtab.css      — Search page styles
server.js       — Express search server (Brave API + TF-IDF)
package.json    — Dependencies
.env            — Your API keys (create from .env.example)
```
