const { app, BrowserWindow, ipcMain, session, dialog, shell, Menu, MenuItem } = require('electron');
const { autoUpdater } = require('electron-updater');

require('dotenv').config({ path: require('path').join(__dirname, '.env') });

let Sentry = null;
try {
  Sentry = require('@sentry/electron/main');
} catch (err) {
  console.error('[main] Failed to load @sentry/electron/main:', err.message);
}

if (Sentry && process.env.SENTRY_DSN) {
  try {
    Sentry.init({
      dsn: process.env.SENTRY_DSN,
      release: app.getVersion(),
      environment: process.env.NODE_ENV || 'development',
    });
  } catch (err) {
    console.error('[main] Sentry.init failed:', err.message);
  }
}

// Chromium feature flags — must be set before app.whenReady()
app.commandLine.appendSwitch('enable-features', [
  'WebAuthenticationPasskeys',
  'WebAuthenticationConditionalUI',
  'FedCm',
].join(','));
// Disable flags that expose Electron identity to sites
app.commandLine.appendSwitch('disable-features', 'ElectronAutoUpdater');

// Must be set before app is ready so macOS menu bar and dock show "Jeev"
app.name = 'Jeev';
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

let mainWindow;
let serverProcess;

const CHROME_UA = process.platform === 'win32'
  ? 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36'
  : 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36';

const CH_UA_PLATFORM = process.platform === 'win32' ? '"Windows"' : process.platform === 'linux' ? '"Linux"' : '"macOS"';

const userDataPath = app.getPath('userData');
const extensionsPath = path.join(userDataPath, 'extensions');

if (!fs.existsSync(extensionsPath)) fs.mkdirSync(extensionsPath, { recursive: true });

// All webviews use this named session so extensions apply to them
const MAIN_SESSION = 'persist:main';

