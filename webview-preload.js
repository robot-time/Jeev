'use strict';

// Inject Chrome API globals so the Chrome Web Store recognises this as Chrome.
// This runs inside every webview before any page scripts.

const CHROME_VER = '136';
// Derive platform from the actual UA so it stays consistent with sec-ch-ua-platform
const _uaPlatform = /Windows/.test(navigator.userAgent) ? 'Windows' : /Linux/.test(navigator.userAgent) ? 'Linux' : 'macOS';

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
      platform: _uaPlatform,
      getHighEntropyValues: () => Promise.resolve({
        architecture: _uaPlatform === 'Windows' ? 'x86' : 'arm',
        bitness: '64',
        brands,
        fullVersionList: brands.map(b => ({ brand: b.brand, version: `${b.version}.0.0.0` })),
        mobile: false,
        model: '',
        platform: _uaPlatform,
        platformVersion: '13.0.0',
        uaFullVersion: `${CHROME_VER}.0.0.0`,
        wow64: false,
      }),
      toJSON: () => ({ brands, mobile: false, platform: _uaPlatform }),
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
  install: function(url, ok, fail) {
    // Extract extension ID from the store URL
    const m = (url || '').match(/\/([a-z]{32})(?:[/?]|$)/);
    const id = m && m[1];
    if (!id) { if (fail) fail('invalid_id'); return; }
    const { ipcRenderer } = require('electron');
    ipcRenderer.sendToHost('install-crx-by-id', id);
    if (ok) ok();
  },
  onInstallStageChanged: { addListener: function() {}, removeListener: function() {}, hasListener: function() { return false; } },
  onDownloadProgress:    { addListener: function() {}, removeListener: function() {}, hasListener: function() { return false; } },
};

// webstorePrivate — private API the Web Store install button actually calls
let _pendingCrxId = null;
window.chrome.webstorePrivate = {
  beginInstallWithManifest3: function(details, cb) {
    _pendingCrxId = details && details.id;
    if (cb) cb('');  // '' = success
  },
  completeInstall: function(expectedId, cb) {
    const id = expectedId || _pendingCrxId;
    _pendingCrxId = null;
    if (!id) { if (cb) cb('missing_id'); return; }
    const { ipcRenderer } = require('electron');
    ipcRenderer.sendToHost('install-crx-by-id', id);
    if (cb) cb('');
  },
  isInIncognitoMode: function(cb) { if (cb) cb(false); },
  getStoreLogin: function(cb) { if (cb) cb(''); },
  setStoreLogin: function(_l, cb) { if (cb) cb(); },
  getBrowserLogin: function(cb) { if (cb) cb({ login: '' }); },
  getWebGLStatus: function(cb) { if (cb) cb({ webgl_status: 'webgl_allowed' }); },
  getIsLauncherEnabled: function(cb) { if (cb) cb(false); },
  isAutoConfirmCode: function(cb) { if (cb) cb(false); },
  getExtensionStatus: function(_id, _manifest, cb) { if (cb) cb('installable'); },
  // result: 2 = CAN_REQUEST_INSTALL (the store shows the install button)
  getAvailability: function(_id, _ver, _type, _op, cb) { if (cb) cb({ result: 2 }); },
  getProfileInfo: function(cb) { if (cb) cb({}); },
  getEphemeralAppsEnabled: function(cb) { if (cb) cb(false); },
  installBundle: function(_details, cb) { if (cb) cb(null, []); },
  onInstallStageChanged: { addListener: function() {}, removeListener: function() {} },
  onDownloadProgress: { addListener: function() {}, removeListener: function() {} },
};

// Make key webstorePrivate methods appear as native bindings (toString check)
const _nativeToString = function() { return 'function () { [native code] }'; };
['beginInstallWithManifest3', 'completeInstall', 'getAvailability', 'getExtensionStatus'].forEach(fn => {
  if (window.chrome.webstorePrivate[fn]) {
    window.chrome.webstorePrivate[fn].toString = _nativeToString;
  }
});

// chrome.management — required by modern Web Store to check installability
window.chrome.management = {
  getAll: function(cb) { if (cb) cb([]); return Promise.resolve([]); },
  get: function(_id, cb) { if (cb) cb(null); return Promise.resolve(null); },
  getPermissionWarningsById: function(_id, cb) { if (cb) cb([]); },
  setEnabled: function(_id, _enabled, cb) { if (cb) cb(); },
  uninstall: function(_id, _opts, cb) { if (cb) cb(); },
  onInstalled: { addListener: function() {}, removeListener: function() {}, hasListener: function() { return false; } },
  onUninstalled: { addListener: function() {}, removeListener: function() {}, hasListener: function() { return false; } },
  onEnabled: { addListener: function() {}, removeListener: function() {}, hasListener: function() { return false; } },
  onDisabled: { addListener: function() {}, removeListener: function() {}, hasListener: function() { return false; } },
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
