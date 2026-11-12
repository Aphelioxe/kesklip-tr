'use strict';

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const ffmpegStatic = require('ffmpeg-static');
const ffprobeStatic = require('ffprobe-static');

function unpacked(binaryPath) {
  const value = String(binaryPath || '');
  if (value.includes('app.asar' + path.sep) || value.includes('app.asar/')) {
    return value.replace('app.asar', 'app.asar.unpacked');
  }
  return value;
}

const FFMPEG = unpacked(ffmpegStatic);
const FFPROBE = unpacked(ffprobeStatic.path);

const VIDEO_EXTENSIONS = new Set([
  '.mp4', '.m4v', '.mov', '.mkv', '.avi', '.webm', '.ogv',
  '.mpg', '.mpeg', '.ts', '.mts', '.m2ts', '.wmv', '.flv', '.3gp',
]);
const AUDIO_EXTENSIONS = new Set([
  '.mp3', '.wav', '.m4a', '.aac', '.flac', '.ogg', '.opus', '.wma', '.aiff', '.aif',
]);

const DIRECT_CONTAINERS = new Set(['.mp4', '.m4v', '.mov', '.webm', '.ogv']);
const DIRECT_VIDEO_CODECS = new Set(['h264', 'vp8', 'vp9', 'av1']);
const DIRECT_AUDIO_CODECS = new Set(['aac', 'mp3', 'opus', 'vorbis', 'flac', 'pcm_s16le', 'pcm_s24le']);
const MP4_AUDIO_CODECS = new Set(['aac', 'mp3']);
const SUPPORTED_PIX_FMTS = new Set(['yuv420p', 'yuvj420p', 'nv12', 'yuv422p', 'yuv444p']);

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function safeJsonParse(value, fallback) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function runProcess(binary, args, options = {}) {
  const {
    cwd,
    onStdout,
    onStderr,
    onSpawn,
    timeoutMs = 0,
    env,
  } = options;

  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(binary, args, {
        cwd,
        windowsHide: true,
        env: env ? { ...process.env, ...env } : process.env,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (error) {
      reject(error);
      return;
    }

    let stdout = '';
    let stderr = '';
    let settled = false;
    let timer = null;

    if (onSpawn) onSpawn(child);

    if (timeoutMs > 0) {
      timer = setTimeout(() => {
        if (!settled) {
          try { child.kill('SIGKILL'); } catch { /* ignore */ }
        }
      }, timeoutMs);
    }

    child.stdout.on('data', (chunk) => {
      const text = chunk.toString('utf8');
      stdout += text;
      if (stdout.length > 1024 * 1024) stdout = stdout.slice(-512 * 1024);
      if (onStdout) onStdout(text);
    });

    child.stderr.on('data', (chunk) => {
      const text = chunk.toString('utf8');
      stderr += text;
      if (stderr.length > 1024 * 1024) stderr = stderr.slice(-512 * 1024);
      if (onStderr) onStderr(text);
    });

    child.on('error', (error) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      reject(error);
    });

    child.on('close', (code, signal) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve({ code, signal, stdout, stderr, child });
    });
  });
}

async function ensureDir(dir) {
  await fsp.mkdir(dir, { recursive: true });
  return dir;
}

