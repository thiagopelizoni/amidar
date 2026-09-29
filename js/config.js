window.AMI = window.AMI || {};

// Dados estaticos do jogo: grade, paleta e tuning, medidos de um screenshot
// do cartucho original (geometria e cores extraidas pixel a pixel).
window.AMI.config = (function () {
  'use strict';

  // Quadro nativo do 2600: 160 pixels por 192 linhas. Os pixels sao mais
  // largos que altos; PXA converte 1 pixel horizontal em linhas equivalentes.
  const W = 160;
  const H = 192;
  const ASPECT = 358 / 280;          // proporcao do screenshot do original
  const PXA = ASPECT * H / W;        // ~1.53

  // Grade: 6 linhas horizontais continuas e 5 faixas de degraus verticais
  // (a escada de amidakuji que da nome ao jogo), em 32 colunas de 4 pixels.
  const NCOL = 32;
  const NLINE = 6;
  const X0 = 16;
  const COL_W = 4;
  const Y0 = 29;
  const BAND_H = 23;

  // Colunas com degrau em cada faixa, medidas do original (simetricas c -> 31-c).
  const RUNGS = [
    [0, 6, 10, 14, 17, 21, 25, 31],
    [0, 4, 9, 12, 19, 22, 27, 31],
    [0, 3, 11, 20, 28, 31],
    [0, 5, 14, 17, 26, 31],
    [0, 6, 12, 19, 25, 31],
  ];

  // Cores amostradas do screenshot: campo preto, trilhos vermelho-rosado,
  // tinta azul, gorila branco e guerreiros verde-menta.
  const PAL = {
    bg: '#000000',
    line: '#B74A62',
    lineDim: '#4D1F29',
    rungDark: '#5B2531',
    paint: '#3C8FCF',
    fill: '#3C8FCF',
    player: '#F0F0F0',
    eye: '#3C8FCF',
    warrior: '#5ECC9B',
    warriorShadow: '#24503C',
    pig: '#E890B4',
    pigShadow: '#5C3446',
    chicken: '#E4E45C',
    chickenFlash: '#F0F0F0',
    text: '#F0F0F0',
    textDim: '#B74A62',
    flash: '#F0F0F0',
  };

  const TUNE = {
    playerSpeed: 0.66,         // px horizontais por quadro (60 fps)
    playerSpeedPerRound: 0.015,
    playerSpeedMax: 0.80,
    enemySpeed: 0.60,          // rodada 1: a mais lenta, como no manual
    enemySpeedPerRound: 0.05,
    enemySpeedMax: 0.95,
    tracerBonus: 0.08,         // o Tracer e mais rapido que o gorila
    chickenSpeed: 0.48,
    chickenTime: 10,           // segundos
    chickenWarn: 2.2,
    jumpTime: 1.8,
    jumpsPerLife: 4,
    releaseGap: 0.8,           // segundos entre a entrada de cada patrulheiro
    readyTime: 2.0,
    deathTime: 1.8,
    clearTime: 2.6,
    boxScore: 50,
    vertScore: 1,
    chickenScore: 100,
    startLives: 3,             // tres gorilas, como no manual
    stepFrames: 8,             // cadencia do som de passos
  };

  // Patrulheiros entram pela linha de cima; o Tracer nasce no canto superior direito.
  const SPAWNS = [
    { k: 14, hdir: 'left' },
    { k: 17, hdir: 'right' },
    { k: 10, hdir: 'right' },
    { k: 21, hdir: 'left' },
    { k: 6, hdir: 'right' },
  ];
  const TRACER_START = { k: NCOL - 1, j: 0, dir: 'left' };
  const PLAYER_START = { x: X0 + 2 + 15.5 * COL_W, j: NLINE - 1 };

  function colX(k) { return X0 + k * COL_W; }          // borda esquerda do degrau
  function lineY(j) { return Y0 + j * BAND_H; }        // primeira linha do trilho
  function trackX(k) { return colX(k) + 2; }           // eixo de movimento
  function trackY(j) { return lineY(j) + 1; }

  return {
    W, H, ASPECT, PXA, NCOL, NLINE, X0, COL_W, Y0, BAND_H, RUNGS, PAL, TUNE,
    SPAWNS, TRACER_START, PLAYER_START, colX, lineY, trackX, trackY,
  };
})();