function startServer() {
  const serverPath = path.join(__dirname, 'server.js');
  serverProcess = spawn(process.execPath, [serverPath], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  serverProcess.stdout.on('data', d => process.stdout.write('[server] ' + d));
  serverProcess.stderr.on('data', d => process.stderr.write('[server] ' + d));
  serverProcess.on('error', err => console.error('Server failed:', err));
}

async function loadExtensions() {
  if (!fs.existsSync(extensionsPath)) return;
  const dirs = fs.readdirSync(extensionsPath, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => path.join(extensionsPath, d.name));
  for (const dir of dirs) {
    try {
      await session.fromPartition(MAIN_SESSION).loadExtension(dir, { allowFileAccess: true });
      console.log('Loaded extension:', dir);
    } catch (e) {
      console.error('Extension load failed:', dir, e.message);
    }
  }
}

function createWindow() {
  const isMac = process.platform === 'darwin';

  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    frame: isMac,
    titleBarStyle: isMac ? 'hiddenInset' : undefined,
    backgroundColor: '#0d0d0d',
    webPreferences: {
      webviewTag: true,
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.js'),
      webSecurity: true,
      spellcheck: true,
    },
  });

  session.fromPartition(MAIN_SESSION).setUserAgent(CHROME_UA);
  session.fromPartition(MAIN_SESSION).setSpellCheckerEnabled(true);
  session.fromPartition(MAIN_SESSION).setSpellCheckerLanguages(['en-AU']);

  // Inject sec-ch-ua client hints so the Web Store sees a real Chrome fingerprint
  session.fromPartition(MAIN_SESSION).webRequest.onBeforeSendHeaders((details, callback) => {
    const h = details.requestHeaders;
    h['sec-ch-ua'] = '"Chromium";v="136", "Google Chrome";v="136", "Not-A.Brand";v="99"';
    h['sec-ch-ua-mobile'] = '?0';
    h['sec-ch-ua-platform'] = CH_UA_PLATFORM;
    callback({ requestHeaders: h });
  });

  // Permission handler with persistent memory
  const permissionsFile = path.join(userDataPath, 'permissions.json');
  let permissionCache = {};
  try { permissionCache = JSON.parse(fs.readFileSync(permissionsFile, 'utf8')); } catch { }

  const savePermissions = () => {
    try { fs.writeFileSync(permissionsFile, JSON.stringify(permissionCache)); } catch { }
  };

  const PERMISSION_LABELS = {
    media: 'Camera & Microphone',
    geolocation: 'Location',
    notifications: 'Notifications',
    clipboard: 'Clipboard',
    display: 'Screen Capture',
    midi: 'MIDI Devices',
    pointerLock: 'Pointer Lock',
  };

  session.fromPartition(MAIN_SESSION).setPermissionRequestHandler((webContents, permission, callback) => {
    const label = PERMISSION_LABELS[permission] || permission;
    const url = webContents.getURL();
    const origin = (() => { try { return new URL(url).hostname; } catch { return url; } })();
    const key = `${origin}::${permission}`;

    // Use remembered decision if we have one
    if (key in permissionCache) {
      return callback(permissionCache[key]);
    }

    dialog.showMessageBox(mainWindow, {
      type: 'question',
      buttons: ['Allow', 'Deny'],
      defaultId: 0,
      title: 'Permission Request',
      message: `${origin} wants to access: ${label}`,
      checkboxLabel: 'Remember for this site',
      checkboxChecked: true,
    }).then(({ response, checkboxChecked }) => {
      const allowed = response === 0;
      if (checkboxChecked) {
        permissionCache[key] = allowed;
        savePermissions();
      }
      callback(allowed);
    });
  });

  // Download handler
  session.fromPartition(MAIN_SESSION).on('will-download', (event, item) => {
    const downloadsPath = app.getPath('downloads');
    const filePath = path.join(downloadsPath, item.getFilename());
    item.setSavePath(filePath);

    const downloadId = Date.now().toString();
    mainWindow.webContents.send('download-progress', {
      id: downloadId,
      filename: item.getFilename(),
      state: 'started',
      percent: 0,
    });

    item.on('updated', (_e, state) => {
      if (state === 'progressing') {
        const received = item.getReceivedBytes();
        const total = item.getTotalBytes();
        const percent = total > 0 ? Math.round((received / total) * 100) : -1;
        mainWindow.webContents.send('download-progress', {
          id: downloadId,
          filename: item.getFilename(),
          state: 'progressing',
          percent,
        });
      }
    });

    item.once('done', (_e, state) => {
      mainWindow.webContents.send('download-progress', {
        id: downloadId,
        filename: item.getFilename(),
        state,
        path: filePath,
        percent: 100,
      });
    });
  });

  mainWindow.loadFile('renderer.html');

  // Window controls
  ipcMain.handle('window-minimize', () => mainWindow.minimize());
  ipcMain.handle('window-maximize', () => {
    if (mainWindow.isMaximized()) mainWindow.unmaximize();
    else mainWindow.maximize();
  });
  ipcMain.handle('window-close', () => mainWindow.close());
  ipcMain.handle('is-mac', () => isMac);

  // Persistence
  ipcMain.handle('read-file', (_, filename) => {
    const fp = path.join(userDataPath, filename);
    if (!fs.existsSync(fp)) return null;
    return fs.readFileSync(fp, 'utf8');
  });
  ipcMain.handle('write-file', (_, filename, content) => {
    const fp = path.join(userDataPath, filename);
    fs.writeFileSync(fp, content, 'utf8');
    return true;
  });

  // Extensions
  ipcMain.handle('get-extensions', () => {
    const exts = session.fromPartition(MAIN_SESSION).getAllExtensions();
    return Object.values(exts).map(e => ({
      id: e.id,
      name: e.name,
      version: e.version,
      path: e.path,
    }));
  });

  ipcMain.handle('capture-screenshot', async () => {
    if (!mainWindow) return null;
    const image = await mainWindow.webContents.capturePage();
    return image.toDataURL();
  });

  ipcMain.handle('get-sentry-dsn', () => process.env.SENTRY_DSN || null);

  ipcMain.handle('test-update-popup', (_, version) => {
    mainWindow.webContents.send('update-ready', { version });
  });

  ipcMain.handle('install-crx-by-id', async (_, extensionId) => {
    const fetch = require('node-fetch');
    const { execSync } = require('child_process');
    const os = require('os');

    const crxUrl = `https://clients2.google.com/service/update2/crx?response=redirect&prodversion=136.0.0.0&x=id%3D${extensionId}%26uc%26installsource%3Dondemand&acceptformat=crx3,crx2`;

    try {
      const resp = await fetch(crxUrl, {
        headers: { 'User-Agent': CHROME_UA },
        redirect: 'follow',
      });
      if (!resp.ok) return { error: `Download failed: ${resp.status}` };

      const crxBuffer = Buffer.from(await resp.buffer());

      // Parse CRX header to locate the embedded ZIP
      const magic = crxBuffer.slice(0, 4).toString('ascii');
      if (magic !== 'Cr24') return { error: 'Not a valid CRX file' };

      const version = crxBuffer.readUInt32LE(4);
      let zipOffset;
      if (version === 3) {
        zipOffset = 12 + crxBuffer.readUInt32LE(8);
      } else if (version === 2) {
        zipOffset = 16 + crxBuffer.readUInt32LE(8) + crxBuffer.readUInt32LE(12);
      } else {
        return { error: `Unknown CRX version: ${version}` };
      }

      const zipBuffer = crxBuffer.slice(zipOffset);
      const tmpZip = path.join(os.tmpdir(), `jeev-ext-${extensionId}.zip`);
      const extDir = path.join(extensionsPath, extensionId);

      fs.writeFileSync(tmpZip, zipBuffer);
      if (fs.existsSync(extDir)) fs.rmSync(extDir, { recursive: true, force: true });
      fs.mkdirSync(extDir, { recursive: true });

      if (process.platform === 'win32') {
        execSync(`powershell -command "Expand-Archive -LiteralPath '${tmpZip}' -DestinationPath '${extDir}' -Force"`, { timeout: 30000 });
      } else {
        execSync(`unzip -o "${tmpZip}" -d "${extDir}"`, { timeout: 30000 });
      }
      try { fs.unlinkSync(tmpZip); } catch (_) {}

      const ext = await session.fromPartition(MAIN_SESSION).loadExtension(extDir, { allowFileAccess: true });
      if (mainWindow) mainWindow.webContents.send('extension-installed', { name: ext.name });
      return { success: true, name: ext.name };
    } catch (e) {
      console.error('[crx-install]', e.message);
      return { error: e.message };
    }
  });

  ipcMain.handle('install-extension', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Select Unpacked Extension Folder',
      properties: ['openDirectory'],
    });
    if (result.canceled || !result.filePaths.length) return { error: 'cancelled' };
    const src = result.filePaths[0];
    const name = path.basename(src);
    const dest = path.join(extensionsPath, name);
    try {
      fs.cpSync(src, dest, { recursive: true });
      const ext = await session.fromPartition(MAIN_SESSION).loadExtension(dest, { allowFileAccess: true });
      return { success: true, extension: { id: ext.id, name: ext.name, version: ext.version } };
    } catch (e) {
      return { error: e.message };
    }
  });

  ipcMain.handle('remove-extension', async (_, id) => {
    try {
      await session.fromPartition(MAIN_SESSION).removeExtension(id);
      return true;
    } catch (e) {
      return false;
    }
  });

  ipcMain.handle('open-external', (_, url) => shell.openExternal(url));

  // Open a dedicated native window for Google sign-in that shares persist:main cookies.
  // Because it's a BrowserWindow (not an embedded webview) it's far less likely to be
  // blocked by Google's embedded-browser detection, and any cookies it acquires are
  // immediately visible to all webviews that use the same session partition.
  let signInWindow = null;
  ipcMain.handle('google-signin', () => new Promise((resolve) => {
    if (signInWindow && !signInWindow.isDestroyed()) {
      signInWindow.focus();
      resolve(false);
      return;
    }
    signInWindow = new BrowserWindow({
      width: 500,
      height: 700,
      title: 'Sign in to Google',
      parent: mainWindow,
      modal: false,
      webPreferences: {
        contextIsolation: false, // lets preload inject window.chrome shims
        nodeIntegration: false,
        session: session.fromPartition(MAIN_SESSION),
        preload: path.join(__dirname, 'webview-preload.js'),
      },
    });
    signInWindow.webContents.setUserAgent(CHROME_UA);
    signInWindow.loadURL('https://accounts.google.com/ServiceLogin?continue=https://www.google.com/');

    // Once Google redirects back to google.com the user has signed in
    signInWindow.webContents.on('did-navigate', (_, url) => {
      if (/^https:\/\/(www\.)?google\.com\/?(\?|$)/i.test(url)) {
        setTimeout(() => { if (signInWindow && !signInWindow.isDestroyed()) signInWindow.close(); }, 800);
        resolve(true);
      }
    });
    signInWindow.on('closed', () => { signInWindow = null; resolve(false); });
  }));

  mainWindow.on('closed', () => { mainWindow = null; });
}

