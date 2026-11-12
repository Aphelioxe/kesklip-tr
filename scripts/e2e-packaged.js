'use strict';

const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const ffmpegPath = require('ffmpeg-static');
const ffprobePath = require('ffprobe-static').path;

const root = path.join(__dirname, '..');
const unpackedExe = path.join(root, 'dist', 'win-unpacked', 'KesKlip.exe');
const installedExe = 'D:\\KesKlip\\app\\KesKlip.exe';
const exePath = process.env.KESKLIP_EXE || (fs.existsSync(unpackedExe) ? unpackedExe : installedExe);
const useDefaults = process.env.KESKLIP_TEST_DEFAULTS === '1';
const port = 9335;
const tmpRoot = path.join(os.tmpdir(), 'kesklip-e2e-packaged');
const userDataDir = path.join(tmpRoot, 'userdata');
const cacheDir = path.join(tmpRoot, 'cache');
const exportDir = path.join(tmpRoot, 'exports');
const outPath = path.join(exportDir, 'packaged-export.mp4');
const sample1 = path.join(os.tmpdir(), 'kesklip-smoke', 'sample1.mp4');

for (const dir of [userDataDir, cacheDir, exportDir]) {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
}
if (!fs.existsSync(exePath)) throw new Error(`Paketlenmiş uygulama yok: ${exePath}`);
if (!fs.existsSync(sample1)) throw new Error(`Test medyası yok: ${sample1}`);

const launchStarted = Date.now();
const child = spawn(exePath, [`--remote-debugging-port=${port}`, `--user-data-dir=${userDataDir}`], {
  cwd: path.dirname(exePath),
  env: {
    ...process.env,
    ...(useDefaults ? {} : { KESKLIP_CACHE_DIR: cacheDir, KESKLIP_EXPORT_DIR: exportDir }),
  },
  stdio: ['ignore', 'pipe', 'pipe'],
  windowsHide: false,
});

let stdout = '';
let stderr = '';
child.stdout.on('data', (chunk) => { stdout += chunk.toString('utf8'); });
child.stderr.on('data', (chunk) => { stderr += chunk.toString('utf8'); });

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function log(name, data) {
  console.log(name, JSON.stringify(data));
}

