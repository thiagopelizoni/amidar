window.AMI = window.AMI || {};

// Joystick de verdade: a direcao vale enquanto esta pressionada (teclado,
// d-pad tatil, swipe ou gamepad) e a mais recente vence. Soltou, o gorila para.
window.AMI.input = (function () {
  'use strict';

  const listeners = {};
  const held = [];               // teclas de direcao pressionadas, a ultima vence
  const padDirs = new Map();     // pointerId -> direcao no d-pad tatil
  let padLast = null;
  let touchDir = null;
  let gpDir = null;
  const gpPrev = {};

  function emit(name) {
    const list = listeners[name];
    if (list) for (const cb of list) cb();
  }

  function unlock() {
    if (window.AMI.audio) window.AMI.audio.unlock();
  }

  const DIR_CODES = {
    ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
    KeyW: 'up', KeyS: 'down', KeyA: 'left', KeyD: 'right',
  };
  const JUMP_CODES = { Space: 1, KeyZ: 1, KeyX: 1, ShiftLeft: 1, ShiftRight: 1, KeyJ: 1 };
  const CMD_CODES = { KeyP: 'pause', KeyM: 'mute', KeyF: 'flicker', KeyC: 'tv', KeyL: 'difficulty' };

  function release(dir) {
    const i = held.indexOf(dir);
    if (i >= 0) held.splice(i, 1);
  }

  window.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const onButton = e.target && e.target.tagName === 'BUTTON';
    const dir = DIR_CODES[e.code];
    if (dir) {
      e.preventDefault();
      if (!e.repeat) { release(dir); held.push(dir); }
      unlock();
      return;
    }
    if (e.code === 'Enter' || e.code === 'NumpadEnter') {
      if (onButton) return;
      e.preventDefault();
      unlock();
      if (!e.repeat) emit('action');
    } else if (JUMP_CODES[e.code]) {
      if (onButton && e.code === 'Space') return;
      e.preventDefault();
      unlock();
      if (!e.repeat) emit('jump');
    } else if (CMD_CODES[e.code] && !e.repeat) {
      emit(CMD_CODES[e.code]);
    }
  });

  window.addEventListener('keyup', (e) => {
    const dir = DIR_CODES[e.code];
    if (dir) release(dir);
  });

  window.addEventListener('blur', () => {
    held.length = 0;
    padDirs.clear();
    padLast = null;
    touchDir = null;
  });

  // Swipe sobre a tela: arrastar dirige enquanto o dedo estiver na tela;
  // toque rapido vira 'tap' (pulo durante o jogo). Clique de mouse vira 'click'.
  function bindScreen(canvas) {
    let sx = 0, sy = 0, moved = false, active = null;
    canvas.addEventListener('pointerdown', (e) => {
      unlock();
      if (e.pointerType === 'mouse') { emit('click'); return; }
      active = e.pointerId;
      sx = e.clientX; sy = e.clientY; moved = false;
      if (canvas.setPointerCapture) canvas.setPointerCapture(e.pointerId);
    });
    canvas.addEventListener('pointermove', (e) => {
      if (e.pointerId !== active) return;
      const dx = e.clientX - sx, dy = e.clientY - sy;
      if (Math.abs(dx) > 14 || Math.abs(dy) > 14) {
        moved = true;
        touchDir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up');
        sx = e.clientX; sy = e.clientY;
      }
    });
    const end = (e) => {
      if (e.pointerId !== active) return;
      active = null;
      touchDir = null;
      if (!moved && e.type === 'pointerup') emit('tap');
    };
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  // D-pad tatil: deslizar o dedo entre as setas troca a direcao sem soltar.
  function bindPad(root) {
    const dirAt = (x, y) => {
      const el = document.elementFromPoint(x, y);
      const btn = el && el.closest ? el.closest('[data-dir]') : null;
      return btn && root.contains(btn) ? btn.dataset.dir : null;
    };
    const dpad = root.querySelector('.dpad') || root;
    dpad.addEventListener('pointerdown', (e) => {
      const d = dirAt(e.clientX, e.clientY);
      if (!d) return;
      e.preventDefault();
      unlock();
      padDirs.set(e.pointerId, d);
      padLast = d;
      if (dpad.setPointerCapture) dpad.setPointerCapture(e.pointerId);
    });
    dpad.addEventListener('pointermove', (e) => {
      if (!padDirs.has(e.pointerId)) return;
      const d = dirAt(e.clientX, e.clientY);
      if (d && d !== padDirs.get(e.pointerId)) { padDirs.set(e.pointerId, d); padLast = d; }
    });
    const up = (e) => {
      padDirs.delete(e.pointerId);
      padLast = padDirs.size ? Array.from(padDirs.values()).pop() : null;
    };
    dpad.addEventListener('pointerup', up);
    dpad.addEventListener('pointercancel', up);
    root.querySelectorAll('[data-action]').forEach((btn) => {
      btn.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        unlock();
        emit(btn.dataset.action);
      });
    });
    root.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  // Gamepad (inclusive adaptadores de joystick Atari): direcional/analogico
  // move, botao A/B pula, Start inicia. Consultado a cada quadro pelo jogo.
  function poll() {
    gpDir = null;
    if (typeof navigator === 'undefined' || !navigator.getGamepads) return;
    const pads = navigator.getGamepads();
    for (const gp of pads) {
      if (!gp || !gp.connected) continue;
      const b = (i) => !!(gp.buttons[i] && gp.buttons[i].pressed);
      const ax = gp.axes[0] || 0, ay = gp.axes[1] || 0;
      if (b(12) || ay < -0.5) gpDir = 'up';
      else if (b(13) || ay > 0.5) gpDir = 'down';
      else if (b(14) || ax < -0.5) gpDir = 'left';
      else if (b(15) || ax > 0.5) gpDir = 'right';
      const edges = { jump: b(0) || b(1) || b(2) || b(3), action: b(9) || b(8) };
      for (const name in edges) {
        const key = gp.index + name;
        if (edges[name] && !gpPrev[key]) { unlock(); emit(name); }
        gpPrev[key] = edges[name];
      }
      if (gpDir) break;
    }
  }

  return {
    dir() {
      return held.length ? held[held.length - 1] : (padLast || touchDir || gpDir);
    },
    poll,
    bindScreen,
    bindPad,
    on(name, cb) { (listeners[name] = listeners[name] || []).push(cb); },
  };
})();