// ===================== AUTO-UPDATER =====================
autoUpdater.autoDownload = true;          // download silently in background
autoUpdater.autoInstallOnAppQuit = false; // we show a prompt before installing

autoUpdater.on('update-downloaded', (info) => {
  if (mainWindow) {
    mainWindow.webContents.send('update-ready', { version: info.version });
  }
});

autoUpdater.on('error', (err) => {
  console.log('[updater] error:', err.message);
});

ipcMain.on('install-update', () => {
  if (process.platform === 'darwin') {
    // electron-updater's built-in relaunch is unreliable on macOS;
    // schedule our own relaunch first, then let quitAndInstall quit.
    app.relaunch();
    autoUpdater.quitAndInstall(true, false);
  } else {
    autoUpdater.quitAndInstall(false, true);
  }
});

app.whenReady().then(async () => {
  startServer();
  await new Promise(r => setTimeout(r, 600));
  await loadExtensions();
  createWindow();

  // Check for updates 8 s after launch, then every 4 h.
  // autoUpdater is a no-op in dev mode (electron . / not packaged).
  if (app.isPackaged) {
    setTimeout(() => autoUpdater.checkForUpdates().catch(() => {}), 8000);
    setInterval(() => autoUpdater.checkForUpdates().catch(() => {}), 4 * 60 * 60 * 1000);
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  if (serverProcess) serverProcess.kill();
});
