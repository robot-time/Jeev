'use strict';

// ===================== STATE =====================
const state = {
  spaces: [],
  activeSpaceId: null,
  tabs: {},          // tabId -> tab object
  activeTabId: null,
  history: [],       // [{url, title, favicon, timestamp}]
  bookmarks: [],     // [{url, title, favicon, timestamp}]
  settings: {
    sidebarCollapsed: false,
    braveApiKey: '',
    palette: 'ocean',
    grainIntensity: 8,
    theme: 'dark',
    sidebarWidth: 240,
  },
  downloads: {},     // id -> download
};

let saveTimer = null;
let toolbarFadeTimer = null;
let findActive = false;
let commandSelectedIndex = -1;
let commandResults = [];

// ===================== UTILITIES =====================
function genId() {
  return Math.random().toString(36).slice(2, 10);
}

function showToast(msg, durationMs = 3000) {
  const el = document.createElement('div');
  el.className = 'jeev-toast';
  el.textContent = msg;
  document.body.appendChild(el);
  requestAnimationFrame(() => el.classList.add('jeev-toast-visible'));
  setTimeout(() => {
    el.classList.remove('jeev-toast-visible');
    el.addEventListener('transitionend', () => el.remove(), { once: true });
  }, durationMs);
}

function isUrl(str) {
  str = str.trim();
  if (/^https?:\/\//i.test(str)) return true;
  if (/^localhost(:\d+)?/i.test(str)) return true;
  if (/^file:\/\//i.test(str)) return true;
  if (/^[a-z0-9-]+\.[a-z]{2,}(\/|$)/i.test(str) && !str.includes(' ')) return true;
  return false;
}

function normalizeUrl(str) {
  str = str.trim();
  if (/^https?:\/\//i.test(str) || /^file:\/\//i.test(str)) return str;
  if (/^localhost/i.test(str)) return 'http://' + str;
  if (isUrl(str)) return 'https://' + str;
  return null;
}

function googleSearchUrl(q) {
  return 'https://www.google.com/search?q=' + encodeURIComponent(q);
}

function applyPalette(name) {
  document.documentElement.setAttribute('data-palette', name);
  document.querySelectorAll('.palette-swatch').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.palette === name);
  });
}

function applyTheme(name) {
  const root = document.documentElement;
  if (name === 'system') {
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    root.setAttribute('data-theme', prefersDark ? 'dark' : 'light');
  } else {
    root.setAttribute('data-theme', name);
  }
  document.querySelectorAll('#theme-control button').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.theme === name);
  });
}

window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
  if ((state.settings.theme || 'dark') === 'system') {
    document.documentElement.setAttribute('data-theme', e.matches ? 'dark' : 'light');
  }
});

function applyGrain(intensity) {
  const layer = document.getElementById('grain-layer');
  if (layer) {
    layer.style.setProperty('--grain-opacity', intensity / 100);
  }
  const slider = document.getElementById('grain-slider');
  if (slider) slider.value = intensity;
  const label = document.getElementById('grain-value');
  if (label) label.textContent = intensity + '%';
}

function applySidebarWidth(width) {
  const root = document.documentElement;
  root.style.setProperty('--sidebar-width', width + 'px');
  const input = document.getElementById('sidebar-width-input');
  if (input) input.value = width;
  const handle = document.getElementById('sidebar-resize-handle');
  if (handle) handle.style.left = width + 'px';
}

function getNewtabUrl() {
  return 'http://localhost:7429/newtab.html';
}

function getDomain(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); }
  catch { return url; }
}

function isNewtab(url) {
  return !url || url === 'about:blank' || url.includes('newtab.html') || url === 'http://localhost:7429/' || url === 'http://localhost:7429';
}

// ===================== PERSISTENCE =====================
async function loadState() {
  try {
    const tabsRaw = await window.electronAPI.readFile('tabs.json');
    if (tabsRaw) {
      const saved = JSON.parse(tabsRaw);
      state.spaces = saved.spaces || [];
      state.activeSpaceId = saved.activeSpaceId || null;
      // Tabs will be reconstructed with webviews after
      state.savedTabs = saved.tabs || {};
    }
  } catch (e) { console.warn('tabs.json load failed', e); }

  try {
    const histRaw = await window.electronAPI.readFile('history.json');
    if (histRaw) state.history = JSON.parse(histRaw) || [];
  } catch { }

  try {
    const bmRaw = await window.electronAPI.readFile('bookmarks.json');
    if (bmRaw) state.bookmarks = JSON.parse(bmRaw) || [];
  } catch { }

  try {
    const settRaw = await window.electronAPI.readFile('settings.json');
    if (settRaw) Object.assign(state.settings, JSON.parse(settRaw));
  } catch { }
}

function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(persistAll, 600);
}

async function persistAll() {
  const tabsData = {
    spaces: state.spaces,
    activeSpaceId: state.activeSpaceId,
    tabs: Object.fromEntries(
      Object.entries(state.tabs).map(([id, t]) => [id, {
        id: t.id, url: t.url, title: t.title, favicon: t.favicon,
        spaceId: t.spaceId, pinned: t.pinned, lastVisited: t.lastVisited,
      }])
    ),
  };
  await window.electronAPI.writeFile('tabs.json', JSON.stringify(tabsData));
  await window.electronAPI.writeFile('history.json', JSON.stringify(state.history.slice(0, 500)));
  await window.electronAPI.writeFile('bookmarks.json', JSON.stringify(state.bookmarks));
  await window.electronAPI.writeFile('settings.json', JSON.stringify(state.settings));
}

// ===================== EMOJI PALETTE =====================
const EMOJI_LIST = [
  '🏠','💼','🌟','🎯','🚀','💻','📚','🎨',
  '🎮','🎵','🎬','✈️','🌊','🏔','🌿','☀️',
  '❤️','💜','🔥','⚡','💡','🔮','💎','🏆',
  '🦊','🐋','🐶','🐱','🦁','🦋','🐸','🐧',
  '🍕','☕','🍎','🥑','🍜','🎂','🍇','🍣',
  '📝','📌','🔧','⚙️','🗂️','📊','🔍','📋',
  '🌈','🌙','🌴','🏖','🏙','🗺️','🌐','🎭',
  '🎸','🏋','📡','🔑','💰','🎁','🧲','🎲',
  '😀','😎','🤓','😊','🥳','🤩','😍','🫡',
  '⭐','✨','💫','🎪','🌀','🔮','🃏','🎯',
];

const SPACE_COLORS = ['#4a90d9','#e05c5c','#e89a4a','#b4cf5e','#4acfb0','#7a6ff0','#d06fc2','#f0a3c0'];

function defaultEmojiForSpace(name) {
  const map = { personal: '🏠', work: '💼', research: '🔍', study: '📚', fun: '🎮', travel: '✈️' };
  return map[(name || '').toLowerCase()] || '🌟';
}

// ===================== SPACES =====================
function createSpace(name, color, id, emoji) {
  const space = {
    id: id || genId(),
    name,
    color: color || SPACE_COLORS[state.spaces.length % SPACE_COLORS.length],
    emoji: emoji || defaultEmojiForSpace(name),
    tabIds: [],
  };
  state.spaces.push(space);
  return space;
}

function switchSpace(spaceId) {
  state.activeSpaceId = spaceId;
  renderSpaceDots();
  renderTabList();
  for (const [tid, tab] of Object.entries(state.tabs)) {
    if (tab.webview) {
      tab.webview.classList.toggle('active', tab.spaceId === spaceId && tid === state.activeTabId);
    }
  }
  const spaceTabs = getSpaceTabs(spaceId);
  if (spaceTabs.length > 0) {
    const toActivate = spaceTabs.find(t => t.id === state.activeTabId) || spaceTabs[0];
    activateTab(toActivate.id);
  } else {
    openNewTab();
  }
  scheduleSave();
}

function deleteSpace(spaceId) {
  if (state.spaces.length <= 1) return; // can't delete last space
  // Close all tabs in the space
  const tabs = getSpaceTabs(spaceId);
  for (const tab of tabs) {
    if (tab.webview) tab.webview.remove();
    delete state.tabs[tab.id];
  }
  state.spaces = state.spaces.filter(s => s.id !== spaceId);
  if (state.activeSpaceId === spaceId) {
    switchSpace(state.spaces[0].id);
  } else {
    renderSpaceDots();
    scheduleSave();
  }
}

function getSpace(id) {
  return state.spaces.find(s => s.id === id);
}

function getSpaceTabs(spaceId) {
  const space = getSpace(spaceId);
  if (!space) return [];
  return space.tabIds.map(id => state.tabs[id]).filter(Boolean);
}

