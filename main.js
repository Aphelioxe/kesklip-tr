'use strict';

const { app, BrowserWindow, ipcMain, dialog, screen, shell, Menu, session } = require('electron');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');

const {
  VIDEO_EXTENSIONS,
  AUDIO_EXTENSIONS,
  probeMedia,
  detectHardwareEncoder,
  ensureThumbnail,
  ensureWaveform,
  buildPreviewFile,
  hashForFile,
  killProcessTree,
  ensureDir,
  fileExists,
} = require('./main/media-tools');
const { startMediaServer } = require('./main/media-server');
const { ExportManager } = require('./main/exporter');

app.setName('KesKlip');
if (process.platform === 'win32') app.setAppUserModelId('com.kesklip.app');
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
} else {
  boot();
}

let mainWindow = null;
let mediaServer = null;
let serverToken = '';
let serverBaseUrl = '';
let cacheRoot = '';
let paths = {};
let hardware = { encoder: 'libx264', label: 'CPU (libx264)', hardware: false };
let hardwareReady = Promise.resolve(hardware);
let exportManager = null;
let currentExport = null;
let proxyJobs = new Map();
let isQuitting = false;

function getWindowStatePath() {
  return path.join(app.getPath('userData'), 'window-state.json');
}

function loadWindowState() {
  try {
    const value = JSON.parse(fs.readFileSync(getWindowStatePath(), 'utf8'));
    if (value && Number.isFinite(value.width) && Number.isFinite(value.height)) return value;
  } catch { /* ignore */ }
  return null;
}

function scheduleWindowStateSave(window) {
  let timer = null;
  const save = () => {
    if (!window || window.isDestroyed()) return;
    try {
      const bounds = window.getBounds();
      fs.writeFileSync(
        getWindowStatePath(),
        JSON.stringify({ x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height, maximized: window.isMaximized() }),
        'utf8'
      );
    } catch { /* ignore */ }
  };
  const queue = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(save, 400);
  };
  window.on('resize', queue);
  window.on('move', queue);
  window.on('close', () => {
    if (timer) clearTimeout(timer);
    save();
  });
}

function getCacheRoot() {
  if (process.env.KESKLIP_CACHE_DIR) return path.resolve(process.env.KESKLIP_CACHE_DIR);
  if (process.platform === 'win32' && fs.existsSync('D:\\')) {
    return 'D:\\KesKlip\\cache';
  }
  return path.join(app.getPath('userData'), 'cache');
}

function getDefaultExportDir() {
  const candidates = [];
  if (process.env.KESKLIP_EXPORT_DIR) candidates.push(process.env.KESKLIP_EXPORT_DIR);
  if (process.platform === 'win32' && fs.existsSync('D:\\')) candidates.push('D:\\KesKlip\\exports');
  candidates.push(path.join(app.getPath('videos'), 'KesKlip'));
  return candidates.find((dir) => {
    try {
      fs.mkdirSync(dir, { recursive: true });
      return true;
    } catch {
      return false;
    }
  }) || app.getPath('videos');
}

function createPaths() {
  cacheRoot = getCacheRoot();
  paths = {
    cacheRoot,
    thumbsDir: path.join(cacheRoot, 'thumbs'),
    proxiesDir: path.join(cacheRoot, 'proxies'),
    waveformsDir: path.join(cacheRoot, 'waveforms'),
    tempDir: path.join(cacheRoot, 'temp'),
    logsDir: path.join(cacheRoot, 'logs'),
    exportDir: getDefaultExportDir(),
    autosavePath: path.join(app.getPath('userData'), 'autosave.json'),
  };
  for (const dir of [paths.cacheRoot, paths.thumbsDir, paths.proxiesDir, paths.waveformsDir, paths.tempDir, paths.logsDir]) {
    try { fs.mkdirSync(dir, { recursive: true }); } catch { /* ignore */ }
  }
}

