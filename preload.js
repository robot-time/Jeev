const { contextBridge, ipcRenderer } = require('electron');

let Sentry = null;
let sentryDsn = '';
try {
  Sentry = require('@sentry/electron/renderer');
  sentryDsn = process.env.SENTRY_DSN || '';
  if (sentryDsn) {
    Sentry.init();
  }
} catch (err) {
  console.error('[preload] Sentry init failed:', err);
}

function dataUrlToUint8Array(dataUrl) {
  const base64 = dataUrl.split(',')[1];
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

contextBridge.exposeInMainWorld('electronAPI', {
  minimize: () => ipcRenderer.invoke('window-minimize'),
  maximize: () => ipcRenderer.invoke('window-maximize'),
  close: () => ipcRenderer.invoke('window-close'),
  isMac: () => ipcRenderer.invoke('is-mac'),

  readFile: (filename) => ipcRenderer.invoke('read-file', filename),
  writeFile: (filename, content) => ipcRenderer.invoke('write-file', filename, content),

  getExtensions: () => ipcRenderer.invoke('get-extensions'),
  installExtension: () => ipcRenderer.invoke('install-extension'),
  removeExtension: (id) => ipcRenderer.invoke('remove-extension', id),

  openExternal: (url) => ipcRenderer.invoke('open-external', url),
  googleSignIn: () => ipcRenderer.invoke('google-signin'),

  onDownloadProgress: (cb) => ipcRenderer.on('download-progress', (_e, data) => cb(data)),
  offDownloadProgress: () => ipcRenderer.removeAllListeners('download-progress'),

  onUpdateReady: (cb) => ipcRenderer.on('update-ready', (_e, info) => cb(info)),
  installUpdate: () => ipcRenderer.invoke('install-update'),

  captureScreenshot: () => ipcRenderer.invoke('capture-screenshot'),
  getSentryDsn: () => ipcRenderer.invoke('get-sentry-dsn'),

  captureFeedback: (message, name, email, screenshotDataUrl) => {
    if (!Sentry || !sentryDsn) return null;
    const hint = {};
    if (screenshotDataUrl) {
      hint.attachments = [{
        filename: 'screenshot.png',
        data: dataUrlToUint8Array(screenshotDataUrl),
        contentType: 'image/png',
      }];
    }
    return Sentry.captureFeedback({ name, email, message, url: window.location.href }, hint);
  },
});
