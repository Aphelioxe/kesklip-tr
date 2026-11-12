'use strict';

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const Timeline = require('../shared/timeline');
const {
  FFMPEG,
  runProcess,
  killProcessTree,
  ensureDir,
  clamp,
} = require('./media-tools');

const TRANSITION_MAP = {
  soft: 'fade',
  flash: 'fadewhite',
  slide: 'slideleft',
  zoom: 'zoomin',
  wipe: 'wipeleft',
  circle: 'circleopen',
};

const QUALITY_SETTINGS = {
  high: {
    nvencCq: 19,
    x264Crf: 18,
    x264Preset: 'medium',
    audioBitrate: '224k',
  },
  balanced: {
    nvencCq: 22,
    x264Crf: 21,
    x264Preset: 'veryfast',
    audioBitrate: '192k',
  },
  fast: {
    nvencCq: 26,
    x264Crf: 25,
    x264Preset: 'ultrafast',
    audioBitrate: '160k',
  },
};

function encoderArguments(encoder, quality) {
  const preset = QUALITY_SETTINGS[quality] || QUALITY_SETTINGS.balanced;

  if (encoder === 'h264_nvenc') {
    return [
      '-c:v', 'h264_nvenc',
      '-preset', quality === 'fast' ? 'p3' : 'p5',
      '-rc', 'vbr',
      '-cq', String(preset.nvencCq),
      '-b:v', '0',
      '-pix_fmt', 'yuv420p',
      '-profile:v', 'high',
    ];
  }

  if (encoder === 'h264_amf') {
    return [
      '-c:v', 'h264_amf',
      '-quality', quality === 'fast' ? 'speed' : 'balanced',
      '-rc', 'cqp',
      '-qp_i', String(preset.nvencCq + 2),
      '-qp_p', String(preset.nvencCq + 4),
      '-pix_fmt', 'yuv420p',
      '-profile:v', 'high',
    ];
  }

  if (encoder === 'h264_qsv') {
    return [
      '-c:v', 'h264_qsv',
      '-preset', quality === 'fast' ? 'veryfast' : 'medium',
      '-global_quality', String(preset.nvencCq + 1),
      '-pix_fmt', 'yuv420p',
      '-profile:v', 'high',
    ];
  }

  return [
    '-c:v', 'libx264',
    '-preset', preset.x264Preset,
    '-crf', String(preset.x264Crf),
    '-pix_fmt', 'yuv420p',
    '-profile:v', 'high',
  ];
}

function hexToAssColor(hex, alpha = 0) {
  const value = String(hex || '#ffffff').replace('#', '');
  const normalized = /^[0-9a-f]{6}$/i.test(value) ? value : 'ffffff';
  const r = normalized.slice(0, 2);
  const g = normalized.slice(2, 4);
  const b = normalized.slice(4, 6);
  const a = clamp(Math.round(Number(alpha) || 0), 0, 255).toString(16).padStart(2, '0').toUpperCase();
  return `&H${a}${b}${g}${r}`;
}

function assTime(seconds) {
  const value = Math.max(0, Number(seconds) || 0);
  const hours = Math.floor(value / 3600);
  const minutes = Math.floor((value % 3600) / 60);
  const secs = Math.floor(value % 60);
  const centis = Math.round((value - Math.floor(value)) * 100);
  const pad = (num, size) => String(num).padStart(size, '0');
  return `${hours}:${pad(minutes, 2)}:${pad(secs, 2)}.${pad(Math.min(99, centis), 2)}`;
}

function sanitizeAssText(text) {
  return String(text == null ? '' : text)
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/[{}]/g, '')
    .replace(/\\/g, '/')
    .split('\n')
    .map((line) => line.replace(/\s+$/g, ''))
    .join('\\N');
}

