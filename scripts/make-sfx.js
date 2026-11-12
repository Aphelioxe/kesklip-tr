'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const ffmpegPath = require('ffmpeg-static');

const root = path.join(__dirname, '..');
const outputDir = path.join(root, 'assets', 'sfx');
fs.mkdirSync(outputDir, { recursive: true });

function render(file, source, audioFilter) {
  const outputPath = path.join(outputDir, file);
  const args = [
    '-hide_banner',
    '-loglevel', 'error',
    '-y',
    '-f', 'lavfi',
    '-i', source,
    '-af', `${audioFilter},alimiter=limit=0.89:level=false`,
    '-ar', '48000',
    '-ac', '2',
    '-c:a', 'pcm_s16le',
    outputPath,
  ];
  execFileSync(ffmpegPath, args, { windowsHide: true, stdio: 'inherit' });
  console.log(`SFX hazır: ${outputPath}`);
}

render(
  'hit.wav',
  'aevalsrc=0.82*sin(2*PI*(190-130*t)*t)*exp(-11*t)+0.32*random(0)*exp(-30*t):d=0.45:s=48000:c=stereo',
  'highpass=f=45,volume=1.1'
);

render(
  'slash.wav',
  'anoisesrc=d=0.24:c=white:a=0.75:r=48000',
  'highpass=f=1800,lowpass=f=8200,afade=t=out:st=0.045:d=0.19,volume=0.9'
);

render(
  'whoosh.wav',
  'aevalsrc=0.55*random(0)*(0.25+0.75*sin(2*PI*3.4*t))*exp(-2.6*t)+0.18*sin(2*PI*(140+260*t)*t)*exp(-4*t):d=0.5:s=48000:c=stereo',
  'lowpass=f=4200,highpass=f=160,afade=t=out:st=0.2:d=0.3'
);

render(
  'pop.wav',
  'aevalsrc=0.8*sin(2*PI*(430+760*t)*t)*exp(-34*t)+0.2*random(0)*exp(-60*t):d=0.18:s=48000:c=stereo',
  'highpass=f=90'
);

render(
  'ding.wav',
  'aevalsrc=(0.38*sin(2*PI*1046.5*t)+0.24*sin(2*PI*1568*t)+0.15*sin(2*PI*2093*t))*exp(-3.8*t):d=1.0:s=48000:c=stereo',
  'afade=t=out:st=0.55:d=0.45,volume=0.9'
);

render(
  'boom.wav',
  'aevalsrc=0.9*sin(2*PI*(92-48*t)*t)*exp(-4.2*t)+0.3*random(0)*exp(-17*t):d=0.8:s=48000:c=stereo',
  'lowpass=f=520,volume=1.05,afade=t=out:st=0.45:d=0.35'
);
