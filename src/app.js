(() => {
  'use strict';

  const api = window.kesklip;
  const T = window.KesKlipTimeline;

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));
  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

  const QUALITY_LABELS = {
    high: 'Yüksek kalite',
    balanced: 'Dengeli',
    fast: 'Hızlı taslak',
  };

  const TRANSITION_LABELS = {
    soft: 'Yumuşak',
    flash: 'Beyaz',
    slide: 'Kaydır',
    zoom: 'Yakınlaş',
    wipe: 'Perde',
    circle: 'Daire',
  };

  const TEXT_COLORS = ['#ffffff', '#63e8c8', '#ffd166', '#ff8fa3', '#69b9ff', '#101820'];

  const refs = {
    app: $('#app'),
    splash: $('#splash'),
    splashText: $('#splashText'),
    projectName: $('#projectName'),
    projectNameButton: $('#projectNameButton'),
    autosaveText: $('#autosaveText'),
    projectResolution: $('#projectResolution'),
    projectFps: $('#projectFps'),
    previewStatusText: $('#previewStatusText'),
    previewStatus: $('.preview-status'),
    previewArea: $('#previewArea'),
    previewStage: $('#previewStage'),
    videoA: $('#videoA'),
    videoB: $('#videoB'),
    textLayer: $('#textLayer'),
    flashLayer: $('#flashLayer'),
    stageEmpty: $('#stageEmpty'),
    sharedDropOverlay: $('#sharedDropOverlay'),
    mediaList: $('#mediaList'),
    mediaEmpty: $('#mediaEmpty'),
    mediaCount: $('#mediaCount'),
    audioList: $('#audioList'),
    audioEmpty: $('#audioEmpty'),
    audioCount: $('#audioCount'),
    inspectorTitle: $('#inspectorTitle'),
    inspectorBadge: $('#inspectorBadge'),
    inspectorBody: $('#inspectorBody'),
    playButton: $('#playButton'),
    skipStartButton: $('#skipStartButton'),
    skipEndButton: $('#skipEndButton'),
    currentTime: $('#currentTime'),
    totalTime: $('#totalTime'),
    muteButton: $('#muteButton'),
    monitorVolume: $('#monitorVolume'),
    fullscreenButton: $('#fullscreenButton'),
    miniTimeline: $('#miniTimeline'),
    miniProgress: $('#miniProgress'),
    miniHandle: $('#miniHandle'),
    timelineScroll: $('#timelineScroll'),
    timelineContent: $('#timelineContent'),
    timelineRuler: $('#timelineRuler'),
    videoTrack: $('#videoTrack'),
    textTrack: $('#textTrack'),
    audioTrack: $('#audioTrack'),
    playhead: $('#playhead'),
    timelineEmpty: $('#timelineEmpty'),
    timelineDuration: $('#timelineDuration'),
    zoomSlider: $('#zoomSlider'),
    modalRoot: $('#modalRoot'),
    toastContainer: $('#toastContainer'),
    undoButton: $('#undoButton'),
    redoButton: $('#redoButton'),
    exportButton: $('#exportButton'),
    importVideoButton: $('#importVideoButton'),
    importAudioButton: $('#importAudioButton'),
    emptyImportButton: $('#emptyImportButton'),
    addTextButton: $('#addTextButton'),
    quickTextButton: $('#quickTextButton'),
    splitButton: $('#splitButton'),
    deleteButton: $('#deleteButton'),
    duplicateButton: $('#duplicateButton'),
    zoomInButton: $('#zoomInButton'),
    zoomOutButton: $('#zoomOutButton'),
    fitTimelineButton: $('#fitTimelineButton'),
    fitPreviewButton: $('#fitPreviewButton'),
    openProjectButton: $('#openProjectButton'),
    saveProjectButton: $('#saveProjectButton'),
    newProjectButton: $('#newProjectButton'),
    shortcutsButton: $('#shortcutsButton'),
  };

  function createProject(name = 'Yeni Proje') {
    return {
      version: 1,
      name,
      width: 1920,
      height: 1080,
      fps: 30,
      media: [],
      clips: [],
      texts: [],
      music: null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
  }

  const state = {
    info: null,
    project: createProject(),
    projectPath: null,
    selected: null,
    playhead: 0,
    playing: false,
    pps: 6,
    zoomValue: 42,
    layout: { items: [], transitions: [], duration: 0 },
    monitorVolume: 1,
    muted: false,
    lastFrame: 0,
    history: [],
    historyIndex: -1,
    thumbUrls: new Map(),
    waveformUrls: new Map(),
    previewUrls: new Map(),
    previewStatus: new Map(),
    proxyInfo: new Map(),
    offline: new Set(),
    pendingImports: [],
    importing: 0,
    exportDialog: null,
    exporting: false,
    exportFinished: false,
    exportNormalize: true,
    exportDenoise: false,
    lastExportDir: null,
    lastExportStarted: null,
    stageNotice: null,
    isScrubbing: false,
    draggingText: null,
    draggingClip: null,
    timelineRaf: 0,
    libraryRaf: 0,
    previewRaf: 0,
    stageRaf: 0,
    lyricsTimer: null,
  };

  const players = [
    { el: refs.videoA, clipId: null, url: '', ready: false, pendingSeek: null },
    { el: refs.videoB, clipId: null, url: '', ready: false, pendingSeek: null },
  ];

  let musicAudio = null;
  let activeModal = null;
  let autosaveTimer = null;
  let autosaveFailed = false;
  const textOverlayEls = new Map();

  function uid(prefix) {
    return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function cssUrl(url) {
    return `url("${String(url || '').replace(/"/g, '%22')}")`;
  }

  function fileUrl(filePath) {
    if (!filePath || !state.info) return '';
    const url = new URL('/file', state.info.serverUrl);
    url.searchParams.set('path', filePath);
    url.searchParams.set('token', state.info.token);
    return url.toString();
  }

  function mediaFor(mediaId) {
    return state.project.media.find((media) => media.id === mediaId) || null;
  }

  function clipFor(clipId) {
    return state.project.clips.find((clip) => clip.id === clipId) || null;
  }

  function textFor(textId) {
    return state.project.texts.find((text) => text.id === textId) || null;
  }

  function selectedClipId() {
    return state.selected && state.selected.type === 'clip' ? state.selected.id : null;
  }

  function selectedTransitionClipId() {
    return state.selected && state.selected.type === 'transition' ? state.selected.clipId : null;
  }

  function mediaName(media) {
    return media && media.name ? media.name : 'Medya';
  }

  function projectDuration() {
    return state.layout.duration || 0;
  }

  function even(value) {
    const rounded = Math.round(Number(value) || 0);
    return Math.max(16, rounded % 2 === 0 ? rounded : rounded - 1);
  }

  function numberOr(value, fallback) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  function formatPlayerTime(seconds) {
    const safe = Math.max(0, Number(seconds) || 0);
    const fps = Math.max(1, Math.round(state.project.fps || 30));
    const frames = Math.floor((safe % 1) * fps + 0.0001);
    const totalSeconds = Math.floor(safe);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const secs = totalSeconds % 60;
    const pad = (value, size) => String(value).padStart(size, '0');
    if (hours > 0) {
      return `${pad(hours, 2)}:${pad(minutes, 2)}:${pad(secs, 2)}.${pad(frames, 2)}`;
    }
    return `${pad(minutes, 2)}:${pad(secs, 2)}.${pad(frames, 2)}`;
  }

  function formatPlainTime(seconds) {
    const safe = Math.max(0, Number(seconds) || 0);
    const hours = Math.floor(safe / 3600);
    const minutes = Math.floor((safe % 3600) / 60);
    const secs = Math.floor(safe % 60);
    const pad = (value) => String(value).padStart(2, '0');
    if (hours > 0) return `${pad(hours)}:${pad(minutes)}:${pad(secs)}`;
    return `${pad(minutes)}:${pad(secs)}`;
  }

  function formatEta(seconds) {
    if (!Number.isFinite(seconds) || seconds < 0) return 'Hesaplanıyor…';
    if (seconds < 1) return '< 1 sn';
    if (seconds < 60) return `~${Math.round(seconds)} sn`;
    const mins = Math.floor(seconds / 60);
    const secs = Math.round(seconds % 60);
    if (mins < 60) return `~${mins} dk ${String(secs).padStart(2, '0')} sn`;
    return `~${Math.floor(mins / 60)} sa ${mins % 60} dk`;
  }

  function formatBytes(bytes) {
    const value = Number(bytes) || 0;
    if (value < 1024 * 1024) return `${(value / 1024).toFixed(0)} KB`;
    if (value < 1024 * 1024 * 1024) return `${(value / 1048576).toFixed(1)} MB`;
    return `${(value / 1073741824).toFixed(2)} GB`;
  }

  function sanitizeFileName(value) {
    return String(value || 'KesKlip')
      .replace(/[<>:"/\\|?*\u0000-\u001F]/g, '-')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/[. ]+$/g, '') || 'KesKlip';
  }

  function makeExportPath() {
    const dir = (state.lastExportDir || state.info.exportDir || '').replace(/[\\/]+$/, '');
    const now = new Date();
    const pad = (value) => String(value).padStart(2, '0');
    const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}-${pad(now.getMinutes())}`;
    return `${dir}\\${sanitizeFileName(state.project.name)}_${stamp}.mp4`;
  }

  function normalizeProject(raw) {
    const source = raw && typeof raw === 'object' ? raw : {};
    const project = createProject(typeof source.name === 'string' && source.name.trim() ? source.name : 'Yeni Proje');
    project.createdAt = Number(source.createdAt) || Date.now();
    project.updatedAt = Number(source.updatedAt) || Date.now();
    project.media = Array.isArray(source.media) ? source.media.filter((media) => media && media.path).map((media) => ({
      ...media,
      id: media.id || uid('media'),
      name: media.name || String(media.path).split(/[\\/]/).pop() || 'Medya',
      kind: media.kind === 'audio' || media.isAudioOnly ? 'audio' : 'video',
      duration: Math.max(0.05, Number(media.duration) || 0.05),
      width: Math.max(0, Number(media.width) || 0),
      height: Math.max(0, Number(media.height) || 0),
      fps: Math.max(1, Number(media.fps) || 30),
      hasAudio: Boolean(media.hasAudio),
      playbackMode: media.playbackMode || 'direct',
    })) : [];

    const seenMedia = new Set();
    project.media = project.media.filter((media) => {
      if (seenMedia.has(media.id)) return false;
      seenMedia.add(media.id);
      return true;
    });

    const firstVideo = project.media.find((media) => media.kind === 'video');
    project.width = even(Number(source.width) || (firstVideo && firstVideo.width) || 1920);
    project.height = even(Number(source.height) || (firstVideo && firstVideo.height) || 1080);
    project.fps = clamp(Number(source.fps) || (firstVideo && firstVideo.fps) || 30, 1, 120);

    const mediaIds = new Set(project.media.map((media) => media.id));
    project.clips = (Array.isArray(source.clips) ? source.clips : [])
      .filter((clip) => clip && mediaIds.has(clip.mediaId))
      .map((clip) => {
        const media = project.media.find((entry) => entry.id === clip.mediaId);
        const inPoint = clamp(Number(clip.inPoint) || 0, 0, Math.max(0, media.duration - 0.05));
        const outPoint = clamp(Number(clip.outPoint) || media.duration, inPoint + 0.05, media.duration);
        const speed = clamp(Number(clip.speed) || 1, 0.5, 2);
        const transition = clip.transitionAfter && T.TRANSITION_TYPES.includes(clip.transitionAfter.type)
          ? { type: clip.transitionAfter.type, duration: clamp(Number(clip.transitionAfter.duration) || 0.45, 0.15, 1.5) }
          : null;
        return {
          id: clip.id || uid('clip'),
          mediaId: clip.mediaId,
          inPoint,
          outPoint,
          speed,
          volume: clamp(numberOr(clip.volume, 1), 0, 1.5),
          fadeIn: clamp(numberOr(clip.fadeIn, 0), 0, 10),
          fadeOut: clamp(numberOr(clip.fadeOut, 0), 0, 10),
          transitionAfter: transition,
        };
      });

    if (project.clips.length) {
      const last = project.clips[project.clips.length - 1];
      last.transitionAfter = null;
    }

    project.texts = (Array.isArray(source.texts) ? source.texts : []).map((text) => ({
      id: text.id || uid('text'),
      content: String(text.content == null ? 'Yazınız' : text.content),
      start: Math.max(0, Number(text.start) || 0),
      end: Math.max(0.2, Number(text.end) || 4),
      x: clamp(numberOr(text.x, 0.5), 0.02, 0.98),
      y: clamp(numberOr(text.y, 0.5), 0.02, 0.98),
      size: clamp(Number(text.size) || 5.6, 1.5, 20),
      color: /^#[0-9a-f]{6}$/i.test(String(text.color || '')) ? text.color : '#ffffff',
      bold: Boolean(text.bold),
      background: Boolean(text.background),
      fade: clamp(Number(text.fade) || 0.18, 0, 2),
    }));

    const musicMedia = source.music ? project.media.find((media) => media.id === source.music.mediaId) : null;
    project.music = musicMedia ? {
      mediaId: musicMedia.id,
      volume: clamp(numberOr(source.music.volume, 0.35), 0, 1.5),
      loop: source.music.loop !== false,
      fadeIn: clamp(numberOr(source.music.fadeIn, 0), 0, 10),
      fadeOut: clamp(numberOr(source.music.fadeOut, 0), 0, 10),
    } : null;

    return project;
  }

  function refreshLayout() {
    state.layout = T.computeLayout(state.project);
    if (state.playhead > state.layout.duration) state.playhead = state.layout.duration;
    if (state.playhead < 0) state.playhead = 0;
  }

  function projectForSave() {
    return clone(state.project);
  }

  function initHistory() {
    state.history = [clone(state.project)];
    state.historyIndex = 0;
    updateHistoryButtons();
  }

  function pushHistory() {
    const snapshot = clone(state.project);
    const current = state.history[state.historyIndex];
    if (current && JSON.stringify(current) === JSON.stringify(snapshot)) return;
    state.history = state.history.slice(0, state.historyIndex + 1);
    state.history.push(snapshot);
    if (state.history.length > 80) state.history.shift();
    state.historyIndex = state.history.length - 1;
    updateHistoryButtons();
  }

  function updateHistoryButtons() {
    if (refs.undoButton) refs.undoButton.disabled = state.historyIndex <= 0;
    if (refs.redoButton) refs.redoButton.disabled = state.historyIndex >= state.history.length - 1;
  }

  function undo() {
    if (state.historyIndex <= 0) return;
    pausePlayback();
    state.historyIndex -= 1;
    state.project = clone(state.history[state.historyIndex]);
    validateSelection();
    refreshLayout();
    renderAll();
    markDirty();
  }

  function redo() {
    if (state.historyIndex >= state.history.length - 1) return;
    pausePlayback();
    state.historyIndex += 1;
    state.project = clone(state.history[state.historyIndex]);
    validateSelection();
    refreshLayout();
    renderAll();
    markDirty();
  }

  function validateSelection() {
    const selection = state.selected;
    if (!selection) return;
    if (selection.type === 'clip' && !clipFor(selection.id)) state.selected = null;
    if (selection.type === 'text' && !textFor(selection.id)) state.selected = null;
    if (selection.type === 'music' && !state.project.music) state.selected = null;
    if (selection.type === 'transition') {
      const clip = clipFor(selection.clipId);
      const index = clip ? state.project.clips.indexOf(clip) : -1;
      if (!clip || index < 0 || index >= state.project.clips.length - 1) state.selected = null;
    }
  }

  function setAutosaveState(kind) {
    if (!refs.autosaveText) return;
    refs.autosaveText.classList.toggle('is-saving', kind === 'saving');
    if (kind === 'saving') refs.autosaveText.textContent = 'Kaydediliyor…';
    else if (kind === 'error') refs.autosaveText.textContent = 'Kaydedilemedi';
    else refs.autosaveText.textContent = 'Kaydedildi';
  }

  function markDirty() {
    state.project.updatedAt = Date.now();
    setAutosaveState('saving');
    if (autosaveTimer) clearTimeout(autosaveTimer);
    autosaveTimer = setTimeout(async () => {
      try {
        const result = await api.autosaveProject(projectForSave());
        if (result && result.ok === false) throw new Error(result.error || 'Otomatik kaydetme başarısız.');
        autosaveFailed = false;
        setAutosaveState('saved');
      } catch (error) {
        if (!autosaveFailed) {
          autosaveFailed = true;
          setAutosaveState('error');
          toast({
            type: 'warning',
            title: 'Otomatik kaydetme başarısız',
            message: error.message || 'Proje geçici olarak kaydedilemedi.',
          });
        }
      }
    }, 650);
  }

  function toast({ type = 'success', title = '', message = '', duration = 3200 }) {
    if (!refs.toastContainer) return;
    const icons = {
      success: 'i-check',
      error: 'i-alert',
      warning: 'i-alert',
      info: 'i-check-circle',
    };
    const item = document.createElement('div');
    item.className = `toast ${type === 'error' ? 'is-error' : type === 'warning' ? 'is-warning' : ''}`;
    item.innerHTML = `
      <span class="toast-icon"><svg class="icon"><use href="#${icons[type] || icons.info}"/></svg></span>
      <span class="toast-message">${title ? `<strong>${escapeHtml(title)}</strong>` : ''}${escapeHtml(message)}</span>
      <button class="toast-close" title="Kapat"><svg class="icon"><use href="#i-x"/></svg></button>
    `;
    const remove = () => {
      item.classList.add('is-leaving');
      setTimeout(() => item.remove(), 190);
    };
    item.querySelector('.toast-close').addEventListener('click', remove);
    refs.toastContainer.append(item);
    setTimeout(remove, duration);
  }

  function updateHistoryAndDirty() {
    updateHistoryButtons();
    markDirty();
  }

  async function call(fn, ...args) {
    const result = await fn(...args);
    if (!result || result.ok === false) {
      throw new Error(result && result.error ? result.error : 'İşlem tamamlanamadı.');
    }
    return result;
  }

  function renderAll(options = {}) {
    refreshLayout();
    renderProjectMeta();
    renderLibrary();
    renderTimeline();
    renderInspector();
    renderTextOverlay();
    updateStageSize();
    updatePlayheadUI();
    updatePreviewStatus();
    updateHistoryButtons();
    if (options.sync !== false) schedulePreviewSync(true);
  }

  function renderProjectMeta() {
    const project = state.project;
    if (refs.projectName) {
      refs.projectName.textContent = project.name || 'Yeni Proje';
      refs.projectName.parentElement.title = project.name || 'Yeni Proje';
    }
    if (refs.projectResolution) refs.projectResolution.textContent = `${project.width} × ${project.height}`;
    if (refs.projectFps) refs.projectFps.textContent = `${Math.round(project.fps)} fps`;
    if (refs.totalTime) refs.totalTime.textContent = formatPlayerTime(projectDuration());
    if (refs.timelineDuration) refs.timelineDuration.textContent = formatPlainTime(projectDuration());
    if (refs.exportButton) refs.exportButton.disabled = !project.clips.length;
    document.title = `${project.name || 'Yeni Proje'} — KesKlip`;
    refs.app.classList.remove('is-loading');
  }

  function queueLibraryRender() {
    if (state.libraryRaf) return;
    state.libraryRaf = requestAnimationFrame(() => {
      state.libraryRaf = 0;
      renderLibrary();
    });
  }

  function proxyBadgeMarkup(media) {
    const info = state.proxyInfo.get(media.id);
    const status = state.previewStatus.get(media.id);
    if (info && info.status === 'running') {
      const percent = Math.round(clamp(Number(info.progress) || 0, 0, 1) * 100);
      return `
        <span class="proxy-badge"><svg class="icon"><use href="#i-loader"/></svg>${percent > 1 ? `${percent}%` : 'Hazırlanıyor'}</span>
        <span class="media-progress"><span style="width:${percent}%"></span></span>
      `;
    }
    if (info && info.status === 'error') {
      return '<span class="proxy-badge is-error"><svg class="icon" style="animation:none"><use href="#i-alert"/></svg>Önizleme yok</span>';
    }
    if (status === 'preparing') {
      return '<span class="proxy-badge"><svg class="icon"><use href="#i-loader"/></svg>Hazırlanıyor</span>';
    }
    return '';
  }

  function mediaCardMarkup(media) {
    const isAudio = media.kind === 'audio';
    const offline = state.offline.has(media.path);
    const thumbUrl = state.thumbUrls.get(media.id);
    const waveformUrl = state.waveformUrls.get(media.id);
    const proxyBadge = isAudio ? '' : proxyBadgeMarkup(media);
    let visual = '';
    if (isAudio) {
      visual = waveformUrl
        ? `<img src="${escapeHtml(waveformUrl)}" alt="" style="object-fit:fill;opacity:.78">`
        : '<span class="media-thumb-placeholder"><svg class="icon"><use href="#i-wave"/></svg></span>';
    } else if (thumbUrl) {
      visual = `<img src="${escapeHtml(thumbUrl)}" alt="" loading="lazy">`;
    } else {
      visual = '<span class="media-thumb-placeholder"><svg class="icon"><use href="#i-film"/></svg></span>';
    }
    const subtitle = isAudio
      ? `Ses · ${escapeHtml(media.audioCodecLabel || 'Ses')}`
      : `${Number(media.width) || '?'} × ${Number(media.height) || '?'}`;
    return `
      <article class="media-card ${isAudio ? 'is-audio' : ''} ${offline ? 'is-offline' : ''}" data-media-id="${escapeHtml(media.id)}" draggable="true" title="${escapeHtml(media.name)}">
        <div class="media-thumb">
          ${visual}
          <span class="media-duration">${escapeHtml(T.formatClock(media.duration))}</span>
          <button class="media-add" data-add-media="${escapeHtml(media.id)}" title="${isAudio ? 'Müzik olarak ekle' : 'Zaman çizelgesine ekle'}">
            <svg class="icon"><use href="#i-plus"/></svg>
          </button>
          ${offline ? '<span class="media-offline"><svg class="icon"><use href="#i-alert"/></svg>Dosya yok</span>' : ''}
          ${proxyBadge}
        </div>
        <div class="media-info">
          <span class="media-name">${escapeHtml(media.name)}</span>
          <span class="media-sub">${subtitle}</span>
        </div>
      </article>
    `;
  }

  function pendingCardMarkup(pending) {
    return `
      <article class="media-card media-loading ${pending.isAudio ? 'is-audio' : ''}">
        <div class="media-thumb"></div>
        <div class="media-info">
          <span class="media-name"></span>
          <span class="media-sub"></span>
        </div>
      </article>
    `;
  }

  function renderLibrary() {
    const videos = state.project.media.filter((media) => media.kind === 'video');
    const audio = state.project.media.filter((media) => media.kind === 'audio');
    const pendingVideos = state.pendingImports.filter((pending) => !pending.isAudio);
    const pendingAudio = state.pendingImports.filter((pending) => pending.isAudio);

    if (refs.mediaCount) refs.mediaCount.textContent = String(videos.length + pendingVideos.length);
    if (refs.audioCount) refs.audioCount.textContent = String(audio.length + pendingAudio.length);

    if (refs.mediaList) {
      refs.mediaList.innerHTML = videos.map(mediaCardMarkup).join('') + pendingVideos.map(pendingCardMarkup).join('');
      refs.mediaList.classList.remove('is-audio');
    }
    if (refs.audioList) {
      refs.audioList.innerHTML = audio.map(mediaCardMarkup).join('') + pendingAudio.map(pendingCardMarkup).join('');
      refs.audioList.classList.add('is-audio');
    }
    if (refs.mediaEmpty) refs.mediaEmpty.classList.toggle('is-hidden', videos.length + pendingVideos.length > 0);
    if (refs.audioEmpty) refs.audioEmpty.classList.toggle('is-hidden', audio.length + pendingAudio.length > 0);
  }

  function chooseTickStep(pps) {
    const steps = [0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600, 7200];
    return steps.find((step) => step * pps >= 64) || 7200;
  }

  function formatRulerTime(time, step) {
    if (step >= 1) return T.formatClock(time);
    const decimals = step >= 0.5 ? 1 : step >= 0.1 ? 1 : 2;
    const safe = Math.max(0, time);
    const minutes = Math.floor(safe / 60);
    const seconds = (safe % 60).toFixed(decimals).padStart(decimals + 3, '0');
    return `${String(minutes).padStart(2, '0')}:${seconds}`;
  }

  function renderRuler() {
    if (!refs.timelineRuler || !refs.timelineScroll) return;
    const pps = state.pps;
    const duration = Math.max(projectDuration(), 1);
    const scrollLeft = refs.timelineScroll.scrollLeft || 0;
    const viewport = refs.timelineScroll.clientWidth || 800;
    const major = chooseTickStep(pps);
    const minor = major / 5;
    const rawStart = (scrollLeft - major * pps) / pps;
    const startTime = Math.max(0, Math.floor(rawStart / major) * major);
    const endTime = Math.min(duration + major, (scrollLeft + viewport + major * pps) / pps);
    const fragment = document.createDocumentFragment();

    let index = 0;
    for (let time = Math.ceil(startTime / minor) * minor; time <= endTime + 0.0001; time += minor, index += 1) {
      const isMajor = index % 5 === 0;
      const tick = document.createElement('div');
      tick.className = `ruler-tick${isMajor ? ' major' : ''}`;
      tick.style.left = `${time * pps}px`;
      fragment.append(tick);
      if (isMajor) {
        const label = document.createElement('span');
        label.className = 'ruler-label';
        label.style.left = `${time * pps}px`;
        label.textContent = formatRulerTime(time, major);
        fragment.append(label);
      }
    }

    refs.timelineRuler.innerHTML = '';
    refs.timelineRuler.append(fragment);
    refs.timelineContent.style.setProperty('--grid-size', `${major * pps}px`);
  }

  function renderTimeline() {
    refreshLayout();
    const duration = projectDuration();
    const pps = state.pps;
    const viewportWidth = refs.timelineScroll ? refs.timelineScroll.clientWidth : 900;
    const contentWidth = Math.max(viewportWidth, duration * pps + 100, 480);
    state.layout = T.computeLayout(state.project);
    if (refs.timelineContent) refs.timelineContent.style.width = `${contentWidth}px`;

    const selected = state.selected;
    let videoHtml = '';

    state.layout.items.forEach((item) => {
      const clip = item.clip;
      const media = mediaFor(clip.mediaId);
      if (!media) return;
      const thumbUrl = state.thumbUrls.get(media.id);
      const isSelected = selected && selected.type === 'clip' && selected.id === clip.id;
      const offline = state.offline.has(media.path);
      const left = item.start * pps;
      const width = Math.max(2, item.duration * pps);
      const speedLabel = Math.abs(clip.speed - 1) > 0.001 ? `${clip.speed}x` : '';
      const compact = width < 58;
      const thumbStyle = thumbUrl ? `background-image:${escapeHtml(cssUrl(thumbUrl))};` : '';
      videoHtml += `
        <div class="timeline-clip ${isSelected ? 'is-selected' : ''} ${offline ? 'is-offline' : ''}"
          data-clip-id="${escapeHtml(clip.id)}"
          style="left:${left}px;width:${width}px"
          draggable="true"
          title="${escapeHtml(media.name)}">
          ${thumbUrl ? `<span class="clip-thumb" style="${thumbStyle}"></span>` : '<span class="clip-thumbnail-placeholder"></span>'}
          <span class="clip-tint"></span>
          ${compact ? '' : `
            <span class="clip-content">
              <span class="clip-name">${escapeHtml(media.name)}</span>
              <span class="clip-meta-row">
                <span>${escapeHtml(T.formatClock(item.duration))}</span>
                ${speedLabel ? `<span class="clip-speed">${speedLabel}</span>` : '<span></span>'}
              </span>
            </span>
          `}
          <span class="trim-handle left" data-trim="left" title="Kırp"></span>
          <span class="trim-handle right" data-trim="right" title="Kırp"></span>
        </div>
      `;
    });

    state.layout.transitions.forEach((transition) => {
      const outgoing = state.project.clips[transition.afterIndex];
      if (!outgoing) return;
      const markerTime = (transition.start + transition.end) / 2;
      const isSelected = selected && selected.type === 'transition' && selected.clipId === outgoing.id;
      const label = widthLabel(transition.duration * pps, 34) ? TRANSITION_LABELS[transition.type] || 'Geçiş' : '';
      videoHtml += `
        <button class="transition-marker ${isSelected ? 'is-selected' : ''}" data-transition-clip="${escapeHtml(outgoing.id)}"
          style="left:${markerTime * pps}px" title="${TRANSITION_LABELS[transition.type] || 'Geçiş'} · ${transition.duration.toFixed(1)} sn">
          <svg class="icon"><use href="#i-sparkles"/></svg>${label ? `<span>${label}</span>` : ''}
        </button>
      `;
    });

    if (refs.videoTrack) refs.videoTrack.innerHTML = videoHtml;

    let textHtml = '';
    state.project.texts.forEach((text) => {
      const start = Math.max(0, Math.min(text.start, duration));
      const end = Math.max(start, Math.min(text.end, duration));
      if (end <= start) return;
      const isSelected = selected && selected.type === 'text' && selected.id === text.id;
      textHtml += `
        <div class="timeline-clip text-clip ${isSelected ? 'is-selected' : ''}"
          data-text-id="${escapeHtml(text.id)}"
          style="left:${start * pps}px;width:${Math.max(2, (end - start) * pps)}px"
          title="${escapeHtml(text.content || 'Yazı')}">
          <span class="clip-content">
            <span class="clip-name">${escapeHtml(text.content || 'Yazı')}</span>
            <span class="clip-meta-row"><span>${escapeHtml(T.formatClock(start))}</span><span>${escapeHtml(T.formatClock(end - start))}</span></span>
          </span>
          <span class="trim-handle left" data-text-trim="left" title="Kırp"></span>
          <span class="trim-handle right" data-text-trim="right" title="Kırp"></span>
        </div>
      `;
    });
    if (refs.textTrack) refs.textTrack.innerHTML = textHtml;

    let audioHtml = '';
    if (state.project.music) {
      const media = mediaFor(state.project.music.mediaId);
      if (media) {
        const isSelected = selected && selected.type === 'music';
        const end = state.project.music.loop ? duration : Math.min(duration, media.duration);
        if (end > 0) {
          const waveformUrl = state.waveformUrls.get(media.id);
          audioHtml = `
            <div class="timeline-clip audio-clip ${isSelected ? 'is-selected' : ''}"
              data-music-id="${escapeHtml(media.id)}"
              style="left:0;width:${Math.max(2, end * pps)}px"
              title="${escapeHtml(media.name)}">
              ${waveformUrl ? `<span class="audio-waveform" style="background-image:${escapeHtml(cssUrl(waveformUrl))}"></span>` : '<span class="audio-waveform-placeholder"></span>'}
              <span class="clip-content">
                <span class="clip-name">${escapeHtml(media.name)}</span>
                <span class="clip-meta-row"><span>${state.project.music.loop ? 'Döngüde' : 'Tek sefer'}</span><span>${escapeHtml(T.formatClock(end))}</span></span>
              </span>
            </div>
          `;
        }
      }
    }
    if (refs.audioTrack) refs.audioTrack.innerHTML = audioHtml;

    if (refs.timelineEmpty) refs.timelineEmpty.classList.toggle('is-hidden', state.project.clips.length > 0);
    if (refs.timelineDuration) refs.timelineDuration.textContent = formatPlainTime(duration);
    if (refs.timelineContent) {
      refs.timelineScroll.style.overflowX = 'auto';
    }
    renderRuler();
    updatePlayheadUI();
  }

  function widthLabel(pixelWidth, minWidth) {
    return pixelWidth >= minWidth;
  }

  function scheduleTimelineRender() {
    if (state.timelineRaf) return;
    state.timelineRaf = requestAnimationFrame(() => {
      state.timelineRaf = 0;
      renderTimeline();
      renderInspector();
    });
  }

  function renderTextOverlay() {
    if (!refs.textLayer) return;
    textOverlayEls.clear();
    refs.textLayer.innerHTML = '';
    const fragment = document.createDocumentFragment();
    state.project.texts.forEach((text) => {
      const node = document.createElement('div');
      node.className = 'preview-text';
      node.dataset.textId = text.id;
      node.textContent = text.content;
      if (state.selected && state.selected.type === 'text' && state.selected.id === text.id) {
        node.classList.add('is-selected');
      }
      fragment.append(node);
      textOverlayEls.set(text.id, { el: node, text });
    });
    refs.textLayer.append(fragment);
    updateTextOverlayStyles();
    updateTextOverlayVisibility(state.playhead);
  }

  function updateTextOverlayStyles() {
    const stageHeight = refs.previewStage ? refs.previewStage.clientHeight : 0;
    const height = stageHeight || state.project.height || 1080;
    textOverlayEls.forEach(({ el, text }) => {
      el.textContent = text.content;
      el.style.left = `${clamp(text.x, 0.02, 0.98) * 100}%`;
      el.style.top = `${clamp(text.y, 0.02, 0.98) * 100}%`;
      el.style.fontSize = `${Math.max(9, (Number(text.size) / 100) * height)}px`;
      el.style.color = text.color || '#ffffff';
      el.style.fontWeight = text.bold ? '800' : '600';
      el.classList.toggle('has-background', Boolean(text.background));
      el.classList.toggle('is-selected', Boolean(state.selected && state.selected.type === 'text' && state.selected.id === text.id));
    });
  }

  function updateTextOverlayVisibility(time) {
    textOverlayEls.forEach(({ el, text }) => {
      const visible = time >= text.start - 0.001 && time <= text.end + 0.001;
      el.style.display = visible ? '' : 'none';
    });
  }

  function updatePreviewStatus() {
    if (!refs.previewStatusText) return;
    const active = T.getActiveItems(state.layout, state.playhead);
    let text = 'Önizleme hazır';
    let mode = 'ready';
    if (!state.project.clips.length) {
      text = 'Video yok';
      mode = '';
    } else if (state.offline.size > 0 && active.some((item) => {
      const media = mediaFor(item.clip.mediaId);
      return media && state.offline.has(media.path);
    })) {
      text = 'Kaynak dosya bulunamadı';
      mode = 'error';
    } else {
      const pending = active.find((item) => {
        const media = mediaFor(item.clip.mediaId);
        if (!media) return true;
        const status = state.previewStatus.get(media.id);
        return !state.previewUrls.get(media.id) && status !== 'direct';
      });
      if (pending) {
        text = 'Önizleme hazırlanıyor…';
        mode = 'busy';
      }
    }
    refs.previewStatusText.textContent = text;
    refs.previewStatus.classList.toggle('is-busy', mode === 'busy');
    refs.previewStatus.classList.toggle('is-error', mode === 'error');
    updateStageNotice();
  }

  function ensureStageNotice() {
    if (state.stageNotice && state.stageNotice.isConnected) return state.stageNotice;
    const notice = document.createElement('div');
    notice.className = 'stage-notice';
    notice.innerHTML = `
      <span class="stage-notice-spinner"><svg class="icon"><use href="#i-loader"/></svg></span>
      <strong>Önizleme hazırlanıyor</strong>
      <span class="stage-notice-copy">Video ilk kez açılırken kısa bir hazırlık gerekebilir.</span>
    `;
    refs.previewStage.append(notice);
    state.stageNotice = notice;
    return notice;
  }

  function updateStageNotice() {
    if (!refs.previewStage) return;
    const active = T.getActiveItems(state.layout, state.playhead);
    const missing = active.find((item) => {
      const media = mediaFor(item.clip.mediaId);
      if (!media) return true;
      if (state.offline.has(media.path)) return true;
      return !state.previewUrls.get(media.id);
    });
    if (!state.project.clips.length || !missing) {
      if (state.stageNotice) state.stageNotice.classList.remove('is-visible');
      return;
    }
    const media = mediaFor(missing.clip.mediaId);
    const proxy = media ? state.proxyInfo.get(media.id) : null;
    const notice = ensureStageNotice();
    const title = notice.querySelector('strong');
    const copy = notice.querySelector('.stage-notice-copy');
    const spinner = notice.querySelector('.stage-notice-spinner');
    if (media && state.offline.has(media.path)) {
      title.textContent = 'Kaynak dosya bulunamadı';
      copy.textContent = 'Dosya taşınmış veya silinmiş olabilir. Projeyi yeniden içe aktararak devam edebilirsin.';
      spinner.style.display = 'none';
    } else if (proxy && proxy.status === 'error') {
      title.textContent = 'Önizleme oluşturulamadı';
      copy.textContent = proxy.message || 'Bu video için önizleme hazırlanamadı. Yine de dışa aktarmayı deneyebilirsin.';
      spinner.style.display = 'none';
    } else {
      title.textContent = 'Önizleme hazırlanıyor';
      copy.textContent = proxy && proxy.progress
        ? `%${Math.round(proxy.progress * 100)} tamamlandı · kaynak dosya değiştirilmiyor`
        : '40 dakikalık videolar bile içe aktarılırken kopyalanmaz. Önizleme arka planda hazırlanıyor.';
      spinner.style.display = '';
    }
    notice.classList.add('is-visible');
  }

  function updatePlayheadUI() {
    const duration = projectDuration();
    const pps = state.pps;
    if (refs.currentTime) refs.currentTime.textContent = formatPlayerTime(state.playhead);
    if (refs.totalTime) refs.totalTime.textContent = formatPlayerTime(duration);
    if (refs.timelineDuration) refs.timelineDuration.textContent = formatPlainTime(duration);
    if (refs.playhead) refs.playhead.style.left = `${state.playhead * pps}px`;
    if (refs.miniProgress) refs.miniProgress.style.width = `${duration > 0 ? (state.playhead / duration) * 100 : 0}%`;
    if (refs.miniHandle) refs.miniHandle.style.left = `${duration > 0 ? (state.playhead / duration) * 100 : 0}%`;
    if (refs.playButton) {
      refs.playButton.classList.toggle('is-playing', state.playing);
      refs.playButton.disabled = !state.project.clips.length;
    }
    updateTextOverlayVisibility(state.playhead);
    if (state.stageNotice) updateStageNotice();
  }

  function updateStageSize() {
    if (!refs.previewArea || !refs.previewStage) return;
    if (refs.previewStage.classList.contains('is-fullscreen')) return;
    const rect = refs.previewArea.getBoundingClientRect();
    const computed = getComputedStyle(refs.previewArea);
    const padX = (parseFloat(computed.paddingLeft) || 0) + (parseFloat(computed.paddingRight) || 0);
    const padY = (parseFloat(computed.paddingTop) || 0) + (parseFloat(computed.paddingBottom) || 0);
    const availableWidth = Math.max(160, rect.width - padX);
    const availableHeight = Math.max(100, rect.height - padY);
    const ratio = (state.project.width || 16) / (state.project.height || 9);
    let width = availableWidth;
    let height = width / ratio;
    if (height > availableHeight) {
      height = availableHeight;
      width = height * ratio;
    }
    refs.previewStage.style.width = `${Math.floor(width)}px`;
    refs.previewStage.style.height = `${Math.floor(height)}px`;
    updateTextOverlayStyles();
  }

  function queueStageResize() {
    if (state.stageRaf) return;
    state.stageRaf = requestAnimationFrame(() => {
      state.stageRaf = 0;
      updateStageSize();
    });
  }

  // ── Playback engine ─────────────────────────────────────

  function previewSourceFor(media) {
    if (!media) return '';
    return state.previewUrls.get(media.id) || '';
  }

  function attachPlayerHandlers() {
    players.forEach((player) => {
      player.el.addEventListener('loadedmetadata', () => {
        player.ready = true;
        if (player.pendingSeek != null) {
          try { player.el.currentTime = player.pendingSeek; } catch { /* ignore */ }
          player.pendingSeek = null;
        }
      });
      player.el.addEventListener('error', () => {
        player.ready = false;
        const clip = player.clipId ? clipFor(player.clipId) : null;
        const media = clip ? mediaFor(clip.mediaId) : null;
        if (media) {
          state.proxyInfo.set(media.id, {
            status: 'error',
            message: 'Önizleme oynatılamadı. Kaynak dosya bozuk olabilir.',
          });
          updatePreviewStatus();
        }
      });
    });
  }

  function resetPlayer(player) {
    player.clipId = null;
    player.url = '';
    player.ready = false;
    player.pendingSeek = null;
    player.el.classList.remove('is-visible');
    player.el.style.opacity = '0';
    player.el.style.transform = '';
    player.el.style.clipPath = '';
    try { player.el.pause(); } catch { /* ignore */ }
  }

  function ensurePlayerFor(player, media, clip, item, time, playing) {
    const source = previewSourceFor(media);
    if (!source) {
      if (player.clipId === clip.id) resetPlayer(player);
      player.el.classList.remove('is-visible');
      return null;
    }

    if (player.clipId !== clip.id || player.url !== source) {
      player.clipId = clip.id;
      player.url = source;
      player.ready = false;
      player.pendingSeek = null;
      player.el.src = source;
      try { player.el.load(); } catch { /* ignore */ }
    }

    const target = T.timeToSource(item, time);
    const speed = clamp(Number(clip.speed) || 1, 0.5, 2);
    if (Math.abs((player.el.playbackRate || 1) - speed) > 0.001) {
      player.el.playbackRate = speed;
    }
    if (player.el.preservesPitch !== undefined) player.el.preservesPitch = false;
    if (player.el.readyState >= 1) player.ready = true;

    if (!player.ready || player.el.readyState < 1) {
      player.pendingSeek = target;
    } else {
      const drift = Math.abs(player.el.currentTime - target);
      const threshold = playing ? 0.3 : 0.06;
      if (drift > threshold) {
        try { player.el.currentTime = target; } catch { /* ignore */ }
      }
    }

    if (playing) {
      if (player.el.paused) {
        const attempt = player.el.play();
        if (attempt && typeof attempt.catch === 'function') attempt.catch(() => {});
      }
    } else if (!player.el.paused) {
      player.el.pause();
    }

    player.el.style.opacity = '1';
    player.el.style.transform = '';
    player.el.style.clipPath = '';
    player.el.classList.add('is-visible');
    return player;
  }

  function setPlayerOpacity(player, value) {
    if (!player) return;
    player.el.style.opacity = String(clamp(value, 0, 1));
  }

  function setPlayerVolume(player, volume) {
    if (!player) return;
    player.el.volume = clamp(Number(volume) || 0, 0, 1);
    player.el.muted = state.muted || volume <= 0.001;
  }

  function clipFadeFactor(item, time) {
    if (!item || !item.clip) return 1;
    const duration = Math.max(0.001, Number(item.duration) || T.getClipDuration(item.clip));
    const fades = T.getClipFades(item.clip);
    const local = clamp(time - item.start, 0, duration);
    let factor = 1;
    if (fades.fadeIn > 0.01 && local < fades.fadeIn) {
      factor *= clamp(local / fades.fadeIn, 0, 1);
    }
    if (fades.fadeOut > 0.01 && local > duration - fades.fadeOut) {
      factor *= clamp((duration - local) / fades.fadeOut, 0, 1);
    }
    return clamp(factor, 0, 1);
  }

  function applyClipFadeToPlayer(player, item, time) {
    if (!player) return 1;
    const factor = clipFadeFactor(item, time);
    const opacity = Number(player.el.style.opacity || 0);
    const volume = Number(player.el.volume || 0);
    setPlayerOpacity(player, opacity * factor);
    setPlayerVolume(player, volume * factor);
    return factor;
  }

  function applyTransitionToPlayers(outgoing, incoming, transition, time) {
    const span = Math.max(0.001, transition.end - transition.start);
    const progress = clamp((time - transition.start) / span, 0, 1);
    const eased = progress * progress * (3 - 2 * progress);
    if (refs.flashLayer) refs.flashLayer.style.opacity = '0';
    if (outgoing) outgoing.el.style.clipPath = '';
    if (incoming) incoming.el.style.clipPath = '';

    if (transition.type === 'slide') {
      if (outgoing) {
        outgoing.el.style.transform = `translateX(${-32 * eased}%)`;
        setPlayerOpacity(outgoing, 1);
      }
      if (incoming) {
        incoming.el.style.transform = `translateX(${100 - eased * 100}%)`;
        setPlayerOpacity(incoming, 1);
      }
    } else if (transition.type === 'flash') {
      if (outgoing) setPlayerOpacity(outgoing, 1 - eased * 0.25);
      if (incoming) setPlayerOpacity(incoming, 0.35 + eased * 0.65);
      if (refs.flashLayer) {
        const flash = Math.sin(progress * Math.PI);
        refs.flashLayer.style.opacity = String(clamp(flash * 0.92, 0, 1));
      }
    } else if (transition.type === 'zoom') {
      if (outgoing) {
        outgoing.el.style.transform = `scale(${(1 + eased * 0.24).toFixed(4)})`;
        setPlayerOpacity(outgoing, 1 - eased);
      }
      if (incoming) {
        incoming.el.style.transform = `scale(${(0.86 + eased * 0.14).toFixed(4)})`;
        setPlayerOpacity(incoming, eased);
      }
    } else if (transition.type === 'wipe') {
      if (outgoing) setPlayerOpacity(outgoing, 1);
      if (incoming) {
        incoming.el.style.clipPath = `inset(0 0 0 ${((1 - eased) * 100).toFixed(2)}%)`;
        setPlayerOpacity(incoming, 1);
      }
    } else if (transition.type === 'circle') {
      if (outgoing) setPlayerOpacity(outgoing, 1);
      if (incoming) {
        incoming.el.style.clipPath = `circle(${(eased * 75).toFixed(2)}% at 50% 50%)`;
        setPlayerOpacity(incoming, 1);
      }
    } else {
      if (outgoing) setPlayerOpacity(outgoing, 1 - eased);
      if (incoming) setPlayerOpacity(incoming, eased);
    }

    if (outgoing) setPlayerVolume(outgoing, outgoing.clipVolume * (1 - eased * 0.65));
    if (incoming) setPlayerVolume(incoming, incoming.clipVolume * (0.35 + eased * 0.65));
  }

  function syncMusic(time, playing) {
    const music = state.project.music;
    const media = music ? mediaFor(music.mediaId) : null;
    if (!music || !media) {
      if (musicAudio) {
        musicAudio.pause();
        musicAudio.removeAttribute('src');
        musicAudio.load();
      }
      return;
    }

    if (!musicAudio) {
      musicAudio = new Audio();
      musicAudio.preload = 'auto';
    }

    const source = previewSourceFor(media) || fileUrl(media.path);
    if (!source) {
      musicAudio.pause();
      return;
    }
    if (musicAudio.src !== source) {
      musicAudio.src = source;
      try { musicAudio.load(); } catch { /* ignore */ }
    }

    const duration = Math.max(0.1, Number(media.duration) || 0.1);
    const projectLength = Math.max(0.1, projectDuration());
    let target = time;
    if (music.loop) {
      target = time % duration;
    } else if (time > duration) {
      if (!musicAudio.paused) musicAudio.pause();
      if (Math.abs(musicAudio.currentTime - duration) > 0.4) {
        try { musicAudio.currentTime = Math.max(0, duration - 0.1); } catch { /* ignore */ }
      }
      return;
    }

    const drift = Math.abs((musicAudio.currentTime || 0) - target);
    if (drift > (playing ? 0.4 : 0.08)) {
      try { musicAudio.currentTime = target; } catch { /* ignore */ }
    }

    const fadeIn = clamp(Number(music.fadeIn) || 0, 0, 10);
    const fadeOut = clamp(Number(music.fadeOut) || 0, 0, 10);
    let gain = clamp(Number(music.volume) || 0, 0, 1.5);
    if (fadeIn > 0.01 && time < fadeIn) gain *= clamp(time / fadeIn, 0, 1);
    if (fadeOut > 0.01 && time > projectLength - fadeOut) {
      gain *= clamp((projectLength - time) / fadeOut, 0, 1);
    }
    musicAudio.volume = clamp(gain * state.monitorVolume, 0, 1);
    musicAudio.muted = state.muted;

    if (playing) {
      if (musicAudio.paused) {
        const attempt = musicAudio.play();
        if (attempt && typeof attempt.catch === 'function') attempt.catch(() => {});
      }
    } else if (!musicAudio.paused) {
      musicAudio.pause();
    }
  }

  function syncPreview(force = false) {
    const active = T.getActiveItems(state.layout, state.playhead);
    const transition = T.getTransitionAtTime(state.layout, state.playhead);

    players.forEach((player) => {
      player.el.style.transform = '';
      player.el.style.clipPath = '';
    });
    if (refs.flashLayer) refs.flashLayer.style.opacity = '0';

    if (!state.project.clips.length || !active.length) {
      players.forEach(resetPlayer);
      syncMusic(state.playhead, false);
      if (refs.stageEmpty) refs.stageEmpty.classList.remove('is-hidden');
      if (refs.flashLayer) refs.flashLayer.style.opacity = '0';
      updateStageNotice();
      return;
    }

    if (refs.stageEmpty) refs.stageEmpty.classList.add('is-hidden');

    if (active.length === 1) {
      const item = active[0];
      const media = mediaFor(item.clip.mediaId);
      const primary = players[0];
      resetPlayer(players[1]);
      const player = ensurePlayerFor(primary, media, item.clip, item, state.playhead, state.playing);
      if (player) {
        player.clipVolume = clamp(Number(item.clip.volume) == null ? 1 : Number(item.clip.volume), 0, 1.5);
        setPlayerOpacity(player, 1);
        setPlayerVolume(player, player.clipVolume);
        applyClipFadeToPlayer(player, item, state.playhead);
      }
    } else {
      const outgoingItem = active[0];
      const incomingItem = active[1];
      const outgoingMedia = mediaFor(outgoingItem.clip.mediaId);
      const incomingMedia = mediaFor(incomingItem.clip.mediaId);
      const outgoing = ensurePlayerFor(players[0], outgoingMedia, outgoingItem.clip, outgoingItem, state.playhead, state.playing);
      const incoming = ensurePlayerFor(players[1], incomingMedia, incomingItem.clip, incomingItem, state.playhead, state.playing);
      if (outgoing) outgoing.clipVolume = clamp(Number(outgoingItem.clip.volume) == null ? 1 : Number(outgoingItem.clip.volume), 0, 1.5);
      if (incoming) incoming.clipVolume = clamp(Number(incomingItem.clip.volume) == null ? 1 : Number(incomingItem.clip.volume), 0, 1.5);
      if (transition) {
        applyTransitionToPlayers(outgoing, incoming, transition, state.playhead);
      } else {
        setPlayerOpacity(outgoing, 1);
        setPlayerOpacity(incoming, 1);
        if (outgoing) setPlayerVolume(outgoing, outgoing.clipVolume);
        if (incoming) setPlayerVolume(incoming, incoming.clipVolume);
      }
      if (outgoing) applyClipFadeToPlayer(outgoing, outgoingItem, state.playhead);
      if (incoming) applyClipFadeToPlayer(incoming, incomingItem, state.playhead);
    }

    syncMusic(state.playhead, state.playing);
    if (force) updatePreviewStatus();
    updateStageNotice();
  }

  function schedulePreviewSync(force = false) {
    if (force) state.previewForce = true;
    if (state.previewRaf) return;
    state.previewRaf = requestAnimationFrame(() => {
      state.previewRaf = 0;
      const shouldForce = Boolean(state.previewForce);
      state.previewForce = false;
      syncPreview(shouldForce);
    });
  }

  function seekTo(time, options = {}) {
    const duration = projectDuration();
    state.playhead = clamp(Number(time) || 0, 0, Math.max(0, duration));
    updatePlayheadUI();
    syncPreview(true);
    if (options.render) scheduleTimelineRender();
  }

  function playbackTick() {
    if (!state.playing) return;
    const now = performance.now();
    const delta = state.lastFrame ? Math.min(0.25, (now - state.lastFrame) / 1000) : 0;
    state.lastFrame = now;
    const duration = projectDuration();
    if (duration <= 0) {
      pausePlayback();
      return;
    }
    state.playhead = Math.min(duration, state.playhead + delta);
    updatePlayheadUI();
    syncPreview(false);
    if (state.playhead >= duration - 0.001) {
      state.playhead = duration;
      pausePlayback();
      updatePlayheadUI();
      syncPreview(true);
      return;
    }
    requestAnimationFrame(playbackTick);
  }

  function playPlayback() {
    if (!state.project.clips.length) return;
    const duration = projectDuration();
    if (duration <= 0.02) return;
    if (state.playhead >= duration - 0.02) state.playhead = 0;
    state.playing = true;
    state.lastFrame = performance.now();
    updatePlayheadUI();
    syncPreview(true);
    requestAnimationFrame(playbackTick);
  }

  function pausePlayback() {
    const wasPlaying = state.playing;
    state.playing = false;
    state.lastFrame = 0;
    if (wasPlaying || true) {
      players.forEach((player) => {
        try { player.el.pause(); } catch { /* ignore */ }
      });
      if (musicAudio) {
        try { musicAudio.pause(); } catch { /* ignore */ }
      }
    }
    updatePlayheadUI();
  }

  function togglePlayback() {
    if (state.playing) pausePlayback();
    else playPlayback();
  }

  function stepFrame(direction) {
    const frame = 1 / Math.max(1, state.project.fps || 30);
    pausePlayback();
    seekTo(state.playhead + direction * Math.max(frame, 0.033));
  }

  function ensureMusicAudioElement() {
    if (!musicAudio) {
      musicAudio = new Audio();
      musicAudio.preload = 'auto';
    }
    syncMusic(state.playhead, false);
  }

  function refreshAudioSettings() {
    if (musicAudio) {
      const music = state.project.music;
      const base = music ? clamp(Number(music.volume) || 0, 0, 1.5) : 0;
      musicAudio.volume = clamp(base * state.monitorVolume, 0, 1);
      musicAudio.muted = state.muted;
    }
    players.forEach((player) => {
      player.el.muted = state.muted;
    });
    if (refs.monitorVolume) {
      const value = Math.round(state.monitorVolume * 100);
      refs.monitorVolume.value = String(state.muted ? 0 : value);
      refs.monitorVolume.style.setProperty('--range-fill', `${state.muted ? 0 : value}%`);
    }
    if (refs.muteButton) {
      refs.muteButton.innerHTML = `<svg class="icon icon-sm"><use href="#${state.muted ? 'i-volume-x' : 'i-volume'}"/></svg>`;
      refs.muteButton.title = state.muted ? 'Sesi aç' : 'Sesi kapat';
    }
    syncPreview(true);
  }

  // ── Import & media preparation ──────────────────────────

  const VIDEO_EXT = /\.(mp4|m4v|mov|mkv|avi|webm|ogv|mpg|mpeg|ts|mts|m2ts|wmv|flv|3gp)$/i;
  const AUDIO_EXT = /\.(mp3|wav|m4a|aac|flac|ogg|opus|wma|aiff|aif)$/i;

  function isAudioPath(filePath) {
    return AUDIO_EXT.test(String(filePath || ''));
  }

  function addPendingImport(filePath, isAudio) {
    const key = uid('pending');
    state.pendingImports.push({
      key,
      isAudio,
      name: String(filePath || '').split(/[\\/]/).pop() || 'Medya',
    });
    queueLibraryRender();
    return key;
  }

  function removePendingImport(key) {
    state.pendingImports = state.pendingImports.filter((pending) => pending.key !== key);
    queueLibraryRender();
  }

  function findMediaByPath(filePath) {
    const normalized = String(filePath || '').toLowerCase();
    return state.project.media.find((media) => String(media.path || '').toLowerCase() === normalized) || null;
  }

  function addClipFromMedia(media, options = {}) {
    if (!media || media.kind !== 'video') return null;
    const wasEmpty = state.project.clips.length === 0;
    const clip = {
      id: uid('clip'),
      mediaId: media.id,
      inPoint: 0,
      outPoint: Math.max(0.1, Number(media.duration) || 0.1),
      speed: 1,
      volume: 1,
      fadeIn: 0,
      fadeOut: 0,
      transitionAfter: null,
    };
    if (options.atEnd === false) {
      state.project.clips.unshift(clip);
    } else {
      state.project.clips.push(clip);
    }
    if (state.project.clips.length === 1) {
      state.project.width = even(media.width || state.project.width);
      state.project.height = even(media.height || state.project.height);
      state.project.fps = clamp(Number(media.fps) || state.project.fps, 1, 120);
    }
    state.selected = { type: 'clip', id: clip.id };
    refreshLayout();
    renderAll({ sync: false });
    const item = state.layout.items.find((entry) => entry.clip.id === clip.id);
    state.playhead = item ? item.start : 0;
    updatePlayheadUI();
    syncPreview(true);
    scheduleTimelineRender();
    if (wasEmpty) fitTimeline();
    pushHistory();
    markDirty();
    return clip;
  }

  function attachMusic(media, options = {}) {
    if (!media || media.kind !== 'audio') return;
    state.project.music = {
      mediaId: media.id,
      volume: options.volume == null ? 0.35 : options.volume,
      loop: options.loop !== false,
      fadeIn: 0.6,
      fadeOut: 1.2,
    };
    state.selected = { type: 'music' };
    ensureMusicAudioElement();
    renderAll();
    pushHistory();
    markDirty();
  }

  function prepareMediaPreview(media) {
    if (!media) return;
    if (media.playbackMode === 'direct') {
      state.previewUrls.set(media.id, fileUrl(media.path));
      state.previewStatus.set(media.id, 'direct');
      state.proxyInfo.delete(media.id);
      return;
    }
    state.previewStatus.set(media.id, 'preparing');
    api.preparePreview(media).then((result) => {
      if (!result || result.ok === false) throw new Error(result && result.error ? result.error : 'Önizleme başlatılamadı.');
      const info = result.result || {};
      if (info.previewUrl) {
        state.previewUrls.set(media.id, info.previewUrl);
        state.previewStatus.set(media.id, 'ready');
      }
      if (info.status === 'running' || info.status === 'starting') {
        state.previewStatus.set(media.id, 'preparing');
        state.proxyInfo.set(media.id, {
          status: 'running',
          progress: 0,
          message: media.playbackMode === 'remux' ? 'Önizleme kopyası hazırlanıyor…' : 'Önizleme oluşturuluyor…',
        });
      } else if (info.status === 'done' || info.status === 'ready' || info.status === 'not-needed') {
        if (info.previewUrl) state.previewUrls.set(media.id, info.previewUrl);
        state.previewStatus.set(media.id, 'ready');
        state.proxyInfo.delete(media.id);
      }
    }).catch((error) => {
      state.previewStatus.set(media.id, 'error');
      state.proxyInfo.set(media.id, {
        status: 'error',
        message: error.message || 'Önizleme hazırlanamadı.',
      });
      updatePreviewStatus();
      queueLibraryRender();
    }).finally(() => {
      queueLibraryRender();
      if (T.getActiveItems(state.layout, state.playhead).some((item) => item.clip.mediaId === media.id)) {
        schedulePreviewSync(true);
      }
      updatePreviewStatus();
    });
  }

  async function hydrateMedia(media, options = {}) {
    if (!media) return;
    if (media.playbackMode === 'direct') {
      state.previewUrls.set(media.id, fileUrl(media.path));
    }
    prepareMediaPreview(media);

    try {
      const result = await api.createThumbnail(media);
      if (result && result.ok !== false) {
        if (result.thumbUrl) state.thumbUrls.set(media.id, result.thumbUrl);
        if (result.waveformUrl) state.waveformUrls.set(media.id, result.waveformUrl);
      }
    } catch (error) {
      if (!options.quiet) console.warn('Küçük görsel hazırlanamadı:', error);
    }
    queueLibraryRender();
    scheduleTimelineRender();
  }

  async function hydrateAllMedia() {
    await Promise.allSettled(state.project.media.map((media) => hydrateMedia(media, { quiet: true })));
    await refreshOfflineStatus();
  }

  async function refreshOfflineStatus() {
    if (!state.project.media.length) {
      state.offline.clear();
      return;
    }
    try {
      const result = await call(api.checkPaths, state.project.media.map((media) => media.path));
      const list = result.result || [];
      const next = new Set();
      list.forEach((entry) => {
        if (!entry.exists) next.add(entry.path);
      });
      state.offline = next;
      queueLibraryRender();
      scheduleTimelineRender();
      updatePreviewStatus();
    } catch (error) {
      console.warn('Dosya denetimi yapılamadı:', error);
    }
  }

  async function importPaths(paths, options = {}) {
    const list = (Array.isArray(paths) ? paths : [paths])
      .filter((item) => typeof item === 'string' && item.trim())
      .map((item) => item.trim());
    if (!list.length) return;

    const onlyAudio = Boolean(options.asMusic);
    const candidates = [];
    for (const filePath of list) {
      const audio = isAudioPath(filePath);
      if (onlyAudio && !audio) continue;
      if (findMediaByPath(filePath)) {
        if (!options.quiet) toast({ type: 'info', title: 'Zaten kitaplıkta', message: String(filePath).split(/[\\/]/).pop() });
        continue;
      }
      if (!audio && !VIDEO_EXT.test(filePath)) {
        if (!options.quiet) toast({ type: 'warning', title: 'Desteklenmeyen dosya', message: `${String(filePath).split(/[\\/]/).pop()} desteklenen bir video ya da ses dosyası değil.` });
        continue;
      }
      candidates.push({ filePath, audio });
    }

    if (!candidates.length) return;

    const existingClipsBefore = state.project.clips.length;
    let addedAny = false;
    let firstVideo = null;
    const probeResults = [];

    for (const candidate of candidates) {
      const pendingKey = addPendingImport(candidate.filePath, candidate.audio);
      try {
        const result = await call(api.probeMedia, candidate.filePath);
        const media = result.media;
        if (!media) throw new Error('Dosya bilgisi alınamadı.');
        const existing = state.project.media.find((entry) => entry.id === media.id || String(entry.path || '').toLowerCase() === String(media.path || '').toLowerCase());
        if (existing) continue;
        media.kind = media.isAudioOnly ? 'audio' : 'video';
        media.playbackMode = media.playbackMode || 'direct';
        state.project.media.push(media);
        probeResults.push({ media, audio: candidate.audio || media.kind === 'audio' });
        addedAny = true;
        if (media.kind === 'video' && !firstVideo) firstVideo = media;
        if (media.playbackMode === 'direct') {
          state.previewUrls.set(media.id, fileUrl(media.path));
          state.previewStatus.set(media.id, 'direct');
        }
      } catch (error) {
        toast({ type: 'error', title: 'İçe aktarılamadı', message: error.message || 'Dosya okunamadı.' });
      } finally {
        removePendingImport(pendingKey);
      }
    }

    if (!addedAny) {
      renderLibrary();
      return;
    }

    if (firstVideo && existingClipsBefore === 0) {
      addClipFromMedia(firstVideo, { atEnd: true });
    }
    const firstAudio = probeResults.find((entry) => entry.media.kind === 'audio');
    if (firstAudio && !state.project.music && options.autoMusic !== false) {
      attachMusic(firstAudio.media, { volume: 0.35 });
    } else {
      refreshLayout();
      renderAll();
      pushHistory();
      markDirty();
    }

    probeResults.forEach((entry) => {
      hydrateMedia(entry.media, { quiet: true });
    });

    const addedVideos = probeResults.filter((entry) => entry.media.kind === 'video').length;
    const addedAudio = probeResults.length - addedVideos;
    if (!options.quiet) {
      const parts = [];
      if (addedVideos) parts.push(`${addedVideos} video`);
      if (addedAudio) parts.push(`${addedAudio} ses`);
      toast({
        type: 'success',
        title: 'İçe aktarma tamam',
        message: `${parts.join(' ve ')} kitaplığa eklendi. Dosyalar kopyalanmadı.`,
        duration: 2800,
      });
    }
  }

  async function pickAndImport(kind = 'video') {
    try {
      const result = await call(api.pickMedia, kind);
      const paths = result.paths || [];
      if (paths.length) await importPaths(paths, { asMusic: kind === 'audio' });
    } catch (error) {
      toast({ type: 'error', title: 'Dosya seçilemedi', message: error.message || 'Beklenmeyen bir hata oluştu.' });
    }
  }

  function handleProxyUpdate(payload) {
    if (!payload || !payload.mediaId) return;
    const media = mediaFor(payload.mediaId);
    if (!media) return;
    if (!payload.status) return;
    state.proxyInfo.set(payload.mediaId, payload);
    if (payload.status === 'done') {
      const url = payload.outputPath ? fileUrl(payload.outputPath) : '';
      if (url) state.previewUrls.set(payload.mediaId, url);
      state.previewStatus.set(payload.mediaId, 'ready');
    } else if (payload.status === 'error') {
      state.previewStatus.set(payload.mediaId, 'error');
    } else {
      state.previewStatus.set(payload.mediaId, 'preparing');
    }
    queueLibraryRender();
    updatePreviewStatus();
    const active = T.getActiveItems(state.layout, state.playhead);
    if (active.some((item) => item.clip.mediaId === payload.mediaId)) {
      schedulePreviewSync(true);
    }
    if (payload.status === 'done') {
      toast({ type: 'success', title: 'Önizleme hazır', message: `${media.name} artık akıcı oynatılabilir.`, duration: 2600 });
    } else if (payload.status === 'error') {
      toast({ type: 'warning', title: 'Önizleme hazırlanamadı', message: payload.message || media.name, duration: 5000 });
    }
  }

  // ── Timeline interactions ───────────────────────────────

  const TIMELINE_MIN_PPS = 0.05;
  const TIMELINE_MAX_PPS = 800;

  function ppsFromSlider(value) {
    const v = clamp(Number(value) || 0, 0, 100);
    const ratio = TIMELINE_MAX_PPS / TIMELINE_MIN_PPS;
    return clamp(TIMELINE_MIN_PPS * Math.pow(ratio, v / 100), TIMELINE_MIN_PPS, TIMELINE_MAX_PPS);
  }

  function sliderFromPps(pps) {
    const safe = clamp(Number(pps) || TIMELINE_MIN_PPS, TIMELINE_MIN_PPS, TIMELINE_MAX_PPS);
    const ratio = Math.log(TIMELINE_MAX_PPS / TIMELINE_MIN_PPS);
    return clamp((Math.log(safe / TIMELINE_MIN_PPS) / ratio) * 100, 0, 100);
  }

  function setZoom(value, options = {}) {
    const oldPps = state.pps;
    state.zoomValue = clamp(Number(value) || 0, 0, 100);
    state.pps = ppsFromSlider(state.zoomValue);
    if (refs.zoomSlider) refs.zoomSlider.value = String(state.zoomValue);
    if (refs.timelineScroll && options.keepAnchor !== false) {
      const anchorTime = (refs.timelineScroll.scrollLeft + refs.timelineScroll.clientWidth / 2) / oldPps;
      renderTimeline();
      refs.timelineScroll.scrollLeft = Math.max(0, anchorTime * state.pps - refs.timelineScroll.clientWidth / 2);
    } else {
      renderTimeline();
    }
  }

  function fitTimeline() {
    const duration = Math.max(projectDuration(), 1);
    const viewport = refs.timelineScroll ? Math.max(220, refs.timelineScroll.clientWidth - 28) : 900;
    const pps = clamp(viewport / duration, TIMELINE_MIN_PPS, TIMELINE_MAX_PPS);
    state.pps = pps;
    state.zoomValue = sliderFromPps(pps);
    if (refs.zoomSlider) refs.zoomSlider.value = String(state.zoomValue);
    renderTimeline();
    if (refs.timelineScroll) refs.timelineScroll.scrollLeft = 0;
  }

  function setSelection(selection, options = {}) {
    state.selected = selection || null;
    if (options.render !== false) {
      renderAll({ sync: false });
      schedulePreviewSync(true);
    }
    updateInspectorSelection();
  }

  function updateInspectorSelection() {
    if (refs.videoTrack) {
      $$('.timeline-clip.is-selected', refs.videoTrack).forEach((el) => el.classList.remove('is-selected'));
      const clipId = selectedClipId();
      if (clipId) {
        const el = $(`[data-clip-id="${cssEscape(clipId)}"]`, refs.videoTrack);
        if (el) el.classList.add('is-selected');
      }
    }
    if (refs.textTrack) {
      $$('.timeline-clip.is-selected', refs.textTrack).forEach((el) => el.classList.remove('is-selected'));
      const textId = state.selected && state.selected.type === 'text' ? state.selected.id : null;
      if (textId) {
        const el = $(`[data-text-id="${cssEscape(textId)}"]`, refs.textTrack);
        if (el) el.classList.add('is-selected');
      }
    }
    if (refs.audioTrack) {
      $$('.timeline-clip.is-selected', refs.audioTrack).forEach((el) => el.classList.remove('is-selected'));
      if (state.selected && state.selected.type === 'music') {
        const el = $('.audio-clip', refs.audioTrack);
        if (el) el.classList.add('is-selected');
      }
    }
    textOverlayEls.forEach(({ el }, id) => {
      el.classList.toggle('is-selected', Boolean(state.selected && state.selected.type === 'text' && state.selected.id === id));
    });
  }

  function cssEscape(value) {
    if (window.CSS && typeof window.CSS.escape === 'function') return window.CSS.escape(String(value));
    return String(value).replace(/["\\]/g, '\\$&');
  }

  function refreshAfterEdit({ history = true, render = true } = {}) {
    refreshLayout();
    if (render) renderAll({ sync: false });
    if (history) pushHistory();
    markDirty();
    schedulePreviewSync(true);
  }

  function deleteSelection() {
    const selection = state.selected;
    if (!selection) return;
    pausePlayback();

    if (selection.type === 'clip') {
      const index = state.project.clips.findIndex((clip) => clip.id === selection.id);
      if (index < 0) return;
      state.project.clips.splice(index, 1);
      if (state.project.clips.length) {
        state.project.clips[state.project.clips.length - 1].transitionAfter = null;
      }
      state.selected = null;
    } else if (selection.type === 'text') {
      state.project.texts = state.project.texts.filter((text) => text.id !== selection.id);
      state.selected = null;
    } else if (selection.type === 'music') {
      state.project.music = null;
      state.selected = null;
      if (musicAudio) {
        musicAudio.pause();
        musicAudio.removeAttribute('src');
      }
    } else if (selection.type === 'transition') {
      const clip = clipFor(selection.clipId);
      if (clip) {
        clip.transitionAfter = null;
        state.selected = { type: 'clip', id: clip.id };
      }
    }

    refreshAfterEdit();
    toast({ type: 'info', title: 'Silindi', message: 'Değişikliği Ctrl+Z ile geri alabilirsin.', duration: 2200 });
  }

  function splitAtPlayhead() {
    pausePlayback();
    const time = state.playhead;
    const selectedId = selectedClipId();
    let item = selectedId
      ? state.layout.items.find((entry) => entry.clip.id === selectedId && time > entry.start + 0.03 && time < entry.end - 0.03)
      : null;
    if (!item) {
      item = state.layout.items.find((entry) => time > entry.start + 0.03 && time < entry.end - 0.03);
    }
    if (!item) {
      toast({ type: 'warning', title: 'Buradan bölünemez', message: 'İmleci bir klibin ortasına getir.', duration: 2400 });
      return;
    }
    const clip = item.clip;
    const sourceTime = T.timeToSource(item, time);
    const speed = clamp(Number(clip.speed) || 1, 0.5, 2);
    const minSource = T.MIN_CLIP_DURATION * speed;
    if (sourceTime - clip.inPoint < minSource || clip.outPoint - sourceTime < minSource) {
      toast({ type: 'warning', title: 'Çok kısa', message: 'Klibin kenarına çok yakın; biraz daha içeriden böl.', duration: 2400 });
      return;
    }

    const rightClip = {
      ...clone(clip),
      id: uid('clip'),
      inPoint: sourceTime,
      fadeIn: 0,
      transitionAfter: clip.transitionAfter ? clone(clip.transitionAfter) : null,
    };
    clip.outPoint = sourceTime;
    clip.fadeOut = 0;
    clip.transitionAfter = null;
    const index = state.project.clips.findIndex((entry) => entry.id === clip.id);
    state.project.clips.splice(index + 1, 0, rightClip);
    state.selected = { type: 'clip', id: rightClip.id };
    refreshAfterEdit();
    toast({ type: 'success', title: 'Bölündü', message: `Yeni klip ${formatPlayerTime(time)} noktasından başlıyor.`, duration: 2200 });
  }

  function duplicateSelection() {
    const selection = state.selected;
    if (!selection) return;
    pausePlayback();
    if (selection.type === 'clip') {
      const index = state.project.clips.findIndex((clip) => clip.id === selection.id);
      if (index < 0) return;
      const copy = { ...clone(state.project.clips[index]), id: uid('clip'), transitionAfter: null };
      state.project.clips.splice(index + 1, 0, copy);
      state.selected = { type: 'clip', id: copy.id };
      refreshAfterEdit();
    } else if (selection.type === 'text') {
      const text = textFor(selection.id);
      if (!text) return;
      const span = Math.max(0.2, text.end - text.start);
      const copy = {
        ...clone(text),
        id: uid('text'),
        start: Math.min(Math.max(0, projectDuration() - span), text.end + 0.15),
        end: Math.min(projectDuration(), text.end + 0.15 + span),
      };
      state.project.texts.push(copy);
      state.selected = { type: 'text', id: copy.id };
      refreshAfterEdit();
    }
  }

  function reorderClip(clipId, targetIndex) {
    const clips = state.project.clips;
    const fromIndex = clips.findIndex((clip) => clip.id === clipId);
    if (fromIndex < 0) return;
    let insertIndex = clamp(targetIndex, 0, clips.length);
    const [clip] = clips.splice(fromIndex, 1);
    if (fromIndex < insertIndex) insertIndex -= 1;
    insertIndex = clamp(insertIndex, 0, clips.length);
    clips.splice(insertIndex, 0, clip);
    clips[clips.length - 1].transitionAfter = null;
    state.selected = { type: 'clip', id: clip.id };
    refreshAfterEdit();
    toast({ type: 'info', title: 'Sıra değişti', message: 'Klibi yeni konumuna taşıdım.', duration: 1800 });
  }

  function seekFromPointer(event, element) {
    if (!element || !refs.timelineContent) return;
    const rect = refs.timelineContent.getBoundingClientRect();
    const x = clamp(event.clientX - rect.left, 0, Math.max(0, rect.width - 1));
    seekTo(x / state.pps);
  }

  function beginScrub(event) {
    if (event.button !== 0) return;
    pausePlayback();
    state.isScrubbing = true;
    seekFromPointer(event, event.currentTarget);
    const target = event.currentTarget;
    const onMove = (moveEvent) => {
      if (!state.isScrubbing) return;
      seekFromPointer(moveEvent, target);
    };
    const onUp = () => {
      state.isScrubbing = false;
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      document.body.classList.remove('is-scrubbing');
    };
    document.body.classList.add('is-scrubbing');
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
    event.preventDefault();
  }

  function beginTrim(event, kind, id, side) {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    pausePlayback();
    const startX = event.clientX;
    const duration = projectDuration();

    if (kind === 'clip') {
      const clip = clipFor(id);
      const media = clip ? mediaFor(clip.mediaId) : null;
      if (!clip || !media) return;
      const speed = clamp(Number(clip.speed) || 1, 0.5, 2);
      const initial = { inPoint: clip.inPoint, outPoint: clip.outPoint };
      const minSource = T.MIN_CLIP_DURATION * speed;
      const onMove = (moveEvent) => {
        const delta = ((moveEvent.clientX - startX) / state.pps) * speed;
        if (side === 'left') {
          clip.inPoint = clamp(initial.inPoint + delta, 0, initial.outPoint - minSource);
        } else {
          clip.outPoint = clamp(initial.outPoint + delta, initial.inPoint + minSource, media.duration);
        }
        refreshLayout();
        renderTimeline();
        renderInspector();
        updatePlayheadUI();
      };
      const onUp = () => {
        document.removeEventListener('pointermove', onMove);
        document.removeEventListener('pointerup', onUp);
        document.body.classList.remove('is-scrubbing');
        state.suppressDrag = false;
        pushHistory();
        markDirty();
        renderAll({ sync: false });
        schedulePreviewSync(true);
      };
      state.suppressDrag = true;
      document.body.classList.add('is-scrubbing');
      document.addEventListener('pointermove', onMove);
      document.addEventListener('pointerup', onUp);
      return;
    }

    if (kind === 'text') {
      const text = textFor(id);
      if (!text) return;
      const initial = { start: text.start, end: text.end };
      const onMove = (moveEvent) => {
        const delta = (moveEvent.clientX - startX) / state.pps;
        if (side === 'left') {
          text.start = clamp(initial.start + delta, 0, initial.end - 0.2);
        } else {
          text.end = clamp(initial.end + delta, text.start + 0.2, Math.max(duration, text.start + 0.2));
        }
        renderTimeline();
        renderInspector();
        renderTextOverlay();
      };
      const onUp = () => {
        document.removeEventListener('pointermove', onMove);
        document.removeEventListener('pointerup', onUp);
        document.body.classList.remove('is-scrubbing');
        pushHistory();
        markDirty();
        renderAll({ sync: false });
      };
      document.body.classList.add('is-scrubbing');
      document.addEventListener('pointermove', onMove);
      document.addEventListener('pointerup', onUp);
    }
  }

  function beginTextClipMove(event, textId) {
    if (event.button !== 0) return;
    const text = textFor(textId);
    if (!text) return;
    event.stopPropagation();
    event.preventDefault();
    pausePlayback();
    setSelection({ type: 'text', id: textId });
    const startX = event.clientX;
    const initial = { start: text.start, end: text.end };
    const span = initial.end - initial.start;
    const duration = Math.max(projectDuration(), span);
    const onMove = (moveEvent) => {
      const delta = (moveEvent.clientX - startX) / state.pps;
      const start = clamp(initial.start + delta, 0, Math.max(0, duration - span));
      text.start = start;
      text.end = start + span;
      renderTimeline();
      renderInspector();
      renderTextOverlay();
    };
    const onUp = () => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      document.body.classList.remove('is-dragging-clip');
      pushHistory();
      markDirty();
      renderAll({ sync: false });
    };
    document.body.classList.add('is-dragging-clip');
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
  }

  function beginTextOverlayDrag(event, textId) {
    if (event.button !== 0) return;
    const text = textFor(textId);
    if (!text || !refs.previewStage) return;
    event.preventDefault();
    event.stopPropagation();
    pausePlayback();
    setSelection({ type: 'text', id: textId });
    const rect = refs.previewStage.getBoundingClientRect();
    const onMove = (moveEvent) => {
      text.x = clamp((moveEvent.clientX - rect.left) / Math.max(1, rect.width), 0.02, 0.98);
      text.y = clamp((moveEvent.clientY - rect.top) / Math.max(1, rect.height), 0.02, 0.98);
      updateTextOverlayStyles();
      const el = textOverlayEls.get(textId);
      if (el) el.el.classList.add('is-dragging');
    };
    const onUp = () => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      const el = textOverlayEls.get(textId);
      if (el) el.el.classList.remove('is-dragging');
      pushHistory();
      markDirty();
      renderInspector();
    };
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
  }

  function updateVolumeUI() {
    if (refs.monitorVolume) {
      const value = Math.round(state.monitorVolume * 100);
      refs.monitorVolume.value = String(state.muted ? 0 : value);
      refs.monitorVolume.style.setProperty('--range-fill', `${state.muted ? 0 : value}%`);
    }
    if (refs.muteButton) {
      refs.muteButton.innerHTML = `<svg class="icon icon-sm"><use href="#${state.muted ? 'i-volume-x' : 'i-volume'}"/></svg>`;
      refs.muteButton.title = state.muted ? 'Sesi aç' : 'Sesi kapat';
    }
  }

  function toggleMute() {
    state.muted = !state.muted;
    updateVolumeUI();
    refreshAudioSettings();
  }

  function bindTimelineInteractions() {
    if (refs.playButton) refs.playButton.addEventListener('click', togglePlayback);
    if (refs.skipStartButton) refs.skipStartButton.addEventListener('click', () => { pausePlayback(); seekTo(0); });
    if (refs.skipEndButton) refs.skipEndButton.addEventListener('click', () => { pausePlayback(); seekTo(projectDuration()); });
    if (refs.muteButton) refs.muteButton.addEventListener('click', toggleMute);
    if (refs.monitorVolume) {
      refs.monitorVolume.addEventListener('input', () => {
        const value = clamp(Number(refs.monitorVolume.value) || 0, 0, 100) / 100;
        state.monitorVolume = value;
        state.muted = value <= 0.001;
        updateVolumeUI();
        refreshAudioSettings();
      });
    }
    if (refs.fullscreenButton) {
      refs.fullscreenButton.addEventListener('click', () => {
        refs.previewStage.classList.toggle('is-fullscreen');
        if (refs.previewStage.classList.contains('is-fullscreen')) {
          updateTextOverlayStyles();
        } else {
          queueStageResize();
        }
      });
    }
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && refs.previewStage.classList.contains('is-fullscreen')) {
        refs.previewStage.classList.remove('is-fullscreen');
        queueStageResize();
      }
    });
    if (refs.miniTimeline) {
      refs.miniTimeline.addEventListener('pointerdown', (event) => {
        if (event.button !== 0) return;
        pausePlayback();
        const rect = refs.miniTimeline.getBoundingClientRect();
        seekTo(((event.clientX - rect.left) / Math.max(1, rect.width)) * projectDuration());
        const onMove = (moveEvent) => {
          seekTo(((moveEvent.clientX - rect.left) / Math.max(1, rect.width)) * projectDuration());
        };
        const onUp = () => {
          document.removeEventListener('pointermove', onMove);
          document.removeEventListener('pointerup', onUp);
        };
        document.addEventListener('pointermove', onMove);
        document.addEventListener('pointerup', onUp);
      });
    }

    if (refs.timelineRuler) refs.timelineRuler.addEventListener('pointerdown', beginScrub);
    if (refs.timelineScroll) {
      refs.timelineScroll.addEventListener('scroll', () => {
        renderRuler();
      });
      refs.timelineScroll.addEventListener('wheel', (event) => {
        if (!event.ctrlKey) return;
        event.preventDefault();
        setZoom(state.zoomValue + (event.deltaY > 0 ? -4 : 4));
      }, { passive: false });
    }

    if (refs.timelineContent) {
      refs.timelineContent.addEventListener('pointerdown', (event) => {
        if (event.target.closest('.timeline-clip, .transition-marker, .playhead')) return;
        if (event.button !== 0) return;
        pausePlayback();
        state.selected = null;
        updateInspectorSelection();
        renderInspector();
        seekFromPointer(event, refs.timelineContent);
      });
    }

    const trimHandler = (event) => {
      const handle = event.target.closest('[data-trim], [data-text-trim]');
      if (!handle) return;
      const clipEl = handle.closest('[data-clip-id]');
      const textEl = handle.closest('[data-text-id]');
      if (clipEl) {
        beginTrim(event, 'clip', clipEl.dataset.clipId, handle.dataset.trim);
      } else if (textEl) {
        beginTrim(event, 'text', textEl.dataset.textId, handle.dataset.textTrim);
      }
    };
    if (refs.videoTrack) refs.videoTrack.addEventListener('pointerdown', trimHandler);
    if (refs.textTrack) refs.textTrack.addEventListener('pointerdown', trimHandler);

    if (refs.videoTrack) {
      refs.videoTrack.addEventListener('pointerdown', (event) => {
        if (event.button !== 0) return;
        if (event.target.closest('.trim-handle, .transition-marker')) return;
        const clipEl = event.target.closest('[data-clip-id]');
        if (!clipEl) return;
        event.stopPropagation();
        setSelection({ type: 'clip', id: clipEl.dataset.clipId });
      });

      refs.videoTrack.addEventListener('click', (event) => {
        const transition = event.target.closest('[data-transition-clip]');
        if (transition) {
          event.stopPropagation();
          setSelection({ type: 'transition', clipId: transition.dataset.transitionClip });
        }
      });

      refs.videoTrack.addEventListener('dragstart', (event) => {
        if (state.suppressDrag) {
          event.preventDefault();
          return;
        }
        const clipEl = event.target.closest('[data-clip-id]');
        if (!clipEl) return;
        state.draggingClip = clipEl.dataset.clipId;
        event.dataTransfer.effectAllowed = 'move';
        try { event.dataTransfer.setData('text/kesklip-clip', clipEl.dataset.clipId); } catch { /* ignore */ }
        clipEl.classList.add('is-dragging');
      });

      refs.videoTrack.addEventListener('dragend', () => {
        state.draggingClip = null;
        $$('.timeline-clip.is-dragging, .timeline-clip.is-drop-target', refs.videoTrack).forEach((el) => {
          el.classList.remove('is-dragging', 'is-drop-target');
        });
      });

      refs.videoTrack.addEventListener('dragover', (event) => {
        const mediaId = readMediaDrag(event);
        if (!state.draggingClip && !mediaId) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = state.draggingClip ? 'move' : 'copy';
        const clipEls = $$('.timeline-clip[data-clip-id]', refs.videoTrack);
        clipEls.forEach((el) => el.classList.remove('is-drop-target'));
        const target = dropTargetElement(refs.videoTrack, event.clientX);
        if (target) target.classList.add('is-drop-target');
      });

      refs.videoTrack.addEventListener('dragleave', (event) => {
        if (event.target === refs.videoTrack) {
          $$('.timeline-clip.is-drop-target', refs.videoTrack).forEach((el) => el.classList.remove('is-drop-target'));
        }
      });

      refs.videoTrack.addEventListener('drop', (event) => {
        const mediaId = readMediaDrag(event);
        if (!state.draggingClip && !mediaId) return;
        event.preventDefault();
        $$('.timeline-clip.is-drop-target', refs.videoTrack).forEach((el) => el.classList.remove('is-drop-target'));
        if (mediaId) {
          const media = mediaFor(mediaId);
          if (media && media.kind === 'video') addClipFromMedia(media);
          state.draggingClip = null;
          return;
        }
        const clipEls = $$('.timeline-clip[data-clip-id]', refs.videoTrack);
        let targetIndex = clipEls.length;
        for (let index = 0; index < clipEls.length; index += 1) {
          const rect = clipEls[index].getBoundingClientRect();
          if (event.clientX < rect.left + rect.width / 2) {
            targetIndex = index;
            break;
          }
        }
        const draggedId = state.draggingClip;
        state.draggingClip = null;
        if (draggedId) reorderClip(draggedId, targetIndex);
      });
    }

    if (refs.textTrack) {
      refs.textTrack.addEventListener('pointerdown', (event) => {
        if (event.button !== 0) return;
        if (event.target.closest('.trim-handle')) return;
        const textEl = event.target.closest('[data-text-id]');
        if (!textEl) return;
        beginTextClipMove(event, textEl.dataset.textId);
      });
    }

    if (refs.audioTrack) {
      refs.audioTrack.addEventListener('pointerdown', (event) => {
        const audioEl = event.target.closest('[data-music-id]');
        if (!audioEl) return;
        event.stopPropagation();
        setSelection({ type: 'music' });
      });
    }

    if (refs.textLayer) {
      refs.textLayer.addEventListener('pointerdown', (event) => {
        const textEl = event.target.closest('[data-text-id]');
        if (!textEl) return;
        beginTextOverlayDrag(event, textEl.dataset.textId);
      });
    }

    if (refs.splitButton) refs.splitButton.addEventListener('click', splitAtPlayhead);
    if (refs.deleteButton) refs.deleteButton.addEventListener('click', deleteSelection);
    if (refs.duplicateButton) refs.duplicateButton.addEventListener('click', duplicateSelection);
    if (refs.zoomSlider) refs.zoomSlider.addEventListener('input', () => setZoom(Number(refs.zoomSlider.value)));
    if (refs.zoomInButton) refs.zoomInButton.addEventListener('click', () => setZoom(state.zoomValue + 6));
    if (refs.zoomOutButton) refs.zoomOutButton.addEventListener('click', () => setZoom(state.zoomValue - 6));
    if (refs.fitTimelineButton) refs.fitTimelineButton.addEventListener('click', fitTimeline);
    if (refs.fitPreviewButton) refs.fitPreviewButton.addEventListener('click', () => {
      refs.previewStage.classList.remove('is-fullscreen');
      queueStageResize();
    });
  }

  function readMediaDrag(event) {
    try {
      const value = event.dataTransfer.getData('text/kesklip-media');
      if (value) return value;
    } catch { /* ignore */ }
    return state.draggingMediaId || '';
  }

  function dropTargetElement(track, clientX) {
    const clipEls = $$('.timeline-clip[data-clip-id]', track);
    for (const el of clipEls) {
      const rect = el.getBoundingClientRect();
      if (clientX < rect.left + rect.width / 2) return el;
    }
    return null;
  }

  // ── Inspector ───────────────────────────────────────────

  function setInspectorHeader(title, badge) {
    if (refs.inspectorTitle) refs.inspectorTitle.textContent = title;
    if (refs.inspectorBadge) refs.inspectorBadge.textContent = badge;
  }

  function sectionLabel(text, icon = '') {
    return `<div class="section-label"><span>${escapeHtml(text)}</span>${icon ? `<svg class="icon icon-xs"><use href="#${icon}"/></svg>` : ''}</div>`;
  }

  function propertyRow(label, value) {
    return `<div class="property-row"><span class="property-label">${escapeHtml(label)}</span><span class="property-value">${escapeHtml(value)}</span></div>`;
  }

  function rangeRow({ label, action, value, min, max, step, display }) {
    return `
      <div class="section-label"><span>${escapeHtml(label)}</span><span class="inline-value" data-range-value="${escapeHtml(action)}">${escapeHtml(display)}</span></div>
      <div class="inline-control">
        <input type="range" min="${min}" max="${max}" step="${step}" value="${value}" data-inspector-input="${escapeHtml(action)}" aria-label="${escapeHtml(label)}">
      </div>
    `;
  }

  function transitionOptionsMarkup(current) {
    const options = [
      { id: 'none', name: 'Yok', desc: 'Düz kesme' },
      { id: 'soft', name: 'Yumuşak', desc: 'Karışarak geç' },
      { id: 'flash', name: 'Beyaz', desc: 'Parlak geçiş' },
      { id: 'slide', name: 'Kaydır', desc: 'Yana kay' },
      { id: 'zoom', name: 'Yakınlaş', desc: 'İçeri zoom' },
      { id: 'wipe', name: 'Perde', desc: 'Soldan süpür' },
      { id: 'circle', name: 'Daire', desc: 'Merkezden aç' },
    ];
    return `
      <div class="transition-options">
        ${options.map((option) => `
          <button class="transition-option ${current === option.id ? 'is-active' : ''}" data-action="set-transition" data-transition="${option.id}">
            <strong>${option.name}</strong>
            <span>${option.desc}</span>
          </button>
        `).join('')}
      </div>
    `;
  }

  function renderProjectInspector() {
    setInspectorHeader('Proje', 'Özet');
    const project = state.project;
    const videoCount = project.media.filter((media) => media.kind === 'video').length;
    const audioCount = project.media.filter((media) => media.kind === 'audio').length;
    const duration = projectDuration();
    const currentResolution = `${project.width}x${project.height}`;
    const presets = ['1920x1080', '1280x720', '1080x1920', '3840x2160', '1080x1080'];
    if (!presets.includes(currentResolution)) presets.unshift(currentResolution);
    const fpsPresets = [24, 25, 30, 50, 60];
    if (!fpsPresets.includes(Math.round(project.fps))) fpsPresets.unshift(Math.round(project.fps));

    refs.inspectorBody.innerHTML = `
      <div class="project-hero">
        <svg class="icon project-hero-mark"><use href="#i-sparkles"/></svg>
        <h3>${escapeHtml(project.name || 'Yeni Proje')}</h3>
        <p>${timeSummary(duration)} · ${videoCount} video · ${audioCount} ses</p>
      </div>

      <div class="stat-grid">
        <div class="stat-card"><span>Video</span><strong>${videoCount}</strong></div>
        <div class="stat-card"><span>Toplam süre</span><strong>${escapeHtml(T.formatClock(duration))}</strong></div>
        <div class="stat-card"><span>Çözünürlük</span><strong>${project.width} × ${project.height}</strong></div>
        <div class="stat-card"><span>Kare hızı</span><strong>${Math.round(project.fps)} fps</strong></div>
      </div>

      <div class="inspector-section">
        ${sectionLabel('Proje ayarları', 'i-settings')}
        <div class="form-group">
          <label class="form-label">Çözünürlük <span>dışa aktarma varsayılanı</span></label>
          <select class="select-field" data-inspector-change="project-resolution">
            ${presets.map((preset) => {
              const [w, h] = preset.split('x');
              const label = preset === currentResolution ? `${w} × ${h} · mevcut` : `${w} × ${h}`;
              return `<option value="${preset}" ${preset === currentResolution ? 'selected' : ''}>${label}</option>`;
            }).join('')}
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">Kare hızı</label>
          <select class="select-field" data-inspector-change="project-fps">
            ${fpsPresets.map((fps) => `<option value="${fps}" ${Math.round(project.fps) === fps ? 'selected' : ''}>${fps} fps</option>`).join('')}
          </select>
        </div>
        <p class="field-note">Kaynak videolar olduğu gibi kullanılır. Proje çözünürlüğü yalnızca önizleme ve dışa aktarma tuvalini belirler.</p>
      </div>

      <div class="inspector-section">
        ${sectionLabel('Zaman çizelgesi', 'i-layers')}
        ${propertyRow('Klip sayısı', String(project.clips.length))}
        ${propertyRow('Yazı sayısı', String(project.texts.length))}
        ${propertyRow('Müzik', project.music ? 'Var' : 'Yok')}
        ${propertyRow('Toplam süre', T.formatClock(duration))}
      </div>

      <div class="inspector-section">
        ${sectionLabel('Kısayollar', 'i-keyboard')}
        <div class="tip-list">
          <div class="tip-item"><svg class="icon"><use href="#i-play"/></svg><span><kbd>Space</kbd> oynat / duraklat</span></div>
          <div class="tip-item"><svg class="icon"><use href="#i-scissors"/></svg><span><kbd>S</kbd> imleçten böl</span></div>
          <div class="tip-item"><svg class="icon"><use href="#i-trash"/></svg><span><kbd>Del</kbd> seçileni sil</span></div>
          <div class="tip-item"><svg class="icon"><use href="#i-undo"/></svg><span><kbd>Ctrl</kbd> + <kbd>Z</kbd> geri al</span></div>
        </div>
      </div>
    `;
  }

  function timeSummary(seconds) {
    const safe = Math.max(0, Number(seconds) || 0);
    if (safe >= 3600) return `${Math.floor(safe / 3600)} sa ${Math.round((safe % 3600) / 60)} dk`;
    if (safe >= 60) return `${Math.floor(safe / 60)} dk ${Math.round(safe % 60)} sn`;
    return `${Math.round(safe)} sn`;
  }

  function renderClipInspector(clip) {
    const media = mediaFor(clip.mediaId);
    if (!media) return renderProjectInspector();
    const index = state.project.clips.indexOf(clip);
    const isLast = index === state.project.clips.length - 1;
    const clipDuration = T.getClipDuration(clip);
    const item = state.layout.items.find((entry) => entry.clip.id === clip.id);
    const thumbUrl = state.thumbUrls.get(media.id);
    const currentTransition = clip.transitionAfter ? clip.transitionAfter.type : 'none';
    const transitionDuration = clip.transitionAfter ? clip.transitionAfter.duration : 0.45;
    const speed = clamp(Number(clip.speed) || 1, 0.5, 2);

    setInspectorHeader('Video Klibi', 'Video');
    refs.inspectorBody.innerHTML = `
      <div class="clip-preview-card">
        <div class="clip-preview-thumb">${thumbUrl ? `<img src="${escapeHtml(thumbUrl)}" alt="">` : '<svg class="icon"><use href="#i-film"/></svg>'}</div>
        <div class="clip-preview-copy">
          <strong title="${escapeHtml(media.name)}">${escapeHtml(media.name)}</strong>
          <span>${media.width || '?'} × ${media.height || '?'} · ${escapeHtml(T.formatClock(clipDuration))}</span>
        </div>
      </div>

      <div class="inspector-section">
        ${sectionLabel('Klip', 'i-film')}
        ${propertyRow('Başlangıç', item ? T.formatClock(item.start) : '—')}
        ${propertyRow('Süre', T.formatClock(clipDuration))}
        ${propertyRow('Kaynak aralığı', `${T.formatClock(clip.inPoint)} → ${T.formatClock(clip.outPoint)}`)}
        ${propertyRow('Sıra', `${index + 1} / ${state.project.clips.length}`)}
      </div>

      <div class="inspector-section">
        ${sectionLabel('Hız', 'i-gauge')}
        <div class="segmented" style="grid-template-columns:repeat(4,1fr)">
          ${[0.5, 1, 1.5, 2].map((value) => `
            <button data-action="set-clip-speed" data-speed="${value}" class="${Math.abs(speed - value) < 0.001 ? 'is-active' : ''}">${value}x</button>
          `).join('')}
        </div>
        <p class="field-note">Hız, sesin perdesini korumaya çalışır. Çok yüksek hızlarda ses biraz hızlanabilir.</p>
        ${rangeRow({
          label: 'Ses seviyesi',
          action: 'clip-volume',
          value: Math.round(clamp(Number(clip.volume) || 0, 0, 1.5) * 100),
          min: 0,
          max: 150,
          step: 1,
          display: `%${Math.round(clamp(Number(clip.volume) || 0, 0, 1.5) * 100)}`,
        })}
      </div>

      <div class="inspector-section">
        ${sectionLabel('Yumuşak giriş / çıkış', 'i-sparkles')}
        ${rangeRow({
          label: 'Giriş solması',
          action: 'clip-fade-in',
          value: Number(clip.fadeIn || 0).toFixed(2),
          min: 0,
          max: 10,
          step: 0.1,
          display: `${Number(clip.fadeIn || 0).toFixed(1)} sn`,
        })}
        ${rangeRow({
          label: 'Çıkış solması',
          action: 'clip-fade-out',
          value: Number(clip.fadeOut || 0).toFixed(2),
          min: 0,
          max: 10,
          step: 0.1,
          display: `${Number(clip.fadeOut || 0).toFixed(1)} sn`,
        })}
        <p class="field-note">Görüntü ve ses birlikte solar. Süre, klip uzunluğunun yarısıyla sınırlıdır; dışa aktarımda da uygulanır.</p>
      </div>

      ${isLast ? `
        <div class="inspector-section">
          ${sectionLabel('Geçiş', 'i-sparkles')}
          <p class="property-hint">Son klipten sonra geçiş eklenemez. Geçiş eklemek için bu klibin sağına başka bir klip ekle.</p>
        </div>
      ` : `
        <div class="inspector-section">
          ${sectionLabel('Sonraki klibe geçiş', 'i-sparkles')}
          ${transitionOptionsMarkup(currentTransition)}
          ${currentTransition !== 'none' ? `
            ${rangeRow({
              label: 'Geçiş süresi',
              action: 'transition-duration',
              value: transitionDuration,
              min: 0.15,
              max: 1.5,
              step: 0.05,
              display: `${Number(transitionDuration).toFixed(2)} sn`,
            })}
            <p class="field-note">Geçiş, iki klibin toplam süresini kısaltır; dışa aktarımda da aynen uygulanır.</p>
          ` : ''}
        </div>
      `}

      <div class="inspector-actions">
        <button class="button button-secondary" data-action="split-clip"><svg class="icon icon-sm"><use href="#i-scissors"/></svg>Böl</button>
        <button class="button button-secondary" data-action="duplicate-clip"><svg class="icon icon-sm"><use href="#i-layers"/></svg>Çoğalt</button>
        <button class="button button-danger" data-action="delete-clip"><svg class="icon icon-sm"><use href="#i-trash"/></svg>Sil</button>
      </div>
    `;
  }

  function renderTextInspector(text) {
    setInspectorHeader('Yazı', 'Yazı');
    const position = text.y < 0.35 ? 'top' : text.y > 0.65 ? 'bottom' : 'center';
    refs.inspectorBody.innerHTML = `
      <div class="inspector-section">
        ${sectionLabel('İçerik', 'i-type')}
        <textarea class="textarea-field" data-inspector-input="text-content" maxlength="500" placeholder="Yazını yaz…">${escapeHtml(text.content)}</textarea>
        <p class="field-note">Alt satır için Enter kullan. Yazı önizlemede görünür ve dışa aktarımda videoya işlenir.</p>
      </div>

      <div class="inspector-section">
        ${sectionLabel('Konum', 'i-move')}
        <div class="position-options">
          <button class="position-option ${position === 'top' ? 'is-active' : ''}" data-action="text-position" data-position="top"><span class="mini-frame"></span></button>
          <button class="position-option ${position === 'center' ? 'is-active' : ''}" data-action="text-position" data-position="center"><span class="mini-frame"></span></button>
          <button class="position-option ${position === 'bottom' ? 'is-active' : ''}" data-action="text-position" data-position="bottom"><span class="mini-frame"></span></button>
        </div>
        <p class="field-note">Daha ince ayar için yazıyı önizleme üzerinde sürükle.</p>
      </div>

      <div class="inspector-section">
        ${sectionLabel('Görünüm', 'i-sparkles')}
        ${rangeRow({
          label: 'Boyut',
          action: 'text-size',
          value: Number(text.size).toFixed(1),
          min: 1.5,
          max: 20,
          step: 0.1,
          display: `%${Number(text.size).toFixed(1)}`,
        })}
        ${rangeRow({
          label: 'Solma',
          action: 'text-fade',
          value: Number(text.fade).toFixed(2),
          min: 0,
          max: 2,
          step: 0.05,
          display: `${Number(text.fade).toFixed(2)} sn`,
        })}
        <div class="toggle-row">
          <span class="toggle-label">Kalın yazı</span>
          <button class="switch ${text.bold ? 'is-on' : ''}" data-action="toggle-bold" aria-label="Kalın yazı"></button>
        </div>
        <div class="toggle-row">
          <span class="toggle-label">Arka plan kutusu</span>
          <button class="switch ${text.background ? 'is-on' : ''}" data-action="toggle-background" aria-label="Arka plan"></button>
        </div>
        <div class="section-label" style="margin-top:12px"><span>Renk</span></div>
        <div class="color-swatches">
          ${TEXT_COLORS.map((color) => `
            <button class="color-swatch ${String(text.color).toLowerCase() === color ? 'is-active' : ''}" style="background:${color}" data-action="text-color" data-color="${color}" title="${color}"></button>
          `).join('')}
          <input class="color-picker" type="color" value="${escapeHtml(text.color || '#ffffff')}" data-inspector-change="text-color-custom" aria-label="Özel renk">
        </div>
      </div>

      <div class="inspector-section">
        ${sectionLabel('Zamanlama', 'i-clock')}
        ${rangeRow({
          label: 'Başlangıç',
          action: 'text-start',
          value: Number(text.start).toFixed(2),
          min: 0,
          max: Math.max(projectDuration(), 0.2),
          step: 0.05,
          display: T.formatClock(text.start),
        })}
        ${rangeRow({
          label: 'Bitiş',
          action: 'text-end',
          value: Number(text.end).toFixed(2),
          min: 0,
          max: Math.max(projectDuration(), 0.2),
          step: 0.05,
          display: T.formatClock(text.end),
        })}
      </div>

      <div class="inspector-actions">
        <button class="button button-secondary" data-action="duplicate-text"><svg class="icon icon-sm"><use href="#i-layers"/></svg>Çoğalt</button>
        <button class="button button-danger" data-action="delete-text"><svg class="icon icon-sm"><use href="#i-trash"/></svg>Sil</button>
      </div>
    `;
  }

  function renderMusicInspector() {
    const music = state.project.music;
    const media = music ? mediaFor(music.mediaId) : null;
    if (!music || !media) return renderProjectInspector();
    setInspectorHeader('Müzik', 'Ses');
    refs.inspectorBody.innerHTML = `
      <div class="audio-file-preview">
        <span class="audio-file-icon"><svg class="icon"><use href="#i-music"/></svg></span>
        <div class="audio-file-copy">
          <strong title="${escapeHtml(media.name)}">${escapeHtml(media.name)}</strong>
          <span>${escapeHtml(T.formatClock(media.duration))} · ${escapeHtml(media.audioCodecLabel || 'Ses')}</span>
        </div>
      </div>

      <div class="inspector-section">
        ${sectionLabel('Karışım', 'i-volume')}
        ${rangeRow({
          label: 'Müzik seviyesi',
          action: 'music-volume',
          value: Math.round(clamp(Number(music.volume) || 0, 0, 1.5) * 100),
          min: 0,
          max: 150,
          step: 1,
          display: `%${Math.round(clamp(Number(music.volume) || 0, 0, 1.5) * 100)}`,
        })}
        <div class="toggle-row">
          <span class="toggle-label">Video bitince başa dön (döngü)</span>
          <button class="switch ${music.loop ? 'is-on' : ''}" data-action="toggle-music-loop" aria-label="Müzik döngüsü"></button>
        </div>
        <p class="field-note">Müzik, toplam video süresine göre kısaltılır veya döngüye alınır.</p>
      </div>

      <div class="inspector-section">
        ${sectionLabel('Geçişler', 'i-wave')}
        ${rangeRow({
          label: 'Başta artır',
          action: 'music-fade-in',
          value: Number(music.fadeIn).toFixed(2),
          min: 0,
          max: 10,
          step: 0.1,
          display: `${Number(music.fadeIn).toFixed(1)} sn`,
        })}
        ${rangeRow({
          label: 'Sonda azalt',
          action: 'music-fade-out',
          value: Number(music.fadeOut).toFixed(2),
          min: 0,
          max: 10,
          step: 0.1,
          display: `${Number(music.fadeOut).toFixed(1)} sn`,
        })}
      </div>

      <div class="inspector-actions">
        <button class="button button-danger" data-action="remove-music"><svg class="icon icon-sm"><use href="#i-trash"/></svg>Müziği kaldır</button>
      </div>
    `;
  }

  function renderTransitionInspector(clip) {
    const media = mediaFor(clip.mediaId);
    const index = state.project.clips.indexOf(clip);
    const nextClip = state.project.clips[index + 1];
    const nextMedia = nextClip ? mediaFor(nextClip.mediaId) : null;
    const currentTransition = clip.transitionAfter ? clip.transitionAfter.type : 'none';
    const duration = clip.transitionAfter ? clip.transitionAfter.duration : 0.45;
    setInspectorHeader('Geçiş', 'Efekt');

    refs.inspectorBody.innerHTML = `
      <div class="project-hero">
        <svg class="icon project-hero-mark"><use href="#i-sparkles"/></svg>
        <h3>${escapeHtml(media ? media.name : 'Klip')}</h3>
        <p>${nextMedia ? `→ ${escapeHtml(nextMedia.name)}` : 'Sonraki klip'}</p>
      </div>

      <div class="inspector-section">
        ${sectionLabel('Geçiş türü', 'i-sparkles')}
        ${transitionOptionsMarkup(currentTransition)}
        <p class="property-hint">Geçişler iki klibin üst üste binen kısmında oynar ve toplam süreyi kısaltır.</p>
      </div>

      ${currentTransition !== 'none' ? `
        <div class="inspector-section">
          ${sectionLabel('Süre', 'i-clock')}
          ${rangeRow({
            label: 'Geçiş süresi',
            action: 'transition-duration',
            value: duration,
            min: 0.15,
            max: 1.5,
            step: 0.05,
            display: `${Number(duration).toFixed(2)} sn`,
          })}
        </div>
      ` : ''}

      <div class="inspector-actions">
        <button class="button button-secondary" data-action="select-outgoing-clip"><svg class="icon icon-sm"><use href="#i-film"/></svg>Klibi seç</button>
        <button class="button button-danger" data-action="remove-transition"><svg class="icon icon-sm"><use href="#i-x"/></svg>Geçişi kaldır</button>
      </div>
    `;
  }

  function renderInspector() {
    if (!refs.inspectorBody) return;
    const selection = state.selected;
    if (!selection) return renderProjectInspector();
    if (selection.type === 'clip') {
      const clip = clipFor(selection.id);
      if (!clip) return renderProjectInspector();
      return renderClipInspector(clip);
    }
    if (selection.type === 'text') {
      const text = textFor(selection.id);
      if (!text) return renderProjectInspector();
      return renderTextInspector(text);
    }
    if (selection.type === 'music') {
      if (!state.project.music) return renderProjectInspector();
      return renderMusicInspector();
    }
    if (selection.type === 'transition') {
      const clip = clipFor(selection.clipId);
      if (!clip) return renderProjectInspector();
      return renderTransitionInspector(clip);
    }
    return renderProjectInspector();
  }

  function updateRangeDisplay(action, value, suffix = '') {
    const el = refs.inspectorBody.querySelector(`[data-range-value="${cssEscape(action)}"]`);
    if (el) el.textContent = `${value}${suffix}`;
  }

  function handleInspectorClick(event) {
    const actionEl = event.target.closest('[data-action]');
    if (!actionEl) return;
    const action = actionEl.dataset.action;
    const selection = state.selected;

    if (action === 'set-clip-speed') {
      const clip = selectedClipId() ? clipFor(selectedClipId()) : null;
      if (!clip) return;
      pausePlayback();
      clip.speed = clamp(Number(actionEl.dataset.speed) || 1, 0.5, 2);
      refreshAfterEdit();
      return;
    }

    if (action === 'set-transition') {
      let clip = null;
      if (selection && selection.type === 'clip') clip = clipFor(selection.id);
      if (selection && selection.type === 'transition') clip = clipFor(selection.clipId);
      if (!clip) return;
      const type = actionEl.dataset.transition;
      if (type === 'none') {
        clip.transitionAfter = null;
      } else {
        clip.transitionAfter = {
          type,
          duration: clip.transitionAfter ? clip.transitionAfter.duration : 0.45,
        };
      }
      if (state.selected.type === 'clip') state.selected = { type: 'transition', clipId: clip.id };
      refreshAfterEdit();
      return;
    }

    if (action === 'split-clip') { splitAtPlayhead(); return; }
    if (action === 'duplicate-clip') { duplicateSelection(); return; }
    if (action === 'delete-clip') { deleteSelection(); return; }
    if (action === 'duplicate-text') { duplicateSelection(); return; }
    if (action === 'delete-text') { deleteSelection(); return; }
    if (action === 'remove-music') {
      if (!state.project.music) return;
      state.project.music = null;
      state.selected = null;
      if (musicAudio) { musicAudio.pause(); musicAudio.removeAttribute('src'); }
      refreshAfterEdit();
      return;
    }
    if (action === 'toggle-music-loop') {
      if (!state.project.music) return;
      state.project.music.loop = !state.project.music.loop;
      refreshAfterEdit();
      return;
    }
    if (action === 'toggle-bold') {
      const text = selection && selection.type === 'text' ? textFor(selection.id) : null;
      if (!text) return;
      text.bold = !text.bold;
      updateTextOverlayStyles();
      renderInspector();
      pushHistory();
      markDirty();
      return;
    }
    if (action === 'toggle-background') {
      const text = selection && selection.type === 'text' ? textFor(selection.id) : null;
      if (!text) return;
      text.background = !text.background;
      updateTextOverlayStyles();
      renderInspector();
      pushHistory();
      markDirty();
      return;
    }
    if (action === 'text-color') {
      const text = selection && selection.type === 'text' ? textFor(selection.id) : null;
      if (!text) return;
      text.color = actionEl.dataset.color || '#ffffff';
      updateTextOverlayStyles();
      renderInspector();
      pushHistory();
      markDirty();
      return;
    }
    if (action === 'text-position') {
      const text = selection && selection.type === 'text' ? textFor(selection.id) : null;
      if (!text) return;
      const position = actionEl.dataset.position;
      text.x = 0.5;
      text.y = position === 'top' ? 0.16 : position === 'bottom' ? 0.84 : 0.5;
      updateTextOverlayStyles();
      renderInspector();
      pushHistory();
      markDirty();
      return;
    }
    if (action === 'select-outgoing-clip') {
      if (selection && selection.type === 'transition') {
        setSelection({ type: 'clip', id: selection.clipId });
      }
      return;
    }
    if (action === 'remove-transition') {
      if (selection && selection.type === 'transition') {
        const clip = clipFor(selection.clipId);
        if (clip) clip.transitionAfter = null;
        state.selected = { type: 'clip', id: selection.clipId };
        refreshAfterEdit();
      }
      return;
    }
  }

  function handleInspectorInput(event, commit = false) {
    const target = event.target;
    if (!target) return;
    const action = target.dataset.inspectorInput;
    const selection = state.selected;
    if (!action) return;

    if (action === 'text-content') {
      const text = selection && selection.type === 'text' ? textFor(selection.id) : null;
      if (!text) return;
      text.content = target.value;
      renderTextOverlay();
      const clipName = refs.textTrack ? $(`[data-text-id="${cssEscape(text.id)}"] .clip-name`, refs.textTrack) : null;
      if (clipName) clipName.textContent = text.content || 'Yazı';
      if (commit) { pushHistory(); markDirty(); }
      return;
    }

    if (action.startsWith('clip-')) {
      const clip = selection && selection.type === 'clip' ? clipFor(selection.id) : null;
      if (!clip) return;
      if (action === 'clip-volume') {
        clip.volume = clamp((Number(target.value) || 0) / 100, 0, 1.5);
        updateRangeDisplay(action, Math.round(clip.volume * 100), '');
        schedulePreviewSync(true);
      } else if (action === 'clip-fade-in') {
        clip.fadeIn = clamp(Number(target.value) || 0, 0, 10);
        updateRangeDisplay(action, clip.fadeIn.toFixed(1), ' sn');
        schedulePreviewSync(true);
      } else if (action === 'clip-fade-out') {
        clip.fadeOut = clamp(Number(target.value) || 0, 0, 10);
        updateRangeDisplay(action, clip.fadeOut.toFixed(1), ' sn');
        schedulePreviewSync(true);
      }
      if (commit) { pushHistory(); markDirty(); }
      return;
    }

    if (action === 'transition-duration') {
      const clip = selection && selection.type === 'transition'
        ? clipFor(selection.clipId)
        : selection && selection.type === 'clip' ? clipFor(selection.id) : null;
      if (!clip || !clip.transitionAfter) return;
      clip.transitionAfter.duration = clamp(Number(target.value) || 0.45, 0.15, 1.5);
      updateRangeDisplay(action, clip.transitionAfter.duration.toFixed(2), ' sn');
      refreshLayout();
      renderTimeline();
      schedulePreviewSync(true);
      if (commit) { pushHistory(); markDirty(); }
      return;
    }

    if (action.startsWith('text-')) {
      const text = selection && selection.type === 'text' ? textFor(selection.id) : null;
      if (!text) return;
      if (action === 'text-size') {
        text.size = clamp(Number(target.value) || 5.6, 1.5, 20);
        updateRangeDisplay(action, text.size.toFixed(1), '');
        updateTextOverlayStyles();
      } else if (action === 'text-fade') {
        text.fade = clamp(Number(target.value) || 0, 0, 2);
        updateRangeDisplay(action, text.fade.toFixed(2), ' sn');
      } else if (action === 'text-start') {
        text.start = clamp(Number(target.value) || 0, 0, text.end - 0.2);
        target.value = String(text.start);
        updateRangeDisplay(action, T.formatClock(text.start));
        renderTimeline();
        updateTextOverlayVisibility(state.playhead);
      } else if (action === 'text-end') {
        text.end = clamp(Number(target.value) || 0.2, text.start + 0.2, Math.max(projectDuration(), text.start + 0.2));
        target.value = String(text.end);
        updateRangeDisplay(action, T.formatClock(text.end));
        renderTimeline();
        updateTextOverlayVisibility(state.playhead);
      }
      if (commit) { pushHistory(); markDirty(); }
      return;
    }

    if (action.startsWith('music-')) {
      const music = state.project.music;
      if (!music) return;
      if (action === 'music-volume') {
        music.volume = clamp((Number(target.value) || 0) / 100, 0, 1.5);
        updateRangeDisplay(action, Math.round(music.volume * 100), '');
      } else if (action === 'music-fade-in') {
        music.fadeIn = clamp(Number(target.value) || 0, 0, 10);
        updateRangeDisplay(action, music.fadeIn.toFixed(1), ' sn');
      } else if (action === 'music-fade-out') {
        music.fadeOut = clamp(Number(target.value) || 0, 0, 10);
        updateRangeDisplay(action, music.fadeOut.toFixed(1), ' sn');
      }
      refreshAudioSettings();
      if (commit) { pushHistory(); markDirty(); }
    }
  }

  function handleInspectorChange(event) {
    const target = event.target;
    if (!target) return;
    const change = target.dataset.inspectorChange;
    if (change === 'project-resolution') {
      const [width, height] = String(target.value).split('x').map(Number);
      if (Number.isFinite(width) && Number.isFinite(height) && width > 15 && height > 15) {
        state.project.width = even(width);
        state.project.height = even(height);
        updateStageSize();
        renderAll({ sync: false });
        pushHistory();
        markDirty();
      }
      return;
    }
    if (change === 'project-fps') {
      state.project.fps = clamp(Number(target.value) || 30, 1, 120);
      renderProjectMeta();
      pushHistory();
      markDirty();
      return;
    }
    if (change === 'text-color-custom') {
      const text = state.selected && state.selected.type === 'text' ? textFor(state.selected.id) : null;
      if (!text) return;
      text.color = target.value || '#ffffff';
      updateTextOverlayStyles();
      renderInspector();
      pushHistory();
      markDirty();
      return;
    }
    if (target.dataset.inspectorInput) {
      handleInspectorInput(event, true);
      if (change === 'text-content') renderInspector();
    }
  }

  function bindInspectorEvents() {
    if (!refs.inspectorBody) return;
    refs.inspectorBody.addEventListener('click', handleInspectorClick);
    refs.inspectorBody.addEventListener('input', (event) => handleInspectorInput(event, false));
    refs.inspectorBody.addEventListener('change', (event) => {
      if (event.target.dataset.inspectorInput) {
        handleInspectorInput(event, true);
      } else if (event.target.dataset.inspectorChange) {
        handleInspectorChange(event);
      }
    });
  }

  // ── Modals, project actions & export ────────────────────

  function closeModal() {
    if (!activeModal) return;
    const modal = activeModal;
    activeModal = null;
    modal.overlay.remove();
    if (typeof modal.onClose === 'function') modal.onClose();
  }

  function openModal(options = {}) {
    closeModal();
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal ${options.wide ? 'modal-wide' : ''}" role="dialog" aria-modal="true">
        <div class="modal-header">
          <div>
            <h2>${escapeHtml(options.title || '')}</h2>
            ${options.subtitle ? `<p>${escapeHtml(options.subtitle)}</p>` : ''}
          </div>
          <button class="modal-close" title="Kapat"><svg class="icon icon-sm"><use href="#i-x"/></svg></button>
        </div>
        <div class="modal-body">${options.body || ''}</div>
        <div class="modal-footer">${options.footer || ''}</div>
      </div>
    `;
    refs.modalRoot.append(overlay);
    const modal = overlay.querySelector('.modal');
    const controller = {
      overlay,
      modal,
      body: overlay.querySelector('.modal-body'),
      footer: overlay.querySelector('.modal-footer'),
      header: overlay.querySelector('.modal-header'),
      closeButton: overlay.querySelector('.modal-close'),
      onClose: options.onClose,
      canClose: null,
      setBody(html) { controller.body.innerHTML = html; },
      setFooter(html) { controller.footer.innerHTML = html; },
      setTitle(title, subtitle) {
        const h2 = controller.header.querySelector('h2');
        if (h2) h2.textContent = title || '';
        let p = controller.header.querySelector('p');
        if (subtitle) {
          if (!p) {
            p = document.createElement('p');
            h2.after(p);
          }
          p.textContent = subtitle;
        } else if (p) {
          p.remove();
        }
      },
      close: closeModal,
      forceClose: closeModal,
    };
    activeModal = controller;

    const requestClose = () => {
      if (controller.canClose && !controller.canClose()) return;
      closeModal();
    };
    controller.requestClose = requestClose;
    overlay.addEventListener('mousedown', (event) => {
      if (event.target === overlay) requestClose();
    });
    controller.closeButton.addEventListener('click', requestClose);
    document.addEventListener('keydown', function onKey(event) {
      if (event.key !== 'Escape') return;
      if (activeModal !== controller) {
        document.removeEventListener('keydown', onKey);
        return;
      }
      event.preventDefault();
      requestClose();
    });
    if (typeof options.onMount === 'function') options.onMount(controller);
    requestAnimationFrame(() => {
      const focusable = controller.body.querySelector('input, textarea, select, button');
      if (focusable) focusable.focus({ preventScroll: true });
    });
    return controller;
  }

  function confirmDialog({ title, message, confirmLabel = 'Onayla', cancelLabel = 'Vazgeç', danger = false }) {
    return new Promise((resolve) => {
      let settled = false;
      const finish = (value) => {
        if (settled) return;
        settled = true;
        resolve(value);
        closeModal();
      };
      const dialog = openModal({
        title,
        body: `<p class="confirm-message">${message}</p>`,
        footer: `
          <button class="button button-ghost" data-confirm="false">${escapeHtml(cancelLabel)}</button>
          <button class="button ${danger ? 'button-danger' : 'button-primary'}" data-confirm="true">${escapeHtml(confirmLabel)}</button>
        `,
        onClose: () => { if (!settled) { settled = true; resolve(false); } },
      });
      dialog.overlay.addEventListener('click', (event) => {
        const button = event.target.closest('[data-confirm]');
        if (!button) return;
        event.stopPropagation();
        finish(button.dataset.confirm === 'true');
      });
    });
  }

  function resetPlaybackResources() {
    pausePlayback();
    players.forEach(resetPlayer);
    if (musicAudio) {
      try {
        musicAudio.pause();
        musicAudio.removeAttribute('src');
        musicAudio.load();
      } catch { /* ignore */ }
    }
    state.proxyInfo.clear();
    state.previewStatus.clear();
    state.previewUrls.clear();
  }

  async function newProject() {
    if (state.project.clips.length || state.project.media.length) {
      const confirmed = await confirmDialog({
        title: 'Yeni proje açılsın mı?',
        message: 'Mevcut <strong>zaman çizelgesi ve medya kitaplığı</strong> temizlenecek. Kaynak video dosyalarına hiçbir şey olmaz. Kaydetmediğin değişiklikler kaybolur.',
        confirmLabel: 'Yeni proje',
        danger: true,
      });
      if (!confirmed) return;
    }
    closeModal();
    resetPlaybackResources();
    state.project = createProject();
    state.projectPath = null;
    state.selected = null;
    state.playhead = 0;
    state.thumbUrls.clear();
    state.waveformUrls.clear();
    state.offline.clear();
    state.exportPath = null;
    initHistory();
    renderAll();
    setZoom(42, { keepAnchor: false });
    if (refs.inspectorBody) renderProjectInspector();
    api.clearAutosave().catch(() => {});
    updateStageSize();
    toast({ type: 'info', title: 'Yeni proje', message: 'Temiz bir zaman çizelgesi hazır.', duration: 2200 });
  }

  async function openProject() {
    try {
      const result = await call(api.openProject);
      if (result.canceled) return;
      const project = normalizeProject(result.data);
      pausePlayback();
      resetPlaybackResources();
      state.project = project;
      state.projectPath = result.path || null;
      state.selected = null;
      state.playhead = 0;
      state.thumbUrls.clear();
      state.waveformUrls.clear();
      state.offline.clear();
      initHistory();
      refreshLayout();
      renderAll();
      updateStageSize();
      await refreshOfflineStatus();
      hydrateAllMedia();
      fitTimeline();
      toast({ type: 'success', title: 'Proje açıldı', message: project.name, duration: 2200 });
    } catch (error) {
      toast({ type: 'error', title: 'Proje açılamadı', message: error.message || 'Dosya okunamadı.', duration: 5000 });
    }
  }

  async function saveProject(saveAs = false) {
    try {
      const result = await call(api.saveProject, {
        data: projectForSave(),
        path: state.projectPath,
        saveAs,
      });
      if (result.canceled) return false;
      state.projectPath = result.path || state.projectPath;
      setAutosaveState('saved');
      toast({
        type: 'success',
        title: 'Proje kaydedildi',
        message: state.projectPath || state.project.name,
        duration: 2400,
      });
      return true;
    } catch (error) {
      toast({ type: 'error', title: 'Kaydedilemedi', message: error.message || 'Proje yazılamadı.', duration: 5000 });
      return false;
    }
  }

  function renameProject() {
    const current = state.project.name || 'Yeni Proje';
    const dialog = openModal({
      title: 'Projeyi yeniden adlandır',
      subtitle: 'Bu ad proje dosyasında ve dışa aktarma adında kullanılır.',
      body: `
        <div class="form-group">
          <label class="form-label">Proje adı</label>
          <input id="renameProjectInput" class="form-input" type="text" maxlength="80" value="${escapeHtml(current)}" autocomplete="off">
        </div>
      `,
      footer: `
        <button class="button button-ghost" data-rename="cancel">Vazgeç</button>
        <button class="button button-primary" data-rename="save">Kaydet</button>
      `,
    });
    const input = dialog.body.querySelector('#renameProjectInput');
    const commit = () => {
      const value = String(input.value || '').trim();
      if (!value) {
        input.focus({ preventScroll: true });
        return;
      }
      state.project.name = value;
      renderProjectMeta();
      renderInspector();
      pushHistory();
      markDirty();
      closeModal();
    };
    dialog.overlay.addEventListener('click', (event) => {
      const button = event.target.closest('[data-rename]');
      if (button) commit();
    });
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        commit();
      }
    });
    requestAnimationFrame(() => {
      input.focus({ preventScroll: true });
      input.select();
    });
  }

  function showShortcutsModal() {
    const rows = [
      ['Oynat / duraklat', ['Space']],
      ['İmleçten böl', ['S']],
      ['Seçileni sil', ['Del']],
      ['Geri al', ['Ctrl', 'Z']],
      ['Yinele', ['Ctrl', 'Shift', 'Z']],
      ['Projeyi kaydet', ['Ctrl', 'S']],
      ['Dışa aktar', ['Ctrl', 'E']],
      ['Video içe aktar', ['Ctrl', 'I']],
      ['Başa dön', ['Home']],
      ['Sona git', ['End']],
      ['Kare kare ilerle', ['←', '→']],
      ['Yakınlaştır / uzaklaştır', ['Ctrl', '+', '−']],
    ];
    openModal({
      title: 'Kısayollar',
      subtitle: 'Hızlı düzenleme için klavyeni kullan.',
      wide: true,
      body: `
        <div class="shortcut-grid">
          ${rows.map(([label, keys]) => `
            <div class="shortcut-row">
              <span>${escapeHtml(label)}</span>
              <span class="shortcut-keys">${keys.map((key) => `<kbd>${escapeHtml(key)}</kbd>`).join('')}</span>
            </div>
          `).join('')}
        </div>
      `,
      footer: '<button class="button button-primary" data-close-modal>Tamam</button>',
      onMount: (dialog) => {
        dialog.footer.addEventListener('click', (event) => {
          if (event.target.closest('[data-close-modal]')) closeModal();
        });
      },
    });
  }

  function exportSummaryHtml() {
    const duration = projectDuration();
    const hw = state.info && state.info.hardware;
    return `
      <div class="export-summary">
        <span class="export-summary-icon"><svg class="icon"><use href="#i-download"/></svg></span>
        <div class="export-summary-copy">
          <strong>${escapeHtml(state.project.name || 'KesKlip videosu')}</strong>
          <span>${escapeHtml(T.formatClock(duration))} · ${state.project.width} × ${state.project.height} · ${Math.round(state.project.fps)} fps</span>
        </div>
        <span class="export-summary-badge">${hw && hw.hardware ? 'GPU hızlandırma' : 'CPU'}</span>
      </div>
    `;
  }

  function exportFormHtml() {
    return `
      ${exportSummaryHtml()}

      <div class="form-group">
        <label class="form-label">Kayıt konumu</label>
        <div class="path-row">
          <input id="exportPathInput" class="form-input" type="text" value="${escapeHtml(state.exportPath || makeExportPath())}" spellcheck="false">
          <button class="button button-secondary" data-export-action="browse"><svg class="icon icon-sm"><use href="#i-folder"/></svg>Gözat</button>
        </div>
        <p class="field-note">Varsayılan olarak D:\\KesKlip\\exports klasörüne yazar. İstersen başka bir yer seç.</p>
      </div>

      <div class="form-group">
        <label class="form-label">Kalite <span>dosya boyutu / hız dengesi</span></label>
        <div class="export-options" style="grid-template-columns:repeat(3,1fr)">
          ${[
            { id: 'high', name: 'Yüksek', desc: 'En iyi görüntü, daha büyük dosya' },
            { id: 'balanced', name: 'Dengeli', desc: 'Önerilen, iyi denge' },
            { id: 'fast', name: 'Hızlı', desc: 'Küçük dosya, hızlı çıktı' },
          ].map((option) => `
            <button class="export-option ${state.exportQuality === option.id ? 'is-active' : ''}" data-export-quality="${option.id}">
              <strong>${option.name}</strong>
              <span>${option.desc}</span>
            </button>
          `).join('')}
        </div>
      </div>

      <div class="form-group">
        <label class="form-label">Ses işleme <span>dışa aktarımda uygulanır</span></label>
        <div class="toggle-row">
          <span class="toggle-label">Ses normalizasyonu (-16 LUFS)</span>
          <button class="switch ${state.exportNormalize ? 'is-on' : ''}" data-export-toggle="normalize" aria-label="Ses normalizasyonu"></button>
        </div>
        <div class="toggle-row">
          <span class="toggle-label">Gürültü azaltma</span>
          <button class="switch ${state.exportDenoise ? 'is-on' : ''}" data-export-toggle="denoise" aria-label="Gürültü azaltma"></button>
        </div>
        <p class="field-note">Normalizasyon sesi dengeli bir seviyeye getirir. Gürültü azaltma, konuşmalı kayıtlarda hafif arka plan sesini düşürür; müzik ağırlıklı videolarda kapalı bırakabilirsin.</p>
      </div>

      <div class="export-note">
        <svg class="icon icon-sm"><use href="#i-gauge"/></svg>
        <span>${state.info && state.info.hardware && state.info.hardware.hardware
          ? `${escapeHtml(state.info.hardware.label)} kullanılacak. Dışa aktarma sırasında kaynak dosyalar değiştirilmez.`
          : 'Donanım kodlayıcı bulunamadı; CPU (libx264) kullanılacak. Kaynak dosyalar değiştirilmez.'}</span>
      </div>
    `;
  }

  function openExportDialog() {
    if (!state.project.clips.length) {
      toast({ type: 'warning', title: 'Dışa aktarılacak video yok', message: 'Önce zaman çizelgesine bir video ekle.', duration: 3000 });
      return;
    }
    if (state.exporting) {
      toast({ type: 'info', title: 'Dışa aktarma sürüyor', message: 'Tamamlanmasını bekleyelim.', duration: 2600 });
      return;
    }
    if (!state.exportPath) state.exportPath = makeExportPath();
    if (!state.exportQuality) state.exportQuality = 'balanced';

    const dialog = openModal({
      title: 'Dışa aktar',
      subtitle: 'Videoyu MP4 olarak, proje çözünürlüğünde hazırla.',
      wide: true,
      body: exportFormHtml(),
      footer: `
        <button class="button button-ghost" data-export-action="close">Vazgeç</button>
        <button class="button button-primary" data-export-action="start"><svg class="icon icon-sm"><use href="#i-download"/></svg>Dışa aktar</button>
      `,
    });
    state.exportDialog = dialog;

    dialog.overlay.addEventListener('click', async (event) => {
      const toggle = event.target.closest('[data-export-toggle]');
      if (toggle) {
        const key = toggle.dataset.exportToggle;
        if (key === 'normalize') state.exportNormalize = !state.exportNormalize;
        else if (key === 'denoise') state.exportDenoise = !state.exportDenoise;
        const active = key === 'normalize' ? state.exportNormalize : state.exportDenoise;
        toggle.classList.toggle('is-on', active);
        return;
      }
      const quality = event.target.closest('[data-export-quality]');
      if (quality) {
        state.exportQuality = quality.dataset.exportQuality;
        dialog.body.querySelectorAll('[data-export-quality]').forEach((el) => el.classList.toggle('is-active', el === quality));
        return;
      }
      const actionEl = event.target.closest('[data-export-action]');
      if (!actionEl) return;
      const action = actionEl.dataset.exportAction;
      if (action === 'close') {
        if (state.exporting) {
          toast({ type: 'warning', title: 'Dışa aktarma sürüyor', message: 'Önce iptal et veya bitmesini bekle.', duration: 2600 });
          return;
        }
        closeModal();
        return;
      }
      if (action === 'browse') {
        const input = dialog.body.querySelector('#exportPathInput');
        const result = await call(api.chooseExportPath, {
          name: state.project.name,
          currentPath: input ? input.value : state.exportPath,
        }).catch((error) => {
          toast({ type: 'error', title: 'Konum seçilemedi', message: error.message, duration: 4000 });
          return null;
        });
        if (result && !result.canceled && result.path) {
          state.exportPath = result.path;
          if (input) input.value = result.path;
        }
        return;
      }
      if (action === 'start') {
        await startExportFromDialog(dialog);
        return;
      }
      if (action === 'cancel') {
        actionEl.disabled = true;
        const subtitle = dialog.body.querySelector('.progress-subtitle');
        if (subtitle) subtitle.textContent = 'İptal ediliyor…';
        api.cancelExport().catch(() => {});
        return;
      }
      if (action === 'retry') {
        dialog.canClose = null;
        dialog.closeButton.style.display = '';
        dialog.setTitle('Dışa aktar', 'Videoyu MP4 olarak, proje çözünürlüğünde hazırla.');
        dialog.setBody(exportFormHtml());
        dialog.setFooter(`
          <button class="button button-ghost" data-export-action="close">Vazgeç</button>
          <button class="button button-primary" data-export-action="start"><svg class="icon icon-sm"><use href="#i-download"/></svg>Dışa aktar</button>
        `);
        return;
      }
      if (action === 'open-result') {
        if (state.lastExportResult && state.lastExportResult.outputPath) {
          api.openPath(state.lastExportResult.outputPath).catch((error) => {
            toast({ type: 'error', title: 'Video açılamadı', message: error.message, duration: 4000 });
          });
        }
        return;
      }
      if (action === 'show-result') {
        if (state.lastExportResult && state.lastExportResult.outputPath) {
          api.showItemInFolder(state.lastExportResult.outputPath).catch(() => {});
        }
        return;
      }
    });

    const input = dialog.body.querySelector('#exportPathInput');
    if (input) {
      input.addEventListener('input', () => { state.exportPath = input.value; });
    }
  }

  function formatExportProgress(payload) {
    const info = payload || {};
    const percent = Math.round(clamp(Number(info.progress) || 0, 0, 1) * 100);
    return {
      percent,
      percentText: `%${percent}`,
      elapsed: formatEta(Number(info.elapsed) || 0).replace('~', ''),
      eta: info.eta == null ? 'hesaplanıyor' : formatEta(info.eta),
      size: info.size ? formatBytes(info.size) : '—',
      fps: info.fps ? `${Math.round(info.fps)} fps` : '—',
      speed: info.speed || '—',
      seconds: T.formatClock(info.seconds || 0),
      duration: T.formatClock(info.duration || projectDuration()),
    };
  }

  function renderExportProgress(payload) {
    const dialog = state.exportDialog;
    if (!dialog || !state.exporting) return;
    const info = formatExportProgress(payload);
    const fill = dialog.body.querySelector('#exportProgressFill');
    const percent = dialog.body.querySelector('#exportPercent');
    const meta = dialog.body.querySelector('#exportProgressMeta');
    const progressText = dialog.body.querySelector('#exportProgressText');
    if (fill) fill.style.width = `${info.percent}%`;
    if (percent) percent.textContent = info.percentText;
    if (meta) meta.textContent = `${info.seconds} / ${info.duration} · ${info.size}`;
    if (progressText) progressText.textContent = `${info.eta} kaldı · ${info.fps}`;
  }

  async function startExportFromDialog(dialog) {
    if (state.exporting) return;
    const input = dialog.body.querySelector('#exportPathInput');
    let outputPath = String(input ? input.value : state.exportPath || '').trim();
    if (!outputPath) {
      toast({ type: 'warning', title: 'Kayıt konumu gerekli', message: 'Bir dosya yolu seç.', duration: 2800 });
      return;
    }
    if (!/\.mp4$/i.test(outputPath)) outputPath += '.mp4';
    state.exportPath = outputPath;
    state.lastExportDir = outputPath.replace(/[\\/][^\\/]*$/, '');
    state.exporting = true;
    state.exportDialog = dialog;
    dialog.canClose = () => false;
    dialog.closeButton.style.display = 'none';
    dialog.setTitle('Video hazırlanıyor', 'KesKlip videoyu tek geçişte birleştiriyor.');
    dialog.setBody(`
      <div class="progress-stage">
        <div class="progress-header">
          <div>
            <div class="progress-title">Videon hazırlanıyor</div>
            <div class="progress-subtitle" id="exportProgressText">Başlıyor…</div>
          </div>
          <div class="progress-percent" id="exportPercent">%0</div>
        </div>
        <div class="progress-track"><div class="progress-fill" id="exportProgressFill"></div></div>
        <div class="progress-meta">
          <span><svg class="icon"><use href="#i-clock"/></svg><span id="exportProgressMeta">00:00 / ${T.formatClock(projectDuration())}</span></span>
          <span id="exportProgressSpeed">—</span>
        </div>
      </div>
      <p class="field-note" style="margin-top:14px">Pencereyi kapatma; işlem bitince video otomatik olarak kaydedilir. İptal edersen yarım dosya silinir.</p>
    `);
    dialog.setFooter(`<button class="button button-danger" data-export-action="cancel">İptal et</button>`);

    try {
      const result = await call(api.startExport, {
        project: projectForSave(),
        outputPath,
        options: {
          quality: state.exportQuality,
          normalize: state.exportNormalize !== false,
          denoise: state.exportDenoise === true,
        },
      });
      const exportResult = result.result || {};
      state.exporting = false;
      if (exportResult.ok) {
        showExportDone(exportResult, dialog);
      } else if (exportResult.canceled) {
        dialog.canClose = null;
        dialog.closeButton.style.display = '';
        dialog.setTitle('Dışa aktarma iptal edildi', 'Yarım dosya temizlendi.');
        dialog.setBody(`
          <div class="error-state">
            <span class="error-icon"><svg class="icon"><use href="#i-x"/></svg></span>
            <h3>İptal edildi</h3>
            <p>Dışa aktarma durduruldu ve yarım kalan dosya silindi. Projektörde değişiklik yapmadan yeniden deneyebilirsin.</p>
          </div>
        `);
        dialog.setFooter(`
          <button class="button button-primary" data-export-action="retry">Yeniden dene</button>
          <button class="button button-ghost" data-export-action="close">Kapat</button>
        `);
      } else {
        showExportError(exportResult.error || 'Dışa aktarma tamamlanamadı.', exportResult.logPath, dialog);
      }
    } catch (error) {
      state.exporting = false;
      showExportError(error.message || 'Dışa aktarma başarısız oldu.', null, dialog);
    }
  }

  function showExportDone(result, dialog) {
    state.lastExportResult = result;
    state.exporting = false;
    dialog.canClose = null;
    dialog.closeButton.style.display = '';
    dialog.setTitle('Dışa aktarma tamamlandı', 'Video hazır.');
    dialog.setBody(`
      <div class="export-done">
        <span class="done-icon"><svg class="icon"><use href="#i-check"/></svg></span>
        <h3>Videon hazır!</h3>
        <p>${escapeHtml(result.outputPath || '')}</p>
        <div class="export-done-meta">
          <span>${formatBytes(result.size || 0)}</span>
          <span class="dot"></span>
          <span>${T.formatClock(result.duration || projectDuration())}</span>
          <span class="dot"></span>
          <span>${Math.round(Number(result.elapsed) || 0)} sn sürdü</span>
        </div>
        ${result.encoder ? `<div class="export-done-meta"><span>${escapeHtml(result.encoder)}</span></div>` : ''}
      </div>
    `);
    dialog.setFooter(`
      <button class="button button-ghost" data-export-action="show-result"><svg class="icon icon-sm"><use href="#i-folder"/></svg>Klasörde göster</button>
      <button class="button button-secondary" data-export-action="retry">Yeni dışa aktarma</button>
      <button class="button button-primary" data-export-action="open-result"><svg class="icon icon-sm"><use href="#i-play-circle"/></svg>Videoyu aç</button>
    `);
    toast({ type: 'success', title: 'Dışa aktarma tamam', message: result.outputPath || 'Video kaydedildi.', duration: 4200 });
  }

  function showExportError(message, logPath, dialog) {
    state.exporting = false;
    dialog.canClose = null;
    dialog.closeButton.style.display = '';
    dialog.setTitle('Dışa aktarma başarısız', 'Bir sorun oluştu.');
    dialog.setBody(`
      <div class="error-state">
        <span class="error-icon"><svg class="icon"><use href="#i-alert"/></svg></span>
        <h3>Video oluşturulamadı</h3>
        <p>${escapeHtml(message || 'Bilinmeyen bir hata oluştu.')}</p>
        ${logPath ? `<p style="margin-top:8px;color:var(--dim)">Günlük: ${escapeHtml(logPath)}</p>` : ''}
      </div>
    `);
    dialog.setFooter(`
      <button class="button button-ghost" data-export-action="close">Kapat</button>
      <button class="button button-primary" data-export-action="retry">Yeniden dene</button>
    `);
  }

  function handleExportProgressEvent(payload) {
    if (!payload) return;
    if (payload.running === false && payload.result) return;
    renderExportProgress(payload);
  }

  function handleExportStartedEvent(payload) {
    if (!payload) return;
    state.lastExportStarted = payload;
    if (payload.outputPath) state.lastExportDir = payload.outputPath.replace(/[\\/][^\\/]*$/, '');
  }

  // ── Text overlays, bindings & boot ──────────────────────

  function addTextOverlay(template = 'custom') {
    if (!state.project.clips.length) {
      toast({ type: 'warning', title: 'Önce video ekle', message: 'Yazı eklemek için zaman çizelgesinde bir video olmalı.', duration: 2800 });
      return;
    }
    const duration = Math.max(0.2, projectDuration());
    const presets = {
      title: {
        content: 'Başlık metni',
        size: 8.5,
        y: 0.28,
        bold: true,
        background: false,
        color: '#ffffff',
      },
      caption: {
        content: 'Alt yazı metni',
        size: 4.2,
        y: 0.84,
        bold: false,
        background: true,
        color: '#ffffff',
      },
      tag: {
        content: 'Vurgu',
        size: 4.5,
        y: 0.5,
        bold: true,
        background: false,
        color: '#63e8c8',
      },
      custom: {
        content: 'Yazınız',
        size: 5.6,
        y: 0.5,
        bold: false,
        background: false,
        color: '#ffffff',
      },
    };
    const preset = presets[template] || presets.custom;
    let start = clamp(state.playhead, 0, Math.max(0, duration - 0.2));
    let end = Math.min(duration, start + 4.5);
    if (end - start < 0.3) {
      start = Math.max(0, duration - 3);
      end = duration;
    }
    const text = {
      id: uid('text'),
      content: preset.content,
      start,
      end,
      x: 0.5,
      y: preset.y,
      size: preset.size,
      color: preset.color,
      bold: preset.bold,
      background: preset.background,
      fade: 0.18,
    };
    state.project.texts.push(text);
    state.selected = { type: 'text', id: text.id };
    renderAll({ sync: false });
    pushHistory();
    markDirty();
    requestAnimationFrame(() => {
      const textarea = refs.inspectorBody.querySelector('[data-inspector-input="text-content"]');
      if (textarea) {
        textarea.focus({ preventScroll: true });
        textarea.select();
      }
    });
  }

  function switchSidePanel(name) {
    $$('.side-tab').forEach((tab) => tab.classList.toggle('is-active', tab.dataset.sidePanel === name));
    $$('.side-panel').forEach((panel) => panel.classList.toggle('is-active', panel.dataset.panel === name));
  }

  function bindMediaLibrary() {
    const handleAdd = (event) => {
      const button = event.target.closest('[data-add-media]');
      if (!button) return;
      event.stopPropagation();
      event.preventDefault();
      const media = mediaFor(button.dataset.addMedia);
      if (!media) return;
      if (media.kind === 'audio') {
        attachMusic(media);
        toast({ type: 'success', title: 'Müzik eklendi', message: media.name, duration: 2200 });
      } else {
        addClipFromMedia(media);
        toast({ type: 'success', title: 'Zaman çizelgesine eklendi', message: media.name, duration: 2000 });
      }
    };

    if (refs.mediaList) {
      refs.mediaList.addEventListener('click', handleAdd);
      refs.mediaList.addEventListener('dblclick', (event) => {
        const card = event.target.closest('[data-media-id]');
        if (!card) return;
        const media = mediaFor(card.dataset.mediaId);
        if (media && media.kind === 'video') addClipFromMedia(media);
      });
      refs.mediaList.addEventListener('dragstart', (event) => {
        const card = event.target.closest('[data-media-id]');
        if (!card) return;
        state.draggingMediaId = card.dataset.mediaId;
        try {
          event.dataTransfer.effectAllowed = 'copy';
          event.dataTransfer.setData('text/kesklip-media', card.dataset.mediaId);
        } catch { /* ignore */ }
      });
      refs.mediaList.addEventListener('dragend', () => { state.draggingMediaId = null; });
    }

    if (refs.audioList) {
      refs.audioList.addEventListener('click', handleAdd);
      refs.audioList.addEventListener('dragstart', (event) => {
        const card = event.target.closest('[data-media-id]');
        if (!card) return;
        state.draggingMediaId = card.dataset.mediaId;
        try {
          event.dataTransfer.effectAllowed = 'copy';
          event.dataTransfer.setData('text/kesklip-media', card.dataset.mediaId);
        } catch { /* ignore */ }
      });
      refs.audioList.addEventListener('dragend', () => { state.draggingMediaId = null; });
    }

    if (refs.audioTrack) {
      refs.audioTrack.addEventListener('dragover', (event) => {
        const mediaId = readMediaDrag(event);
        if (!mediaId) return;
        const media = mediaFor(mediaId);
        if (!media || media.kind !== 'audio') return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'copy';
        refs.audioTrack.classList.add('is-drop-target');
      });
      refs.audioTrack.addEventListener('dragleave', (event) => {
        if (event.target === refs.audioTrack) refs.audioTrack.classList.remove('is-drop-target');
      });
      refs.audioTrack.addEventListener('drop', (event) => {
        const mediaId = readMediaDrag(event);
        refs.audioTrack.classList.remove('is-drop-target');
        if (!mediaId) return;
        const media = mediaFor(mediaId);
        if (!media || media.kind !== 'audio') return;
        event.preventDefault();
        attachMusic(media);
      });
    }
  }

  function bindDropZone() {
    let dragDepth = 0;
    const hasFiles = (event) => Boolean(
      event.dataTransfer &&
      Array.from(event.dataTransfer.types || []).includes('Files')
    );
    const show = () => {
      if (refs.sharedDropOverlay) refs.sharedDropOverlay.classList.add('is-visible');
    };
    const hide = () => {
      dragDepth = 0;
      if (refs.sharedDropOverlay) refs.sharedDropOverlay.classList.remove('is-visible');
    };

    window.addEventListener('dragenter', (event) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      dragDepth += 1;
      show();
    });
    window.addEventListener('dragover', (event) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
    });
    window.addEventListener('dragleave', (event) => {
      if (!hasFiles(event)) return;
      dragDepth = Math.max(0, dragDepth - 1);
      if (dragDepth === 0) hide();
    });
    window.addEventListener('drop', async (event) => {
      if (event.target.closest && event.target.closest('#timelineScroll')) {
        // Timeline-level drops are handled by the track listeners.
      }
      if (!hasFiles(event)) return;
      event.preventDefault();
      hide();
      const files = Array.from(event.dataTransfer.files || []);
      if (!files.length) return;
      const paths = files.map((file) => api.getPathForFile(file)).filter(Boolean);
      if (paths.length) await importPaths(paths);
    });
  }

  function handleKeyboard(event) {
    if (activeModal) return;
    const target = event.target;
    if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;

    const mod = event.ctrlKey || event.metaKey;
    const key = event.key;
    const lower = String(key).toLowerCase();

    if (mod) {
      if (lower === 'z') {
        event.preventDefault();
        if (event.shiftKey) redo();
        else undo();
        return;
      }
      if (lower === 'y') { event.preventDefault(); redo(); return; }
      if (lower === 's') { event.preventDefault(); saveProject(event.shiftKey); return; }
      if (lower === 'e') { event.preventDefault(); openExportDialog(); return; }
      if (lower === 'i') { event.preventDefault(); pickAndImport('video'); return; }
      if (lower === 'o') { event.preventDefault(); openProject(); return; }
      if (lower === 'n') { event.preventDefault(); newProject(); return; }
      if (key === '0') { event.preventDefault(); fitTimeline(); return; }
      if (key === '+' || key === '=') { event.preventDefault(); setZoom(state.zoomValue + 6); return; }
      if (key === '-' || key === '_') { event.preventDefault(); setZoom(state.zoomValue - 6); return; }
      return;
    }

    if (key === ' ' || key === 'Spacebar') {
      event.preventDefault();
      if (!event.repeat) togglePlayback();
      return;
    }
    if (lower === 's' && !event.repeat) { event.preventDefault(); splitAtPlayhead(); return; }
    if ((key === 'Delete' || key === 'Backspace') && !event.repeat) {
      if (state.selected) {
        event.preventDefault();
        deleteSelection();
      }
      return;
    }
    if (key === 'Home') { event.preventDefault(); pausePlayback(); seekTo(0); return; }
    if (key === 'End') { event.preventDefault(); pausePlayback(); seekTo(projectDuration()); return; }
    if (key === 'ArrowLeft' || key === 'ArrowRight') {
      event.preventDefault();
      const direction = key === 'ArrowLeft' ? -1 : 1;
      if (event.shiftKey) {
        pausePlayback();
        seekTo(state.playhead + direction, { render: true });
      } else {
        stepFrame(direction);
      }
      return;
    }
    if (key === 'Escape') {
      if (refs.previewStage.classList.contains('is-fullscreen')) {
        refs.previewStage.classList.remove('is-fullscreen');
        queueStageResize();
      } else if (state.selected) {
        setSelection(null);
      }
    }
  }

  function bindGlobalEvents() {
    if (refs.projectNameButton) refs.projectNameButton.addEventListener('click', renameProject);
    if (refs.openProjectButton) refs.openProjectButton.addEventListener('click', openProject);
    if (refs.saveProjectButton) refs.saveProjectButton.addEventListener('click', () => saveProject(false));
    if (refs.newProjectButton) refs.newProjectButton.addEventListener('click', newProject);
    if (refs.exportButton) refs.exportButton.addEventListener('click', openExportDialog);
    if (refs.undoButton) refs.undoButton.addEventListener('click', undo);
    if (refs.redoButton) refs.redoButton.addEventListener('click', redo);
    if (refs.importVideoButton) refs.importVideoButton.addEventListener('click', () => pickAndImport('video'));
    if (refs.importAudioButton) refs.importAudioButton.addEventListener('click', () => pickAndImport('audio'));
    if (refs.emptyImportButton) refs.emptyImportButton.addEventListener('click', () => pickAndImport('video'));
    if (refs.addTextButton) refs.addTextButton.addEventListener('click', () => addTextOverlay('custom'));
    if (refs.quickTextButton) refs.quickTextButton.addEventListener('click', () => addTextOverlay('custom'));
    if (refs.shortcutsButton) refs.shortcutsButton.addEventListener('click', showShortcutsModal);

    $$('.side-tab').forEach((tab) => {
      tab.addEventListener('click', () => switchSidePanel(tab.dataset.sidePanel));
    });

    $$('.text-preset').forEach((button) => {
      button.addEventListener('click', () => addTextOverlay(button.dataset.template || 'custom'));
    });

    document.addEventListener('keydown', handleKeyboard);

    window.addEventListener('resize', queueStageResize);
    window.addEventListener('focus', () => refreshOfflineStatus());
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden' && state.project.media.length) {
        api.autosaveProject(projectForSave()).catch(() => {});
      }
    });

    if (typeof ResizeObserver === 'function' && refs.previewArea) {
      const observer = new ResizeObserver(() => queueStageResize());
      observer.observe(refs.previewArea);
    }

    window.addEventListener('error', (event) => {
      console.error('KesKlip renderer hatası:', event.error || event.message);
      state.lastErrors = state.lastErrors || [];
      state.lastErrors.push(String(event.message || (event.error && event.error.message) || 'hata'));
    });
    window.addEventListener('unhandledrejection', (event) => {
      console.error('KesKlip yakalanmamış hata:', event.reason);
      state.lastErrors = state.lastErrors || [];
      state.lastErrors.push(String(event.reason && event.reason.message || event.reason || 'hata'));
    });
  }

  function setSplashText(text) {
    if (refs.splashText) refs.splashText.textContent = text;
  }

  function hideSplash() {
    if (refs.app) refs.app.classList.remove('is-loading');
    if (refs.splash) refs.splash.classList.add('is-hidden');
  }

  function showFatal(error) {
    console.error('KesKlip başlatılamadı:', error);
    if (refs.app) refs.app.classList.remove('is-loading');
    if (refs.splash) {
      refs.splash.classList.remove('is-hidden');
      const inner = refs.splash.querySelector('.splash-inner');
      if (inner) {
        inner.innerHTML = `
          <span class="splash-mark" style="filter:none">
            <svg viewBox="0 0 40 40"><rect x="2" y="2" width="36" height="36" rx="11" fill="#3b1d23"/><path d="M15 13l11 7-11 7V13Z" fill="#ff9eaa"/></svg>
          </span>
          <strong style="font-size:21px">Başlatılamadı</strong>
          <span class="splash-status" style="color:#ff9eaa;max-width:520px;text-align:center;line-height:1.6">${escapeHtml(error && error.message ? error.message : String(error))}</span>
          <button id="fatalRetry" class="button button-primary" style="margin-top:14px">Yeniden dene</button>
        `;
        const retry = inner.querySelector('#fatalRetry');
        if (retry) retry.addEventListener('click', () => window.location.reload());
      }
    }
  }

  async function boot() {
    if (!api) throw new Error('KesKlip köprüsü yüklenemedi. Uygulamayı yeniden başlat.');
    if (!T) throw new Error('Zaman çizelgesi motoru yüklenemedi.');

    setSplashText('Sistem bilgileri okunuyor…');
    const infoResult = await call(api.info);
    state.info = infoResult.info;
    state.exportQuality = 'balanced';
    state.exportPath = null;

    try {
      const volume = Number(localStorage.getItem('kesklip.monitorVolume'));
      if (Number.isFinite(volume) && volume >= 0 && volume <= 1) state.monitorVolume = volume;
      state.muted = localStorage.getItem('kesklip.muted') === '1';
    } catch { /* ignore */ }

    setSplashText('Son proje kontrol ediliyor…');
    let restored = false;
    try {
      const autosaveResult = await call(api.getAutosave);
      if (autosaveResult.autosave && autosaveResult.autosave.data) {
        state.project = normalizeProject(autosaveResult.autosave.data);
        state.projectPath = null;
        restored = state.project.media.length > 0 || state.project.clips.length > 0;
      }
    } catch (error) {
      console.warn('Otomatik kayıt okunamadı:', error);
    }

    attachPlayerHandlers();
    bindInspectorEvents();
    bindTimelineInteractions();
    bindGlobalEvents();
    bindMediaLibrary();
    bindDropZone();

    api.onProxyUpdate(handleProxyUpdate);
    api.onExportProgress(handleExportProgressEvent);
    api.onExportStarted(handleExportStartedEvent);

    setSplashText('Arayüz hazırlanıyor…');
    initHistory();
    refreshLayout();
    renderAll();
    updateVolumeUI();
    updateStageSize();
    updatePreviewStatus();

    if (state.project.media.length) {
      hydrateAllMedia();
    }
    if (projectDuration() > 0) {
      fitTimeline();
    } else {
      setZoom(42, { keepAnchor: false });
    }

    hideSplash();
    if (restored) {
      setTimeout(() => {
        toast({
          type: 'info',
          title: 'Son oturum geri yüklendi',
          message: 'Otomatik kayıttan devam ediyorsun. Kaynak dosyalar yerinde kalır.',
          duration: 3800,
        });
      }, 420);
    }
  }

  Object.defineProperty(window, '__kesklip', {
    value: {
      state,
      importPaths,
      addTextOverlay,
      addClipFromMedia,
      hydrateMedia,
      hydrateAllMedia,
      prepareMediaPreview,
      seekTo,
      playPlayback,
      pausePlayback,
      renderAll,
      renderTimeline,
      fitTimeline,
      setZoom,
      projectDuration,
      splitAtPlayhead,
      deleteSelection,
      duplicateSelection,
      reorderClip,
      attachMusic,
      setSelection,
      refreshOfflineStatus,
      undo,
      redo,
      pushHistory,
      projectForSave,
      getErrors: () => state.lastErrors || [],
    },
    configurable: false,
    writable: false,
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      boot().catch(showFatal);
    });
  } else {
    boot().catch(showFatal);
  }
})();
