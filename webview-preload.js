'use strict';

// Inject Chrome API globals so the Chrome Web Store recognises this as Chrome.
// This runs inside every webview before any page scripts.

const CHROME_VER = '124';

// navigator.webdriver — Google uses this to detect automated/embedded browsers
try {
  Object.defineProperty(navigator, 'webdriver', {
    get: () => undefined,
    configurable: true,
  });
} catch (_) {}

// navigator.vendor — checked by the Web Store
try {
  Object.defineProperty(navigator, 'vendor', {
    get: () => 'Google Inc.',
    configurable: true,
  });
} catch (_) {}

// navigator.userAgentData (Client Hints UA) — checked by modern Chrome Web Store
try {
  const brands = [
    { brand: 'Chromium',      version: CHROME_VER },
    { brand: 'Google Chrome', version: CHROME_VER },
    { brand: 'Not-A.Brand',   version: '99' },
  ];
  Object.defineProperty(navigator, 'userAgentData', {
    get: () => ({
      brands,
      mobile: false,
      platform: 'macOS',
      getHighEntropyValues: () => Promise.resolve({
        architecture: 'arm',
        bitness: '64',
        brands,
        fullVersionList: brands.map(b => ({ brand: b.brand, version: `${b.version}.0.0.0` })),
        mobile: false,
        model: '',
        platform: 'macOS',
        platformVersion: '13.0.0',
        uaFullVersion: `${CHROME_VER}.0.0.0`,
        wow64: false,
      }),
      toJSON: () => ({ brands, mobile: false, platform: 'macOS' }),
    }),
    configurable: true,
  });
} catch (_) {}

if (!window.chrome) window.chrome = {};

// CSI — used by Google services to detect genuine Chrome
window.chrome.csi = function() {
  return { startE: Date.now(), onloadT: Date.now(), pageT: 0, tran: 15 };
};

// loadTimes — another Chrome fingerprint
window.chrome.loadTimes = function() {
  return {
    requestTime: Date.now() / 1000,
    startLoadTime: Date.now() / 1000,
    commitLoadTime: Date.now() / 1000,
    finishDocumentLoadTime: 0,
    finishLoadTime: 0,
    firstPaintTime: 0,
    firstPaintAfterLoadTime: 0,
    navigationType: 'Other',
    wasFetchedViaSpdy: true,
    wasNpnNegotiated: true,
    npnNegotiatedProtocol: 'h2',
    wasAlternateProtocolAvailable: false,
    connectionInfo: 'h2',
  };
};

// app — checked by the Web Store to identify Chrome
window.chrome.app = {
  isInstalled: false,
  getDetails: function() { return null; },
  getIsInstalled: function() { return false; },
  installState: function(cb) { if (cb) cb('not_installed'); },
  runningState: function() { return 'cannot_run'; },
};

// runtime stub — many extensions + the store check chrome.runtime
if (!window.chrome.runtime) {
  window.chrome.runtime = {
    id: undefined,
    connect: function() {
      return {
        postMessage: function() {},
        disconnect: function() {},
        onMessage: { addListener: function() {}, removeListener: function() {} },
        onDisconnect: { addListener: function() {}, removeListener: function() {} },
      };
    },
    sendMessage: function() {},
    onMessage:  { addListener: function() {}, removeListener: function() {}, hasListener: function() { return false; } },
    onConnect:  { addListener: function() {}, removeListener: function() {} },
    getManifest: function() { return {}; },
    getURL: function(p) { return p; },
    setUninstallURL: function() {},
    onInstalled: { addListener: function() {} },
    onStartup:   { addListener: function() {} },
  };
}

// webstore shim — the store checks this to confirm it's talking to Chrome
window.chrome.webstore = {
  install: function(_url, _ok, fail) { if (fail) fail('not_permitted_by_policy'); },
  onInstallStageChanged: { addListener: function() {}, removeListener: function() {}, hasListener: function() { return false; } },
  onDownloadProgress:    { addListener: function() {}, removeListener: function() {}, hasListener: function() { return false; } },
};

// Hide Electron-specific globals that pages can probe
try { delete window.process; } catch (_) {}
try { delete window.require; } catch (_) {}
const electronGlobals = Object.keys(window).filter(k => k.startsWith('ELECTRON_'));
for (const g of electronGlobals) {
  try { delete window[g]; } catch (_) {}
}

// Fake a minimal plugins list so navigator.plugins.length > 0
if (navigator.plugins && navigator.plugins.length === 0) {
  try {
    Object.defineProperty(navigator, 'plugins', {
      get: () => ({
        length: 3,
        item: () => null,
        namedItem: () => null,
        refresh: () => {},
      }),
      configurable: true,
    });
  } catch (_) {}
}