function fileExists(filePath) {
  try {
    return fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

function hashForFile(filePath, stat) {
  return crypto
    .createHash('sha1')
    .update(`${path.resolve(filePath)}|${stat.size}|${Math.round(stat.mtimeMs)}`)
    .digest('hex')
    .slice(0, 20);
}

function parseRate(rate) {
  if (!rate || typeof rate !== 'string') return 0;
  const parts = rate.split('/').map(Number);
  if (parts.length === 2 && parts[1]) return parts[0] / parts[1];
  const value = Number(rate);
  return Number.isFinite(value) ? value : 0;
}

function prettyCodec(codec) {
  const names = {
    h264: 'H.264',
    hevc: 'H.265',
    vp8: 'VP8',
    vp9: 'VP9',
    av1: 'AV1',
    prores: 'ProRes',
    mpeg4: 'MPEG-4',
    aac: 'AAC',
    mp3: 'MP3',
    opus: 'Opus',
    vorbis: 'Vorbis',
    ac3: 'AC3',
    eac3: 'E-AC3',
    dts: 'DTS',
    pcm_s16le: 'PCM',
  };
  return names[codec] || String(codec || '').toUpperCase();
}

function resolveRotation(stream) {
  let rotation = 0;
  if (stream && stream.side_data_list) {
    for (const side of stream.side_data_list) {
      if (typeof side.rotation === 'number') rotation = side.rotation;
    }
  }
  if (stream && stream.tags && stream.tags.rotate) {
    const parsed = Number(stream.tags.rotate);
    if (Number.isFinite(parsed)) rotation = parsed;
  }
  return ((Math.round(rotation) % 360) + 360) % 360;
}

async function probeMedia(filePath) {
  const stat = await fsp.stat(filePath);
  if (!stat.isFile()) throw new Error('Dosya bulunamadı.');
  const ext = path.extname(filePath).toLowerCase();
  const isVideoExt = VIDEO_EXTENSIONS.has(ext);
  const isAudioExt = AUDIO_EXTENSIONS.has(ext);

  const { code, stdout, stderr } = await runProcess(FFPROBE, [
    '-v', 'error',
    '-print_format', 'json',
    '-show_format',
    '-show_streams',
    filePath,
  ], { timeoutMs: 45000 });

  if (code !== 0) {
    const details = (stderr || '').trim().slice(-500);
    throw new Error(`Bu dosya okunamadı. ${details || 'Desteklenmeyen bir biçim olabilir.'}`);
  }

  const data = safeJsonParse(stdout, {});
  const streams = Array.isArray(data.streams) ? data.streams : [];
  const videoStream = streams.find((stream) => stream.codec_type === 'video' && stream.disposition?.attached_pic !== 1);
  const audioStream = streams.find((stream) => stream.codec_type === 'audio');
  const format = data.format || {};

  let duration = Number(format.duration);
  if (!Number.isFinite(duration) || duration <= 0) {
    duration = Number(videoStream && videoStream.duration) || Number(audioStream && audioStream.duration) || 0;
  }
  if (!Number.isFinite(duration) || duration <= 0) {
    throw new Error('Videonun süresi okunamadı.');
  }

  const rotation = videoStream ? resolveRotation(videoStream) : 0;
  let width = Number(videoStream && videoStream.width) || 0;
  let height = Number(videoStream && videoStream.height) || 0;
  if (rotation === 90 || rotation === 270) {
    [width, height] = [height, width];
  }

  const fps = videoStream ? parseRate(videoStream.avg_frame_rate) || parseRate(videoStream.r_frame_rate) : 0;
  const videoCodec = videoStream ? String(videoStream.codec_name || '') : '';
  const audioCodec = audioStream ? String(audioStream.codec_name || '') : '';
  const pixFmt = videoStream ? String(videoStream.pix_fmt || '') : '';
  const hasAudio = Boolean(audioStream);
  const kind = videoStream ? 'video' : 'audio';

  let playbackMode = 'direct';
  let playbackReason = '';

  if (kind === 'video') {
    if (!DIRECT_CONTAINERS.has(ext)) {
      playbackMode = 'remux';
      playbackReason = 'Kap biçimi tarayıcıda doğrudan oynatılamıyor.';
    }
    if (!DIRECT_VIDEO_CODECS.has(videoCodec) || !SUPPORTED_PIX_FMTS.has(pixFmt)) {
      playbackMode = 'transcode';
      playbackReason = 'Video kodeği önizleme için uygun değil.';
    } else if (hasAudio && !DIRECT_AUDIO_CODECS.has(audioCodec)) {
      playbackMode = playbackMode === 'transcode' ? 'transcode' : 'remux';
      playbackReason = 'Ses kodeği önizleme için uygun değil.';
    } else if (ext === '.mov' && !MP4_AUDIO_CODECS.has(audioCodec) && hasAudio) {
      playbackMode = playbackMode === 'transcode' ? 'transcode' : 'remux';
      playbackReason = 'Ses kodeği MP4 önizlemesi için dönüştürülüyor.';
    }
  } else if (kind === 'audio') {
    if (!DIRECT_AUDIO_CODECS.has(audioCodec)) {
      playbackMode = 'transcode-audio';
      playbackReason = 'Ses biçimi tarayıcıda doğrudan oynatılamıyor.';
    }
  }

  const size = stat.size;
  const mtimeMs = stat.mtimeMs;
  const id = hashForFile(filePath, stat);

  return {
    ok: true,
    id,
    path: filePath,
    name: path.basename(filePath),
    ext,
    kind,
    duration,
    width,
    height,
    fps: Number.isFinite(fps) && fps > 0 ? Math.round(fps * 1000) / 1000 : 30,
    rotation,
    videoCodec,
    videoCodecLabel: prettyCodec(videoCodec),
    audioCodec,
    audioCodecLabel: prettyCodec(audioCodec),
    pixFmt,
    hasAudio,
    bitrate: Number(format.bit_rate) || 0,
    size,
    mtimeMs,
    isVideo: Boolean(videoStream),
    isAudioOnly: !videoStream && Boolean(audioStream),
    isVideoExt,
    isAudioExt,
    playbackMode,
    playbackReason,
  };
}

async function detectHardwareEncoder() {
  const candidates = [
    {
      encoder: 'h264_nvenc',
      label: 'NVIDIA NVENC',
      args: ['-c:v', 'h264_nvenc', '-preset', 'p4'],
    },
    {
      encoder: 'h264_amf',
      label: 'AMD AMF',
      args: ['-c:v', 'h264_amf', '-quality', 'balanced'],
    },
    {
      encoder: 'h264_qsv',
      label: 'Intel Quick Sync',
      args: ['-c:v', 'h264_qsv'],
    },
  ];

  for (const candidate of candidates) {
    try {
      const { code } = await runProcess(FFMPEG, [
        '-hide_banner', '-loglevel', 'error',
        '-f', 'lavfi', '-i', 'color=c=black:s=320x240:d=0.12',
        ...candidate.args,
        '-f', 'null', '-',
      ], { timeoutMs: 20000 });
      if (code === 0) {
        return {
          encoder: candidate.encoder,
          label: candidate.label,
          hardware: true,
        };
      }
    } catch {
      // Try the next candidate.
    }
  }

  return { encoder: 'libx264', label: 'CPU (libx264)', hardware: false };
}

async function ensureThumbnail({ filePath, media, thumbsDir }) {
  await ensureDir(thumbsDir);
  const stat = await fsp.stat(filePath);
  const key = hashForFile(filePath, stat);
  const outputPath = path.join(thumbsDir, `${key}.jpg`);

  if (fileExists(outputPath)) {
    return { ok: true, thumbPath: outputPath, cached: true };
  }

  const duration = Number(media.duration) || 0;
  const seek = duration > 2 ? clamp(duration * 0.08, 0.5, 12) : Math.max(0, duration * 0.25);
  const args = [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-ss', seek.toFixed(3),
    '-i', filePath,
    '-frames:v', '1',
    '-vf', "scale='min(640,iw)':-2",
    '-q:v', '4',
    outputPath,
  ];

  const { code, stderr } = await runProcess(FFMPEG, args, { timeoutMs: 45000 });
  if (code !== 0 || !fileExists(outputPath)) {
    throw new Error(`Küçük görsel oluşturulamadı. ${(stderr || '').trim().slice(-250)}`);
  }
  return { ok: true, thumbPath: outputPath, cached: false };
}

async function ensureWaveform({ filePath, waveformsDir }) {
  await ensureDir(waveformsDir);
  const stat = await fsp.stat(filePath);
  const key = hashForFile(filePath, stat);
  const outputPath = path.join(waveformsDir, `${key}.png`);

  if (fileExists(outputPath)) {
    return { ok: true, waveformPath: outputPath, cached: true };
  }

  const { code, stderr } = await runProcess(FFMPEG, [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-i', filePath,
    '-filter_complex', 'showwavespic=s=1800x180:colors=#57d7c9',
    '-frames:v', '1',
    outputPath,
  ], { timeoutMs: 120000 });

  if (code !== 0 || !fileExists(outputPath)) {
    throw new Error(`Ses dalgası oluşturulamadı. ${(stderr || '').trim().slice(-250)}`);
  }
  return { ok: true, waveformPath: outputPath, cached: false };
}

async function buildPreviewFile({ filePath, media, outputPath, hardware, onProgress, registerChild }) {
  const mode = media.playbackMode;
  if (mode === 'direct') {
    return { ok: true, skipped: true, outputPath: filePath };
  }

  await ensureDir(path.dirname(outputPath));
  if (fileExists(outputPath)) {
    const stat = await fsp.stat(outputPath);
    if (stat.size > 1024) {
      return { ok: true, cached: true, outputPath };
    }
  }

  if (mode === 'remux' || mode === 'transcode-audio') {
    const audioCopyable = media.hasAudio && MP4_AUDIO_CODECS.has(media.audioCodec);
    const args = [
      '-hide_banner', '-loglevel', 'warning', '-y',
      '-i', filePath,
      '-map', '0:v:0?',
      '-map', '0:a:0?',
    ];
    if (mode === 'transcode-audio' || !audioCopyable) {
      if (media.hasAudio) {
        args.push('-c:a', 'aac', '-b:a', '160k', '-ac', '2', '-ar', '48000');
      } else {
        args.push('-an');
      }
    } else {
      args.push('-c:a', 'copy');
    }
    args.push(
      '-c:v', 'copy',
      '-movflags', '+faststart',
      '-progress', 'pipe:1',
      '-nostats',
      outputPath
    );

    let childRef = null;
    const result = await runProcess(FFMPEG, args, {
      onSpawn: (child) => {
        childRef = child;
        if (registerChild) registerChild(child);
      },
      onStdout: (text) => parseProgress(text, onProgress, media.duration),
    });
    if (result.code === 0 && fileExists(outputPath)) {
      return { ok: true, outputPath };
    }
    try { await fsp.unlink(outputPath); } catch { /* ignore */ }
    throw new Error(`Önizleme dosyası hazırlanamadı. ${(result.stderr || '').trim().slice(-300)}`);
  }

  const sourceHeight = Number(media.height) || 720;
  const targetHeight = sourceHeight > 1080 ? 720 : Math.min(sourceHeight || 720, 720);
  const args = [
    '-hide_banner', '-loglevel', 'warning', '-y',
    '-i', filePath,
    '-map', '0:v:0',
    '-map', '0:a:0?',
  ];

  if (sourceHeight > targetHeight) {
    args.push('-vf', `scale=-2:${targetHeight}`);
  }

  if (hardware && hardware.encoder === 'h264_nvenc') {
    args.push('-c:v', 'h264_nvenc', '-preset', 'p4', '-cq', '28', '-pix_fmt', 'yuv420p');
  } else if (hardware && hardware.encoder === 'h264_amf') {
    args.push('-c:v', 'h264_amf', '-quality', 'speed', '-qp_i', '28', '-qp_p', '30', '-pix_fmt', 'yuv420p');
  } else {
    args.push('-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '27', '-pix_fmt', 'yuv420p');
  }

  if (media.hasAudio) {
    args.push('-c:a', 'aac', '-b:a', '128k', '-ac', '2', '-ar', '48000');
  } else {
    args.push('-an');
  }

  args.push(
    '-movflags', '+faststart',
    '-progress', 'pipe:1',
    '-nostats',
    outputPath
  );

  let result = await runProcess(FFMPEG, args, {
    onSpawn: (child) => registerChild && registerChild(child),
    onStdout: (text) => parseProgress(text, onProgress, media.duration),
    timeoutMs: 0,
  });

  if (result.code !== 0 && hardware && hardware.encoder === 'h264_nvenc') {
    try { await fsp.unlink(outputPath); } catch { /* ignore */ }
    const fallbackArgs = [
      '-hide_banner', '-loglevel', 'warning', '-y',
      '-i', filePath,
      '-map', '0:v:0',
      '-map', '0:a:0?',
    ];
    if (sourceHeight > targetHeight) fallbackArgs.push('-vf', `scale=-2:${targetHeight}`);
    fallbackArgs.push('-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '27', '-pix_fmt', 'yuv420p');
    if (media.hasAudio) fallbackArgs.push('-c:a', 'aac', '-b:a', '128k', '-ac', '2', '-ar', '48000');
    else fallbackArgs.push('-an');
    fallbackArgs.push('-movflags', '+faststart', '-progress', 'pipe:1', '-nostats', outputPath);
    result = await runProcess(FFMPEG, fallbackArgs, {
      onSpawn: (child) => registerChild && registerChild(child),
      onStdout: (text) => parseProgress(text, onProgress, media.duration),
    });
  }

  if (result.code === 0 && fileExists(outputPath)) {
    return { ok: true, outputPath };
  }
  try { await fsp.unlink(outputPath); } catch { /* ignore */ }
  throw new Error(`Önizleme hazırlanamadı. ${(result.stderr || '').trim().slice(-400)}`);
}

function parseProgress(text, onProgress, totalDuration) {
  if (!onProgress) return;
  const match = text.match(/out_time_us=(\d+)/);
  if (!match) return;
  const seconds = Number(match[1]) / 1e6;
  const total = Number(totalDuration) || 0;
  const progress = total > 0 ? clamp(seconds / total, 0, 0.995) : 0;
  onProgress({ seconds, progress });
}

async function killProcessTree(child) {
  if (!child || child.killed) return;
  try {
    if (process.platform === 'win32' && child.pid) {
      spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
    } else {
      child.kill('SIGKILL');
    }
  } catch {
    try { child.kill('SIGKILL'); } catch { /* ignore */ }
  }
}

module.exports = {
  FFMPEG,
  FFPROBE,
  VIDEO_EXTENSIONS,
  AUDIO_EXTENSIONS,
  probeMedia,
  detectHardwareEncoder,
  ensureThumbnail,
  ensureWaveform,
  buildPreviewFile,
  hashForFile,
  runProcess,
  killProcessTree,
  ensureDir,
  fileExists,
  clamp,
  parseProgress,
};
