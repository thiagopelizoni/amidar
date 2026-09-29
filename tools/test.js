'use strict';
// Testes headless em Node: valida a grade, simula jogo com entradas reais de
// teclado sobre stubs de DOM/canvas e confere as regras do cartucho.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');

// --- stubs de navegador -----------------------------------------------
const listeners = {};
const noop = () => {};
const ctx2d = new Proxy({}, {
  get(t, prop) {
    if (prop === 'globalAlpha' || prop === 'fillStyle') return 1;
    return noop;
  },
  set() { return true; },
});
const canvas = {
  width: 0, height: 0,
  getContext: () => ctx2d,
  addEventListener: noop,
};
let rafCb = null;
const sandbox = {
  window: null,
  document: {
    getElementById: (id) => (id === 'screen' ? canvas : null),
    addEventListener: noop,
    hidden: false,
  },
  localStorage: { getItem: () => null, setItem: noop },
  requestAnimationFrame: (cb) => { rafCb = cb; },
  console, Math, JSON, Uint8Array, Map, Set, Array, Object, String, Number,
};
sandbox.window = sandbox;
sandbox.window.addEventListener = (name, cb) => { listeners[name] = cb; };
vm.createContext(sandbox);

for (const f of ['config.js', 'sprites.js', 'audio.js', 'input.js', 'game.js']) {
  const code = fs.readFileSync(path.join(ROOT, 'js', f), 'utf8');
  vm.runInContext(code, sandbox, { filename: f });
}

const CFG = sandbox.window.AMI.config;
const DBG = sandbox.window.AMI.debug;
const { RUNGS, NCOL, NLINE } = CFG;
const game = DBG.game;

let failures = 0;
function check(cond, msg) {
  if (!cond) { failures++; console.error('FALHOU: ' + msg); } else console.log('ok  ' + msg);
}

// --- grade ---------------------------------------------------------------
check(RUNGS.length === NLINE - 1, '5 faixas de degraus entre 6 linhas');
RUNGS.forEach((band, b) => {
  const sorted = band.every((k, i) => i === 0 || band[i - 1] < k);
  check(sorted && band[0] === 0 && band[band.length - 1] === NCOL - 1, `faixa ${b} ordenada e com bordas 0 e 31`);
  const mirrored = band.map((k) => NCOL - 1 - k).sort((a, c) => a - c);
  check(JSON.stringify(mirrored) === JSON.stringify(band), `faixa ${b} simetrica c -> 31-c`);
});
check(DBG.boxes.length === 29, 'grade tem 29 boxes (7+7+5+5+5), veio ' + DBG.boxes.length);
check(DBG.boxes.filter((b) => b.corner).length === 4, '4 boxes de canto');
check(DBG.segs.every((s) => s.boxes.length >= 1), 'todo segmento pertence a pelo menos um box');
const hPts = DBG.segs.filter((s) => s.kind === 'h').map((s) => s.pts);
check(Math.min.apply(null, hPts) === 1 && Math.max.apply(null, hPts) === 6, 'horizontais valem de 1 a 6 pontos');

// conectividade entre juncoes (BFS)
{
  const key = (j, k) => j * 100 + k;
  const seen = new Set([key(0, 0)]);
  const q = [[0, 0]];
  while (q.length) {
    const [j, k] = q.shift();
    const js = DBG.junctions[j];
    const i = js.indexOf(k);
    const nb = [];
    if (i > 0) nb.push([j, js[i - 1]]);
    if (i < js.length - 1) nb.push([j, js[i + 1]]);
    if (j > 0 && DBG.rungSet[j - 1].has(k)) nb.push([j - 1, k]);
    if (j < NLINE - 1 && DBG.rungSet[j].has(k)) nb.push([j + 1, k]);
    for (const [a, c] of nb) if (!seen.has(key(a, c))) { seen.add(key(a, c)); q.push([a, c]); }
  }
  const total = DBG.junctions.reduce((n, l) => n + l.length, 0);
  check(seen.size === total, `todas as ${total} juncoes alcancaveis`);
}

// --- simulacao --------------------------------------------------------------
sandbox.window.AMI.boot();
if (!rafCb) throw new Error('boot nao agendou frame');