function renderSpaceDots() {
  const container = document.getElementById('spaces-list');
  container.innerHTML = '';
  for (const space of state.spaces) {
    // Ensure legacy spaces have an emoji
    if (!space.emoji) space.emoji = defaultEmojiForSpace(space.name);

    const btn = document.createElement('button');
    btn.className = 'space-btn' + (space.id === state.activeSpaceId ? ' active' : '');
    btn.title = space.name;
    btn.dataset.spaceId = space.id;
    btn.textContent = space.emoji;
    if (space.id === state.activeSpaceId) {
      btn.style.borderBottomColor = space.color;
    }
    btn.addEventListener('click', () => switchSpace(space.id));
    btn.addEventListener('contextmenu', (e) => { e.preventDefault(); showSpaceContextMenu(e, space.id); });
    container.appendChild(btn);
  }
}

// ===================== ACTIVE SPACE ROW =====================
function renderActiveSpaceRow() {
  const row = document.getElementById('active-space-row');
  const space = getSpace(state.activeSpaceId);
  if (!space) {
    row.classList.add('hidden');
    return;
  }
  row.classList.remove('hidden');
  document.getElementById('active-space-avatar').textContent = space.emoji || '🌟';
  document.getElementById('active-space-name').textContent = space.name;
}

// ===================== TABS =====================
function makeWebview(id) {
  const tab = state.tabs[id];
  const wv = document.createElement('webview');
  wv.setAttribute('allowpopups', '');
  wv.setAttribute('plugins', '');
  wv.setAttribute('partition', 'persist:main'); // must match MAIN_SESSION in main.js
  wv.setAttribute('preload', new URL('webview-preload.js', window.location.href).href);
  // No src — we load lazily via loadURL after dom-ready

  wv.addEventListener('dom-ready', () => {
    tab.domReady = true;
    if (tab.pendingUrl) {
      const u = tab.pendingUrl;
      tab.pendingUrl = null;
      try { wv.loadURL(u); } catch (e) { console.error('loadURL failed:', e); }
    }
  });

  wv.addEventListener('did-start-loading', () => onTabLoadStart(id));
  wv.addEventListener('did-stop-loading', () => onTabLoadStop(id));
  wv.addEventListener('did-fail-load', (e) => {
    // -3 is ERR_ABORTED — ignore it (happens on redirect or stop())
    if (e.errorCode !== -3) onTabLoadStop(id);
  });
  wv.addEventListener('page-title-updated', (e) => onTabTitleUpdate(id, e.title));
  wv.addEventListener('page-favicon-updated', (e) => {
    if (e.favicons && e.favicons.length > 0) onTabFaviconUpdate(id, e.favicons[0]);
  });
  wv.addEventListener('did-navigate', (e) => onTabNavigate(id, e.url));
  wv.addEventListener('did-navigate-in-page', (e) => {
    if (e.isMainFrame) onTabNavigate(id, e.url);
  });
  wv.addEventListener('new-window', (e) => openNewTab(e.url));
  wv.addEventListener('context-menu', (e) => showContextMenu(e, id));

  // Google blocks sign-in from embedded browsers and redirects to a "rejected"
  // endpoint even for anonymous searches.  Handle two cases:
  //   1. /*/rejected  — stale error page; silently extract `continue` and go there.
  //   2. ServiceLogin / actual sign-in — open in system browser.
  wv.addEventListener('did-start-navigation', (e) => {
    if (!e.isMainFrame || !e.url) return;
    const url = e.url;
    if (!/accounts\.google\.com/i.test(url)) return;

    if (/\/rejected/i.test(url)) {
      // Google redirected us here because it detected an embedded browser.
      // Extract the original destination and navigate there instead.
      wv.stop();
      try {
        const continueUrl = new URL(url).searchParams.get('continue');
        if (continueUrl && /^https?:\/\//i.test(continueUrl)) {
          wv.loadURL(continueUrl);
          return;
        }
      } catch (_) {}
      return;
    }

    // User actively navigated to a sign-in page — open a dedicated sign-in window
    // that shares the session so cookies carry back to all webviews automatically.
    if (/ServiceLogin|GlifWebSignIn|\/signin\//i.test(url)) {
      wv.stop();
      showToast('Opening Google sign-in…');
      window.electronAPI.googleSignIn().then((signedIn) => {
        if (signedIn) {
          showToast('Signed in — reloading…');
          wv.reload();
        }
      });
    }
  });

  document.getElementById('webview-container').appendChild(wv);
  return wv;
}

function createTab(url, spaceId) {
  const id = 't-' + genId();
  const tab = {
    id,
    url: url || getNewtabUrl(),
    title: 'New Tab',
    favicon: null,
    spaceId: spaceId || state.activeSpaceId,
    pinned: false,
    lastVisited: Date.now(),
    loading: false,
    webview: null,
    domReady: false,   // true once the webview guest process fires dom-ready
    pendingUrl: null,  // URL queued to load as soon as dom-ready fires
  };
  state.tabs[id] = tab;

  const space = getSpace(tab.spaceId);
  if (space) space.tabIds.push(id);

  tab.webview = makeWebview(id);
  scheduleSave();
  return tab;
}

// Trigger a webview to actually load its URL (lazy init).
// Safe to call at any time — will wait for dom-ready if needed.
function triggerLoad(tab) {
  if (!tab || !tab.webview) return;
  if (tab.domReady) {
    try { tab.webview.loadURL(tab.url); } catch (e) { console.error(e); }
  } else {
    // Park the URL; the dom-ready handler will pick it up.
    // Setting src="about:blank" boots the guest process without navigating.
    tab.pendingUrl = tab.url;
    if (!tab.webview.getAttribute('src')) {
      tab.webview.setAttribute('src', 'about:blank');
    }
  }
}

function openNewTab(url) {
  const tab = createTab(url || getNewtabUrl(), state.activeSpaceId);
  renderTabList();
  activateTab(tab.id);
  return tab;
}

function activateTab(tabId) {
  const prev = state.activeTabId;
  state.activeTabId = tabId;

  // Show only the active webview
  for (const [tid, t] of Object.entries(state.tabs)) {
    if (t.webview) t.webview.classList.toggle('active', tid === tabId);
  }

  const tab = state.tabs[tabId];
  if (!tab) return;

  tab.lastVisited = Date.now();

  // Lazy-load: boot the webview if it hasn't loaded its URL yet
  if (!tab.domReady && !tab.pendingUrl) {
    triggerLoad(tab);
  }

  updateNavButtons();
  updateAddressDisplay(tab.url, tab.title);
  updateBookmarkIcon();

  if (prev !== tabId) renderTabList();
  scheduleSave();
}

function closeTab(tabId) {
  const tab = state.tabs[tabId];
  if (!tab) return;

  const space = getSpace(tab.spaceId);
  if (space) space.tabIds = space.tabIds.filter(id => id !== tabId);

  if (tab.webview) tab.webview.remove();
  delete state.tabs[tabId];

  if (state.activeTabId === tabId) {
    const spaceTabs = getSpaceTabs(state.activeSpaceId);
    if (spaceTabs.length > 0) {
      activateTab(spaceTabs[spaceTabs.length - 1].id);
    } else {
      openNewTab();
      return;
    }
  }

  renderTabList();
  scheduleSave();
}

function pinTab(tabId) {
  const tab = state.tabs[tabId];
  if (!tab) return;
  tab.pinned = !tab.pinned;
  renderTabList();
  scheduleSave();
}

function onTabLoadStart(tabId) {
  const tab = state.tabs[tabId];
  if (!tab) return;
  tab.loading = true;
  updateTabRowState(tabId);
  if (tabId === state.activeTabId) startProgress();
}

function onTabLoadStop(tabId) {
  const tab = state.tabs[tabId];
  if (!tab) return;
  tab.loading = false;
  updateTabRowState(tabId);
  if (tabId === state.activeTabId) {
    completeProgress();
    updateNavButtons();
    updateFloatingToolbarVisibility();
  }
}

function onTabTitleUpdate(tabId, title) {
  const tab = state.tabs[tabId];
  if (!tab) return;
  tab.title = title || tab.url;
  updateTabRowState(tabId);
  if (tabId === state.activeTabId) updateAddressDisplay(tab.url, tab.title);
  scheduleSave();
}

function onTabFaviconUpdate(tabId, faviconUrl) {
  const tab = state.tabs[tabId];
  if (!tab) return;
  tab.favicon = faviconUrl;
  updateTabRowState(tabId);
  scheduleSave();
}

function onTabNavigate(tabId, url) {
  const tab = state.tabs[tabId];
  if (!tab) return;
  // Ignore the about:blank we set to boot the guest process
  if (url === 'about:blank') return;
  tab.url = url;
  if (tabId === state.activeTabId) {
    updateAddressDisplay(url, tab.title);
    updateNavButtons();
    updateBookmarkIcon();
  }
  // Add to history
  if (!isNewtab(url) && url !== 'about:blank') {
    addHistory(url, tab.title, tab.favicon);
  }
  scheduleSave();
}

