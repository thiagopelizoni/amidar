window.AMI = window.AMI || {};

// Loop principal, movimento sobre a grade, pintura, IA dos patrulheiros e renderizacao.
(function () {
  'use strict';

  const CFG = window.AMI.config;
  const SPR = window.AMI.sprites;
  const AUD = window.AMI.audio;
  const INP = window.AMI.input;

  const { W, H, PXA, NCOL, NLINE, COL_W, BAND_H, RUNGS, PAL, TUNE, colX, lineY, trackX, trackY } = CFG;
  const LAST = NLINE - 1;
  const EPS = 1e-6;

  const DIR = {
    up: { x: 0, y: -1 }, down: { x: 0, y: 1 },
    left: { x: -1, y: 0 }, right: { x: 1, y: 0 },
  };
  const OPP = { up: 'down', down: 'up', left: 'right', right: 'left' };
  const CCW = { left: 'down', down: 'right', right: 'up', up: 'left' };
  const isH = (d) => d === 'left' || d === 'right';

  // ---------------------------------------------------------------- grade

  const rungSet = RUNGS.map((r) => new Set(r));

  // Juncoes de cada linha horizontal: colunas com degrau acima ou abaixo.
  const junctions = [];
  for (let j = 0; j < NLINE; j++) {
    const s = new Set();
    if (j > 0) RUNGS[j - 1].forEach((k) => s.add(k));
    if (j < LAST) RUNGS[j].forEach((k) => s.add(k));
    junctions.push(Array.from(s).sort((a, b) => a - b));
  }
  const junctionSet = junctions.map((list) => new Set(list));

  // Segmentos pintaveis: trechos horizontais entre juncoes vizinhas e degraus.
  // A cobertura e medida em pixels (horizontal) ou linhas (vertical).
  const segs = [];
  const hSegs = [];
  const vSegs = [];
  for (let j = 0; j < NLINE; j++) {
    const list = [];
    const js = junctions[j];
    for (let i = 0; i + 1 < js.length; i++) {
      const len = (js[i + 1] - js[i]) * COL_W;
      const s = { kind: 'h', j, k1: js[i], k2: js[i + 1], len, cov: new Uint8Array(len), count: 0, done: false, pts: 1, boxes: [] };
      list.push(s);
      segs.push(s);
    }
    hSegs.push(list);
  }
  for (let b = 0; b < LAST; b++) {
    const map = new Map();
    for (const k of RUNGS[b]) {
      const s = { kind: 'v', b, k, len: BAND_H, cov: new Uint8Array(BAND_H), count: 0, done: false, pts: TUNE.vertScore, boxes: [] };
      map.set(k, s);
      segs.push(s);
    }
    vSegs.push(map);
  }

  // Horizontais valem de 1 (o mais curto) a 6 pontos (o mais longo), como no manual.
  (function scoreHorizontals() {
    const hs = segs.filter((s) => s.kind === 'h');
    const lens = hs.map((s) => s.k2 - s.k1);
    const lo = Math.min.apply(null, lens), hi = Math.max.apply(null, lens);
    for (const s of hs) s.pts = 1 + Math.round(5 * ((s.k2 - s.k1) - lo) / Math.max(1, hi - lo));
  })();

  // Boxes: retangulos entre degraus consecutivos de cada faixa.
  const boxes = [];
  for (let b = 0; b < LAST; b++) {
    const r = RUNGS[b];
    for (let i = 0; i + 1 < r.length; i++) {
      const k1 = r[i], k2 = r[i + 1];
      const inside = (s) => s.k1 >= k1 && s.k2 <= k2;
      const bs = hSegs[b].filter(inside)
        .concat(hSegs[b + 1].filter(inside))
        .concat([vSegs[b].get(k1), vSegs[b].get(k2)]);
      const corner = (b === 0 || b === LAST - 1) && (k1 === 0 || k2 === NCOL - 1);
      const box = { b, k1, k2, segs: bs, filled: false, corner };
      for (const s of bs) s.boxes.push(box);
      boxes.push(box);
    }
  }

  function lineAt(y) {
    const f = (y - trackY(0)) / BAND_H;
    const j = Math.round(f);
    return j >= 0 && j < NLINE && Math.abs(f - j) * BAND_H < EPS ? j : -1;
  }

  function colAt(x) {
    const f = (x - trackX(0)) / COL_W;
    const k = Math.round(f);
    return k >= 0 && k < NCOL && Math.abs(f - k) * COL_W < EPS ? k : -1;
  }

  function junctionOf(e) {
    const j = lineAt(e.y);
    if (j < 0) return null;
    const k = colAt(e.x);
    if (k < 0 || !junctionSet[j].has(k)) return null;
    return { j, k };
  }

  function canMove(e, d) {
    const jn = junctionOf(e);
    if (jn) return allowsAt(jn.j, jn.k, d);
    return lineAt(e.y) >= 0 ? isH(d) : !isH(d);
  }

  function allowsAt(j, k, d) {
    switch (d) {
      case 'left': return k > 0;
      case 'right': return k < NCOL - 1;
      case 'up': return j > 0 && rungSet[j - 1].has(k);
      case 'down': return j < LAST && rungSet[j].has(k);
    }
    return false;
  }

  function nextJunctionX(e, d) {
    const list = junctions[lineAt(e.y)];
    if (d === 'right') {
      for (let i = 0; i < list.length; i++) if (trackX(list[i]) > e.x + EPS) return trackX(list[i]);
    } else {
      for (let i = list.length - 1; i >= 0; i--) if (trackX(list[i]) < e.x - EPS) return trackX(list[i]);
    }
    return e.x;
  }

  function nextLineY(e, d) {
    const f = (e.y - trackY(0)) / BAND_H;
    const j = d === 'down' ? Math.floor(f + EPS) + 1 : Math.ceil(f - EPS) - 1;
    return trackY(Math.max(0, Math.min(LAST, j)));
  }

  // Avanca ate a proxima juncao, decide, e repete enquanto sobrar passo.
  // O orcamento e medido em pixels horizontais; na vertical vale PXA linhas por pixel,
  // para que a velocidade aparente seja a mesma nos dois eixos.
  function stepActor(e, budget, decide, onMove) {
    let guard = 16;
    while (budget > EPS && guard-- > 0) {
      if (junctionOf(e)) {
        decide(e);
        if (!e.moving) return;
      }
      if (!canMove(e, e.dir)) { e.moving = false; return; }
      const d = DIR[e.dir];
      const ox = e.x, oy = e.y;
      if (d.x) {
        const target = nextJunctionX(e, e.dir);
        const cost = Math.abs(target - e.x);
        if (budget >= cost - EPS) { e.x = target; budget -= cost; } else { e.x += d.x * budget; budget = 0; }
      } else {
        const target = nextLineY(e, e.dir);
        const cost = Math.abs(target - e.y) / PXA;
        if (budget >= cost - EPS) { e.y = target; budget -= cost; } else { e.y += d.y * budget * PXA; budget = 0; }
      }
      if (onMove) onMove(e, ox, oy);
    }
  }

  // ------------------------------------------------------------- estado

  const game = {
    mode: 'title',           // title | ready | play | dying | clear | gameover
    modeT: 0,
    time: 0,
    frame: 0,
    round: 1,
    score: 0,
    hi: 0,
    lives: TUNE.startLives,
    jumps: TUNE.jumpsPerLife,
    jumpT: 0,
    chickenT: 0,
    warned: false,
    warbleT: 0,
    cornersDone: false,
    filled: 0,
    paused: false,
    flicker: 1,              // 0 desligado | 1 suave | 2 autentico (multiplexado)
    expert: false,           // chave de dificuldade: comeca na rodada 3, com 6 patrulheiros
    bw: false,               // chave COR/P&B do console
    stepT: 0,
    player: null,
    enemies: [],
    popups: [],
  };

  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* sem storage */ } },
  };

  game.hi = parseInt(store.get('amidar2600.hi') || '0', 10) || 0;
  try {
    const prefs = JSON.parse(store.get('amidar2600.prefs') || '{}');
    if (prefs.flicker === 0 || prefs.flicker === 1 || prefs.flicker === 2) game.flicker = prefs.flicker;
    game.expert = !!prefs.expert;
    game.bw = !!prefs.bw;
  } catch (e) { /* preferencias invalidas */ }

  function savePrefs() {
    store.set('amidar2600.prefs', JSON.stringify({ flicker: game.flicker, expert: game.expert, bw: game.bw }));
  }

  const isGorillaRound = () => game.round % 2 === 1;

  function playerSpeed() {
    return Math.min(TUNE.playerSpeedMax, TUNE.playerSpeed + (game.round - 1) * TUNE.playerSpeedPerRound);
  }

  function enemySpeed(e) {
    if (game.chickenT > 0) return TUNE.chickenSpeed;
    const base = Math.min(TUNE.enemySpeedMax, TUNE.enemySpeed + (game.round - 1) * TUNE.enemySpeedPerRound);
    return e.kind === 'tracer' ? base + TUNE.tracerBonus : base;
  }

  function chickenDuration() {
    return Math.max(6, TUNE.chickenTime - (game.round - 1) * 0.5);
  }

  function spawnEnemy(e, delay) {
    if (e.kind === 'tracer') {
      const t = CFG.TRACER_START;
      e.x = trackX(t.k); e.y = trackY(t.j); e.dir = t.dir;
    } else {
      const sp = CFG.SPAWNS[e.slot];
      e.x = trackX(sp.k); e.y = trackY(0);
      e.hdir = sp.hdir; e.vdir = 'down'; e.dir = sp.hdir; e.fresh = true;
    }
    e.state = 'wait';
    e.release = delay;
    e.moving = true;
  }

  function resetActors() {
    game.player = {
      x: CFG.PLAYER_START.x, y: trackY(CFG.PLAYER_START.j),
      dir: 'left', moving: false, facingLeft: true, painting: false,
    };
    game.enemies = [];
    const tracer = { kind: 'tracer', slot: -1 };
    spawnEnemy(tracer, 0.2);
    game.enemies.push(tracer);
    const patrollers = game.round <= 2 ? 4 : 5;
    for (let i = 0; i < patrollers; i++) {
      const e = { kind: 'patrol', slot: i };
      spawnEnemy(e, 0.6 + i * TUNE.releaseGap);
      game.enemies.push(e);
    }
    game.jumpT = 0;
    game.chickenT = 0;
    game.popups = [];
    game.stepT = 0;
  }

  function clearPaint() {
    for (const s of segs) { s.cov.fill(0); s.count = 0; s.done = false; }
    for (const b of boxes) b.filled = false;
    game.filled = 0;
    game.cornersDone = false;
  }

  function startRound(fresh) {
    if (fresh) clearPaint();
    resetActors();
    game.jumps = TUNE.jumpsPerLife;
    game.mode = 'ready';
    game.modeT = TUNE.readyTime;
    game.paused = false;
  }

  function newGame() {
    game.round = game.expert ? 3 : 1;
    game.score = 0;
    game.lives = TUNE.startLives;
    startRound(true);
    AUD.start();
  }

  function toTitle() {
    game.mode = 'title';
    game.round = game.expert ? 3 : 1;
    game.paused = false;
    clearPaint();
    resetActors();
  }

  function addScore(n) {
    game.score += n;
    if (game.score > game.hi) {
      game.hi = game.score;
      store.set('amidar2600.hi', String(game.hi));
    }
  }

  function popup(x, y, text) {
    game.popups.push({ x, y, text, t: 1.2 });
  }

  // ------------------------------------------------------------ pintura

  function paintRange(s, a, b) {
    const lo = Math.max(0, Math.floor(a + EPS));
    const hi = Math.min(s.len, Math.ceil(b - EPS));
    let fresh = false;
    for (let i = lo; i < hi; i++) {
      if (!s.cov[i]) { s.cov[i] = 1; s.count++; fresh = true; }
    }
    if (!s.done && s.count >= s.len) completeSeg(s);
    return fresh;
  }

  function completeSeg(s) {
    s.done = true;
    addScore(s.pts);
    let filledNow = 0;
    for (const box of s.boxes) {
      if (box.filled || !box.segs.every((q) => q.done)) continue;
      box.filled = true;
      game.filled++;
      filledNow++;
      addScore(TUNE.boxScore);
    }
    if (filledNow) AUD.box(); else AUD.segment();
    if (!game.cornersDone && boxes.every((b) => !b.corner || b.filled)) {
      game.cornersDone = true;
      startChickens();
    }
    if (game.filled === boxes.length && game.mode === 'play') {
      game.mode = 'clear';
      game.modeT = TUNE.clearTime;
      game.chickenT = 0;
      AUD.roundClear();
    }
  }

  function onPlayerMove(p, ox, oy) {
    let fresh = false;
    if (oy === p.y) {
      const j = lineAt(p.y);
      const mx = (ox + p.x) / 2;
      const s = hSegs[j].find((q) => trackX(q.k1) <= mx && mx <= trackX(q.k2));
      if (s) {
        const base = trackX(s.k1);
        fresh = paintRange(s, Math.min(ox, p.x) - base, Math.max(ox, p.x) - base);
      }
    } else {
      const k = colAt(p.x);
      const my = (oy + p.y) / 2;
      const b = Math.floor((my - trackY(0)) / BAND_H);
      const s = vSegs[b] && vSegs[b].get(k);
      if (s) {
        const base = trackY(b);
        fresh = paintRange(s, Math.min(oy, p.y) - base, Math.max(oy, p.y) - base);
      }
    }
    if (fresh) p.painting = true;
  }

  // ------------------------------------------------------------ jogador

  const ASSIST_PX = 12;      // tolerancia para "encaixar" numa curva perpendicular

  // Direcao perpendicular indisponivel aqui: desliza ate a juncao que a aceite.
  function approachDir(p, want) {
    const j = lineAt(p.y);
    if (j >= 0 && !isH(want)) {
      const ok = (k) => (want === 'up' ? j > 0 && rungSet[j - 1].has(k) : j < LAST && rungSet[j].has(k));
      let dl = Infinity, dr = Infinity;
      for (const k of junctions[j]) {
        if (!ok(k)) continue;
        const dx = trackX(k) - p.x;
        if (dx > EPS) dr = Math.min(dr, dx);
        else if (dx < -EPS) dl = Math.min(dl, -dx);
      }
      if (p.moving && isH(p.dir)) {
        const ahead = p.dir === 'right' ? dr : dl;
        const behind = p.dir === 'right' ? dl : dr;
        if (ahead < Infinity && canMove(p, p.dir)) return p.dir;
        if (behind <= ASSIST_PX) return OPP[p.dir];
        return null;
      }
      if (Math.min(dl, dr) > ASSIST_PX) return null;
      return dl < dr ? 'left' : 'right';
    }
    if (j < 0 && isH(want)) {
      const k = colAt(p.x);
      if ((want === 'left' && k === 0) || (want === 'right' && k === NCOL - 1)) return null;
      if (p.moving && !isH(p.dir)) return p.dir;
      const f = (p.y - trackY(0)) / BAND_H;
      return f - Math.floor(f) < 0.5 ? 'up' : 'down';
    }
    return null;
  }

  // Curva tardia: se a juncao que aceita a direcao pedida acabou de ficar para
  // tras (ate LATE_PX), volta a ela e vira na hora, sem esperar a proxima.
  const LATE_PX = 4;

  function lateSnap(p, want) {
    if (!p.moving || isH(p.dir) === isH(want)) return false;
    const j = lineAt(p.y);
    if (j >= 0 && isH(p.dir)) {
      const back = p.dir === 'right' ? -1 : 1;
      for (const k of junctions[j]) {
        const dx = trackX(k) - p.x;
        if (Math.sign(dx) === back && Math.abs(dx) <= LATE_PX && allowsAt(j, k, want)) {
          p.x = trackX(k);
          p.dir = want;
          return true;
        }
      }
      return false;
    }
    if (j < 0 && !isH(p.dir)) {
      const k = colAt(p.x);
      const f = (p.y - trackY(0)) / BAND_H;
      const jb = p.dir === 'down' ? Math.floor(f) : Math.ceil(f);
      if (k >= 0 && Math.abs(trackY(jb) - p.y) <= LATE_PX * PXA && allowsAt(jb, k, want)) {
        p.y = trackY(jb);
        p.dir = want;
        return true;
      }
    }
    return false;
  }

  function steer(p) {
    const want = INP.dir();
    if (!want) { p.moving = false; return; }
    if (canMove(p, want)) {
      p.dir = want;
      p.moving = true;
    } else if (lateSnap(p, want)) {
      p.moving = true;
    } else {
      const d = approachDir(p, want);
      if (d) { p.dir = d; p.moving = true; } else p.moving = false;
    }
    if (p.dir === 'left') p.facingLeft = true;
    else if (p.dir === 'right') p.facingLeft = false;
  }

  function updatePlayer(frames) {
    const p = game.player;
    p.painting = false;
    steer(p);
    if (p.moving) stepActor(p, playerSpeed() * frames, steer, onPlayerMove);
    if (p.moving) {
      game.stepT -= frames;
      if (game.stepT <= 0) {
        AUD.step(p.painting);
        game.stepT = TUNE.stepFrames;
      }
    } else {
      game.stepT = 0;
    }
  }

  // --------------------------------------------------------- patrulheiros

  // "Amidar movement": desce (ou sobe) um degrau, anda na horizontal ate a
  // primeira esquina que leve adiante no sentido vertical, e repete. Inverte o
  // sentido vertical nas linhas de cima e de baixo e o horizontal nas bordas.
  function decidePatrol(e) {
    const j = lineAt(e.y);
    if (e.fresh || !isH(e.dir)) {
      e.fresh = false;
      if (j === 0) e.vdir = 'down';
      else if (j === LAST) e.vdir = 'up';
      if (!canMove(e, e.hdir)) e.hdir = OPP[e.hdir];
      e.dir = e.hdir;
    } else if (canMove(e, e.vdir)) {
      e.dir = e.vdir;
    } else if (canMove(e, e.hdir)) {
      e.dir = e.hdir;
    } else {
      e.vdir = OPP[e.vdir];
      if (canMove(e, e.vdir)) e.dir = e.vdir;
      else { e.hdir = OPP[e.hdir]; e.dir = e.hdir; }
    }
    e.moving = true;
  }

  // O Tracer so patrulha a borda externa, no sentido anti-horario.
  function decideTracer(e) {
    let guard = 4;
    while (!canMove(e, e.dir) && guard-- > 0) e.dir = CCW[e.dir];
    e.moving = true;
  }

  // Ninguem entra em cena em cima do gorila: a entrada espera ele se afastar.
  function playerNear(e, dist) {
    const p = game.player;
    if (!p || game.mode === 'title') return false;
    return Math.abs((e.x - p.x) * PXA) < dist && Math.abs(e.y - p.y) < dist;
  }

  function updateEnemies(dt, frames) {
    for (const e of game.enemies) {
      if (e.state === 'wait') {
        e.release -= dt;
        if (e.release <= 0 && !playerNear(e, 20)) e.state = 'active';
        continue;
      }
      if (e.state !== 'active') continue;
      stepActor(e, enemySpeed(e) * frames, e.kind === 'tracer' ? decideTracer : decidePatrol, null);
    }
  }

  function startChickens() {
    game.chickenT = chickenDuration();
    game.warned = false;
    game.warbleT = 0.6;
    AUD.chickens();
  }

  function endChickens() {
    game.chickenT = 0;
    let n = 0;
    for (const e of game.enemies) {
      if (e.state === 'gone') spawnEnemy(e, 0.5 + 0.6 * n++);
    }
  }

  function checkCollisions() {
    const p = game.player;
    for (const e of game.enemies) {
      if (e.state !== 'active') continue;
      const dx = (e.x - p.x) * PXA;
      const dy = e.y - p.y;
      if (Math.abs(dx) >= 8 || Math.abs(dy) >= 6) continue;
      if (game.chickenT > 0) {
        e.state = 'gone';
        addScore(TUNE.chickenScore);
        popup(e.x, e.y, String(TUNE.chickenScore));
        AUD.chickenCaught();
      } else if (game.jumpT <= 0) {
        game.mode = 'dying';
        game.modeT = TUNE.deathTime;
        AUD.death();
        return;
      }
    }
  }

  // ----------------------------------------------------------- atualizacao

  function updatePlay(dt, frames) {
    if (game.jumpT > 0) game.jumpT = Math.max(0, game.jumpT - dt);
    if (game.chickenT > 0) {
      game.chickenT -= dt;
      game.warbleT -= dt;
      if (game.warbleT <= 0) { AUD.warble(); game.warbleT = 0.3; }
      if (!game.warned && game.chickenT <= TUNE.chickenWarn) { game.warned = true; AUD.warn(); }
      if (game.chickenT <= 0) endChickens();
    }
    updatePlayer(frames);
    if (game.mode !== 'play') return;
    updateEnemies(dt, frames);
    checkCollisions();
    for (const p of game.popups) p.t -= dt;
    game.popups = game.popups.filter((p) => p.t > 0);
  }

  function update(dt) {
    game.time += dt;
    const frames = dt * 60;
    switch (game.mode) {
      case 'title':
        updateEnemies(dt, frames);
        break;
      case 'ready':
        game.modeT -= dt;
        if (game.modeT <= 0) game.mode = 'play';
        break;
      case 'play':
        if (!game.paused) updatePlay(dt, frames);
        break;
      case 'dying':
        game.modeT -= dt;
        if (game.modeT <= 0) {
          game.lives--;
          if (game.lives <= 0) {
            game.mode = 'gameover';
            game.modeT = 4;
          } else {
            startRound(false);
          }
        }
        break;
      case 'clear':
        game.modeT -= dt;
        if (game.modeT <= 0) {
          game.round++;
          startRound(true);
        }
        break;
      case 'gameover':
        game.modeT -= dt;
        if (game.modeT <= 0) toTitle();
        break;
    }
  }

  // ------------------------------------------------------------- desenho

  let canvas = null, ctx = null, scan = null;
  let sx = 4, sy = 3;

  // Retangulo em coordenadas logicas (160x192) alinhado ao pixel do dispositivo:
  // nitido em qualquer tamanho de tela, sem o borrado da escala do navegador.
  function rect(x, y, w, h) {
    const x0 = Math.round(x * sx), y0 = Math.round(y * sy);
    ctx.fillRect(x0, y0, Math.round((x + w) * sx) - x0, Math.round((y + h) * sy) - y0);
  }

  function drawBitmap(bm, x, y, color, eye) {
    for (let r = 0; r < bm.length; r++) {
      const row = bm[r];
      let c = 0;
      while (c < row.length) {
        const ch = row[c];
        if (ch === '.') { c++; continue; }
        let c2 = c + 1;
        while (c2 < row.length && row[c2] === ch) c2++;
        ctx.fillStyle = ch === 'e' ? (eye || color) : color;
        rect(x + c, y + r, c2 - c, 1);
        c = c2;
      }
    }
  }

  function drawText(str, x, y, color, tx, ty) {
    tx = tx || 1;
    ty = ty || tx;
    ctx.fillStyle = color;
    for (let i = 0; i < str.length; i++) {
      const glyph = SPR.FONT[str[i].toUpperCase()] || SPR.FONT[' '];
      const gx = x + i * 5 * tx;
      for (let r = 0; r < 5; r++) {
        const row = glyph[r];
        for (let c = 0; c < 4; c++) {
          if (row[c] === '1') rect(gx + c * tx, y + r * ty, tx, ty);
        }
      }
    }
  }

  function drawTextCentered(str, y, color, tx, ty, cx) {
    const w = SPR.textWidth(str, tx || 1);
    drawText(str, Math.round((cx === undefined ? W / 2 : cx) - w / 2), y, color, tx, ty);
  }

  function lineColors(flashOn) {
    if (flashOn) return { line: PAL.flash, dim: PAL.flash, dark: PAL.flash, paint: PAL.flash };
    return { line: PAL.line, dim: PAL.lineDim, dark: PAL.rungDark, paint: PAL.paint };
  }

  function drawFills(flashOn) {
    ctx.fillStyle = flashOn ? PAL.flash : PAL.fill;
    for (const box of boxes) {
      if (!box.filled) continue;
      const x = colX(box.k1) + COL_W;
      const w = (box.k2 - box.k1) * COL_W - COL_W;
      const top = lineY(box.b) + 3, bottom = lineY(box.b + 1);
      for (let y = top + 1; y < bottom - 1; y += 2) rect(x, y, w, 1);
    }
  }

  // Trilhos como no original: linhas horizontais duplas (aceso/apagado/aceso) e
  // degraus listrados por linha de varredura. Pintado, o azul entrelaca o vermelho.
  function drawMaze(flashOn) {
    const C = lineColors(flashOn);
    for (let b = 0; b < LAST; b++) {
      const top = lineY(b) + 3, bottom = lineY(b + 1);
      for (const k of RUNGS[b]) {
        const s = vSegs[b].get(k);
        const x = colX(k);
        for (let y = top; y < bottom; y++) {
          const i = Math.floor(y + 0.5 - trackY(b));
          const painted = s.done || (i >= 0 && i < s.len && s.cov[i]);
          ctx.fillStyle = painted ? (y % 2 ? C.paint : C.line) : (y % 3 === 2 ? C.dark : C.line);
          rect(x, y, COL_W, 1);
        }
      }
    }
    for (let j = 0; j < NLINE; j++) {
      const y = lineY(j);
      ctx.fillStyle = C.line;
      rect(colX(0), y, colX(NCOL - 1) + COL_W - colX(0), 1);
      rect(colX(0), y + 2, colX(NCOL - 1) + COL_W - colX(0), 1);
      ctx.fillStyle = C.dim;
      rect(colX(0), y + 1, colX(NCOL - 1) + COL_W - colX(0), 1);
      ctx.fillStyle = C.paint;
      for (const s of hSegs[j]) {
        if (s.done) {
          const x = colX(s.k1), w = colX(s.k2) + COL_W - x;
          rect(x, y, w, 1);
          rect(x, y + 2, w, 1);
          continue;
        }
        if (!s.count) continue;
        const base = trackX(s.k1);
        let i = 0;
        while (i < s.len) {
          if (!s.cov[i]) { i++; continue; }
          let i2 = i + 1;
          while (i2 < s.len && s.cov[i2]) i2++;
          rect(base + i, y, i2 - i, 1);
          rect(base + i, y + 2, i2 - i, 1);
          i = i2;
        }
      }
    }
  }

  function enemyLook(e) {
    if (game.chickenT > 0) {
      const warn = game.chickenT < TUNE.chickenWarn && ((game.frame >> 3) & 1) === 0;
      return { bm: e.dir === 'left' ? SPR.CHICKEN_L : SPR.CHICKEN, color: warn ? PAL.chickenFlash : PAL.chicken, shadow: PAL.chicken };
    }
    if (isGorillaRound()) return { bm: SPR.WARRIOR, color: PAL.warrior, shadow: PAL.warriorShadow };
    return { bm: SPR.PIG, color: PAL.pig, shadow: PAL.pigShadow };
  }

  function drawEnemy(e, alpha) {
    const look = enemyLook(e);
    const frame = look.bm[Math.floor(game.time * 7) & 1];
    const x = e.x - 4, y = e.y - 4;
    ctx.globalAlpha = alpha;
    if (game.jumpT > 0 && game.chickenT <= 0) {
      // Pulo: viram sombras suspensas e o gorila passa por baixo.
      const p = 1 - game.jumpT / TUNE.jumpTime;
      const lift = 7 * Math.min(1, p * 5, (1 - p) * 5);
      ctx.fillStyle = look.shadow;
      rect(x + 1, e.y + 3, 6, 1);
      drawBitmap(frame, x, y - lift, look.shadow);
    } else {
      drawBitmap(frame, x, y, look.color);
    }
    ctx.globalAlpha = 1;
  }

  function drawEnemies() {
    const list = game.enemies.filter((e) => e.state === 'active');
    for (let i = 0; i < list.length; i++) {
      if (game.flicker === 2) {
        if ((game.frame + i) % 2 !== 0) continue;
        drawEnemy(list[i], 1);
      } else if (game.flicker === 1) {
        drawEnemy(list[i], (game.frame + i) % 2 === 0 ? 1 : 0.55);
      } else {
        drawEnemy(list[i], 1);
      }
    }
  }

  function playerFrames() {
    if (isGorillaRound()) return game.player.facingLeft ? SPR.GORILLA_L : SPR.GORILLA;
    return game.player.facingLeft ? SPR.ROLLER_L : SPR.ROLLER;
  }

  function drawPlayer() {
    const p = game.player;
    const frames = playerFrames();
    const f = p.moving ? Math.floor(game.time * 8) & 1 : 0;
    let color = PAL.player;
    if (game.mode === 'dying') {
      // Morte a moda TIA: o sprite pisca trocando de cor e some.
      const k = 1 - game.modeT / TUNE.deathTime;
      if (k > 0.8) return;
      color = [PAL.player, PAL.line, PAL.paint, PAL.chicken][(game.frame >> 2) & 3];
    }
    drawBitmap(frames[f], p.x - 4, p.y - 4, color, PAL.eye);
  }

  function drawHUD() {
    const reserve = Math.max(0, game.lives - 1);
    const icon = isGorillaRound() ? SPR.GORILLA[0] : SPR.ROLLER[0];
    for (let i = 0; i < Math.min(5, reserve); i++) drawBitmap(icon, 16 + i * 11, 153, PAL.player, PAL.eye);
    const score = String(game.score);
    drawText(score, 110 - SPR.textWidth(score, 2), 152, PAL.text, 2, 2);
    ctx.fillStyle = PAL.paint;
    for (let i = 0; i < game.jumps; i++) {
      const x = 141 - i * 6;
      rect(x + 1, 153, 1, 1);
      rect(x, 154, 3, 1);
      rect(x + 1, 155, 1, 4);
    }
    drawText('R' + game.round, 131, 164, PAL.textDim, 1, 1);
  }

  function drawPopups() {
    for (const p of game.popups) {
      drawTextCentered(p.text, Math.round(p.y) - 14, PAL.text, 1, 2, p.x);
    }
  }

  function banner(lines, cy) {
    let h = 8;
    for (const l of lines) h += 5 * (l.ty || 2) + 5;
    const y0 = Math.round((cy === undefined ? 87 : cy) - h / 2);
    ctx.fillStyle = PAL.bg;
    rect(12, y0, W - 24, h);
    ctx.fillStyle = PAL.line;
    rect(12, y0, W - 24, 1);
    rect(12, y0 + h - 1, W - 24, 1);
    let y = y0 + 6;
    for (const l of lines) {
      drawTextCentered(l.text, y, l.color || PAL.text, l.tx || 1, l.ty || 2);
      y += 5 * (l.ty || 2) + 5;
    }
  }

  function render() {
    ctx.fillStyle = PAL.bg;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const flashOn = game.mode === 'clear' && ((game.frame >> 3) & 1) === 0;
    drawFills(flashOn);
    drawMaze(flashOn);

    if (game.mode === 'title') {
      drawEnemies();
      banner([
        { text: 'AMIDAR', color: PAL.warrior, tx: 3, ty: 5 },
        { text: 'TRIBUTO 2600', color: PAL.line, tx: 1, ty: 2 },
        { text: 'RECORDE ' + game.hi, color: PAL.text, tx: 1, ty: 2 },
        { text: game.expert ? 'EXPERT - RODADA 3' : 'NOVATO - RODADA 1', color: PAL.paint, tx: 1, ty: 2 },
        { text: 'ENTER OU TOQUE', color: (game.frame >> 5) & 1 ? PAL.text : PAL.bg, tx: 1, ty: 2 },
      ]);
      drawHUD();
      finishFrame();
      return;
    }

    if (game.mode === 'dying') {
      drawEnemies();
      drawPlayer();
    } else if (game.mode === 'clear') {
      drawPlayer();
    } else {
      drawEnemies();
      drawPlayer();
    }
    drawPopups();

    if (game.mode === 'ready') {
      banner([
        { text: 'RODADA ' + game.round, color: isGorillaRound() ? PAL.warrior : PAL.pig, tx: 1, ty: 2 },
        { text: 'PRONTO!', color: PAL.text, tx: 1, ty: 2 },
      ]);
    } else if (game.mode === 'gameover') {
      banner([
        { text: 'FIM DE JOGO', color: PAL.text, tx: 1, ty: 2 },
        { text: 'PONTOS ' + game.score, color: PAL.paint, tx: 1, ty: 2 },
      ]);
    } else if (game.paused && game.mode === 'play') {
      banner([{ text: 'PAUSA', color: PAL.text, tx: 1, ty: 2 }]);
    }
    drawHUD();
    finishFrame();
  }

  function finishFrame() {
    if (scan) ctx.drawImage(scan, 0, 0);
  }

  // Scanlines alinhadas a cada linha logica: uma faixa escura na base de cada linha,
  // como o feixe do CRT, sem o moire de um padrao CSS sobre pixels escalados.
  function buildScanlines() {
    scan = null;
    if (typeof document === 'undefined' || !document.createElement) return;
    const c = document.createElement('canvas');
    if (!c || !c.getContext) return;
    c.width = canvas.width;
    c.height = canvas.height;
    const g = c.getContext('2d');
    if (!g) return;
    g.fillStyle = 'rgba(0, 0, 0, 0.32)';
    for (let r = 0; r < H; r++) {
      const y0 = Math.round(r * sy), y1 = Math.round((r + 1) * sy);
      const hh = y1 - y0;
      if (hh < 3) continue;
      const dark = Math.max(1, Math.round(hh * 0.34));
      g.fillRect(0, y1 - dark, c.width, dark);
    }
    scan = c;
  }

  function resize() {
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    const cw = canvas.clientWidth || W * 4;
    const ch = canvas.clientHeight || H * 3;
    const bw = Math.max(W, Math.round(cw * dpr));
    const bh = Math.max(H, Math.round(ch * dpr));
    if (canvas.width !== bw || canvas.height !== bh) {
      canvas.width = bw;
      canvas.height = bh;
    }
    sx = canvas.width / W;
    sy = canvas.height / H;
    ctx.imageSmoothingEnabled = false;
    buildScanlines();
  }

  // ----------------------------------------------------------------- loop

  // Passo variavel com subpassos de no maximo 1/60 s: a entrada e aplicada no
  // mesmo quadro em que e lida e o movimento acompanha telas de 60 a 240 Hz.
  let last = 0;
  const MAX_SUB = 1 / 60;

  function frame(ts) {
    if (!last) last = ts;
    let dt = (ts - last) / 1000;
    last = ts;
    if (!(dt > 0)) dt = 0;
    if (dt > 0.1) dt = 0.1;
    INP.poll();
    const n = Math.max(1, Math.ceil(dt / MAX_SUB - 1e-6));
    for (let i = 0; i < n; i++) update(dt / n);
    game.frame++;
    render();
    requestAnimationFrame(frame);
  }

  // ------------------------------------------------------------ interface

  function setText(id, text) {
    if (typeof document === 'undefined') return;
    const el = document.getElementById(id);
    if (el) el.textContent = text;
  }

  function setPressed(sel, on) {
    if (typeof document === 'undefined' || !document.querySelector) return;
    const el = document.querySelector(sel);
    if (el) el.setAttribute('aria-pressed', on ? 'true' : 'false');
  }

  function syncUI() {
    setText('mute-state', AUD.isMuted() ? 'som desligado' : 'som ligado');
    setText('flicker-state', 'flicker ' + ['desligado', 'suave', 'autentico'][game.flicker]);
    setText('tv-state', game.bw ? 'TV preto e branco' : 'TV colorida');
    setText('diff-state', game.expert ? 'dificuldade expert' : 'dificuldade novato');
    setPressed('[data-switch="tv"]', game.bw);
    setPressed('[data-switch="difficulty"]', game.expert);
    if (canvas && canvas.classList) canvas.classList.toggle('bw', game.bw);
  }

  function onAction() {
    if (game.mode === 'title') newGame();
    else if (game.mode === 'gameover') toTitle();
    else if (game.mode === 'play') game.paused = !game.paused;
  }

  function onJump() {
    if (game.mode === 'title') { newGame(); return; }
    if (game.mode !== 'play') return;
    if (game.paused) { game.paused = false; return; }
    if (game.jumps > 0 && game.jumpT <= 0) {
      game.jumps--;
      game.jumpT = TUNE.jumpTime;
      AUD.jump();
    } else if (game.jumpT <= 0) {
      AUD.noJump();
    }
  }

  const commands = {
    pause() { if (game.mode === 'play') game.paused = !game.paused; },
    mute() { AUD.toggleMute(); },
    flicker() { game.flicker = (game.flicker + 1) % 3; savePrefs(); },
    tv() { game.bw = !game.bw; savePrefs(); AUD.click(); },
    difficulty() {
      game.expert = !game.expert;
      savePrefs();
      AUD.click();
      if (game.mode === 'title') toTitle();
    },
    reset() { newGame(); },
  };

  // Acesso para testes automatizados.
  window.AMI.debug = {
    game, segs, hSegs, vSegs, boxes, junctions, rungSet,
    canMove, lineAt, colAt, junctionOf, stepActor, decidePatrol, decideTracer, completeSeg,
    newGame, update,
  };

  window.AMI.boot = function boot() {
    canvas = document.getElementById('screen');
    try {
      ctx = canvas.getContext('2d', { alpha: false, desynchronized: true });
    } catch (e) {
      ctx = null;
    }
    ctx = ctx || canvas.getContext('2d');
    resize();
    if (typeof ResizeObserver !== 'undefined') new ResizeObserver(resize).observe(canvas);
    else window.addEventListener('resize', resize);

    // Controles de toque tambem quando o navegador nao anuncia 'pointer: coarse'.
    if (('ontouchstart' in window || (typeof navigator !== 'undefined' && navigator.maxTouchPoints > 0)) && document.body) {
      document.body.classList.add('touch');
    }
    INP.bindScreen(canvas);
    const pad = document.getElementById('pad');
    if (pad) INP.bindPad(pad);
    INP.on('action', onAction);
    INP.on('click', onAction);
    INP.on('jump', onJump);
    INP.on('tap', () => { if (game.mode === 'play' && !game.paused) onJump(); else onAction(); });
    for (const name in commands) INP.on(name, () => { commands[name](); syncUI(); });

    if (document.querySelectorAll) {
      document.querySelectorAll('[data-switch]').forEach((btn) => {
        btn.addEventListener('click', () => {
          AUD.unlock();
          const cmd = commands[btn.dataset.switch];
          if (cmd) cmd();
          syncUI();
          btn.blur();
        });
      });
    }
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && game.mode === 'play') game.paused = true;
    });

    toTitle();
    syncUI();
    requestAnimationFrame(frame);
  };
})();
