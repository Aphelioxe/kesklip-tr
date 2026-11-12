'use strict';

const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = path.join(__dirname, '..');
const electronPath = require('electron');
const port = 9334;
const tmpRoot = path.join(os.tmpdir(), 'kesklip-e2e-long');
const userDataDir = path.join(tmpRoot, 'userdata');
const cacheDir = path.join(tmpRoot, 'cache');
const longPath = 'D:\\KesKlip\\smoke\\long40.mp4';

for (const dir of [userDataDir, cacheDir]) {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
}
if (!fs.existsSync(longPath)) throw new Error(`Uzun test videosu yok: ${longPath}`);

const child = spawn(electronPath, ['.', `--remote-debugging-port=${port}`, `--user-data-dir=${userDataDir}`], {
  cwd: root,
  env: {
    ...process.env,
    KESKLIP_CACHE_DIR: cacheDir,
    KESKLIP_EXPORT_DIR: path.join(tmpRoot, 'exports'),
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
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`);
      if (response.ok) {
        const list = await response.json();
        const page = list.find((entry) => entry.type === 'page' && entry.webSocketDebuggerUrl);
        if (page) return page;
      }
    } catch { /* not ready */ }
    await sleep(350);
  }
  throw new Error('Electron hata ayıklama portu açılmadı.');
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

async function waitFor(cdp, expression, description, timeout = 30000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const value = await cdp.evaluate(expression, 15000);
    if (value) return value;
    await sleep(300);
  }
  throw new Error(`Bekleme zaman aşımı: ${description}`);
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
    `(() => { const s = window.__kesklip && window.__kesklip.state; return s && s.info && document.querySelector('#splash').classList.contains('is-hidden') ? { encoder: s.info.hardware.label, errors: s.lastErrors || [] } : null; })()`,
    'uygulama açılışı'
  );
  log('BOOT', boot);

  const importResult = await cdp.evaluate(
    `(async () => {
      const s = window.__kesklip.state;
      const started = performance.now();
      await window.__kesklip.importPaths(${JSON.stringify([longPath])});
      const imported = performance.now();
      const thumbDeadline = Date.now() + 30000;
      while (s.thumbUrls.size < 1 && Date.now() < thumbDeadline) {
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
      const thumbDone = performance.now();
      const clip = document.querySelector('#videoTrack .timeline-clip');
      const scroll = document.querySelector('#timelineScroll');
      const media = s.project.media[0];
      return {
        importMs: Math.round(imported - started),
        thumbReadyMs: Math.round(thumbDone - started),
        media: s.project.media.length,
        clips: s.project.clips.length,
        duration: window.__kesklip.projectDuration(),
        width: media ? media.width : 0,
        height: media ? media.height : 0,
        playbackMode: media ? media.playbackMode : '',
        previewStatus: media ? s.previewStatus.get(media.id) : '',
        previewUrls: s.previewUrls.size,
        thumbUrls: s.thumbUrls.size,
        clipWidth: clip ? Math.round(clip.getBoundingClientRect().width) : 0,
        viewport: scroll ? scroll.clientWidth : 0,
        fillRatio: clip && scroll ? Number((clip.getBoundingClientRect().width / Math.max(1, scroll.clientWidth - 28)).toFixed(3)) : 0,
        rulerLabels: [...document.querySelectorAll('#timelineRuler .ruler-label')].map((el) => el.textContent).slice(0, 5),
        widths: {
          inner: window.innerWidth,
          body: document.body.clientWidth,
          docScrollWidth: document.documentElement.scrollWidth,
          shell: Math.round(document.querySelector('.app-shell').getBoundingClientRect().width),
          workspace: Math.round(document.querySelector('.workspace').getBoundingClientRect().width),
          panel: Math.round(document.querySelector('.timeline-panel').getBoundingClientRect().width),
          scroll: Math.round(document.querySelector('#timelineScroll').getBoundingClientRect().width),
          content: Math.round(document.querySelector('#timelineContent').getBoundingClientRect().width),
          inspector: Math.round(document.querySelector('.inspector').getBoundingClientRect().width),
          inspectorLeft: Math.round(document.querySelector('.inspector').getBoundingClientRect().left),
        },
        pps: s.pps,
        zoom: s.zoomValue,
        errors: s.lastErrors || [],
      };
    })()`,
    90000
  );
  log('LONG_IMPORT', importResult);
  if (importResult.media !== 1 || importResult.clips !== 1) throw new Error('Uzun video içe aktarılamadı.');
  if (Math.abs(importResult.duration - 2400) > 1) throw new Error(`Süre yanlış: ${importResult.duration}`);
  if (importResult.fillRatio < 0.8) throw new Error(`Uzun video zaman çizelgesini doldurmadı: ${importResult.fillRatio}`);
  if (importResult.importMs > 5000) throw new Error(`İçe aktarma çok yavaş: ${importResult.importMs}ms`);

  const seekResult = await cdp.evaluate(
    `(async () => {
      window.__kesklip.seekTo(1200);
      await new Promise((resolve) => setTimeout(resolve, 1200));
      const s = window.__kesklip.state;
      const player = document.querySelector('#previewStage video');
      const sample = () => {
        const canvas = document.createElement('canvas');
        canvas.width = 160;
        canvas.height = 90;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(player, 0, 0, canvas.width, canvas.height);
        const data = ctx.getImageData(60, 30, 40, 30).data;
        let sum = 0;
        for (let i = 0; i < data.length; i += 4) sum += data[i] + data[i + 1] + data[i + 2];
        return Math.round(sum / (data.length / 4) / 3);
      };
      const mid = { currentTime: player ? player.currentTime : 0, readyState: player ? player.readyState : 0, brightness: sample() };
      window.__kesklip.playPlayback();
      await new Promise((resolve) => setTimeout(resolve, 1300));
      const playing = s.playhead;
      window.__kesklip.pausePlayback();
      window.__kesklip.seekTo(2385);
      await new Promise((resolve) => setTimeout(resolve, 1100));
      const nearEnd = {
        currentTime: player ? player.currentTime : 0,
        readyState: player ? player.readyState : 0,
        playhead: s.playhead,
        paused: player ? player.paused : null,
        opacity: player ? getComputedStyle(player).opacity : null,
        display: player ? getComputedStyle(player).display : null,
        visibility: player ? getComputedStyle(player).visibility : null,
        src: player ? player.currentSrc : null,
        videoWidth: player ? player.videoWidth : 0,
        brightness: sample(),
      };
      return { mid, playing, advanced: playing > 1200.5, nearEnd, errors: s.lastErrors || [] };
    })()`,
    60000
  );
  log('LONG_SEEK_PLAY', seekResult);
  if (!seekResult.advanced) throw new Error('Uzun videoda oynatma ilerlemedi.');
  if (Math.abs(seekResult.mid.currentTime - 1200) > 5) throw new Error(`20. dakikaya atlama başarısız: ${seekResult.mid.currentTime}`);
  if (Math.abs(seekResult.nearEnd.currentTime - 2385) > 5) throw new Error(`Sona atlama başarısız: ${seekResult.nearEnd.currentTime}`);

  const screenshot = await cdp.send('Page.captureScreenshot', { format: 'png' });
  const shotPath = path.join(tmpRoot, 'long40.png');
  fs.writeFileSync(shotPath, Buffer.from(screenshot.data, 'base64'));
  log('SCREENSHOT', shotPath);

  await cdp.evaluate('window.__kesklip.seekTo(1200)');
  await sleep(900);
  const midScreenshot = await cdp.send('Page.captureScreenshot', { format: 'png' });
  const midShotPath = path.join(tmpRoot, 'long40-mid.png');
  fs.writeFileSync(midShotPath, Buffer.from(midScreenshot.data, 'base64'));
  log('SCREENSHOT_MID', midShotPath);
  await cdp.evaluate('window.__kesklip.seekTo(2385)');
  await sleep(700);

  const errors = collectErrors(cdp);
  log('CONSOLE_ERRORS', errors);
  if (errors.length) throw new Error(`Konsol hataları: ${JSON.stringify(errors)}`);
  cdp.close();
}

main()
  .then(() => {
    console.log('LONG_E2E_OK');
  })
  .catch((error) => {
    console.error('LONG_E2E_FAIL', error && error.stack || error);
    console.error('STDOUT', stdout.slice(-4000));
    console.error('STDERR', stderr.slice(-6000));
    process.exitCode = 1;
  })
  .finally(async () => {
    try { child.kill(); } catch { /* ignore */ }
    await sleep(600);
    try {
      spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
    } catch { /* ignore */ }
    await sleep(400);
    process.exit(process.exitCode || 0);
  });