// ===================== TAB RENDERING =====================
function renderTabList() {
  const spaceTabs = getSpaceTabs(state.activeSpaceId);
  const pinned = spaceTabs.filter(t => t.pinned);
  const open = spaceTabs.filter(t => !t.pinned);
  const now = Date.now();
  const STALE_THRESHOLD = 24 * 60 * 60 * 1000;

  renderActiveSpaceRow();

  // Pinned section — large rounded-square icons horizontally
  const pinnedSection = document.getElementById('pinned-section');
  const pinnedGrid = document.getElementById('pinned-grid');
  if (pinned.length > 0) {
    pinnedSection.classList.remove('hidden');
    pinnedGrid.innerHTML = '';
    for (const tab of pinned) {
      const el = document.createElement('div');
      el.className = 'pinned-tab' + (tab.id === state.activeTabId ? ' active' : '');
      el.title = tab.title;
      el.dataset.tabId = tab.id;
      if (tab.favicon) {
        el.innerHTML = `<img src="${tab.favicon}" onerror="this.style.display='none'">`;
      } else {
        el.innerHTML = `<svg class="tab-fallback-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="10"/></svg>`;
      }
      el.addEventListener('click', () => activateTab(tab.id));
      el.addEventListener('contextmenu', (e) => { e.preventDefault(); showTabContextMenu(e, tab.id); });
      pinnedGrid.appendChild(el);
    }
  } else {
    pinnedSection.classList.add('hidden');
  }

  // Open tabs section — sparse workspace list
  const tabList = document.getElementById('tab-list');
  tabList.innerHTML = '';
  for (const tab of open) {
    const row = document.createElement('div');
    const isStale = (now - tab.lastVisited) > STALE_THRESHOLD;
    row.className = [
      'tab-row',
      tab.id === state.activeTabId ? 'active' : '',
      tab.loading ? 'loading shimmer' : '',
      isStale ? 'stale' : '',
    ].filter(Boolean).join(' ');
    row.dataset.tabId = tab.id;

    const faviconHtml = tab.favicon
      ? `<img class="tab-favicon" src="${tab.favicon}" onerror="this.style.display='none'">`
      : `<svg class="tab-favicon tab-fallback-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="14" height="14"><circle cx="12" cy="12" r="10"/></svg>`;

    row.innerHTML = `
      <div class="tab-favicon-wrap">
        ${faviconHtml}
        <div class="tab-spinner"></div>
      </div>
      <span class="tab-title">${escHtml(tab.title || 'New Tab')}</span>
      <button class="tab-close" title="Close Tab">×</button>
    `;

    row.addEventListener('click', (e) => {
      if (!e.target.classList.contains('tab-close')) activateTab(tab.id);
    });
    row.querySelector('.tab-close').addEventListener('click', (e) => {
      e.stopPropagation();
      closeTab(tab.id);
    });
    row.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      showTabContextMenu(e, tab.id);
    });
    tabList.appendChild(row);
  }
}

function updateTabRowState(tabId) {
  const tab = state.tabs[tabId];
  if (!tab) return;
  // Update title
  document.querySelectorAll(`.tab-row[data-tab-id="${tabId}"] .tab-title`)
    .forEach(el => el.textContent = tab.title || 'New Tab');
  // Update loading class
  document.querySelectorAll(`.tab-row[data-tab-id="${tabId}"]`)
    .forEach(el => el.classList.toggle('loading', tab.loading));
  document.querySelectorAll(`.tab-row[data-tab-id="${tabId}"]`)
    .forEach(el => el.classList.toggle('shimmer', tab.loading));
  // Update favicon
  document.querySelectorAll(`.tab-row[data-tab-id="${tabId}"] .tab-favicon`)
    .forEach(el => {
      if (el.tagName === 'IMG' && tab.favicon) {
        el.src = tab.favicon;
      }
    });
  // Pinned
  const pinnedEl = document.querySelector(`.pinned-tab[data-tab-id="${tabId}"]`);
  if (pinnedEl && tab.favicon) {
    pinnedEl.innerHTML = `<img src="${tab.favicon}" onerror="this.style.display='none'">`;
  }
}

function escHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ===================== NAVIGATION =====================
function navigate(url) {
  const tab = state.tabs[state.activeTabId];
  if (!tab || !tab.webview) return;
  tab.url = url;
  tab.title = 'Loading…';
  updateAddressDisplay(url, tab.title);
  if (tab.domReady) {
    try { tab.webview.loadURL(url); } catch (e) { console.error(e); }
  } else {
    tab.pendingUrl = url;
    if (!tab.webview.getAttribute('src')) {
      tab.webview.setAttribute('src', 'about:blank');
    }
  }
}

function updateNavButtons() {
  const tab = state.tabs[state.activeTabId];
  const wv = tab && tab.webview;
  const backBtn = document.getElementById('back-btn');
  const fwdBtn = document.getElementById('forward-btn');
  if (wv) {
    try {
      backBtn.disabled = !wv.canGoBack();
      fwdBtn.disabled = !wv.canGoForward();
    } catch { backBtn.disabled = true; fwdBtn.disabled = true; }
  } else {
    backBtn.disabled = true;
    fwdBtn.disabled = true;
  }
  // Refresh/stop toggle
  const refreshIcon = document.getElementById('refresh-icon');
  const stopIcon = document.getElementById('stop-icon');
  const isLoading = tab && tab.loading;
  if (refreshIcon) refreshIcon.style.display = isLoading ? 'none' : '';
  if (stopIcon) stopIcon.style.display = isLoading ? '' : 'none';
}

function updateAddressDisplay(url, title) {
  const display = document.getElementById('address-display');
  if (!display) return;
  if (isNewtab(url)) {
    display.textContent = title && title !== 'New Tab' ? title : 'New Tab';
  } else {
    try {
      const u = new URL(url);
      display.textContent = u.hostname + (u.pathname !== '/' ? u.pathname : '') + (u.search || '');
    } catch {
      display.textContent = url;
    }
  }
  // Update security icon
  const icon = document.getElementById('security-icon');
  if (icon) {
    const isSecure = url && url.startsWith('https://');
    icon.style.opacity = isSecure ? '0.6' : '0.3';
  }
}

// ===================== BOOKMARKS =====================
function isBookmarked(url) {
  return state.bookmarks.some(b => b.url === url);
}

function toggleBookmark(url) {
  if (!url || isNewtab(url)) return;
  const tab = state.tabs[state.activeTabId];
  if (isBookmarked(url)) {
    state.bookmarks = state.bookmarks.filter(b => b.url !== url);
  } else {
    state.bookmarks.unshift({
      url, title: tab ? tab.title : url, favicon: tab ? tab.favicon : null,
      timestamp: Date.now(),
    });
  }
  updateBookmarkIcon();
  scheduleSave();
}

function updateBookmarkIcon() {
  const tab = state.tabs[state.activeTabId];
  const url = tab ? tab.url : '';
  const icon = document.getElementById('bookmark-icon');
  if (!icon) return;
  if (isBookmarked(url)) {
    icon.setAttribute('fill', 'var(--accent)');
    icon.setAttribute('stroke', 'var(--accent)');
  } else {
    icon.setAttribute('fill', 'none');
    icon.setAttribute('stroke', 'currentColor');
  }
}

function addHistory(url, title, favicon) {
  // Remove duplicate
  state.history = state.history.filter(h => h.url !== url);
  state.history.unshift({ url, title: title || url, favicon, timestamp: Date.now() });
  if (state.history.length > 500) state.history = state.history.slice(0, 500);
}

// ===================== PROGRESS BAR =====================
let progressInterval = null;
let currentProgress = 0;

function startProgress() {
  const fill = document.getElementById('progress-fill');
  currentProgress = 0;
  fill.style.width = '0%';
  fill.classList.add('loading');
  clearInterval(progressInterval);
  progressInterval = setInterval(() => {
    if (currentProgress < 85) {
      currentProgress += (85 - currentProgress) * 0.06;
      fill.style.width = currentProgress + '%';
    }
  }, 80);
}

function completeProgress() {
  clearInterval(progressInterval);
  const fill = document.getElementById('progress-fill');
  fill.style.width = '100%';
  setTimeout(() => {
    fill.classList.remove('loading');
    fill.style.width = '0%';
  }, 400);
}

// ===================== FLOATING TOOLBAR =====================
function setupFloatingToolbar() {
  const toolbar = document.getElementById('floating-toolbar');
  const content = document.getElementById('content-area');

  function showToolbar() {
    toolbar.classList.remove('faded');
    clearTimeout(toolbarFadeTimer);
    toolbarFadeTimer = setTimeout(() => {
      const tab = state.tabs[state.activeTabId];
      if (!tab || !tab.loading) toolbar.classList.add('faded');
    }, 2800);
  }

  content.addEventListener('mousemove', showToolbar);
  toolbar.addEventListener('mouseenter', () => {
    clearTimeout(toolbarFadeTimer);
    toolbar.classList.remove('faded');
  });
  toolbar.addEventListener('mouseleave', () => {
    toolbarFadeTimer = setTimeout(() => {
      const tab = state.tabs[state.activeTabId];
      if (!tab || !tab.loading) toolbar.classList.add('faded');
    }, 2800);
  });
}

