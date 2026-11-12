const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'src', 'app.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'src', 'index.html'), 'utf8');

const usedIcons = [...app.matchAll(/href="#(i-[a-z0-9-]+)"/g)].map((m) => m[1]);
const definedIcons = [...html.matchAll(/<symbol id="(i-[a-z0-9-]+)"/g)].map((m) => m[1]);
const missingIcons = [...new Set(usedIcons)].filter((x) => !definedIcons.includes(x));

const refs = [...app.matchAll(/\$\('#([A-Za-z0-9_-]+)'\)/g)].map((m) => m[1]);
const ids = [...html.matchAll(/id="([A-Za-z0-9_-]+)"/g)].map((m) => m[1]);
const missingIds = [...new Set(refs)].filter((x) => !ids.includes(x));

console.log('missing icons:', missingIcons);
console.log('missing ids:', missingIds);
console.log('icons used:', new Set(usedIcons).size, 'defined:', definedIcons.length);
