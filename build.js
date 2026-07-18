/* Build script: copies the static design site into dist/.
   Exists so the repo works with ANY Netlify config — whether the UI
   has "npm run build" + publish "dist" (saved from an earlier Vite
   import) or the netlify.toml settings. Both now produce the design. */
const fs = require('fs');
const path = require('path');

const out = path.join(__dirname, 'dist');
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });

const items = [
  'index.html',
  'support.js',
  'image-slot.js',
  '.image-slots.state.json',
  '_redirects',
  'robots.txt',
  'sitemap.xml',
  'assets',
];

for (const item of items) {
  const src = path.join(__dirname, item);
  if (!fs.existsSync(src)) { console.warn('skip missing', item); continue; }
  fs.cpSync(src, path.join(out, item), { recursive: true });
  console.log('copied', item);
}
console.log('Build complete -> dist/');