function updateFloatingToolbarVisibility() {
  const toolbar = document.getElementById('floating-toolbar');
  toolbar.classList.remove('faded');
  clearTimeout(toolbarFadeTimer);
  toolbarFadeTimer = setTimeout(() => toolbar.classList.add('faded'), 2800);
}

// ===================== COMMAND BAR =====================
function openCommandBar(prefill) {
  const overlay = document.getElementById('command-overlay');
  const input = document.getElementById('command-input');
  overlay.classList.remove('hidden');
  input.value = prefill || '';
  input.focus();
  commandSelectedIndex = -1;
  searchCommandBar(input.value);
}

function closeCommandBar() {
  document.getElementById('command-overlay').classList.add('hidden');
  document.getElementById('command-input').value = '';
  document.getElementById('command-results').innerHTML = '';
}

function searchCommandBar(query) {
  const container = document.getElementById('command-results');
  container.innerHTML = '';
  commandResults = [];

  const q = query.trim();

  if (!q) {
    appendCmdSection('');
    appendCmdResult({ type: 'newtab', title: 'New Tab', sub: 'Open a new tab', icon: 'newtab' });
    const spaceTabs = getSpaceTabs(state.activeSpaceId);
    if (spaceTabs.length) {
      appendCmdSection('Open Tabs');
      for (const tab of spaceTabs.slice(0, 8)) {
        appendCmdResult({ type: 'tab', id: tab.id, title: tab.title || 'New Tab', sub: getDomain(tab.url), favicon: tab.favicon });
      }
    }
    commandSelectedIndex = 0;
    highlightCmdResult(0);
    return;
  }

  // Fuzzy search tabs
  const allTabs = Object.values(state.tabs);
  const tabMatches = allTabs
    .map(t => ({ tab: t, score: fuzzyScore(q, t.title + ' ' + t.url) }))
    .filter(r => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);

  if (tabMatches.length) {
    appendCmdSection('Open Tabs');
    tabMatches.forEach(({ tab }) => {
      appendCmdResult({ type: 'tab', id: tab.id, title: tab.title || 'New Tab', sub: getDomain(tab.url), favicon: tab.favicon });
    });
  }

  // History matches
  const histMatches = state.history
    .map(h => ({ h, score: fuzzyScore(q, h.title + ' ' + h.url) }))
    .filter(r => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);

  if (histMatches.length) {
    appendCmdSection('History');
    histMatches.forEach(({ h }) => {
      appendCmdResult({ type: 'history', url: h.url, title: h.title || h.url, sub: getDomain(h.url), favicon: h.favicon });
    });
  }

  // Bookmarks
  const bmMatches = state.bookmarks
    .map(b => ({ b, score: fuzzyScore(q, b.title + ' ' + b.url) }))
    .filter(r => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 4);

  if (bmMatches.length) {
    appendCmdSection('Bookmarks');
    bmMatches.forEach(({ b }) => {
      appendCmdResult({ type: 'bookmark', url: b.url, title: b.title, sub: getDomain(b.url), favicon: b.favicon });
    });
  }

  // Action row: navigate or search
  appendCmdSection('');
  if (isUrl(q)) {
    appendCmdResult({ type: 'navigate', url: normalizeUrl(q) || q, title: 'Go to ' + q, sub: normalizeUrl(q) || q, icon: 'arrow' });
  } else {
    appendCmdResult({ type: 'search', query: q, title: 'Search Google for "' + q + '"', sub: 'google.com', icon: 'search' });
  }

  commandSelectedIndex = -1;
  highlightCmdResult(-1);
}

function appendCmdSection(label) {
  if (!label) return;
  const el = document.createElement('div');
  el.className = 'cmd-section-label';
  el.textContent = label;
  document.getElementById('command-results').appendChild(el);
}

function appendCmdResult(data) {
  const idx = commandResults.length;
  commandResults.push(data);

  const el = document.createElement('div');
  el.className = 'cmd-result';
  el.dataset.idx = idx;

  let iconHtml = '';
  if (data.favicon) {
    iconHtml = `<div class="cmd-result-icon"><img src="${data.favicon}" onerror="this.parentElement.innerHTML='<svg viewBox=\\'0 0 24 24\\' width=\\'14\\' height=\\'14\\' fill=\\'none\\' stroke=\\'currentColor\\' stroke-width=\\'2\\'><circle cx=\\'12\\' cy=\\'12\\' r=\\'10\\'/></svg>'"></div>`;
  } else if (data.icon === 'newtab') {
    iconHtml = `<div class="cmd-result-icon"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg></div>`;
  } else if (data.icon === 'search') {
    iconHtml = `<div class="cmd-result-icon"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg></div>`;
  } else if (data.icon === 'arrow') {
    iconHtml = `<div class="cmd-result-icon"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 12h14M12 5l7 7-7 7"/></svg></div>`;
  } else {
    iconHtml = `<div class="cmd-result-icon"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/></svg></div>`;
  }

  el.innerHTML = `
    ${iconHtml}
    <div class="cmd-result-text">
      <div class="cmd-result-title">${escHtml(data.title)}</div>
      <div class="cmd-result-sub">${escHtml(data.sub || '')}</div>
    </div>
    ${data.type === 'tab' ? '<span class="cmd-result-badge">Tab</span>' : ''}
  `;

  el.addEventListener('mouseenter', () => {
    commandSelectedIndex = idx;
    highlightCmdResult(idx);
  });
  el.addEventListener('click', () => activateCmdResult(idx));
  document.getElementById('command-results').appendChild(el);
}

function highlightCmdResult(idx) {
  document.querySelectorAll('.cmd-result').forEach((el, i) => {
    el.classList.toggle('selected', i === idx);
  });
}

function activateCmdResult(idx) {
  const result = commandResults[idx];
  if (!result) return;
  closeCommandBar();

  if (result.type === 'newtab') {
    openNewTab();
  } else if (result.type === 'tab') {
    const tab = state.tabs[result.id];
    if (tab) {
      if (tab.spaceId !== state.activeSpaceId) switchSpace(tab.spaceId);
      activateTab(result.id);
    }
  } else if (result.type === 'history' || result.type === 'bookmark' || result.type === 'navigate') {
    navigate(result.url);
  } else if (result.type === 'search') {
    navigate(googleSearchUrl(result.query));
  }
}

function fuzzyScore(query, text) {
  if (!text) return 0;
  text = text.toLowerCase();
  query = query.toLowerCase();

  if (text.includes(query)) return 1000 - text.indexOf(query);

  let qi = 0, score = 0;
  for (let si = 0; si < text.length && qi < query.length; si++) {
    if (text[si] === query[qi]) { score++; qi++; }
  }
  if (qi < query.length) return 0;
  return Math.round((score / query.length) * 100);
}

// ===================== FIND IN PAGE =====================
function showFindBar() {
  const bar = document.getElementById('find-bar');
  bar.classList.remove('hidden');
  const input = document.getElementById('find-input');
  input.focus();
  input.select();
  findActive = true;
}

function hideFindBar() {
  const bar = document.getElementById('find-bar');
  bar.classList.add('hidden');
  const tab = state.tabs[state.activeTabId];
  if (tab && tab.webview) tab.webview.stopFindInPage('clearSelection');
  findActive = false;
}

function doFind(forward = true) {
  const tab = state.tabs[state.activeTabId];
  if (!tab || !tab.webview) return;
  const val = document.getElementById('find-input').value;
  if (!val) return;
  tab.webview.findInPage(val, { forward, findNext: true });
  tab.webview.addEventListener('found-in-page', (e) => {
    const r = e.result;
    document.getElementById('find-count').textContent = r.matches ? `${r.activeMatchOrdinal}/${r.matches}` : 'No results';
  }, { once: true });
}

