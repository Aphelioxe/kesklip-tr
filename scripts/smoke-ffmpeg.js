const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const ffmpeg = require('ffmpeg-static');
const ffprobe = require('ffprobe-static').path;

const tmp = path.join(os.tmpdir(), 'kesklip-smoke');
fs.mkdirSync(tmp, { recursive: true });

function run(args, label) {
  try {
    const out = execFileSync(ffmpeg, args, { cwd: tmp, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    console.log(`OK ${label}`);
    return out;
  } catch (error) {
    console.error(`FAIL ${label}`);
    console.error(String(error.stderr || error.message).slice(-4000));
    process.exitCode = 1;
    return null;
  }
}

const src1 = path.join(tmp, 'sample1.mp4');
const src2 = path.join(tmp, 'sample2.mp4');

run(
  ['-y', '-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=30', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000', '-t', '6', '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '28', '-c:a', 'aac', '-b:a', '128k', src1],
  'generate sample1'
);
run(
  ['-y', '-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=30', '-f', 'lavfi', '-i', 'sine=frequency=660:sample_rate=48000', '-t', '6', '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '28', '-c:a', 'aac', '-b:a', '128k', src2],
  'generate sample2'
);

run(
  ['-y', '-f', 'lavfi', '-i', 'color=c=black:s=640x360:d=0.2', '-c:v', 'h264_nvenc', '-preset', 'p4', '-f', 'null', '-'],
  'NVENC H.264 encode'
);
run(
  ['-y', '-f', 'lavfi', '-i', 'color=c=black:s=640x360:d=0.2', '-c:v', 'h264_qsv', '-f', 'null', '-'],
  'QSV H.264 encode'
);

const assFile = path.join(tmp, 'overlays.ass');
fs.writeFileSync(
  assFile,
  `[Script Info]\nScriptType: v4.00+\nPlayResX: 1280\nPlayResY: 720\nScaledBorderAndShadow: yes\n\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: Base,Segoe UI,52,&H00FFFFFF,&H000000FF,&H00000000,&H80000000,1,0,0,0,100,100,0,0,1,2,1,5,0,0,0,1\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\nDialogue: 0,0:00:00.30,0:00:04.00,Base,,0,0,0,,{\\an5\\pos(640,110)\\fad(150,150)}Türkçe başlık: ÇĞİÖŞÜ\n`,
  'utf8'
);

const out = path.join(tmp, 'out.mp4');
run(
  [
    '-y',
    '-ss', '0.5', '-t', '4.5', '-i', src1,
    '-ss', '0.5', '-t', '5.0', '-i', src2,
    '-filter_complex',
    '[0:v]setpts=PTS-STARTPTS,fps=30,scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,format=yuv420p[v0];' +
      '[0:a]asetpts=PTS-STARTPTS,aresample=48000,volume=0.9[a0];' +
      '[1:v]setpts=PTS-STARTPTS,fps=30,scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,format=yuv420p[v1];' +
      '[1:a]asetpts=PTS-STARTPTS,aresample=48000,volume=0.9[a1];' +
      '[v0][v1]xfade=transition=fadewhite:duration=0.6:offset=3.9[vx];' +
      '[a0][a1]acrossfade=d=0.6:c1=tri:c2=tri[ax];' +
      `[vx]subtitles=filename='${path.basename(assFile)}'[vout]`,
    '-map', '[vout]', '-map', '[ax]',
    '-c:v', 'h264_nvenc', '-preset', 'p4', '-cq', '24', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '160k',
    '-movflags', '+faststart',
    out,
  ],
  'xfade + acrossfade + subtitles + NVENC'
);

if (fs.existsSync(out)) {
  const probe = execFileSync(ffprobe, ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', out], { encoding: 'utf8' });
  const info = JSON.parse(probe);
  console.log('output duration:', info.format.duration, 'size:', info.format.size);
}
console.log('Smoke directory:', tmp);