const keydown = (code) => listeners.keydown({ code, key: code, repeat: false, preventDefault: noop, target: null });
const keyup = (code) => listeners.keyup({ code, key: code, preventDefault: noop });
const KEY = { up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight' };

let ts = 0;
function runFrames(n) {
  for (let i = 0; i < n; i++) {
    ts += 1000 / 60;
    const cb = rafCb; rafCb = null;
    cb(ts);
    if (!rafCb) throw new Error('loop parou de agendar frames');
  }
}

function validPos(e) {
  const j = DBG.lineAt(e.y);
  if (j >= 0) return e.x >= CFG.trackX(0) - 1e-6 && e.x <= CFG.trackX(NCOL - 1) + 1e-6;
  const k = DBG.colAt(e.x);
  const b = Math.floor((e.y - CFG.trackY(0)) / CFG.BAND_H);
  return k >= 0 && b >= 0 && b < NLINE - 1 && DBG.rungSet[b].has(k);
}

// Modo atracao: patrulheiros rondando no titulo, sempre sobre trilhos, sempre andando.
runFrames(30);
check(game.mode === 'title', 'comeca no titulo');
{
  let bad = 0, stuck = 0;
  const linesSeen = new Map();
  let tracerOff = 0;
  const prev = new Map();
  for (let f = 0; f < 12000; f++) {
    runFrames(1);
    for (const e of game.enemies) {
      if (e.state !== 'active') continue;
      if (!validPos(e)) bad++;
      const p = prev.get(e);
      if (p && p.x === e.x && p.y === e.y) stuck++;
      prev.set(e, { x: e.x, y: e.y });
      const j = DBG.lineAt(e.y);
      if (j >= 0) { if (!linesSeen.has(e)) linesSeen.set(e, new Set()); linesSeen.get(e).add(j); }
      if (e.kind === 'tracer') {
        const onEdge = DBG.lineAt(e.y) === 0 || DBG.lineAt(e.y) === NLINE - 1 || DBG.colAt(e.x) === 0 || DBG.colAt(e.x) === NCOL - 1;
        if (!onEdge) tracerOff++;
      }
    }
  }
  check(bad === 0, 'inimigos sempre sobre trilhos validos (' + bad + ' fora)');
  check(stuck === 0, 'inimigos nunca travam (' + stuck + ' quadros parados)');
  check(tracerOff === 0, 'Tracer nunca sai da borda');
  const patrols = game.enemies.filter((e) => e.kind === 'patrol');
  check(patrols.every((e) => linesSeen.get(e) && linesSeen.get(e).size === NLINE), 'patrulheiros percorrem as 6 linhas (movimento Amidar)');
}

// Inicia partida.
keydown('Enter');
runFrames(1);
check(game.mode === 'ready', 'Enter inicia a partida (PRONTO)');
runFrames(Math.ceil(CFG.TUNE.readyTime * 60) + 2);
check(game.mode === 'play', 'entra em jogo');
check(game.lives === 3 && game.jumps === 4, '3 gorilas e 4 pulos');

// Sem entrada o gorila fica parado (joystick solto).
{
  const p = game.player;
  const x0 = p.x;
  runFrames(10);
  check(game.player.x === x0, 'gorila parado com o joystick solto');
}

// Latencia: a direcao e aplicada no mesmo quadro em que chega.
{
  for (const e of game.enemies) e.state = 'gone';
  const p = game.player;
  const x0 = p.x;
  keydown(KEY.left);
  runFrames(1);
  check(game.player.x < x0, 'resposta no primeiro quadro apos apertar');
  keyup(KEY.left);
}

// Contorna o box inferior entre as colunas 12 e 19 e confere +50 e preenchimento.
function drive(dir, until, max) {
  keydown(KEY[dir]);
  let n = 0;
  while (!until() && n < (max || 2000)) { runFrames(1); n++; }
  keyup(KEY[dir]);
  return until();
}
{
  for (const e of game.enemies) e.state = 'gone';
  const p = () => game.player;
  const T = CFG.trackX, TY = CFG.trackY;
  const box = DBG.boxes.find((b) => b.b === 4 && b.k1 === 12 && b.k2 === 19);
  const startX = p().x;
  let ok = drive('left', () => p().x <= T(12) + 1e-6);
  ok = ok && drive('up', () => DBG.lineAt(p().y) === 4);
  ok = ok && drive('right', () => p().x >= T(19) - 1e-6);
  ok = ok && drive('down', () => DBG.lineAt(p().y) === 5);
  const before = game.score;
  ok = ok && drive('left', () => box.filled || p().x <= startX - 2);
  check(ok, 'gorila percorre o contorno do box guiado pelo teclado (inclusive curva tardia)');
  check(box.filled, 'box inferior preenchido ao fechar o contorno');
  check(game.score - before >= 50, 'fechar o box rende 50 pontos (+' + (game.score - before) + ')');
}

// Pulo: inimigo em cima do gorila nao mata durante o pulo; depois, mata.
{
  const e = game.enemies[0];
  e.state = 'active';
  e.x = game.player.x;
  e.y = game.player.y;
  e.dir = 'left';
  keydown('Space');
  runFrames(1);
  check(game.jumps === 3 && game.jumpT > 0, 'Espaco usa um pulo');
  for (let i = 0; i < 30; i++) { e.x = game.player.x; e.y = game.player.y; runFrames(1); }
  check(game.mode === 'play', 'inimigo pulando nao pega o gorila');
  runFrames(Math.ceil(CFG.TUNE.jumpTime * 60));
  e.x = game.player.x; e.y = game.player.y;
  runFrames(1);
  check(game.mode === 'dying', 'sem pulo, o inimigo pega o gorila');
  runFrames(Math.ceil(CFG.TUNE.deathTime * 60) + 2);
  check(game.lives === 2 && game.mode === 'ready' && game.jumps === 4, 'perde um gorila e recupera os 4 pulos');
  check(DBG.boxes.find((b) => b.b === 4 && b.k1 === 12).filled, 'a pintura permanece apos a morte');
  runFrames(Math.ceil(CFG.TUNE.readyTime * 60) + 2);
}

// Quatro cantos: galinhas por alguns segundos, 100 pontos cada.
{
  for (const e of game.enemies) e.state = 'gone';
  for (const b of DBG.boxes.filter((q) => q.corner)) {
    for (const s of b.segs) if (!s.done) DBG.completeSeg(s);
  }
  check(game.chickenT > 0, 'fechar os 4 cantos transforma os inimigos em galinhas');
  const e = game.enemies[1];
  e.state = 'active';
  e.x = game.player.x; e.y = game.player.y;
  const before = game.score;
  runFrames(1);
  check(e.state === 'gone' && game.score - before === 100, 'pegar galinha rende 100 pontos');
  runFrames(Math.ceil(game.chickenT * 60) + 2);
  check(game.chickenT <= 0 && game.enemies.every((q) => q.state !== 'gone'), 'galinhas voltam a ser inimigos ao fim do tempo');
}

// Jogo aleatorio por ~60 s com entradas reais, sem excecoes.
{
  const dirs = ['up', 'down', 'left', 'right'];
  let seed = 7;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  let held = null;
  let painted = 0;
  for (let s = 0; s < 600; s++) {
    if (held) keyup(KEY[held]);
    held = dirs[Math.floor(rnd() * 4)];
    keydown(KEY[held]);
    if (rnd() < 0.02) keydown('Space');
    runFrames(6);
    if (game.mode === 'title') break;
    painted = Math.max(painted, DBG.segs.reduce((n, q) => n + q.count, 0));
  }
  if (held) keyup(KEY[held]);
  check(game.score > 0 && painted > 0, 'jogo aleatorio pinta e pontua (score ' + game.score + ')');
}

// Fim de rodada: tudo pintado -> rodada 2, rolo de pintura contra porcos.
{
  keydown('Enter'); runFrames(1);
  if (game.mode !== 'ready' && game.mode !== 'play') { DBG.newGame(); }
  runFrames(Math.ceil(CFG.TUNE.readyTime * 60) + 2);
  for (const e of game.enemies) e.state = 'gone';
  for (const s of DBG.segs) if (!s.done) DBG.completeSeg(s);
  check(game.mode === 'clear', 'todos os boxes cheios encerram a rodada');
  const r = game.round;
  runFrames(Math.ceil(CFG.TUNE.clearTime * 60) + 2);
  check(game.round === r + 1 && game.mode === 'ready', 'avanca para a proxima rodada');
  check(DBG.segs.every((s) => !s.done) && game.filled === 0, 'nova rodada com a grade limpa');
  check(game.round % 2 === 0, 'rodada par (rolo e porcos)');
}

// Game over com 3 mortes e volta ao titulo.
{
  runFrames(Math.ceil(CFG.TUNE.readyTime * 60) + 2);
  let guard = 0;
  while (game.mode !== 'gameover' && guard++ < 10) {
    if (game.mode === 'play') {
      const e = game.enemies[0];
      e.state = 'active'; e.x = game.player.x; e.y = game.player.y;
      game.jumpT = 0; game.chickenT = 0;
    }
    runFrames(10);
    while (game.mode === 'dying' || game.mode === 'ready') runFrames(10);
  }
  check(game.mode === 'gameover', 'sem gorilas, fim de jogo');
  runFrames(4 * 60 + 5);
  check(game.mode === 'title', 'volta ao titulo');
  check(game.hi >= game.score && game.hi > 0, 'recorde registrado');
}

// Comandos de interface nao quebram o loop.
keydown('KeyP'); keydown('KeyM'); keydown('KeyF'); keydown('KeyF'); keydown('KeyF'); keydown('KeyC'); keydown('KeyC');
keydown('KeyL');
runFrames(5);
check(game.expert && game.round === 3, 'chave de dificuldade: expert comeca na rodada 3');
check(game.enemies.length === 6, 'rodada 3 tem 6 patrulheiros (Tracer + 5)');
keydown('KeyL');
runFrames(5);

if (failures) {
  console.error(`\n${failures} verificacao(oes) falharam`);
  process.exit(1);
}
console.log('\ntodos os testes passaram');