// ===================== CONTEXT MENU =====================
function showContextMenu(e, tabId) {
  const menu = document.createElement('div');
  menu.id = 'ctx-menu';
  menu.style.cssText = `
    position:fixed;left:${e.x}px;top:${e.y}px;z-index:99999;
    background:#1a1a22;border:1px solid #2a2a34;border-radius:8px;
    padding:4px;min-width:160px;box-shadow:0 8px 32px rgba(0,0,0,0.6);
    font-size:12.5px;
  `;

  const items = [];
  const tab = state.tabs[tabId];
  const wv = tab && tab.webview;

  if (wv && wv.canGoBack()) items.push({ label: 'Back', action: () => wv.goBack() });
  if (wv && wv.canGoForward()) items.push({ label: 'Forward', action: () => wv.goForward() });
  items.push({ label: 'Reload', action: () => wv && wv.reload() });
  items.push({ sep: true });
  // Context-menu event properties are directly on the event object (not under e.params)
  if (e.linkURL) {
    items.push({ label: 'Open Link in New Tab', action: () => openNewTab(e.linkURL) });
    items.push({ label: 'Copy Link', action: () => navigator.clipboard.writeText(e.linkURL) });
  }
  if (e.srcURL) {
    items.push({ label: 'Save Image', action: () => openNewTab(e.srcURL) });
    items.push({ label: 'Copy Image URL', action: () => navigator.clipboard.writeText(e.srcURL) });
  }
  if (e.selectionText) {
    items.push({ label: 'Copy', action: () => navigator.clipboard.writeText(e.selectionText) });
    items.push({ label: `Search for "${e.selectionText.slice(0, 20)}"`, action: () => navigate(googleSearchUrl(e.selectionText)) });
  }
  items.push({ sep: true });
  items.push({ label: 'Inspect Element', action: () => wv && wv.openDevTools() });

  for (const item of items) {
    if (item.sep) {
      const sep = document.createElement('div');
      sep.style.cssText = 'height:1px;background:#2a2a34;margin:3px 0;';
      menu.appendChild(sep);
    } else {
      const row = document.createElement('div');
      row.style.cssText = 'padding:6px 12px;border-radius:5px;cursor:pointer;color:#c8c8d0;transition:background 0.1s;';
      row.textContent = item.label;
      row.addEventListener('mouseover', () => row.style.background = '#25252f');
      row.addEventListener('mouseout', () => row.style.background = '');
      row.addEventListener('click', () => { item.action(); document.body.removeChild(menu); });
      menu.appendChild(row);
    }
  }

  document.body.appendChild(menu);

  function dismiss(ev) {
    if (!menu.contains(ev.target)) {
      if (document.body.contains(menu)) document.body.removeChild(menu);
      document.removeEventListener('mousedown', dismiss);
    }
  }
  setTimeout(() => document.addEventListener('mousedown', dismiss), 0);
}

function showTabContextMenu(e, tabId) {
  const menu = document.createElement('div');
  menu.style.cssText = `
    position:fixed;left:${e.clientX}px;top:${e.clientY}px;z-index:99999;
    background:#1a1a22;border:1px solid #2a2a34;border-radius:8px;
    padding:4px;min-width:160px;box-shadow:0 8px 32px rgba(0,0,0,0.6);
    font-size:12.5px;
  `;

  const tab = state.tabs[tabId];
  const items = [
    { label: tab.pinned ? 'Unpin Tab' : 'Pin Tab', action: () => pinTab(tabId) },
    { label: 'Duplicate Tab', action: () => { const nt = openNewTab(tab.url); } },
    { sep: true },
    { label: 'Close Tab', action: () => closeTab(tabId) },
  ];

  for (const item of items) {
    if (item.sep) {
      const sep = document.createElement('div');
      sep.style.cssText = 'height:1px;background:#2a2a34;margin:3px 0;';
      menu.appendChild(sep);
    } else {
      const row = document.createElement('div');
      row.style.cssText = 'padding:6px 12px;border-radius:5px;cursor:pointer;color:#c8c8d0;';
      row.textContent = item.label;
      row.addEventListener('mouseover', () => row.style.background = '#25252f');
      row.addEventListener('mouseout', () => row.style.background = '');
      row.addEventListener('click', () => { item.action(); document.body.removeChild(menu); });
      menu.appendChild(row);
    }
  }

  document.body.appendChild(menu);
  function dismiss(ev) {
    if (!menu.contains(ev.target)) {
      if (document.body.contains(menu)) document.body.removeChild(menu);
      document.removeEventListener('mousedown', dismiss);
    }
  }
  setTimeout(() => document.addEventListener('mousedown', dismiss), 0);
}

// ===================== SNIPPET SEARCH OVERLAY =====================
const SERVER = 'http://localhost:7429';

function openSnippetSearch(prefill) {
  const overlay = document.getElementById('snippet-overlay');
  const input = document.getElementById('snippet-input');
  overlay.classList.remove('hidden');
  document.getElementById('snippet-body').innerHTML = '';
  input.value = prefill || '';
  input.focus();
  if (prefill) runSnippetSearch(prefill);
}

function closeSnippetSearch() {
  document.getElementById('snippet-overlay').classList.add('hidden');
  document.getElementById('snippet-body').innerHTML = '';
  document.getElementById('snippet-input').value = '';
}

async function runSnippetSearch(query) {
  query = query.trim();
  if (!query) return;

  const body = document.getElementById('snippet-body');
  const dots = document.getElementById('snippet-dots');
  const inputRow = document.getElementById('snippet-input-row');

  body.innerHTML = '';
  dots.classList.remove('hidden');
  inputRow.classList.add('searching');

  try {
    const resp = await fetch(`${SERVER}/search?q=${encodeURIComponent(query)}`, {
      signal: AbortSignal.timeout(25000),
    });
    dots.classList.add('hidden');
    inputRow.classList.remove('searching');

    if (!resp.ok) {
      const err = await resp.json().catch(() => ({ error: `Server error ${resp.status}` }));
      body.innerHTML = `<div class="snip-error">${escHtml(err.error || 'Search failed.')}</div>`;
      return;
    }

    const data = await resp.json();
    renderSnippetResult(data, query);
  } catch (err) {
    dots.classList.add('hidden');
    document.getElementById('snippet-input-row').classList.remove('searching');
    body.innerHTML = `<div class="snip-error">${
      err.name === 'TimeoutError' || err.name === 'AbortError'
        ? 'Search timed out. The server may still be warming up.'
        : 'Could not reach the search server. Make sure BRAVE_API_KEY is set in .env'
    }</div>`;
  }
}

function renderSnippetResult(data, query) {
  const body = document.getElementById('snippet-body');
  body.innerHTML = '';

  if (data.result) {
    const domain = getDomainFromUrl(data.sourceUrl || '');
    const faviconUrl = domain ? `https://www.google.com/s2/favicons?domain=${domain}&sz=32` : '';

    const block = document.createElement('div');
    block.className = 'snip-result';
    block.innerHTML = `
      <div class="snip-quote">${escHtml(data.result.replace(/\s+/g, ' ').trim())}</div>
      <div class="snip-source">
        ${faviconUrl ? `<img class="snip-favicon" src="${faviconUrl}" onerror="this.style.display='none'">` : ''}
        <span class="snip-title" data-url="${escHtml(data.sourceUrl || '')}">${escHtml(data.sourceTitle || domain)}</span>
        <span class="snip-domain">${escHtml(domain)}</span>
      </div>
      <div class="snip-feedback">
        <span class="snip-feedback-label">Was this helpful?</span>
        <button class="snip-fb-btn" data-vote="up">👍 Yes</button>
        <button class="snip-fb-btn" data-vote="down">👎 No</button>
      </div>
    `;

    // Source link
    block.querySelector('.snip-title').addEventListener('click', () => {
      openNewTab(data.sourceUrl);
      closeSnippetSearch();
    });

    // Feedback
    block.querySelectorAll('.snip-fb-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const vote = btn.dataset.vote;
        saveFeedback({ query, sourceUrl: data.sourceUrl, vote, ts: Date.now() });
        block.querySelector('.snip-feedback').innerHTML =
          `<span class="snip-fb-thanks">Thanks for the feedback${vote === 'up' ? ' 👍' : ' — we\'ll improve 👎'}</span>`;
      });
    });

    body.appendChild(block);
  } else {
    const msg = document.createElement('div');
    msg.className = 'snip-no-result';
    msg.textContent = "Couldn't find a clear answer. Here's what came up:";
    body.appendChild(msg);
  }

  // Further reading
  if (data.sources && data.sources.length) {
    const section = document.createElement('div');
    section.className = 'snip-further';
    section.innerHTML = '<div class="snip-further-label">Also found in</div>';
    for (const src of data.sources) {
      const d = getDomainFromUrl(src.url || '');
      const row = document.createElement('div');
      row.className = 'snip-source-row';
      row.innerHTML = `
        <img class="snip-source-favicon" src="https://www.google.com/s2/favicons?domain=${d}&sz=32" onerror="this.style.display='none'">
        <span class="snip-source-title">${escHtml(src.title || src.url)}</span>
        <span class="snip-source-domain">${escHtml(d)}</span>
      `;
      row.addEventListener('click', () => { openNewTab(src.url); closeSnippetSearch(); });
      section.appendChild(row);
    }
    body.appendChild(section);
  }
}

function getDomainFromUrl(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; }
}

async function saveFeedback(entry) {
  try {
    const raw = await window.electronAPI.readFile('feedback.json').catch(() => null);
    const list = raw ? JSON.parse(raw) : [];
    list.unshift(entry);
    await window.electronAPI.writeFile('feedback.json', JSON.stringify(list.slice(0, 500)));
  } catch { /* non-critical */ }
}