function buildAss({ texts, width, height, duration }) {
  const usableTexts = (Array.isArray(texts) ? texts : [])
    .filter((text) => text && String(text.content || '').trim().length > 0)
    .map((text) => ({
      ...text,
      start: clamp(Number(text.start) || 0, 0, duration),
      end: clamp(Number(text.end) || 0, 0, duration),
    }))
    .filter((text) => text.end > text.start + 0.04);

  if (!usableTexts.length) return null;

  const lines = [
    '[Script Info]',
    'ScriptType: v4.00+',
    `PlayResX: ${Math.round(width)}`,
    `PlayResY: ${Math.round(height)}`,
    'ScaledBorderAndShadow: yes',
    'WrapStyle: 0',
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
  ];

  usableTexts.forEach((text, index) => {
    const fontSize = clamp((Number(text.size) || 5.6) / 100 * height, 10, 500);
    const bold = text.bold ? -1 : 0;
    const hasBackground = Boolean(text.background);
    const outline = hasBackground
      ? Math.max(2, Math.round(fontSize * 0.09))
      : Math.max(2, Math.round(fontSize * 0.035));
    const borderStyle = hasBackground ? 3 : 1;
    const backColour = hasBackground ? '&H66000000' : '&H00000000';
    lines.push(
      `Style: T${index},Segoe UI,${fontSize.toFixed(1)},${hexToAssColor(text.color || '#ffffff')},&H000000FF,` +
      `&H00000000,${backColour},${bold},0,0,0,100,100,0,0,${borderStyle},${outline},0,5,0,0,0,1`
    );
  });

  lines.push('', '[Events]', 'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text');

  usableTexts.forEach((text, index) => {
    const x = clamp((Number(text.x) || 0.5) * width, 0, width);
    const y = clamp((Number(text.y) || 0.5) * height, 0, height);
    const safeText = sanitizeAssText(text.content);
    const fade = clamp(Number(text.fade) || 0.18, 0, 2);
    lines.push(
      `Dialogue: 0,${assTime(text.start)},${assTime(text.end)},T${index},,0,0,0,,` +
      `{\\an5\\pos(${x.toFixed(1)},${y.toFixed(1)})\\fad(${Math.round(fade * 1000)},${Math.round(fade * 1000)})}${safeText}`
    );
  });

  return lines.join('\n') + '\n';
}

function clampProject(project) {
  const width = Math.max(16, Math.round(Number(project.width) || 1920) & ~1);
  const height = Math.max(16, Math.round(Number(project.height) || 1080) & ~1);
  const fps = clamp(Number(project.fps) || 30, 1, 120);
  return { width, height, fps };
}

function buildMusicFilter({ project, layout, musicMedia, inputIndex, duration }) {
  const music = project.music || {};
  const volume = clamp(Number(music.volume) || 0, 0, 1.5);
  const fadeIn = clamp(Number(music.fadeIn) || 0, 0, duration / 2);
  const fadeOut = clamp(Number(music.fadeOut) || 0, 0, duration / 2);
  const filters = [
    `[${inputIndex}:a]asetpts=PTS-STARTPTS`,
    'aresample=48000',
    'aformat=sample_fmts=fltp:channel_layouts=stereo',
    `atrim=duration=${duration.toFixed(3)}`,
    'asetpts=PTS-STARTPTS',
    `volume=${volume.toFixed(3)}`,
  ];

  if (fadeIn > 0.01) filters.push(`afade=t=in:st=0:d=${fadeIn.toFixed(3)}`);
  if (fadeOut > 0.01) {
    filters.push(`afade=t=out:st=${Math.max(0, duration - fadeOut).toFixed(3)}:d=${fadeOut.toFixed(3)}`);
  }

  filters.push('apad', `atrim=duration=${duration.toFixed(3)}`);
  return `${filters.join(',')}[music]`;
}

class ExportManager {
  constructor({ cacheRoot, hardware }) {
    this.cacheRoot = cacheRoot;
    this.hardware = hardware || { encoder: 'libx264', label: 'CPU', hardware: false };
    this.active = null;
  }

  get isRunning() {
    return Boolean(this.active);
  }

  cancel() {
    if (!this.active) return false;
    this.active.canceled = true;
    killProcessTree(this.active.child);
    return true;
  }

