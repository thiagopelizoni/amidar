'use strict';
// Gera dist/amidar-2600.html: pagina single-file com CSS e JS embutidos.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const css = read('css/style.css');
const js = ['js/config.js', 'js/sprites.js', 'js/audio.js', 'js/input.js', 'js/game.js']
  .map(read)
  .join('\n');

const html = read('index.html');
const body = html
  .replace(/^[\s\S]*<body>/, '')
  .replace(/<\/body>[\s\S]*$/, '')
  .replace(/\s*<script src="[^"]+"><\/script>/g, '')
  .replace(/\s*<script>window\.AMI\.boot\(\);<\/script>/, '');

const out = `<title>AMIDAR 2600</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Press+Start+2P&family=VT323&display=swap">
<style>
${css}
</style>
${body.trim()}
<script>
${js}
window.AMI.boot();
</script>
`;

fs.mkdirSync(path.join(ROOT, 'dist'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'dist', 'amidar-2600.html'), out);
console.log('gerado dist/amidar-2600.html (' + out.length + ' bytes)');