// ===================== SIDEBAR RESIZE =====================
function setupSidebarResize() {
  const handle = document.getElementById('sidebar-resize-handle');
  if (!handle) return;

  let dragging = false;
  let startX = 0;
  let startWidth = 0;

  handle.addEventListener('mousedown', (e) => {
    dragging = true;
    startX = e.clientX;
    startWidth = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--sidebar-width'), 10);
    handle.classList.add('dragging');
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    e.preventDefault();
  });

  document.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    const delta = e.clientX - startX;
    const newWidth = Math.max(180, Math.min(420, startWidth + delta));
    applySidebarWidth(newWidth);
    handle.style.left = newWidth + 'px';
  });

  document.addEventListener('mouseup', () => {
    if (!dragging) return;
    dragging = false;
    handle.classList.remove('dragging');
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    const w = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--sidebar-width'), 10);
    state.settings.sidebarWidth = w;
    scheduleSave();
  });
}

// ===================== KEYBOARD SHORTCUTS =====================
function setupKeyboard() {
  document.addEventListener('keydown', (e) => {
    const cmd = e.metaKey || e.ctrlKey;

    // Snippet search shortcut: Cmd/Ctrl+Shift+S
    if (cmd && e.shiftKey && e.key.toLowerCase() === 's') {
      e.preventDefault();
      const snippetOpen = !document.getElementById('snippet-overlay').classList.contains('hidden');
      if (snippetOpen) closeSnippetSearch(); else openSnippetSearch();
      return;
    }

    if (cmd && e.key === 't') { e.preventDefault(); openCommandBar(''); return; }
    if (cmd && e.key === 'w') { e.preventDefault(); if (state.activeTabId) closeTab(state.activeTabId); return; }
    if (cmd && (e.key === 'l' || e.key === 'k')) { e.preventDefault(); openCommandBar(currentTabUrlForBar()); return; }
    if (cmd && e.key === 'b') { e.preventDefault(); toggleSidebar(); return; }
    if (cmd && e.key === 'f') { e.preventDefault(); showFindBar(); return; }
    if (cmd && e.key === 'r') { e.preventDefault(); const tab = state.tabs[state.activeTabId]; if (tab && tab.webview) tab.webview.reload(); return; }
    if (cmd && e.key === '[') { e.preventDefault(); const t = state.tabs[state.activeTabId]; if (t && t.webview && t.webview.canGoBack()) t.webview.goBack(); return; }
    if (cmd && e.key === ']') { e.preventDefault(); const t = state.tabs[state.activeTabId]; if (t && t.webview && t.webview.canGoForward()) t.webview.goForward(); return; }

    // Zoom
    if (cmd && (e.key === '=' || e.key === '+')) { e.preventDefault(); adjustZoom(0.1); return; }
    if (cmd && e.key === '-') { e.preventDefault(); adjustZoom(-0.1); return; }
    if (cmd && e.key === '0') { e.preventDefault(); setZoom(1); return; }

    // Cycle tabs
    if (cmd && e.shiftKey && e.key === ']') { e.preventDefault(); cycleTab(1); return; }
    if (cmd && e.shiftKey && e.key === '[') { e.preventDefault(); cycleTab(-1); return; }

    // Feedback overlay toggle
    if (cmd && e.shiftKey && e.key.toLowerCase() === 'f') {
      e.preventDefault();
      const fbOpen = !document.getElementById('feedback-overlay').classList.contains('hidden');
      if (fbOpen) closeFeedbackModal(); else openFeedbackModal();
      return;
    }

    // Snippet overlay ESC
    if (e.key === 'Escape' && !document.getElementById('snippet-overlay').classList.contains('hidden')) {
      e.preventDefault(); closeSnippetSearch(); return;
    }

    // Feedback overlay ESC
    if (e.key === 'Escape' && !document.getElementById('feedback-overlay').classList.contains('hidden')) {
      e.preventDefault(); closeFeedbackModal(); return;
    }

    // Command bar keyboard nav
    if (!document.getElementById('command-overlay').classList.contains('hidden')) {
      if (e.key === 'Escape') { e.preventDefault(); closeCommandBar(); return; }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        commandSelectedIndex = Math.min(commandSelectedIndex + 1, commandResults.length - 1);
        highlightCmdResult(commandSelectedIndex);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        commandSelectedIndex = Math.max(commandSelectedIndex - 1, 0);
        highlightCmdResult(commandSelectedIndex);
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        const idx = commandSelectedIndex >= 0 ? commandSelectedIndex : commandResults.length - 1;
        activateCmdResult(idx);
        return;
      }
    }

    // Find bar
    if (findActive) {
      if (e.key === 'Escape') { hideFindBar(); return; }
      if (e.key === 'Enter') { doFind(!e.shiftKey); return; }
    }
  });
}

function currentTabUrlForBar() {
  const tab = state.tabs[state.activeTabId];
  if (!tab || isNewtab(tab.url)) return '';
  return tab.url;
}

function adjustZoom(delta) {
  const tab = state.tabs[state.activeTabId];
  if (!tab || !tab.webview) return;
  try {
    const current = tab.webview.getZoomFactor ? tab.webview.getZoomFactor() : 1;
    tab.webview.setZoomFactor(Math.max(0.25, Math.min(5, current + delta)));
  } catch {}
}

function setZoom(factor) {
  const tab = state.tabs[state.activeTabId];
  if (!tab || !tab.webview) return;
  try { tab.webview.setZoomFactor(factor); } catch {}
}

function cycleTab(direction) {
  const spaceTabs = getSpaceTabs(state.activeSpaceId);
  if (spaceTabs.length < 2) return;
  const idx = spaceTabs.findIndex(t => t.id === state.activeTabId);
  const next = (idx + direction + spaceTabs.length) % spaceTabs.length;
  activateTab(spaceTabs[next].id);
}

// ===================== SIDEBAR COLLAPSE =====================
function toggleSidebar() {
  const sidebar = document.getElementById('sidebar');
  state.settings.sidebarCollapsed = !state.settings.sidebarCollapsed;
  sidebar.classList.toggle('collapsed', state.settings.sidebarCollapsed);
  const icon = document.getElementById('collapse-icon');
  if (icon) icon.style.transform = state.settings.sidebarCollapsed ? 'rotate(180deg)' : '';
  scheduleSave();
}

// ===================== DOWNLOADS =====================
function setupDownloads() {
  window.electronAPI.onDownloadProgress((data) => {
    state.downloads[data.id] = data;
    updateDownloadIndicator();
  });
}

function updateDownloadIndicator() {
  const active = Object.values(state.downloads).filter(d => d.state === 'progressing' || d.state === 'started');
  const indicator = document.getElementById('download-indicator');
  const label = document.getElementById('download-label');
  if (active.length > 0) {
    indicator.classList.remove('hidden');
    const latest = active[active.length - 1];
    label.textContent = latest.percent >= 0 ? latest.percent + '%' : '…';
    setTimeout(() => {
      const stillActive = Object.values(state.downloads).filter(d => d.state === 'progressing' || d.state === 'started');
      if (stillActive.length === 0) indicator.classList.add('hidden');
    }, 3000);
  } else {
    setTimeout(() => indicator.classList.add('hidden'), 2000);
  }
}

// ===================== UPDATE POPUP =====================
function setupUpdater() {
  window.electronAPI.onUpdateReady((info) => {
    const popup = document.getElementById('update-popup');
    const ver = document.getElementById('update-popup-version');
    ver.textContent = 'v' + info.version + ' is ready';
    popup.classList.remove('hidden');
    // Animate in
    requestAnimationFrame(() => popup.classList.add('update-popup-visible'));
  });

  document.getElementById('update-install-btn').addEventListener('click', () => {
    window.electronAPI.installUpdate();
  });

  document.getElementById('update-dismiss-btn').addEventListener('click', () => {
    const popup = document.getElementById('update-popup');
    popup.classList.remove('update-popup-visible');
    popup.addEventListener('transitionend', () => popup.classList.add('hidden'), { once: true });
  });
}

// ===================== PANELS =====================
function openPanel(id) {
  document.querySelectorAll('.panel').forEach(p => p.classList.add('hidden'));
  document.getElementById(id).classList.remove('hidden');
  document.getElementById('panel-backdrop').classList.remove('hidden');
}

function closeAllPanels() {
  document.querySelectorAll('.panel').forEach(p => p.classList.add('hidden'));
  document.getElementById('panel-backdrop').classList.add('hidden');
}

async function renderExtensions() {
  const list = document.getElementById('extensions-list');
  list.innerHTML = '<div class="empty-state">Loading…</div>';
  try {
    const exts = await window.electronAPI.getExtensions();
    list.innerHTML = '';
    if (!exts || exts.length === 0) {
      list.innerHTML = '<div class="empty-state">No extensions installed.</div>';
      return;
    }
    for (const ext of exts) {
      const row = document.createElement('div');
      row.className = 'extension-row';
      const iconPath = ext.path ? ext.path + '/icon128.png' : '';
      row.innerHTML = `
        <div class="extension-icon">
          ${iconPath ? `<img src="file://${iconPath}" onerror="this.style.display='none'">` : ''}
        </div>
        <div class="extension-info">
          <div class="extension-name">${escHtml(ext.name)}</div>
          <div class="extension-version">v${ext.version || '—'}</div>
        </div>
        <button class="ext-remove-btn" data-id="${ext.id}">Remove</button>
      `;
      row.querySelector('.ext-remove-btn').addEventListener('click', async () => {
        await window.electronAPI.removeExtension(ext.id);
        renderExtensions();
      });
      list.appendChild(row);
    }
  } catch (e) {
    list.innerHTML = '<div class="empty-state">Failed to load extensions.</div>';
  }
}