function mediaUrlFor(filePath) {
  if (!filePath) return '';
  const parsed = new URL('/file', serverBaseUrl);
  parsed.searchParams.set('path', filePath);
  parsed.searchParams.set('token', serverToken);
  return parsed.toString();
}

function sendToRenderer(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload);
  }
}

function normalizeError(error) {
  const message = String(error && error.message || error || 'Bilinmeyen hata');
  return message.replace(/^Error:\s*/i, '');
}

function handle(channel, handler) {
  ipcMain.handle(channel, async (event, ...args) => {
    try {
      const result = await handler(event, ...args);
      if (result && typeof result === 'object' && 'ok' in result) return result;
      return { ok: true, ...(result || {}) };
    } catch (error) {
      console.error(`[IPC ${channel}]`, error);
      return { ok: false, error: normalizeError(error) };
    }
  });
}

function sanitizeFileName(value, fallback = 'KesKlip') {
  const clean = String(value || '')
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/g, '');
  return clean || fallback;
}

function uniqueIds(project) {
  const seen = new Set();
  for (const media of project.media || []) {
    if (!media.id) {
      media.id = crypto.randomBytes(8).toString('hex');
    }
    while (seen.has(media.id)) {
      media.id = `${media.id}-${crypto.randomBytes(3).toString('hex')}`;
    }
    seen.add(media.id);
  }
}

async function startProxyJob(media) {
  const id = media.id;
  const outputPath = path.join(paths.proxiesDir, `${id}.mp4`);
  const doneMarker = `${outputPath}.ok`;

  if (media.playbackMode === 'direct') {
    return { status: 'not-needed', outputPath: media.path, mediaId: id };
  }

  if (fileExists(outputPath) && fileExists(doneMarker)) {
    return { status: 'ready', outputPath, mediaId: id };
  }

  if (proxyJobs.has(id)) {
    return { status: 'running', outputPath: null, mediaId: id };
  }

  if (fileExists(outputPath)) {
    try { await fsp.unlink(outputPath); } catch { /* ignore */ }
  }

  const job = { canceled: false, child: null };
  proxyJobs.set(id, job);
  sendToRenderer('proxy:update', {
    mediaId: id,
    status: 'running',
    progress: 0,
    message: media.playbackMode === 'remux' ? 'Önizleme kopyası hazırlanıyor…' : 'Önizleme oluşturuluyor…',
  });

  (async () => {
    try {
      const encoder = await hardwareReady;
      const result = await buildPreviewFile({
        filePath: media.path,
        media,
        outputPath,
        hardware: encoder,
        onProgress: ({ progress, seconds }) => {
          if (job.canceled) return;
          sendToRenderer('proxy:update', {
            mediaId: id,
            status: 'running',
            progress,
            seconds,
            message: media.playbackMode === 'remux' ? 'Önizleme kopyası hazırlanıyor…' : 'Önizleme oluşturuluyor…',
          });
        },
        registerChild: (child) => { job.child = child; },
      });

      if (job.canceled) return;
      if (!result || !result.ok) throw new Error('Önizleme dosyası oluşturulamadı.');
      await fsp.writeFile(doneMarker, new Date().toISOString(), 'utf8');
      sendToRenderer('proxy:update', {
        mediaId: id,
        status: 'done',
        progress: 1,
        outputPath: result.outputPath,
        message: 'Önizleme hazır.',
      });
    } catch (error) {
      if (!job.canceled) {
        sendToRenderer('proxy:update', {
          mediaId: id,
          status: 'error',
          progress: 0,
          message: normalizeError(error),
        });
      }
      try { await fsp.unlink(outputPath); } catch { /* ignore */ }
    } finally {
      proxyJobs.delete(id);
    }
  })();

  return { status: 'starting', outputPath: null, mediaId: id };
}

function cancelProxyJobs() {
  for (const job of proxyJobs.values()) {
    job.canceled = true;
    killProcessTree(job.child);
  }
  proxyJobs.clear();
}

