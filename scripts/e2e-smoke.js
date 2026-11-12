'use strict';

const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = path.join(__dirname, '..');
const electronPath = require('electron');
const ffmpegPath = require('ffmpeg-static');
const ffprobePath = require('ffprobe-static').path;
const { execFileSync } = require('child_process');

const port = 9333;
const tmpRoot = path.join(os.tmpdir(), 'kesklip-e2e');
const userDataDir = path.join(tmpRoot, 'userdata');
const cacheDir = path.join(tmpRoot, 'cache');
const exportDir = path.join(tmpRoot, 'exports');
const projectDir = path.join(tmpRoot, 'projects');
const outPath = path.join(exportDir, 'e2e-export.mp4');
const projectPath = path.join(projectDir, 'e2e-project.kesklip');

for (const dir of [userDataDir, cacheDir, exportDir, projectDir]) {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
}

const child = spawn(electronPath, ['.', `--remote-debugging-port=${port}`, `--user-data-dir=${userDataDir}`], {
  cwd: root,
  env: {
    ...process.env,
    KESKLIP_CACHE_DIR: cacheDir,
    KESKLIP_EXPORT_DIR: exportDir,
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
        this.send('Runtime.evaluate', {
          expression,
          awaitPromise: true,
          returnByValue: true,
          userGesture: true,
        }),
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

function probe(filePath) {
  const info = JSON.parse(execFileSync(ffprobePath, [
    '-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', filePath,
  ], { encoding: 'utf8', windowsHide: true }));
  return {
    duration: Number(info.format.duration),
    size: Number(info.format.size),
    streams: info.streams.map((stream) => ({
      type: stream.codec_type,
      codec: stream.codec_name,
      width: stream.width,
      height: stream.height,
      sampleRate: stream.sample_rate,
      channels: stream.channels,
    })),
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
    `(() => { const s = window.__kesklip && window.__kesklip.state; const splash = document.querySelector('#splash'); return s && s.info && splash.classList.contains('is-hidden') ? { title: document.title, projectName: document.querySelector('#projectName').textContent, cacheRoot: s.info.cacheRoot, encoder: s.info.hardware.label, errors: s.lastErrors || [] } : null; })()`,
    'uygulama açılışı'
  );
  log('BOOT', boot);

  const sample1 = path.join(os.tmpdir(), 'kesklip-smoke', 'sample1.mp4');
  const sample2 = path.join(os.tmpdir(), 'kesklip-smoke', 'sample2.mp4');
  const music = path.join(os.tmpdir(), 'kesklip-smoke', 'music1.wav');
  for (const file of [sample1, sample2, music]) {
    if (!fs.existsSync(file)) throw new Error(`Test medyası yok: ${file}`);
  }

  const importResult = await cdp.evaluate(
    `(async () => {
      await window.__kesklip.importPaths(${JSON.stringify([sample1, sample2, music])});
      await new Promise((resolve) => setTimeout(resolve, 900));
      const s = window.__kesklip.state;
      const clip = document.querySelector('#videoTrack .timeline-clip');
      const scroll = document.querySelector('#timelineScroll');
      return {
        media: s.project.media.length,
        videos: s.project.media.filter((m) => m.kind === 'video').length,
        audios: s.project.media.filter((m) => m.kind === 'audio').length,
        clips: s.project.clips.length,
        music: Boolean(s.project.music),
        duration: window.__kesklip.projectDuration(),
        previewUrls: s.previewUrls.size,
        thumbUrls: s.thumbUrls.size,
        videoClips: document.querySelectorAll('#videoTrack .timeline-clip').length,
        audioClips: document.querySelectorAll('#audioTrack .audio-clip').length,
        stageEmptyHidden: document.querySelector('#stageEmpty').classList.contains('is-hidden'),
        clipWidth: clip ? Math.round(clip.getBoundingClientRect().width) : 0,
        viewport: scroll ? scroll.clientWidth : 0,
        timelineFillRatio: clip && scroll ? Number((clip.getBoundingClientRect().width / Math.max(1, scroll.clientWidth - 28)).toFixed(3)) : 0,
        zoom: Math.round(window.__kesklip.state.zoomValue),
        errors: s.lastErrors || [],
      };
    })()`,
    90000
  );
  log('IMPORT', importResult);
  if (importResult.videos !== 2) throw new Error('İki video içe aktarılamadı.');
  if (!importResult.music || importResult.audioClips !== 1) throw new Error('Müzik otomatik eklenmedi.');
  if (importResult.timelineFillRatio < 0.8) throw new Error(`Zaman çizelgesi ilk klibi doldurmadı: ${importResult.timelineFillRatio}`);

  const addSecond = await cdp.evaluate(
    `(() => {
      const s = window.__kesklip.state;
      const second = s.project.media.filter((m) => m.kind === 'video')[1];
      window.__kesklip.addClipFromMedia(second);
      window.__kesklip.fitTimeline();
      return { clips: s.project.clips.length, duration: window.__kesklip.projectDuration(), names: s.project.clips.map((c) => s.project.media.find((m) => m.id === c.mediaId).name) };
    })()`
  );
  log('ADD_SECOND_CLIP', addSecond);
  if (addSecond.clips !== 2) throw new Error('İkinci klip eklenemedi.');

  const splitResult = await cdp.evaluate(
    `(() => {
      const s = window.__kesklip.state;
      const secondClip = s.project.clips[1];
      window.__kesklip.setSelection({ type: 'clip', id: secondClip.id });
      window.__kesklip.seekTo(8.5);
      window.__kesklip.splitAtPlayhead();
      const afterSplit = { clips: s.project.clips.length, duration: window.__kesklip.projectDuration() };
      window.__kesklip.undo();
      const afterUndo = { clips: s.project.clips.length };
      window.__kesklip.redo();
      const afterRedo = { clips: s.project.clips.length, selected: s.selected };
      const rightId = s.project.clips[2].id;
      window.__kesklip.setSelection({ type: 'clip', id: rightId });
      window.__kesklip.deleteSelection();
      const afterDelete = { clips: s.project.clips.length, duration: window.__kesklip.projectDuration() };
      return { afterSplit, afterUndo, afterRedo, afterDelete };
    })()`
  );
  log('SPLIT_UNDO_REDO_DELETE', splitResult);
  if (splitResult.afterSplit.clips !== 3) throw new Error('Bölme işlemi 3 klip üretmedi.');
  if (splitResult.afterUndo.clips !== 2) throw new Error('Geri al 2 klibe dönmedi.');
  if (splitResult.afterRedo.clips !== 3) throw new Error('Yinele 3 klibe dönmedi.');
  if (splitResult.afterDelete.clips !== 2) throw new Error('Silme sonrası 2 klip kalmadı.');

  const reorderResult = await cdp.evaluate(
    `(() => {
      const s = window.__kesklip.state;
      const firstId = s.project.clips[0].id;
      const secondId = s.project.clips[1].id;
      window.__kesklip.reorderClip(secondId, 0);
      const reordered = s.project.clips.map((c) => c.id);
      window.__kesklip.reorderClip(secondId, 2);
      const restored = s.project.clips.map((c) => c.id);
      return {
        moved: reordered[0] === secondId,
        restored: restored[0] === firstId && restored[1] === secondId,
      };
    })()`
  );
  log('REORDER', reorderResult);
  if (!reorderResult.moved || !reorderResult.restored) throw new Error('Sıralama değiştirme çalışmadı.');

  const trimResult = await cdp.evaluate(
    `(() => {
      const s = window.__kesklip.state;
      const clip = s.project.clips[0];
      const before = { inPoint: clip.inPoint, outPoint: clip.outPoint };
      const el = document.querySelector('#videoTrack .timeline-clip');
      const handle = el.querySelector('[data-trim="left"]');
      const rect = handle.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const opts = { bubbles: true, cancelable: true, button: 0, pointerId: 1, pointerType: 'mouse', isPrimary: true };
      handle.dispatchEvent(new PointerEvent('pointerdown', { ...opts, clientX: cx, clientY: cy }));
      document.dispatchEvent(new PointerEvent('pointermove', { ...opts, clientX: cx + 70, clientY: cy }));
      document.dispatchEvent(new PointerEvent('pointerup', { ...opts, clientX: cx + 70, clientY: cy }));
      window.__kesklip.fitTimeline();
      return {
        before,
        after: { inPoint: clip.inPoint, outPoint: clip.outPoint },
        duration: window.__kesklip.projectDuration(),
      };
    })()`
  );
  log('TRIM', trimResult);
  if (!(trimResult.after.inPoint > 0.3 && trimResult.after.outPoint === trimResult.before.outPoint)) {
    throw new Error('Sol kırpma tutamacı çalışmadı.');
  }

  const transitionResult = await cdp.evaluate(
    `(async () => {
      const s = window.__kesklip.state;
      const first = s.project.clips[0];
      window.__kesklip.setSelection({ type: 'clip', id: first.id });
      await new Promise((resolve) => setTimeout(resolve, 120));
      const button = document.querySelector('[data-action="set-transition"][data-transition="soft"]');
      if (!button) throw new Error('Yumuşak geçiş düğmesi bulunamadı.');
      button.click();
      await new Promise((resolve) => setTimeout(resolve, 120));
      const input = document.querySelector('[data-inspector-input="transition-duration"]');
      if (input) {
        input.value = '0.6';
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
      }
      window.__kesklip.fitTimeline();
      const items = s.layout.items;
      const transitionStart = items[1].start;
      const transitionEnd = items[0].end;
      const mid = (transitionStart + transitionEnd) / 2;
      window.__kesklip.seekTo(mid);
      await new Promise((resolve) => setTimeout(resolve, 450));
      const marker = document.querySelector('#videoTrack .transition-marker');
      const players = [...document.querySelectorAll('#previewStage video')].map((video) => Number(getComputedStyle(video).opacity));
      return {
        type: first.transitionAfter ? first.transitionAfter.type : null,
        transitionDuration: first.transitionAfter ? first.transitionAfter.duration : null,
        marker: Boolean(marker),
        transitionStart,
        transitionEnd,
        mid,
        players,
        totalDuration: window.__kesklip.projectDuration(),
        inspectorTitle: document.querySelector('#inspectorTitle').textContent,
      };
    })()`
  );
  log('TRANSITION', transitionResult);
  if (transitionResult.type !== 'soft') throw new Error('Geçiş türü uygulanmadı.');
  if (Math.abs(transitionResult.transitionDuration - 0.6) > 0.001) throw new Error('Geçiş süresi uygulanmadı.');
  if (!transitionResult.marker) throw new Error('Geçiş işareti zaman çizelgesinde yok.');
  if (!(transitionResult.players.filter((opacity) => opacity > 0.05).length >= 2)) {
    throw new Error(`Geçiş önizlemesinde iki oynatıcı görünmüyor: ${JSON.stringify(transitionResult.players)}`);
  }

  const newTransitionResult = await cdp.evaluate(
    `(async () => {
      const s = window.__kesklip.state;
      const first = s.project.clips[0];
      window.__kesklip.setSelection({ type: 'clip', id: first.id });
      await new Promise((resolve) => setTimeout(resolve, 150));
      const buttons = [...document.querySelectorAll('[data-action="set-transition"]')].map((button) => button.dataset.transition);
      const items = s.layout.items;
      const mid = (items[1].start + items[0].end) / 2;
      const results = {};
      for (const type of ['zoom', 'wipe', 'circle']) {
        const button = document.querySelector('[data-action="set-transition"][data-transition="' + type + '"]');
        if (!button) {
          results[type] = { missing: true };
          continue;
        }
        button.click();
        await new Promise((resolve) => setTimeout(resolve, 140));
        window.__kesklip.seekTo(mid);
        await new Promise((resolve) => setTimeout(resolve, 260));
        const videos = [...document.querySelectorAll('#previewStage video')];
        const marker = document.querySelector('#videoTrack .transition-marker');
        results[type] = {
          model: first.transitionAfter ? first.transitionAfter.type : null,
          markerLabel: marker ? marker.textContent.trim() : '',
          opacity: videos.map((video) => Number(getComputedStyle(video).opacity)),
          transform: videos.map((video) => video.style.transform),
          clipPath: videos.map((video) => video.style.clipPath),
        };
      }
      const soft = document.querySelector('[data-action="set-transition"][data-transition="soft"]');
      if (soft) soft.click();
      await new Promise((resolve) => setTimeout(resolve, 120));
      return { buttons, results };
    })()`
  );
  log('NEW_TRANSITIONS', newTransitionResult);
  for (const type of ['soft', 'flash', 'slide', 'zoom', 'wipe', 'circle']) {
    if (!newTransitionResult.buttons.includes(type)) throw new Error(`${type} geçiş düğmesi yok.`);
  }
  if (newTransitionResult.results.zoom.model !== 'zoom') throw new Error('Zoom geçişi uygulanmadı.');
  if (!newTransitionResult.results.zoom.markerLabel.includes('Yakınlaş')) {
    throw new Error(`Zoom geçiş etiketi yanlış: ${newTransitionResult.results.zoom.markerLabel}`);
  }
  if (!newTransitionResult.results.zoom.transform.some((value) => value.includes('scale'))) {
    throw new Error('Zoom önizlemesi ölçek uygulamadı.');
  }
  if (newTransitionResult.results.wipe.model !== 'wipe') throw new Error('Perde geçişi uygulanmadı.');
  if (!newTransitionResult.results.wipe.markerLabel.includes('Perde')) {
    throw new Error(`Perde geçiş etiketi yanlış: ${newTransitionResult.results.wipe.markerLabel}`);
  }
  if (!newTransitionResult.results.wipe.clipPath.some((value) => value.includes('inset'))) {
    throw new Error('Perde önizlemesi kırpma uygulamadı.');
  }
  if (newTransitionResult.results.circle.model !== 'circle') throw new Error('Daire geçişi uygulanmadı.');
  if (!newTransitionResult.results.circle.markerLabel.includes('Daire')) {
    throw new Error(`Daire geçiş etiketi yanlış: ${newTransitionResult.results.circle.markerLabel}`);
  }
  if (!newTransitionResult.results.circle.clipPath.some((value) => value.includes('circle'))) {
    throw new Error('Daire önizlemesi kırpma uygulamadı.');
  }

  const fadeResult = await cdp.evaluate(
    `(async () => {
      const s = window.__kesklip.state;
      const first = s.project.clips[0];
      window.__kesklip.setSelection({ type: 'clip', id: first.id });
      await new Promise((resolve) => setTimeout(resolve, 180));
      const hasFadeInputs = Boolean(
        document.querySelector('[data-inspector-input="clip-fade-in"]') &&
        document.querySelector('[data-inspector-input="clip-fade-out"]')
      );
      const setRange = (action, value) => {
        const input = document.querySelector('[data-inspector-input="' + action + '"]');
        if (!input) return false;
        input.value = String(value);
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      };
      setRange('clip-fade-in', 1);
      setRange('clip-fade-out', 0.8);
      await new Promise((resolve) => setTimeout(resolve, 140));
      window.__kesklip.seekTo(0.12);
      await new Promise((resolve) => setTimeout(resolve, 320));
      const video = document.querySelectorAll('#previewStage video')[0];
      const atStart = {
        opacity: Number(getComputedStyle(video).opacity),
        volume: Number(video.volume),
      };
      window.__kesklip.seekTo(1.4);
      await new Promise((resolve) => setTimeout(resolve, 320));
      const atMiddle = {
        opacity: Number(getComputedStyle(video).opacity),
        volume: Number(video.volume),
      };
      return {
        hasFadeInputs,
        fadeIn: first.fadeIn,
        fadeOut: first.fadeOut,
        atStart,
        atMiddle,
      };
    })()`
  );
  log('CLIP_FADES', fadeResult);
  if (!fadeResult.hasFadeInputs) throw new Error('Klip fade alanları arayüzde yok.');
  if (Math.abs(fadeResult.fadeIn - 1) > 0.001 || Math.abs(fadeResult.fadeOut - 0.8) > 0.001) {
    throw new Error('Klip fade süreleri modele yazılmadı.');
  }
  if (!(fadeResult.atStart.opacity < 0.45 && fadeResult.atStart.volume < 0.45)) {
    throw new Error(`Klip giriş solması önizlemede uygulanmadı: ${JSON.stringify(fadeResult.atStart)}`);
  }
  if (!(fadeResult.atMiddle.opacity > 0.9 && fadeResult.atMiddle.volume > 0.9)) {
    throw new Error(`Klip ortasında fade sıfırlanmadı: ${JSON.stringify(fadeResult.atMiddle)}`);
  }

  const textResult = await cdp.evaluate(
    `(() => {
      window.__kesklip.seekTo(1.2);
      window.__kesklip.addTextOverlay('title');
      const s = window.__kesklip.state;
      return { texts: s.project.texts.length, inspectorTitle: document.querySelector('#inspectorTitle').textContent, textNodes: document.querySelectorAll('#textLayer .preview-text').length };
    })()`
  );
  log('TEXT', textResult);
  if (textResult.texts !== 1) throw new Error('Yazı eklenemedi.');

  const playbackResult = await cdp.evaluate(
    `(async () => {
      window.__kesklip.seekTo(0.4);
      const before = window.__kesklip.state.playhead;
      window.__kesklip.playPlayback();
      await new Promise((resolve) => setTimeout(resolve, 1000));
      const during = window.__kesklip.state.playhead;
      window.__kesklip.pausePlayback();
      return { before, during, playing: window.__kesklip.state.playing, advanced: during > before + 0.4 };
    })()`
  );
  log('PLAYBACK', playbackResult);
  if (!playbackResult.advanced) throw new Error('Oynatma ilerlemedi.');

  const midShot = await cdp.send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(tmpRoot, 'screenshot-edit.png'), Buffer.from(midShot.data, 'base64'));

  const saveResult = await cdp.evaluate(
    `(async () => {
      const s = window.__kesklip.state;
      const result = await window.kesklip.saveProject({
        data: JSON.parse(JSON.stringify(s.project)),
        path: ${JSON.stringify(projectPath)},
        saveAs: false,
      });
      return result;
    })()`
  );
  log('PROJECT_SAVE', saveResult);
  if (!fs.existsSync(projectPath)) throw new Error('Proje dosyası yazılmadı.');
  const savedProject = JSON.parse(fs.readFileSync(projectPath, 'utf8'));
  log('PROJECT_SAVE_FILE', {
    clips: savedProject.clips.length,
    texts: savedProject.texts.length,
    music: Boolean(savedProject.music),
    transition: savedProject.clips[0].transitionAfter,
  });

  const exportDialogResult = await cdp.evaluate(
    `(async () => {
      document.querySelector('#exportButton').click();
      await new Promise((resolve) => setTimeout(resolve, 280));
      const normalize = document.querySelector('[data-export-toggle="normalize"]');
      const denoise = document.querySelector('[data-export-toggle="denoise"]');
      const initial = {
        normalize: window.__kesklip.state.exportNormalize,
        denoise: window.__kesklip.state.exportDenoise,
      };
      const normalizeOn = normalize ? normalize.classList.contains('is-on') : null;
      if (denoise) denoise.click();
      await new Promise((resolve) => setTimeout(resolve, 90));
      const afterDenoise = {
        state: window.__kesklip.state.exportDenoise,
        on: denoise ? denoise.classList.contains('is-on') : null,
      };
      if (denoise) denoise.click();
      await new Promise((resolve) => setTimeout(resolve, 90));
      const close = document.querySelector('[data-export-action="close"]');
      if (close) close.click();
      await new Promise((resolve) => setTimeout(resolve, 220));
      return {
        hasNormalize: Boolean(normalize),
        hasDenoise: Boolean(denoise),
        initial,
        normalizeOn,
        afterDenoise,
        closed: !document.querySelector('#exportPathInput'),
      };
    })()`
  );
  log('EXPORT_DIALOG_OPTIONS', exportDialogResult);
  if (!exportDialogResult.hasNormalize || !exportDialogResult.hasDenoise) {
    throw new Error('Dışa aktarma ses seçenekleri arayüzde yok.');
  }
  if (!exportDialogResult.initial.normalize || !exportDialogResult.normalizeOn) {
    throw new Error('Ses normalizasyonu varsayılan açık değil.');
  }
  if (!exportDialogResult.afterDenoise.state || !exportDialogResult.afterDenoise.on) {
    throw new Error('Gürültü azaltma anahtarı çalışmadı.');
  }
  if (!exportDialogResult.closed) throw new Error('Dışa aktarma penceresi kapanmadı.');

  const projectDuration = await cdp.evaluate('window.__kesklip.projectDuration()');
  const exportResult = await cdp.evaluate(
    `(async () => {
      const s = window.__kesklip.state;
      const project = JSON.parse(JSON.stringify(s.project));
      const result = await window.kesklip.startExport({
        project,
        outputPath: ${JSON.stringify(outPath)},
        options: { quality: 'fast', normalize: true, denoise: true },
      });
      return { ...result, filterGraph: s.lastExportStarted ? s.lastExportStarted.filterGraph : null };
    })()`,
    300000
  );
  log('EXPORT', { result: exportResult.result, filterGraph: exportResult.filterGraph });
  if (!fs.existsSync(outPath)) throw new Error('Dışa aktarma dosyası yok.');
  const filterGraph = String(exportResult.filterGraph || '');
  if (!filterGraph) throw new Error('Dışa aktarma başlangıç bilgisi (filtre grafiği) alınamadı.');
  if (!filterGraph.includes('loudnorm=I=-16:TP=-1.5:LRA=11')) {
    throw new Error('Ses normalizasyonu filtre grafiğinde yok.');
  }
  if (!filterGraph.includes('afftdn=nr=10:nf=-30')) {
    throw new Error('Gürültü azaltma filtre grafiğinde yok.');
  }
  if (!filterGraph.includes('fade=t=in:st=0:d=1.000') || !filterGraph.includes('afade=t=in:st=0:d=1.000')) {
    throw new Error('Klip giriş fade filtresi grafikte yok.');
  }
  if (!filterGraph.includes('fade=t=out') || !filterGraph.includes('afade=t=out')) {
    throw new Error('Klip çıkış fade filtresi grafikte yok.');
  }
  const exportInfo = probe(outPath);
  log('EXPORT_PROBE', { expectedDuration: projectDuration, ...exportInfo });
  if (Math.abs(exportInfo.duration - projectDuration) > 0.2) {
    throw new Error(`Dışa aktarma süresi uyuşmuyor: ${exportInfo.duration} / ${projectDuration}`);
  }
  if (!exportInfo.streams.some((stream) => stream.type === 'audio')) throw new Error('Dışa aktarmada ses akışı yok.');
  if (!exportInfo.streams.some((stream) => stream.type === 'video')) throw new Error('Dışa aktarmada video akışı yok.');

  const framePath = path.join(tmpRoot, 'transition-frame.png');
  execFileSync(ffmpegPath, ['-y', '-ss', String(Math.max(0, transitionResult.transitionStart + 0.2)), '-i', outPath, '-frames:v', '1', framePath], { windowsHide: true });
  log('EXPORT_FRAME', framePath);

  const variants = [
    { type: 'flash', speed: 1, xfade: 'fadewhite' },
    { type: 'slide', speed: 2, xfade: 'slideleft' },
    { type: 'zoom', speed: 1, xfade: 'zoomin' },
    { type: 'wipe', speed: 1, xfade: 'wipeleft' },
    { type: 'circle', speed: 1, xfade: 'circleopen' },
  ];
  for (const variant of variants) {
    const variantPath = path.join(exportDir, `e2e-${variant.type}.mp4`);
    const expected = await cdp.evaluate(
      `(async () => {
        const s = window.__kesklip.state;
        s.project.clips[0].transitionAfter = { type: ${JSON.stringify(variant.type)}, duration: 0.6 };
        s.project.clips[1].speed = ${variant.speed};
        window.__kesklip.renderAll({ sync: false });
        await new Promise((resolve) => setTimeout(resolve, 150));
        return window.__kesklip.projectDuration();
      })()`
    );
    const result = await cdp.evaluate(
      `(async () => {
        const s = window.__kesklip.state;
        const project = JSON.parse(JSON.stringify(s.project));
        const exported = await window.kesklip.startExport({ project, outputPath: ${JSON.stringify(variantPath)}, options: { quality: 'fast' } });
        return { ...exported, filterGraph: s.lastExportStarted ? s.lastExportStarted.filterGraph : null };
      })()`,
      300000
    );
    const info = fs.existsSync(variantPath) ? probe(variantPath) : null;
    log('EXPORT_VARIANT', {
      type: variant.type,
      speed: variant.speed,
      expected,
      result: result && result.result,
      filterGraph: result && result.filterGraph,
      probe: info && { duration: info.duration, size: info.size, streams: info.streams.map((stream) => stream.codec) },
    });
    if (!result || !result.result || !result.result.ok || !info) throw new Error(`${variant.type} dışa aktarma başarısız.`);
    if (!String(result.filterGraph || '').includes(`xfade=transition=${variant.xfade}`)) {
      throw new Error(`${variant.type} için xfade ${variant.xfade} eşlemesi yok.`);
    }
    if (Math.abs(info.duration - expected) > 0.25) throw new Error(`${variant.type} süre uyuşmuyor: ${info.duration} / ${expected}`);
    const frame = path.join(tmpRoot, `variant-${variant.type}.png`);
    execFileSync(ffmpegPath, ['-y', '-ss', String(Math.max(0, expected * 0.55)), '-i', variantPath, '-frames:v', '1', frame], { windowsHide: true });
  }

  await cdp.evaluate(
    `(() => {
      const s = window.__kesklip.state;
      s.project.clips[0].transitionAfter = { type: 'soft', duration: 0.6 };
      s.project.clips[1].speed = 1;
      window.__kesklip.renderAll({ sync: false });
    })()`
  );

  await sleep(1200);
  const autosavePath = path.join(userDataDir, 'autosave.json');
  log('AUTOSAVE_FILE', { path: autosavePath, exists: fs.existsSync(autosavePath) });
  if (!fs.existsSync(autosavePath)) throw new Error('Otomatik kayıt dosyası yok.');

  await cdp.send('Page.reload', { ignoreCache: true });
  const restored = await waitFor(
    cdp,
    `(() => {
      const s = window.__kesklip && window.__kesklip.state;
      const splash = document.querySelector('#splash');
      if (!s || !s.info || !splash || !splash.classList.contains('is-hidden')) return null;
      if (!s.project.media.length) return null;
      return {
        media: s.project.media.length,
        clips: s.project.clips.length,
        texts: s.project.texts.length,
        music: Boolean(s.project.music),
        duration: window.__kesklip.projectDuration(),
        transition: s.project.clips[0].transitionAfter,
        fadeIn: s.project.clips[0].fadeIn,
        fadeOut: s.project.clips[0].fadeOut,
        restoredToast: true,
        errors: s.lastErrors || [],
      };
    })()`,
    'otomatik kayıt geri yükleme',
    45000
  );
  log('AUTOSAVE_RESTORE', restored);
  if (restored.clips !== 2) throw new Error('Geri yüklenen projede 2 klip yok.');
  if (!restored.music) throw new Error('Geri yüklenen projede müzik yok.');
  if (!restored.transition || restored.transition.type !== 'soft') throw new Error('Geri yüklenen projede geçiş yok.');
  if (Math.abs(Number(restored.fadeIn) - 1) > 0.001 || Math.abs(Number(restored.fadeOut) - 0.8) > 0.001) {
    throw new Error(`Geri yüklenen projede fade süreleri korunmadı: ${JSON.stringify({ fadeIn: restored.fadeIn, fadeOut: restored.fadeOut })}`);
  }

  const offlineResult = await cdp.evaluate(
    `(async () => {
      const s = window.__kesklip.state;
      const fakePath = ${JSON.stringify(path.join(tmpRoot, 'missing-source.mp4'))};
      s.project.media.push({ id: 'offline-test', path: fakePath, name: 'missing-source.mp4', kind: 'video', duration: 1, width: 320, height: 180, playbackMode: 'direct' });
      await window.__kesklip.refreshOfflineStatus();
      await new Promise((resolve) => setTimeout(resolve, 350));
      const marked = s.offline.has(fakePath);
      const cardMarked = document.querySelectorAll('.media-card.is-offline').length > 0;
      s.project.media = s.project.media.filter((media) => media.id !== 'offline-test');
      await window.__kesklip.refreshOfflineStatus();
      await new Promise((resolve) => setTimeout(resolve, 250));
      return { marked, cardMarked, cleared: !s.offline.has(fakePath) };
    })()`
  );
  log('OFFLINE_DETECTION', offlineResult);
  if (!offlineResult.marked || !offlineResult.cardMarked || !offlineResult.cleared) {
    throw new Error('Kaynak dosya eksik denetimi çalışmadı.');
  }

  await sleep(1200);
  const finalShot = await cdp.send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(tmpRoot, 'screenshot.png'), Buffer.from(finalShot.data, 'base64'));

  const errors = collectErrors(cdp);
  log('CONSOLE_ERRORS', errors);
  if (errors.length) throw new Error(`Konsol hataları: ${JSON.stringify(errors)}`);
  cdp.close();
}

main()
  .then(() => {
    console.log('E2E_OK');
  })
  .catch((error) => {
    console.error('E2E_FAIL', error && error.stack || error);
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