function renderBookmarksList() {
  const list = document.getElementById('bookmarks-list');
  list.innerHTML = '';
  if (!state.bookmarks.length) {
    list.innerHTML = '<div class="empty-state">No bookmarks yet.</div>';
    return;
  }
  for (const bm of state.bookmarks) {
    const row = document.createElement('div');
    row.className = 'bookmark-row';
    row.innerHTML = `
      ${bm.favicon ? `<img class="bookmark-favicon" src="${bm.favicon}" onerror="this.style.display='none'">` : '<div class="bookmark-favicon"></div>'}
      <span class="bookmark-title">${escHtml(bm.title)}</span>
      <span class="bookmark-domain">${escHtml(getDomain(bm.url))}</span>
      <button class="bookmark-del" title="Remove">×</button>
    `;
    row.addEventListener('click', (e) => {
      if (!e.target.classList.contains('bookmark-del')) {
        closeAllPanels();
        navigate(bm.url);
      }
    });
    row.querySelector('.bookmark-del').addEventListener('click', (e) => {
      e.stopPropagation();
      state.bookmarks = state.bookmarks.filter(b => b.url !== bm.url);
      renderBookmarksList();
      updateBookmarkIcon();
      scheduleSave();
    });
    list.appendChild(row);
  }
}

// ===================== SPACE MODAL =====================
function showSpaceContextMenu(e, spaceId) {
  const existing = document.getElementById('space-ctx-menu');
  if (existing) existing.remove();

  const menu = document.createElement('div');
  menu.id = 'space-ctx-menu';
  menu.style.cssText = `position:fixed;left:${e.clientX}px;top:${e.clientY}px;z-index:99999;
    background:#1a1a22;border:1px solid #2a2a34;border-radius:8px;padding:4px;
    min-width:140px;box-shadow:0 8px 32px rgba(0,0,0,0.6);font-size:12.5px;`;

  const space = getSpace(spaceId);
  const items = [
    { label: 'Edit Space', action: () => showSpaceModal(spaceId) },
    { sep: true },
    { label: 'Delete Space', danger: true, action: () => { if (state.spaces.length > 1) deleteSpace(spaceId); } },
  ];

  for (const item of items) {
    if (item.sep) {
      const s = document.createElement('div');
      s.style.cssText = 'height:1px;background:#2a2a34;margin:3px 0;';
      menu.appendChild(s);
    } else {
      const row = document.createElement('div');
      row.style.cssText = `padding:6px 12px;border-radius:5px;cursor:pointer;color:${item.danger ? '#e07a7a' : '#c8c8d0'};`;
      row.textContent = item.label;
      row.addEventListener('mouseover', () => row.style.background = '#25252f');
      row.addEventListener('mouseout', () => row.style.background = '');
      row.addEventListener('click', () => { item.action(); menu.remove(); });
      menu.appendChild(row);
    }
  }

  document.body.appendChild(menu);
  const dismiss = (ev) => { if (!menu.contains(ev.target)) { menu.remove(); document.removeEventListener('mousedown', dismiss); } };
  setTimeout(() => document.addEventListener('mousedown', dismiss), 0);
}

function showSpaceModal(editSpaceId = null) {
  const existing = document.getElementById('space-modal-overlay');
  if (existing) existing.remove();

  const isEdit = !!editSpaceId;
  const space = isEdit ? getSpace(editSpaceId) : null;
  let selectedEmoji = space ? space.emoji : '🌟';
  let emojiPickerOpen = false;

  const overlay = document.createElement('div');
  overlay.id = 'space-modal-overlay';

  const modal = document.createElement('div');
  modal.id = 'space-modal';
  modal.innerHTML = `
    <div class="sm-header">${isEdit ? 'Edit Space' : 'New Space'}</div>
    <div class="sm-row">
      <button id="sm-emoji-btn" class="sm-emoji-btn" title="Pick emoji">${selectedEmoji}</button>
      <input id="sm-name" class="sm-name-input" type="text"
        placeholder="Space name…" value="${isEdit ? escHtml(space.name) : ''}" maxlength="24">
    </div>
    <div id="sm-emoji-grid" class="sm-emoji-grid hidden"></div>
    <div class="sm-footer">
      <button id="sm-cancel" class="btn-secondary">Cancel</button>
      <button id="sm-submit" class="btn-primary">${isEdit ? 'Save' : 'Create Space'}</button>
    </div>
  `;
  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  // Build emoji grid
  const grid = modal.querySelector('#sm-emoji-grid');
  for (const emoji of EMOJI_LIST) {
    const cell = document.createElement('button');
    cell.className = 'sm-emoji-cell' + (emoji === selectedEmoji ? ' selected' : '');
    cell.textContent = emoji;
    cell.title = emoji;
    cell.addEventListener('click', () => {
      selectedEmoji = emoji;
      modal.querySelector('#sm-emoji-btn').textContent = emoji;
      grid.querySelectorAll('.sm-emoji-cell').forEach(c => c.classList.toggle('selected', c.textContent === emoji));
      grid.classList.add('hidden');
      emojiPickerOpen = false;
    });
    grid.appendChild(cell);
  }

  // Emoji button toggles grid
  modal.querySelector('#sm-emoji-btn').addEventListener('click', () => {
    emojiPickerOpen = !emojiPickerOpen;
    grid.classList.toggle('hidden', !emojiPickerOpen);
    modal.querySelector('#sm-emoji-btn').classList.toggle('active', emojiPickerOpen);
  });

  // Focus name input
  const nameInput = modal.querySelector('#sm-name');
  setTimeout(() => nameInput.focus(), 50);

  // Submit
  const submit = () => {
    const name = nameInput.value.trim();
    if (!name) { nameInput.focus(); return; }
    if (isEdit) {
      space.emoji = selectedEmoji;
      space.name = name;
      renderSpaceDots();
      scheduleSave();
    } else {
      const newSpace = createSpace(name, null, null, selectedEmoji);
      switchSpace(newSpace.id);
      scheduleSave();
    }
    overlay.remove();
  };

  modal.querySelector('#sm-submit').addEventListener('click', submit);
  nameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); if (e.key === 'Escape') overlay.remove(); });
  modal.querySelector('#sm-cancel').addEventListener('click', () => overlay.remove());
  overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) overlay.remove(); });
}

// ===================== FEEDBACK MODAL =====================
function openFeedbackModal() {
  const overlay = document.getElementById('feedback-overlay');
  overlay.classList.remove('hidden');
  document.getElementById('fb-message').value = '';
  document.getElementById('fb-screenshot').checked = true;
  document.getElementById('fb-error').checked = false;
  document.getElementById('fb-status').classList.add('hidden');
  document.getElementById('fb-submit').disabled = false;
  document.getElementById('fb-submit').textContent = 'Send Feedback';
  document.getElementById('fb-message').focus();
}

function closeFeedbackModal() {
  document.getElementById('feedback-overlay').classList.add('hidden');
}

async function submitFeedback() {
  const message = document.getElementById('fb-message').value.trim();
  if (!message) {
    showFeedbackStatus('Please enter a message.', 'error');
    return;
  }

  const dsn = await window.electronAPI.getSentryDsn();
  if (!dsn) {
    showFeedbackStatus('Sentry is not configured. Add SENTRY_DSN to your .env file.', 'error');
    return;
  }

  const btn = document.getElementById('fb-submit');
  btn.disabled = true;
  btn.textContent = 'Sending…';

  let screenshotDataUrl = null;
  if (document.getElementById('fb-screenshot').checked) {
    try {
      screenshotDataUrl = await window.electronAPI.captureScreenshot();
    } catch (e) {
      console.warn('Screenshot capture failed:', e);
    }
  }

  if (document.getElementById('fb-error').checked) {
    const tab = state.tabs[state.activeTabId];
    const url = tab ? tab.url : '';
    const title = tab ? tab.title : '';
    const context = `Active tab: ${title} (${url})`;
    const fullMessage = `[Error Report]\n${context}\n\n${message}`;
    try {
      window.electronAPI.captureFeedback(fullMessage, null, null, screenshotDataUrl);
    } catch (e) {
      console.error('Feedback submission failed:', e);
      showFeedbackStatus('Could not send feedback. Check your connection.', 'error');
      btn.disabled = false;
      btn.textContent = 'Send Feedback';
      return;
    }
  } else {
    try {
      window.electronAPI.captureFeedback(message, null, null, screenshotDataUrl);
    } catch (e) {
      console.error('Feedback submission failed:', e);
      showFeedbackStatus('Could not send feedback. Check your connection.', 'error');
      btn.disabled = false;
      btn.textContent = 'Send Feedback';
      return;
    }
  }

  showFeedbackStatus('Feedback sent. Thank you!', 'success');
  setTimeout(() => {
    closeFeedbackModal();
    btn.disabled = false;
    btn.textContent = 'Send Feedback';
  }, 1200);
}