async function createWindow() {
  const saved = loadWindowState();
  const workArea = screen.getPrimaryDisplay().workAreaSize;
  const width = Math.min(saved?.width || 1480, workArea.width - 24);
  const height = Math.min(saved?.height || 920, workArea.height - 24);
  const iconPath = path.join(__dirname, 'build', 'icon.png');

  mainWindow = new BrowserWindow({
    width,
    height,
    x: saved?.x,
    y: saved?.y,
    minWidth: 1120,
    minHeight: 700,
    center: !saved,
    show: false,
    backgroundColor: '#0b0e13',
    title: 'KesKlip',
    icon: fs.existsSync(iconPath) ? iconPath : undefined,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
      spellcheck: false,
    },
  });

  if (saved?.maximized) mainWindow.maximize();
  Menu.setApplicationMenu(null);
  scheduleWindowStateSave(mainWindow);

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith('file://')) {
      event.preventDefault();
      if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    }
  });

  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.type === 'keyDown' && (input.key === 'F12' || (input.control && input.shift && input.key.toLowerCase() === 'i'))) {
      if (!app.isPackaged || process.env.KESKLIP_DEV === '1') {
        mainWindow.webContents.toggleDevTools();
        event.preventDefault();
      }
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  await mainWindow.loadFile(path.join(__dirname, 'src', 'index.html'));
}