  async exportProject({ project, outputPath, options = {}, onProgress, onStarted }) {
    if (this.active) {
      throw new Error('Zaten devam eden bir dışa aktarma var.');
    }

    if (!outputPath) throw new Error('Dışa aktarma konumu seçilmedi.');
    if (!project || !Array.isArray(project.clips) || project.clips.length === 0) {
      throw new Error('Dışa aktarılacak video yok.');
    }

    const layout = Timeline.computeLayout(project);
    if (layout.duration <= 0.05) throw new Error('Zaman çizelgesi boş görünüyor.');

    const dimensions = clampProject(project);
    const { width, height, fps } = dimensions;
    const duration = layout.duration;
    const quality = QUALITY_SETTINGS[options.quality] ? options.quality : 'balanced';
    const encoder = options.encoder || this.hardware.encoder || 'libx264';
    const normalizeAudio = options.normalize === true || options.audioNormalize === true;
    const denoiseAudio = options.denoise === true || options.audioDenoise === true;
    const mediaById = new Map((project.media || []).map((media) => [media.id, media]));
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const workDir = path.join(this.cacheRoot, 'temp', `export-${timestamp}-${process.pid}`);
    const logDir = path.join(this.cacheRoot, 'logs');
    await ensureDir(workDir);
    await ensureDir(logDir);
    await ensureDir(path.dirname(outputPath));

    const filterParts = [];
    const inputArgs = [];
    const clipInputs = [];

    for (let index = 0; index < layout.items.length; index += 1) {
      const item = layout.items[index];
      const clip = item.clip;
      const media = mediaById.get(clip.mediaId);
      if (!media || !media.path) {
        throw new Error(`Klibin kaynağı bulunamadı: ${clip.name || clip.mediaId}`);
      }
      if (!fs.existsSync(media.path)) {
        throw new Error(`Kaynak dosya bulunamadı: ${media.name || media.path}`);
      }

      const inPoint = Math.max(0, Number(clip.inPoint) || 0);
      const outPoint = Math.max(inPoint + 0.04, Number(clip.outPoint) || 0);
      const sourceDuration = outPoint - inPoint;
      const speed = clamp(Number(clip.speed) || 1, 0.5, 2);
      const clipDuration = Math.max(0.05, sourceDuration / speed);
      const volume = clamp(Number(clip.volume) == null ? 1 : Number(clip.volume), 0, 1.5);
      const fades = Timeline.getClipFades(clip);
      const fadeIn = Math.min(fades.fadeIn, clipDuration * 0.5);
      const fadeOut = Math.min(fades.fadeOut, clipDuration * 0.5);

      if (inPoint > 0.001) inputArgs.push('-ss', inPoint.toFixed(3));
      inputArgs.push('-t', sourceDuration.toFixed(3), '-i', media.path);

      const sourceIndex = clipInputs.length;
      clipInputs.push({
        media,
        clip,
        index: sourceIndex,
        duration: clipDuration,
        speed,
        volume,
      });

      const videoFades = [];
      if (fadeIn > 0.01) videoFades.push(`fade=t=in:st=0:d=${fadeIn.toFixed(3)}`);
      if (fadeOut > 0.01) {
        videoFades.push(`fade=t=out:st=${Math.max(0, clipDuration - fadeOut).toFixed(3)}:d=${fadeOut.toFixed(3)}`);
      }
      const videoFadeSuffix = videoFades.length ? `,${videoFades.join(',')}` : '';

      const speedFilter = Math.abs(speed - 1) > 0.0001
        ? `setpts=(PTS-STARTPTS)/${speed.toFixed(6)}`
        : 'setpts=PTS-STARTPTS';
      filterParts.push(
        `[${sourceIndex}:v]${speedFilter},fps=${fps.toFixed(3)},` +
        `scale=${width}:${height}:force_original_aspect_ratio=decrease,` +
        `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=black,` +
        `setsar=1,format=yuv420p${videoFadeSuffix}[v${index}]`
      );

      if (media.hasAudio) {
        const audioFades = [];
        if (fadeIn > 0.01) audioFades.push(`afade=t=in:st=0:d=${fadeIn.toFixed(3)}`);
        if (fadeOut > 0.01) {
          audioFades.push(`afade=t=out:st=${Math.max(0, clipDuration - fadeOut).toFixed(3)}:d=${fadeOut.toFixed(3)}`);
        }
        const audioFadeSuffix = audioFades.length ? `,${audioFades.join(',')}` : '';
        const denoise = denoiseAudio ? 'afftdn=nr=10:nf=-30,' : '';
        const tempo = Math.abs(speed - 1) > 0.0001 ? `atempo=${speed.toFixed(4)},` : '';
        filterParts.push(
          `[${sourceIndex}:a]asetpts=PTS-STARTPTS,${tempo}aresample=48000:async=1,` +
          `aformat=sample_fmts=fltp:channel_layouts=stereo,` +
          `volume=${volume.toFixed(3)},` +
          denoise +
          `apad=whole_dur=${clipDuration.toFixed(3)},` +
          `atrim=duration=${clipDuration.toFixed(3)}${audioFadeSuffix}[a${index}]`
        );
      } else {
        filterParts.push(
          `anullsrc=channel_layout=stereo:sample_rate=48000,` +
          `atrim=duration=${clipDuration.toFixed(3)},asetpts=PTS-STARTPTS[a${index}]`
        );
      }
    }

    let currentVideo = 'v0';
    let currentAudio = 'a0';
    let currentDuration = clipInputs[0].duration;
    let chainIndex = 0;

    for (let index = 0; index < layout.items.length - 1; index += 1) {
      const transition = Timeline.getEffectiveTransition(layout.items.map((entry) => entry.clip), index);
      const nextVideo = `v${index + 1}`;
      const nextAudio = `a${index + 1}`;
      chainIndex += 1;

      if (transition) {
        const type = TRANSITION_MAP[transition.type] || 'fade';
        const transitionDuration = clamp(transition.duration, 0.08, Math.min(currentDuration, clipInputs[index + 1].duration) * 0.45);
        const offset = Math.max(0, currentDuration - transitionDuration);
        const nextVideoLabel = `vx${chainIndex}`;
        const nextAudioLabel = `ax${chainIndex}`;
        filterParts.push(
          `[${currentVideo}][${nextVideo}]xfade=transition=${type}:duration=${transitionDuration.toFixed(3)}:offset=${offset.toFixed(3)}[${nextVideoLabel}]`
        );
        filterParts.push(
          `[${currentAudio}][${nextAudio}]acrossfade=d=${transitionDuration.toFixed(3)}:c1=tri:c2=tri[${nextAudioLabel}]`
        );
        currentVideo = nextVideoLabel;
        currentAudio = nextAudioLabel;
        currentDuration = currentDuration + clipInputs[index + 1].duration - transitionDuration;
      } else {
        const nextVideoLabel = `vc${chainIndex}`;
        const nextAudioLabel = `ac${chainIndex}`;
        filterParts.push(`[${currentVideo}][${nextVideo}]concat=n=2:v=1:a=0[${nextVideoLabel}]`);
        filterParts.push(`[${currentAudio}][${nextAudio}]concat=n=2:v=0:a=1[${nextAudioLabel}]`);
        currentVideo = nextVideoLabel;
        currentAudio = nextAudioLabel;
        currentDuration += clipInputs[index + 1].duration;
      }
    }

    const assContent = buildAss({
      texts: project.texts,
      width,
      height,
      duration,
    });

    if (assContent) {
      const assPath = path.join(workDir, 'texts.ass');
      await fsp.writeFile(assPath, assContent, 'utf8');
      filterParts.push(`[${currentVideo}]subtitles=filename='texts.ass'[vsub]`);
      currentVideo = 'vsub';
    }

    const music = project.music;
    const musicMedia = music ? mediaById.get(music.mediaId) : null;
    let musicInputIndex = -1;
    const hasAudioContent = clipInputs.some((entry) => entry.media.hasAudio) || Boolean(music);

    if (music && musicMedia && musicMedia.path && fs.existsSync(musicMedia.path)) {
      musicInputIndex = clipInputs.length;
      if (music.loop !== false) inputArgs.push('-stream_loop', '-1');
      inputArgs.push('-i', musicMedia.path);
      filterParts.push(buildMusicFilter({
        project,
        layout,
        musicMedia,
        inputIndex: musicInputIndex,
        duration,
      }));
      filterParts.push(
        `[${currentAudio}][music]amix=inputs=2:duration=first:dropout_transition=0:normalize=0,` +
        `alimiter=limit=0.95[amixed]`
      );
      currentAudio = 'amixed';
    }

    if (normalizeAudio && hasAudioContent) {
      filterParts.push(
        `[${currentAudio}]loudnorm=I=-16:TP=-1.5:LRA=11,aresample=48000,` +
        `asetpts=PTS-STARTPTS[anormalized]`
      );
      currentAudio = 'anormalized';
    }

    filterParts.push(
      `[${currentVideo}]trim=duration=${duration.toFixed(3)},setpts=PTS-STARTPTS[vfinal]`
    );
    filterParts.push(
      `[${currentAudio}]apad=whole_dur=${duration.toFixed(3)},` +
      `atrim=duration=${duration.toFixed(3)},asetpts=PTS-STARTPTS[afinal]`
    );

    const filterGraph = filterParts.join(';');
    const filterScriptPath = path.join(workDir, 'filters.txt');
    await fsp.writeFile(filterScriptPath, filterGraph, 'utf8');

    const qualitySettings = QUALITY_SETTINGS[quality];
    const args = [
      '-hide_banner',
      '-loglevel', 'warning',
      '-y',
      '-nostats',
      '-progress', 'pipe:1',
      ...inputArgs,
      '-filter_complex_script', filterScriptPath,
      '-map', '[vfinal]',
      '-map', '[afinal]',
      ...encoderArguments(encoder, quality),
      '-c:a', 'aac',
      '-b:a', qualitySettings.audioBitrate,
      '-ar', '48000',
      '-ac', '2',
      '-movflags', '+faststart',
      '-max_muxing_queue_size', '4096',
      '-metadata', 'title=KesKlip',
      '-metadata', 'comment=KesKlip ile düzenlendi',
      outputPath,
    ];

    const logPath = path.join(logDir, `export-${timestamp}.log`);
    const startedAt = Date.now();
    let finalStderr = '';
    let progressBuffer = '';
    let lastProgressSent = 0;
    let latestStats = {};

    const active = { canceled: false, child: null };
    this.active = active;

    const sendProgress = (payload, force = false) => {
      const now = Date.now();
      if (!force && now - lastProgressSent < 180) return;
      lastProgressSent = now;
      const elapsed = (now - startedAt) / 1000;
      const normalized = clamp(payload.progress || 0, 0, 1);
      const eta = normalized > 0.015 ? (elapsed / normalized) * (1 - normalized) : null;
      if (onProgress) {
        onProgress({
          progress: normalized,
          seconds: payload.seconds || 0,
          duration,
          elapsed,
          eta,
          fps: payload.fps || latestStats.fps || 0,
          speed: payload.speed || latestStats.speed || '',
          size: payload.size || latestStats.size || 0,
          encoder,
          quality,
        });
      }
    };

    try {
      if (onStarted) {
        onStarted({
          outputPath,
          encoder,
          encoderLabel: this.hardware.encoder === encoder ? this.hardware.label : encoder,
          filterGraph,
          workDir,
          logPath,
        });
      }

      sendProgress({ progress: 0, seconds: 0 }, true);
      const result = await runProcess(FFMPEG, args, {
        cwd: workDir,
        onSpawn: (child) => {
          active.child = child;
        },
        onStdout: (text) => {
          progressBuffer += text;
          const lines = progressBuffer.split(/\r?\n/);
          progressBuffer = lines.pop() || '';
          for (const line of lines) {
            if (!line || !line.includes('=')) continue;
            const separator = line.indexOf('=');
            const key = line.slice(0, separator).trim();
            const value = line.slice(separator + 1).trim();
            if (key === 'out_time_us' || key === 'out_time_ms') {
              const seconds = Number(value) / 1e6;
              latestStats.seconds = seconds;
              latestStats.size = Number(latestStats.total_size) || latestStats.size || 0;
              sendProgress({
                progress: duration > 0 ? seconds / duration : 0,
                seconds,
                fps: latestStats.fps,
                speed: latestStats.speed,
                size: latestStats.size,
              });
            } else if (key === 'fps') {
              latestStats.fps = Number(value) || 0;
            } else if (key === 'speed') {
              latestStats.speed = value;
            } else if (key === 'total_size') {
              latestStats.size = Number(value) || 0;
            } else if (key === 'progress' && value === 'end') {
              sendProgress({ progress: 1, seconds: duration, ...latestStats }, true);
            }
          }
        },
        onStderr: (text) => {
          finalStderr += text;
          if (finalStderr.length > 60000) finalStderr = finalStderr.slice(-30000);
        },
        timeoutMs: 0,
      });

      this.active = null;

      if (active.canceled) {
        await fsp.writeFile(
          logPath,
          `KesKlip dışa aktarma iptal edildi.\n\nKomut:\n${FFMPEG} ${args.map((part) => JSON.stringify(part)).join(' ')}\n\n${finalStderr}`,
          'utf8'
        ).catch(() => {});
        try { await fsp.unlink(outputPath); } catch { /* ignore */ }
        return { ok: false, canceled: true, error: 'Dışa aktarma iptal edildi.' };
      }

      if (result.code !== 0) {
        const logContent = [
          'KesKlip dışa aktarma hatası',
          `Tarih: ${new Date().toISOString()}`,
          `Kod: ${result.code}`,
          '',
          'Komut:',
          `${FFMPEG} ${args.map((part) => JSON.stringify(part)).join(' ')}`,
          '',
          'Filtre grafiği:',
          filterGraph,
          '',
          'FFmpeg çıktısı:',
          finalStderr,
        ].join('\n');
        await fsp.writeFile(logPath, logContent, 'utf8').catch(() => {});
        const cleanError = finalStderr
          .split(/\r?\n/)
          .filter(Boolean)
          .slice(-10)
          .join('\n');
        return {
          ok: false,
          canceled: false,
          error: `Dışa aktarma başarısız oldu.\n${cleanError || 'FFmpeg bilinmeyen bir hata verdi.'}`,
          logPath,
        };
      }

      if (!fs.existsSync(outputPath)) {
        return {
          ok: false,
          canceled: false,
          error: 'FFmpeg tamamlandı ancak çıktı dosyası bulunamadı.',
          logPath,
        };
      }

      sendProgress({ progress: 1, seconds: duration, ...latestStats }, true);
      const outputStat = await fsp.stat(outputPath);
      await fsp.writeFile(
        logPath,
        `KesKlip dışa aktarma tamamlandı.\nSüre: ${((Date.now() - startedAt) / 1000).toFixed(1)} sn\nBoyut: ${(outputStat.size / 1048576).toFixed(1)} MB\nKodlayıcı: ${encoder}\n`,
        'utf8'
      ).catch(() => {});

      return {
        ok: true,
        canceled: false,
        outputPath,
        size: outputStat.size,
        duration,
        elapsed: (Date.now() - startedAt) / 1000,
        encoder,
        logPath,
      };
    } catch (error) {
      this.active = null;
      if (active.canceled) {
        try { await fsp.unlink(outputPath); } catch { /* ignore */ }
        return { ok: false, canceled: true, error: 'Dışa aktarma iptal edildi.' };
      }
      const logContent = [
        'KesKlip dışa aktarma istisnası',
        String(error && error.stack || error),
        '',
        'FFmpeg çıktısı:',
        finalStderr,
      ].join('\n');
      await fsp.writeFile(logPath, logContent, 'utf8').catch(() => {});
      return {
        ok: false,
        canceled: false,
        error: String(error && error.message || error),
        logPath,
      };
    } finally {
      if (this.active === active) this.active = null;
      try {
        await fsp.rm(workDir, { recursive: true, force: true });
      } catch { /* ignore */ }
    }
  }
}

module.exports = {
  ExportManager,
  encoderArguments,
  buildAss,
  QUALITY_SETTINGS,
};