function showFeedbackStatus(text, type) {
  const status = document.getElementById('fb-status');
  status.textContent = text;
  status.className = 'fb-status ' + type;
  status.classList.remove('hidden');
}

// ===================== INIT =====================
async function init() {
  // Platform check
  const isMac = await window.electronAPI.isMac();
  document.getElementById('win-controls').classList.toggle('hidden', isMac);
  if (!isMac) document.body.classList.add('platform-win32');

  await loadState();

  // Set up defaults if no saved state
  if (!state.spaces || state.spaces.length === 0) {
    const p = createSpace('Personal', '#4a90d9', 'space-personal', '🏠');
    createSpace('Work', '#e05c5c', 'space-work', '💼');
    state.activeSpaceId = p.id;
  }
  // Backfill emoji on legacy spaces that predate this field
  for (const s of state.spaces) {
    if (!s.emoji) s.emoji = defaultEmojiForSpace(s.name);
  }

  // Reconstruct tabs from saved data using the lazy webview approach
  if (state.savedTabs) {
    for (const [id, savedTab] of Object.entries(state.savedTabs)) {
      const tab = {
        id,
        url: savedTab.url || getNewtabUrl(),
        title: savedTab.title || 'New Tab',
        favicon: savedTab.favicon || null,
        spaceId: savedTab.spaceId || state.activeSpaceId,
        pinned: savedTab.pinned || false,
        lastVisited: savedTab.lastVisited || Date.now(),
        loading: false,
        webview: null,
        domReady: false,
        pendingUrl: null,
      };
      state.tabs[id] = tab;

      const space = getSpace(tab.spaceId);
      if (space && !space.tabIds.includes(id)) space.tabIds.push(id);

      // Create the webview shell — URL loads lazily when tab is activated
      tab.webview = makeWebview(id);
    }
    delete state.savedTabs;
  }

  // If still no tabs in active space, open new tab
  const spaceTabs = getSpaceTabs(state.activeSpaceId);
  if (spaceTabs.length === 0) openNewTab();

  // Render sidebar
  renderSpaceDots();
  renderTabList();

  // Activate first tab
  const firstTab = getSpaceTabs(state.activeSpaceId)[0];
  if (firstTab) activateTab(firstTab.id);

  // Apply settings
  if (state.settings.sidebarCollapsed) {
    document.getElementById('sidebar').classList.add('collapsed');
  }
  if (state.settings.braveApiKey) {
    document.getElementById('api-key-input').value = state.settings.braveApiKey;
  }
  applyPalette(state.settings.palette || 'ocean');
  applyTheme(state.settings.theme || 'light');
  applyGrain(state.settings.grainIntensity !== undefined ? state.settings.grainIntensity : 8);
  applySidebarWidth(state.settings.sidebarWidth || 260);

  // Set up toolbar
  setupKeyboard();
  setupDownloads();
  setupUpdater();
  setupSidebarResize();
  setupEvents();
}

function setupEvents() {
  // Nav buttons
  document.getElementById('back-btn').addEventListener('click', () => {
    const t = state.tabs[state.activeTabId];
    if (t && t.webview && t.webview.canGoBack()) t.webview.goBack();
  });
  document.getElementById('forward-btn').addEventListener('click', () => {
    const t = state.tabs[state.activeTabId];
    if (t && t.webview && t.webview.canGoForward()) t.webview.goForward();
  });
  document.getElementById('refresh-btn').addEventListener('click', () => {
    const t = state.tabs[state.activeTabId];
    if (!t || !t.webview) return;
    if (t.loading) t.webview.stop();
    else t.webview.reload();
  });
  document.getElementById('address-bar').addEventListener('click', () => openCommandBar(currentTabUrlForBar()));
  document.getElementById('bookmark-btn').addEventListener('click', () => {
    const t = state.tabs[state.activeTabId];
    if (t) toggleBookmark(t.url);
  });

  // New tab
  document.getElementById('new-tab-btn').addEventListener('click', () => openCommandBar(''));

  // Sidebar collapse / toggle
  document.getElementById('collapse-btn').addEventListener('click', toggleSidebar);
  document.getElementById('sidebar-toggle').addEventListener('click', toggleSidebar);

  // Active space row
  document.getElementById('active-space-row').addEventListener('click', (e) => {
    if (e.target.closest('.space-action')) return;
    // Clicking the row itself could cycle spaces or show a quick switcher
    const idx = state.spaces.findIndex(s => s.id === state.activeSpaceId);
    const next = state.spaces[(idx + 1) % state.spaces.length];
    if (next) switchSpace(next.id);
  });
  document.getElementById('space-edit-btn').addEventListener('click', (e) => {
    e.stopPropagation();
    showSpaceModal(state.activeSpaceId);
  });
  document.getElementById('space-menu-btn').addEventListener('click', (e) => {
    e.stopPropagation();
    showSpaceContextMenu(e, state.activeSpaceId);
  });

  // Add space
  document.getElementById('add-space-btn').addEventListener('click', () => showSpaceModal(null));

  // Panel buttons
  document.getElementById('extensions-btn').addEventListener('click', () => { openPanel('extensions-panel'); renderExtensions(); });
  document.getElementById('bookmarks-btn').addEventListener('click', () => { openPanel('bookmarks-panel'); renderBookmarksList(); });
  document.getElementById('settings-btn').addEventListener('click', () => openPanel('settings-panel'));
  document.getElementById('panel-backdrop').addEventListener('click', closeAllPanels);
  document.querySelectorAll('.panel-close-btn').forEach(btn => btn.addEventListener('click', closeAllPanels));

  // Extensions panel
  document.getElementById('install-ext-btn').addEventListener('click', async () => {
    const result = await window.electronAPI.installExtension();
    if (result.success) renderExtensions();
    else if (result.error && result.error !== 'cancelled') alert('Failed: ' + result.error);
  });
  document.getElementById('cwstore-btn').addEventListener('click', () => {
    openNewTab('https://chrome.google.com/webstore');
    closeAllPanels();
  });

  // Settings
  document.getElementById('save-api-key').addEventListener('click', () => {
    state.settings.braveApiKey = document.getElementById('api-key-input').value.trim();
    scheduleSave();
    closeAllPanels();
  });

  // Palette picker
  document.querySelectorAll('.palette-swatch').forEach(btn => {
    btn.addEventListener('click', () => {
      const p = btn.dataset.palette;
      state.settings.palette = p;
      applyPalette(p);
      scheduleSave();
    });
  });

  // Theme toggle
  document.querySelectorAll('#theme-control button').forEach(btn => {
    btn.addEventListener('click', () => {
      const t = btn.dataset.theme;
      state.settings.theme = t;
      applyTheme(t);
      scheduleSave();
    });
  });

  // Grain slider
  document.getElementById('grain-slider').addEventListener('input', (e) => {
    const v = parseInt(e.target.value, 10);
    state.settings.grainIntensity = v;
    applyGrain(v);
    scheduleSave();
  });

  // Sidebar width
  document.getElementById('sidebar-width-input').addEventListener('change', (e) => {
    const v = parseInt(e.target.value, 10);
    if (v >= 180 && v <= 360) {
      state.settings.sidebarWidth = v;
      applySidebarWidth(v);
      scheduleSave();
    }
  });

  // Win controls
  document.getElementById('wc-close').addEventListener('click', () => window.electronAPI.close());
  document.getElementById('wc-min').addEventListener('click', () => window.electronAPI.minimize());
  document.getElementById('wc-max').addEventListener('click', () => window.electronAPI.maximize());

  // Command bar input
  document.getElementById('command-input').addEventListener('input', (e) => searchCommandBar(e.target.value));

  // Find bar
  document.getElementById('find-input').addEventListener('input', () => doFind(true));
  document.getElementById('find-next').addEventListener('click', () => doFind(true));
  document.getElementById('find-prev').addEventListener('click', () => doFind(false));
  document.getElementById('find-close').addEventListener('click', hideFindBar);

  // Snippet overlay
  document.getElementById('snippet-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); runSnippetSearch(e.target.value); }
    if (e.key === 'Escape') { e.preventDefault(); closeSnippetSearch(); }
  });
  document.getElementById('snippet-overlay').addEventListener('mousedown', (e) => {
    if (e.target === document.getElementById('snippet-overlay')) closeSnippetSearch();
  });

  // Feedback overlay
  document.getElementById('fb-close').addEventListener('click', closeFeedbackModal);
  document.getElementById('fb-submit').addEventListener('click', submitFeedback);
  document.getElementById('feedback-overlay').addEventListener('mousedown', (e) => {
    if (e.target === document.getElementById('feedback-overlay')) closeFeedbackModal();
  });
}

document.addEventListener('DOMContentLoaded', init);