async function registerIpc() {
  handle('app:info', async () => {
    const resolvedHardware = await hardwareReady;
    return {
      info: {
        name: 'KesKlip',
        version: app.getVersion(),
        electron: process.versions.electron,
        chrome: process.versions.chrome,
        platform: process.platform,
        arch: process.arch,
        serverUrl: serverBaseUrl,
        token: serverToken,
        cacheRoot,
        exportDir: paths.exportDir,
        hardware: resolvedHardware,
        isPackaged: app.isPackaged,
        paths: {
          desktop: app.getPath('desktop'),
          videos: app.getPath('videos'),
          documents: app.getPath('documents'),
        },
      },
    };
  });

  handle('app:getMediaUrl', async (event, filePath) => ({ url: mediaUrlFor(filePath) }));

  handle('app:openExternal', async (event, url) => {
    if (!/^https?:\/\//i.test(String(url || ''))) throw new Error('Geçersiz bağlantı.');
    await shell.openExternal(url);
    return {};
  });

  handle('media:pick', async (event, options = {}) => {
    const kind = options.kind || 'video';
    const filters = [];
    if (kind === 'video' || kind === 'both') {
      filters.push({ name: 'Video dosyaları', extensions: [...VIDEO_EXTENSIONS].map((ext) => ext.slice(1)) });
    }
    if (kind === 'audio' || kind === 'both') {
      filters.push({ name: 'Ses dosyaları', extensions: [...AUDIO_EXTENSIONS].map((ext) => ext.slice(1)) });
    }
    filters.push({ name: 'Tüm dosyalar', extensions: ['*'] });

    const result = await dialog.showOpenDialog(mainWindow, {
      title: kind === 'audio' ? 'Ses dosyası seç' : 'Video dosyası seç',
      properties: ['openFile', 'multiSelections'],
      filters,
    });
    return { paths: result.canceled ? [] : result.filePaths };
  });

  handle('media:probe', async (event, filePath) => {
    if (!filePath || typeof filePath !== 'string') throw new Error('Dosya seçilmedi.');
    const media = await probeMedia(filePath);
    return { media };
  });

  handle('media:thumbnail', async (event, media) => {
    if (!media || !media.path) throw new Error('Medya bilgisi eksik.');
    if (media.kind === 'audio' || media.isAudioOnly) {
      try {
        const result = await ensureWaveform({ filePath: media.path, waveformsDir: paths.waveformsDir });
        return { waveformPath: result.waveformPath, waveformUrl: mediaUrlFor(result.waveformPath) };
      } catch (error) {
        return { waveformPath: null, error: normalizeError(error) };
      }
    }
    const result = await ensureThumbnail({
      filePath: media.path,
      media,
      thumbsDir: paths.thumbsDir,
    });
    return { thumbPath: result.thumbPath, thumbUrl: mediaUrlFor(result.thumbPath) };
  });

  handle('media:preparePreview', async (event, media) => {
    if (!media || !media.path) throw new Error('Medya bilgisi eksik.');
    if (!fileExists(media.path)) throw new Error(`Dosya bulunamadı: ${media.name || media.path}`);
    const result = await startProxyJob(media);
    return {
      result: {
        ...result,
        previewUrl: result.outputPath ? mediaUrlFor(result.outputPath) : '',
      },
    };
  });

  handle('media:checkPaths', async (event, filePaths) => {
    const list = Array.isArray(filePaths) ? filePaths : [];
    const result = list.map((filePath) => ({ path: filePath, exists: fileExists(filePath) }));
    return { result };
  });

  handle('media:showInFolder', async (event, filePath) => {
    if (!filePath) throw new Error('Dosya yolu eksik.');
    shell.showItemInFolder(filePath);
    return {};
  });

  handle('project:save', async (event, payload = {}) => {
    const data = payload.data;
    if (!data || typeof data !== 'object') throw new Error('Proje verisi eksik.');
    let targetPath = payload.path;
    const saveAs = Boolean(payload.saveAs) || !targetPath;

    if (saveAs) {
      const suggested = `${sanitizeFileName(data.name, 'KesKlip Projesi')}.kesklip`;
      const result = await dialog.showSaveDialog(mainWindow, {
        title: 'KesKlip projesini kaydet',
        defaultPath: targetPath || path.join(app.getPath('documents'), suggested),
        filters: [{ name: 'KesKlip projesi', extensions: ['kesklip'] }],
      });
      if (result.canceled || !result.filePath) return { canceled: true };
      targetPath = result.filePath.endsWith('.kesklip') ? result.filePath : `${result.filePath}.kesklip`;
    }

    await ensureDir(path.dirname(targetPath));
    const serialized = JSON.stringify(data, null, 2);
    const tempPath = `${targetPath}.tmp`;
    await fsp.writeFile(tempPath, serialized, 'utf8');
    await fsp.rename(tempPath, targetPath);
    return { path: targetPath };
  });

  handle('project:open', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'KesKlip projesi aç',
      properties: ['openFile'],
      filters: [{ name: 'KesKlip projesi', extensions: ['kesklip'] }],
    });
    if (result.canceled || !result.filePaths[0]) return { canceled: true };
    const projectPath = result.filePaths[0];
    const text = await fsp.readFile(projectPath, 'utf8');
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error('Proje dosyası bozuk görünüyor.');
    }
    if (!data || !Array.isArray(data.clips)) throw new Error('Bu dosya geçerli bir KesKlip projesi değil.');
    return { path: projectPath, data };
  });

  handle('project:autosave', async (event, data) => {
    if (!data || typeof data !== 'object') return {};
    await ensureDir(path.dirname(paths.autosavePath));
    const tempPath = `${paths.autosavePath}.tmp`;
    await fsp.writeFile(tempPath, JSON.stringify({ savedAt: Date.now(), data }, null, 2), 'utf8');
    await fsp.rename(tempPath, paths.autosavePath);
    return {};
  });

  handle('project:getAutosave', async () => {
    try {
      const text = await fsp.readFile(paths.autosavePath, 'utf8');
      const parsed = JSON.parse(text);
      if (!parsed || !parsed.data || !Array.isArray(parsed.data.clips)) return { autosave: null };
      return { autosave: parsed };
    } catch {
      return { autosave: null };
    }
  });

  handle('project:clearAutosave', async () => {
    try { await fsp.unlink(paths.autosavePath); } catch { /* ignore */ }
    return {};
  });

  handle('export:choosePath', async (event, options = {}) => {
    const baseName = sanitizeFileName(options.name || 'KesKlip videosu', 'KesKlip videosu');
    const stamp = new Date();
    const suffix = `${stamp.getFullYear()}-${String(stamp.getMonth() + 1).padStart(2, '0')}-${String(stamp.getDate()).padStart(2, '0')}_${String(stamp.getHours()).padStart(2, '0')}-${String(stamp.getMinutes()).padStart(2, '0')}`;
    const defaultPath = options.currentPath || path.join(paths.exportDir, `${baseName}_${suffix}.mp4`);
    const result = await dialog.showSaveDialog(mainWindow, {
      title: 'Videoyu dışa aktar',
      defaultPath,
      filters: [{ name: 'MP4 video', extensions: ['mp4'] }],
      properties: ['createDirectory', 'showOverwriteConfirmation'],
    });
    if (result.canceled || !result.filePath) return { canceled: true };
    const filePath = result.filePath.toLowerCase().endsWith('.mp4') ? result.filePath : `${result.filePath}.mp4`;
    return { path: filePath };
  });

  handle('export:start', async (event, payload = {}) => {
    if (!payload.project || !payload.outputPath) throw new Error('Dışa aktarma bilgileri eksik.');
    if (currentExport) throw new Error('Başka bir dışa aktarma zaten sürüyor.');
    const resolvedHardware = await hardwareReady;
    if (!exportManager) exportManager = new ExportManager({ cacheRoot, hardware: resolvedHardware });
    exportManager.hardware = resolvedHardware;
    currentExport = exportManager;
    try {
      const result = await exportManager.exportProject({
        project: payload.project,
        outputPath: payload.outputPath,
        options: payload.options || {},
        onProgress: (progress) => {
          sendToRenderer('export:progress', { ...progress, running: true });
        },
        onStarted: (started) => {
          sendToRenderer('export:started', started);
        },
      });
      sendToRenderer('export:progress', { progress: result.ok ? 1 : 0, running: false, result });
      return { result };
    } finally {
      currentExport = null;
    }
  });

  handle('export:cancel', async () => {
    if (exportManager) exportManager.cancel();
    return {};
  });

  handle('shell:openPath', async (event, filePath) => {
    if (!filePath) throw new Error('Dosya yolu eksik.');
    const result = await shell.openPath(filePath);
    if (result) throw new Error(result);
    return {};
  });

  handle('shell:showItemInFolder', async (event, filePath) => {
    if (!filePath) throw new Error('Dosya yolu eksik.');
    shell.showItemInFolder(filePath);
    return {};
  });
}

async function boot() {
  if (!gotSingleInstanceLock) return;

  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(async () => {
    try {
      createPaths();
      serverToken = crypto.randomBytes(24).toString('hex');
      mediaServer = await startMediaServer({ token: serverToken });
      serverBaseUrl = mediaServer.baseUrl;
      hardwareReady = detectHardwareEncoder()
        .then((result) => {
          hardware = result;
          return result;
        })
        .catch(() => hardware);

      await registerIpc();
      await createWindow();

      session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
        callback(permission === 'media' ? false : false);
      });

      app.on('activate', async () => {
        if (BrowserWindow.getAllWindows().length === 0) await createWindow();
      });
    } catch (error) {
      console.error('KesKlip başlatılamadı:', error);
      dialog.showErrorBox(
        'KesKlip başlatılamadı',
        `${normalizeError(error)}\n\nLütfen uygulamayı yeniden başlatmayı deneyin.`
      );
      app.quit();
    }
  });

  app.on('before-quit', () => {
    isQuitting = true;
    cancelProxyJobs();
    if (exportManager) exportManager.cancel();
    if (mediaServer && mediaServer.server) {
      try { mediaServer.server.close(); } catch { /* ignore */ }
    }
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
