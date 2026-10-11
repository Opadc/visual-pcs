// Assembles src/ into a single self-contained page.
//   index.html              standalone document (open directly or serve statically)
//   dist/visual-pcs.html    body fragment for hosts that supply their own <html>/<head>
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');

const CSS = ['tokens', 'base', 'lab', 'panels', 'story'].map((f) => read(`src/css/${f}.css`)).join('\n');
const HTML = ['intro', 'lab', 'story-1', 'story-2', 'footer'].map((f) => read(`src/html/${f}.html`)).join('\n');
const JS = ['model', 'fec', 'payload', 'state', 'paths', 'content', 'scene-core', 'scene-static', 'packets', 'labels',
  'inspect-model', 'inspector', 'follow', 'ui-controls', 'ui-map', 'ui-faults', 'ui-diag', 'figures', 'story', 'main']
  .map((f) => `/* ---- ${f}.js ---- */\n` + read(`src/js/${f}.js`)).join('\n');

const THREE = '0.147.0';
const head = `<title>Visual PCS</title>
<meta name="description" content="An interactive 3D walk through the 200GBASE-R Ethernet PCS: PCS lanes, PMA bit-multiplexing, SerDes lanes, alignment, deskew and FEC diagnostics.">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Archivo:wdth,wght@62..125,300..800&family=IBM+Plex+Mono:wght@400;500;600&family=Source+Serif+4:opsz,wght@8..60,400;8..60,600&display=swap">
<style>
${CSS}
</style>`;
const scripts = `<script src="https://cdn.jsdelivr.net/npm/three@${THREE}/build/three.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/three@${THREE}/examples/js/controls/OrbitControls.js"></script>
<script>
${JS}
</script>`;

const fragment = `${head}\n${HTML}\n${scripts}\n`;
const doc = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
${head}
</head>
<body>
${HTML}
${scripts}
</body>
</html>
`;

writeFileSync(new URL('index.html', import.meta.url), doc);
mkdirSync(new URL('dist/', import.meta.url), { recursive: true });
writeFileSync(new URL('dist/visual-pcs.html', import.meta.url), fragment);
console.log(`index.html ${(doc.length / 1024).toFixed(1)} KB, dist/visual-pcs.html ${(fragment.length / 1024).toFixed(1)} KB`);
