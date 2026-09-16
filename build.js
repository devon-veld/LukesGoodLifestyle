/* Build: copies the site into dist/ and writes one HTML file per page.
   Every page gets its own <title>, description, canonical URL, social tags,
   robots directive and structured data, all read from the lgl-routes JSON in
   index.html, plus a sitemap.xml of the indexable pages. The build fails if an
   expected tag is missing, so a broken head never reaches production. */
const fs = require('fs');
const path = require('path');

const root = __dirname;
const out = path.join(root, 'dist');
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });

for (const item of ['support.js', 'vendor', 'assets', '404.html', '_redirects', 'robots.txt', 'favicon.ico']) {
  fs.cpSync(path.join(root, item), path.join(out, item), { recursive: true });
}

const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

const routesBlock = html.match(/<script type="application\/json" id="lgl-routes">([\s\S]*?)<\/script>/);
if (!routesBlock) throw new Error('index.html: lgl-routes JSON block not found');
const { site, routes } = JSON.parse(routesBlock[1]);

const ldBlock = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
if (!ldBlock) throw new Error('index.html: JSON-LD block not found');
const ld = JSON.parse(ldBlock[1]);

const attr = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

function replaceCount(doc, re, value, label, expected = 1) {
  const hits = doc.match(new RegExp(re.source, 'g')) || [];
  if (hits.length !== expected) {
    throw new Error(`index.html: expected ${expected} × ${label}, found ${hits.length}`);
  }
  return doc.replace(new RegExp(re.source, 'g'), typeof value === 'function' ? value : () => value);
}

function renderPage(r) {
  const url = site + r.path;
  const social = r.ogTitle || r.title;
  const robots = r.index === false ? 'noindex, nofollow' : 'index, follow, max-image-preview:large';
  let doc = html;
  doc = replaceCount(doc, /<title>[^<]*<\/title>/, `<title>${attr(r.title)}</title>`, '<title>');
  doc = replaceCount(doc, /<meta name="description" content="[^"]*">/, `<meta name="description" content="${attr(r.description)}">`, 'meta description');
  doc = replaceCount(doc, /<link rel="canonical" href="[^"]*">/, `<link rel="canonical" href="${url}">`, 'canonical');
  doc = replaceCount(doc, /<meta name="robots" content="[^"]*">/, `<meta name="robots" content="${robots}">`, 'meta robots');
  doc = replaceCount(doc, /(<link rel="alternate" hreflang="[^"]+" href=")[^"]*(">)/, (_, a, b) => a + url + b, 'hreflang link', 2);
  doc = replaceCount(doc, /<meta property="og:url" content="[^"]*">/, `<meta property="og:url" content="${url}">`, 'og:url');
  doc = replaceCount(doc, /<meta property="og:title" content="[^"]*">/, `<meta property="og:title" content="${attr(social)}">`, 'og:title');
  doc = replaceCount(doc, /<meta property="og:description" content="[^"]*">/, `<meta property="og:description" content="${attr(r.description)}">`, 'og:description');
  doc = replaceCount(doc, /<meta name="twitter:title" content="[^"]*">/, `<meta name="twitter:title" content="${attr(social)}">`, 'twitter:title');
  doc = replaceCount(doc, /<meta name="twitter:description" content="[^"]*">/, `<meta name="twitter:description" content="${attr(r.description)}">`, 'twitter:description');

  // Structured data must describe what is visible on that page:
  // the FAQ is only shown on /training, the products on / and /shop.
  const graph = ld['@graph'].filter((node) => {
    if (node['@type'] === 'FAQPage') return r.page === 'pricing';
    if (node['@type'] === 'Product') return r.page === 'home' || r.page === 'shop';
    return true;
  });
  const json = JSON.stringify({ ...ld, '@graph': graph }, null, 2);
  doc = replaceCount(doc, /<script type="application\/ld\+json">[\s\S]*?<\/script>/, `<script type="application/ld+json">\n${json}\n</script>`, 'JSON-LD block');
  return doc;
}

for (const r of routes) {
  const file = r.path === '/' ? 'index.html' : r.path.slice(1) + '.html';
  fs.writeFileSync(path.join(out, file), renderPage(r));
  console.log(`page  ${r.path.padEnd(10)} -> ${file}${r.index === false ? '  (noindex)' : ''}`);
}

const today = new Date().toISOString().slice(0, 10);
const entries = routes
  .filter((r) => r.index !== false)
  .map((r) => `  <url>\n    <loc>${site}${r.path}</loc>\n    <lastmod>${today}</lastmod>\n  </url>`);
fs.writeFileSync(
  path.join(out, 'sitemap.xml'),
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries.join('\n')}\n</urlset>\n`
);
console.log(`sitemap.xml: ${entries.length} pages`);
console.log('Build complete -> dist/');