async function findTarget() {
  const deadline = Date.now() + 180000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`);
      if (response.ok) {
        const list = await response.json();
        const page = list.find((entry) => entry.type === 'page' && entry.webSocketDebuggerUrl);
        if (page) return page;
      }
    } catch { /* not ready */ }
    await sleep(400);
  }
  throw new Error('Paketlenmiş uygulama hata ayıklama portu açılmadı.');
}

class CDP {
  constructor(url) {
    this.ws = new WebSocket(url);
    this.nextId = 1;
    this.pending = new Map();
    this.events = [];
    this.ws.onmessage = (event) => {
      const payload = JSON.parse(event.data);
      if (payload.id) {
        const pending = this.pending.get(payload.id);
        if (!pending) return;
        this.pending.delete(payload.id);
        if (payload.error) pending.reject(new Error(payload.error.message));
        else pending.resolve(payload.result);
      } else {
        this.events.push(payload);
      }
    };
  }

  async open() {
    await new Promise((resolve, reject) => {
      this.ws.onopen = resolve;
      this.ws.onerror = () => reject(new Error('CDP bağlantısı kurulamadı.'));
    });
  }

  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = this.nextId++;
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate(expression, timeout = 120000) {
    let timer = null;
    const timeoutPromise = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`Değerlendirme zaman aşımı: ${expression.slice(0, 120)}`)), timeout);
    });
    try {
      const result = await Promise.race([
        this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true }),
        timeoutPromise,
      ]);
      if (result.exceptionDetails) {
        const text = result.exceptionDetails.exception && result.exceptionDetails.exception.description;
        throw new Error(text || result.exceptionDetails.text || 'Değerlendirme hatası');
      }
      return result.result ? result.result.value : undefined;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  close() {
    try { this.ws.close(); } catch { /* ignore */ }
  }
}

function collectErrors(cdp) {
  const errors = [];
  for (const event of cdp.events) {
    if (event.method === 'Runtime.exceptionThrown') {
      const details = event.params.exceptionDetails;
      errors.push(details.exception && details.exception.description || details.text || 'exception');
    }
    if (event.method === 'Log.entryAdded' && event.params.entry.level === 'error') {
      errors.push(event.params.entry.text);
    }
    if (event.method === 'Runtime.consoleAPICalled' && event.params.type === 'error') {
      errors.push(event.params.args.map((arg) => arg.value || arg.description || '').join(' '));
    }
  }
  return errors;
}

async function waitFor(cdp, expression, description, timeout = 45000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const value = await cdp.evaluate(expression, 15000);
    if (value) return value;
    await sleep(350);
  }
  throw new Error(`Bekleme zaman aşımı: ${description}`);
}

function probe(filePath) {
  const info = JSON.parse(execFileSync(ffprobePath, [
    '-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', filePath,
  ], { encoding: 'utf8', windowsHide: true }));
  return {
    duration: Number(info.format.duration),
    size: Number(info.format.size),
    streams: info.streams.map((stream) => ({ type: stream.codec_type, codec: stream.codec_name, width: stream.width, height: stream.height })),
  };
}

async function main() {
  const target = await findTarget();
  const cdp = new CDP(target.webSocketDebuggerUrl);
  await cdp.open();
  await cdp.send('Runtime.enable');
  await cdp.send('Log.enable');
  await cdp.send('Page.enable');

  const boot = await waitFor(
    cdp,
    `(() => { const s = window.__kesklip && window.__kesklip.state; const splash = document.querySelector('#splash'); return s && s.info && splash && splash.classList.contains('is-hidden') ? { title: document.title, packaged: s.info.isPackaged, cacheRoot: s.info.cacheRoot, exportDir: s.info.exportDir, encoder: s.info.hardware.label, errors: s.lastErrors || [] } : null; })()`,
    'paketlenmiş uygulama açılışı'
  );
  boot.launchMs = Date.now() - launchStarted;
  log('PACKAGED_BOOT', boot);
  if (!boot.packaged) throw new Error('Uygulama paketlenmiş modda çalışmıyor.');
  if (useDefaults) {
    if (!String(boot.cacheRoot).toUpperCase().startsWith('D:\\KESKLIP')) throw new Error(`Varsayılan önbellek klasörü yanlış: ${boot.cacheRoot}`);
    if (!String(boot.exportDir).toUpperCase().startsWith('D:\\KESKLIP')) throw new Error(`Varsayılan dışa aktarma klasörü yanlış: ${boot.exportDir}`);
  } else {
    if (boot.cacheRoot !== cacheDir) throw new Error(`Önbellek klasörü yanlış: ${boot.cacheRoot}`);
    if (boot.exportDir !== exportDir) throw new Error(`Dışa aktarma klasörü yanlış: ${boot.exportDir}`);
  }

  const importResult = await cdp.evaluate(
    `(async () => {
      await window.__kesklip.importPaths(${JSON.stringify([sample1])});
      await new Promise((resolve) => setTimeout(resolve, 1200));
      const s = window.__kesklip.state;
      const video = document.querySelector('#previewStage video');
      const clip = document.querySelector('#videoTrack .timeline-clip');
      return {
        media: s.project.media.length,
        clips: s.project.clips.length,
        duration: window.__kesklip.projectDuration(),
        previewUrls: s.previewUrls.size,
        thumbUrls: s.thumbUrls.size,
        playbackMode: s.project.media[0] ? s.project.media[0].playbackMode : '',
        videoReady: video ? video.readyState : 0,
        clipWidth: clip ? Math.round(clip.getBoundingClientRect().width) : 0,
        errors: s.lastErrors || [],
      };
    })()`,
    90000
  );
  log('PACKAGED_IMPORT', importResult);
  if (importResult.media !== 1 || importResult.clips !== 1) throw new Error('Paketlenmiş uygulamada içe aktarma başarısız.');
  if (importResult.previewUrls < 1 || importResult.thumbUrls < 1) throw new Error('Paketlenmiş uygulamada önizleme/küçük görsel üretilemedi.');
  if (!(importResult.clipWidth > 200)) throw new Error(`Zaman çizelgesi klibi çizilmedi: ${importResult.clipWidth}`);

  await cdp.evaluate('window.__kesklip.seekTo(1.5)');
  await sleep(1500);
  const preview = await cdp.evaluate(
    `(() => {
      const s = window.__kesklip.state;
      const video = document.querySelector('#previewStage video');
      if (!video) return { error: 'video yok' };
      const canvas = document.createElement('canvas');
      canvas.width = 160;
      canvas.height = 90;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const data = ctx.getImageData(60, 30, 40, 30).data;
      let sum = 0;
      for (let i = 0; i < data.length; i += 4) sum += data[i] + data[i + 1] + data[i + 2];
      return {
        currentTime: video.currentTime,
        readyState: video.readyState,
        videoWidth: video.videoWidth,
        brightness: Math.round(sum / (data.length / 4) / 3),
        errors: s.lastErrors || [],
      };
    })()`
  );
  log('PACKAGED_PREVIEW', preview);
  if (!(preview.readyState >= 2) || !(preview.videoWidth > 0)) throw new Error('Paketlenmiş uygulamada önizleme yüklenmedi.');
  if (!(preview.brightness > 8)) throw new Error(`Paketlenmiş uygulamada önizleme karesi siyah: ${preview.brightness}`);

  const duration = await cdp.evaluate('window.__kesklip.projectDuration()');
  const exportResult = await cdp.evaluate(
    `(async () => {
      const s = window.__kesklip.state;
      const project = JSON.parse(JSON.stringify(s.project));
      return window.kesklip.startExport({ project, outputPath: ${JSON.stringify(outPath)}, options: { quality: 'fast' } });
    })()`,
    300000
  );
  log('PACKAGED_EXPORT', exportResult);
  if (!fs.existsSync(outPath)) throw new Error('Paketlenmiş uygulamada dışa aktarma dosyası yok.');
  const info = probe(outPath);
  log('PACKAGED_EXPORT_PROBE', { expectedDuration: duration, ...info });
  if (Math.abs(info.duration - duration) > 0.25) throw new Error(`Dışa aktarma süresi uyuşmuyor: ${info.duration} / ${duration}`);
  if (!info.streams.some((stream) => stream.type === 'video') || !info.streams.some((stream) => stream.type === 'audio')) {
    throw new Error('Dışa aktarmada ses/video akışı eksik.');
  }

  const pageShot = await cdp.send('Page.captureScreenshot', { format: 'png' });
  const shotPath = path.join(tmpRoot, 'packaged.png');
  fs.writeFileSync(shotPath, Buffer.from(pageShot.data, 'base64'));
  log('PACKAGED_SCREENSHOT', shotPath);

  const errors = collectErrors(cdp);
  log('PACKAGED_CONSOLE_ERRORS', errors);
  if (errors.length) throw new Error(`Konsol hataları: ${JSON.stringify(errors)}`);
  cdp.close();
}

main()
  .then(() => {
    console.log('PACKAGED_E2E_OK');
  })
  .catch((error) => {
    console.error('PACKAGED_E2E_FAIL', error && error.stack || error);
    console.error('STDOUT', stdout.slice(-4000));
    console.error('STDERR', stderr.slice(-6000));
    process.exitCode = 1;
  })
  .finally(async () => {
    try { child.kill(); } catch { /* ignore */ }
    await sleep(700);
    try {
      spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
    } catch { /* ignore */ }
    await sleep(500);
    process.exit(process.exitCode || 0);
  });
