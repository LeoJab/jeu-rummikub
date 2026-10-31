/* Effets spéciaux : sons (WebAudio), confettis, feux d'artifice, bannières, tremblements, réactions. */
window.FX = (function () {
  'use strict';
  var ctx = null, master = null, muted = false;
  try { muted = localStorage.getItem('rk_mute') === '1'; } catch (e) {}

  /* ---------- Sons ---------- */
  function ac() {
    if (muted) return null;
    if (!ctx) {
      try {
        ctx = new (window.AudioContext || window.webkitAudioContext)();
        master = ctx.createGain();
        master.gain.value = 0.7;
        master.connect(ctx.destination);
      } catch (e) { return null; }
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }
  function tone(f, d, type, vol, at, slideTo) {
    var c = ac(); if (!c) return;
    var t = c.currentTime + (at || 0);
    var o = c.createOscillator(), g = c.createGain();
    o.type = type || 'sine';
    o.frequency.setValueAtTime(f, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + d);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol || 0.15, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + d);
    o.connect(g); g.connect(master);
    o.start(t); o.stop(t + d + 0.03);
  }
  function noise(d, vol, at, freq) {
    var c = ac(); if (!c) return;
    var t = c.currentTime + (at || 0);
    var len = Math.max(1, Math.floor(c.sampleRate * d));
    var buf = c.createBuffer(1, len, c.sampleRate), data = buf.getChannelData(0);
    for (var i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    var src = c.createBufferSource(); src.buffer = buf;
    var f = c.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = freq || 2000;
    var g = c.createGain(); g.gain.value = vol || 0.1;
    src.connect(f); f.connect(g); g.connect(master);
    src.start(t);
  }
  var SOUNDS = {
    pick: function () { tone(660, 0.05, 'triangle', 0.07); },
    drop: function () { noise(0.06, 0.22, 0, 1800); tone(140, 0.09, 'sine', 0.14, 0, 70); },
    draw: function () { noise(0.12, 0.14, 0, 3000); tone(300, 0.1, 'triangle', 0.08, 0.05, 520); },
    bad: function () { tone(160, 0.28, 'sawtooth', 0.11, 0, 80); tone(120, 0.28, 'square', 0.06, 0.02, 60); },
    ok: function () { [523, 659, 784].forEach(function (f, i) { tone(f, 0.15, 'triangle', 0.12, i * 0.07); }); },
    combo: function () { [523, 659, 784, 1047, 1319].forEach(function (f, i) { tone(f, 0.18, 'square', 0.06, i * 0.06); noise(0.05, 0.05, i * 0.06, 5000); }); },
    joker: function () { for (var i = 0; i < 9; i++) tone(800 + Math.random() * 1600, 0.22, 'sine', 0.07, i * 0.05); },
    turn: function () { tone(784, 0.12, 'triangle', 0.14); tone(1047, 0.22, 'triangle', 0.14, 0.12); },
    tick: function () { tone(1000, 0.04, 'square', 0.05); },
    shuffle: function () { for (var i = 0; i < 8; i++) noise(0.07, 0.1, i * 0.05, 1500 + Math.random() * 2500); },
    react: function () { tone(880, 0.08, 'sine', 0.07); tone(1175, 0.1, 'sine', 0.06, 0.06); },
    win: function () {
      [523, 523, 523, 659, 784, 659, 784, 1047].forEach(function (f, i) { tone(f, 0.22, 'square', 0.07, i * 0.13); tone(f / 2, 0.22, 'triangle', 0.1, i * 0.13); });
      for (var i = 0; i < 6; i++) noise(0.2, 0.09, 0.9 + i * 0.18, 4000);
    },
    lose: function () { [392, 349, 330, 262].forEach(function (f, i) { tone(f, 0.28, 'triangle', 0.12, i * 0.18); }); }
  };
  function sound(name) { try { if (SOUNDS[name]) SOUNDS[name](); } catch (e) {} }
  function isMuted() { return muted; }
  function toggleMute() {
    muted = !muted;
    try { localStorage.setItem('rk_mute', muted ? '1' : '0'); } catch (e) {}
    return muted;
  }
  function vibrate(p) { try { if (navigator.vibrate) navigator.vibrate(p); } catch (e) {} }

  /* ---------- Particules ---------- */
  var cv = null, g = null, parts = [], running = false, W = 0, H = 0;
  var PALETTE = ['#ffd426', '#ff3b3b', '#2ad1ff', '#ff9a1f', '#ffffff', '#7dff6b', '#d65bff'];
  function setup() {
    if (cv) return true;
    cv = document.getElementById('fx');
    if (!cv) return false;
    g = cv.getContext('2d');
    resize();
    window.addEventListener('resize', resize);
    return true;
  }
  function resize() {
    var dpr = Math.min(2, window.devicePixelRatio || 1);
    W = window.innerWidth; H = window.innerHeight;
    cv.width = W * dpr; cv.height = H * dpr;
    cv.style.width = W + 'px'; cv.style.height = H + 'px';
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  function rnd(a, b) { return a + Math.random() * (b - a); }
  function pick(a) { return a[Math.floor(Math.random() * a.length)]; }
  function start() {
    if (running) return;
    running = true;
    requestAnimationFrame(loop);
  }
  function loop() {
    g.clearRect(0, 0, W, H);
    for (var i = parts.length - 1; i >= 0; i--) {
      var p = parts[i];
      p.life--;
      if (p.life <= 0 || p.y > H + 40) { parts.splice(i, 1); continue; }
      p.vy += p.grav; p.vx *= p.drag; p.vy *= p.drag;
      p.x += p.vx; p.y += p.vy; p.rot += p.vr;
      var a = Math.min(1, p.life / (p.max * 0.4));
      g.globalAlpha = a;
      g.fillStyle = p.color;
      if (p.shape === 'spark') {
        g.beginPath(); g.arc(p.x, p.y, p.size, 0, 6.3); g.fill();
      } else {
        g.save(); g.translate(p.x, p.y); g.rotate(p.rot);
        g.fillRect(-p.size, -p.size * 0.5, p.size * 2, p.size);
        g.restore();
      }
    }
    g.globalAlpha = 1;
    if (parts.length) requestAnimationFrame(loop); else { running = false; g.clearRect(0, 0, W, H); }
  }
  function add(p) { if (parts.length < 900) parts.push(p); }

  function burst(x, y, n, colors) {
    if (!setup()) return;
    colors = colors || PALETTE;
    for (var i = 0; i < n; i++) {
      var a = rnd(0, 6.283), s = rnd(2, 9);
      add({ x: x, y: y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 2, grav: 0.18, drag: 0.985,
            life: rnd(45, 90), max: 90, size: rnd(3, 6), rot: rnd(0, 6), vr: rnd(-0.3, 0.3),
            color: pick(colors), shape: 'rect' });
    }
    start();
  }
  function confetti(n) {
    if (!setup()) return;
    for (var i = 0; i < n; i++) {
      add({ x: rnd(0, W), y: rnd(-80, -10), vx: rnd(-1.5, 1.5), vy: rnd(2, 5), grav: 0.05, drag: 0.995,
            life: rnd(120, 230), max: 230, size: rnd(3, 7), rot: rnd(0, 6), vr: rnd(-0.25, 0.25),
            color: pick(PALETTE), shape: 'rect' });
    }
    start();
  }
  function firework(x, y) {
    if (!setup()) return;
    var col = pick(PALETTE), col2 = pick(PALETTE);
    for (var i = 0; i < 70; i++) {
      var a = (i / 70) * 6.283, s = rnd(3, 7);
      add({ x: x, y: y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, grav: 0.07, drag: 0.972,
            life: rnd(50, 80), max: 80, size: rnd(1.6, 3), rot: 0, vr: 0,
            color: i % 3 ? col : col2, shape: 'spark' });
    }
    start();
    sound('react');
  }
  function fireworks(n, span) {
    if (!setup()) return;
    for (var i = 0; i < n; i++) {
      (function (k) {
        setTimeout(function () { firework(rnd(W * 0.15, W * 0.85), rnd(H * 0.12, H * 0.5)); }, k * (span || 350));
      })(i);
    }
  }

  /* ---------- Bannière, tremblement, réactions ---------- */
  var bannerTimer = null;
  function banner(title, sub, tone) {
    var b = document.getElementById('banner');
    if (!b) return;
    b.className = '';
    b.innerHTML = '<div class="bn-t"></div><div class="bn-s"></div>';
    b.firstChild.textContent = title;
    b.lastChild.textContent = sub || '';
    void b.offsetWidth;
    b.className = 'show ' + (tone || 'yellow');
    clearTimeout(bannerTimer);
    bannerTimer = setTimeout(function () { b.className = ''; }, 2100);
  }
  function shake() {
    document.body.classList.remove('shake');
    void document.body.offsetWidth;
    document.body.classList.add('shake');
    setTimeout(function () { document.body.classList.remove('shake'); }, 500);
  }
  function react(emoji, name) {
    var box = document.getElementById('reacts');
    if (!box) return;
    var el = document.createElement('div');
    el.className = 'react';
    el.style.left = rnd(10, 80) + '%';
    var e = document.createElement('div'); e.className = 'r-e'; e.textContent = emoji;
    var n = document.createElement('div'); n.className = 'r-n'; n.textContent = name || '';
    el.appendChild(e); el.appendChild(n);
    box.appendChild(el);
    setTimeout(function () { el.remove(); }, 2800);
    sound('react');
  }

  return {
    sound: sound, isMuted: isMuted, toggleMute: toggleMute, vibrate: vibrate,
    burst: burst, confetti: confetti, firework: firework, fireworks: fireworks,
    banner: banner, shake: shake, react: react
  };
})();
