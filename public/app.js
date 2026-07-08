/* ============================================================
   声音志 · Sound Journal
   Frontend Logic · 原生 ES6+
   ============================================================ */

const AUDIO_BASE = 'https://audio.ainovalife.com/';

/* ----- helpers ----- */
const $  = (s, p = document) => p.querySelector(s);
const $$ = (s, p = document) => [...p.querySelectorAll(s)];

function toKanjiNum(n) {
  const k = ['〇','一','二','三','四','五','六','七','八','九'];
  if (n < 11) return k[n];
  if (n < 20) return n === 10 ? '十' : '十' + k[n - 10];
  if (n < 100) {
    const t = Math.floor(n / 10), o = n % 10;
    return k[t] + '十' + (o ? k[o] : '');
  }
  return String(n);
}

function toRomanNum(n) {
  if (n < 1) return '—';
  const map = [['M',1000],['CM',900],['D',500],['CD',400],['C',100],
               ['XC',90],['L',50],['XL',40],['X',10],['IX',9],
               ['V',5],['IV',4],['I',1]];
  let r = '';
  for (const [l, v] of map) { while (n >= v) { r += l; n -= v; } }
  return r;
}

function fmtTime(s) {
  if (!isFinite(s) || s < 0) return '0:00';
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60).toString().padStart(2, '0');
  return `${m}:${sec}`;
}

function fmtDate(s) {
  const d = new Date(s);
  if (isNaN(d)) return s;
  return `${d.getFullYear()} · ${String(d.getMonth()+1).padStart(2,'0')} · ${String(d.getDate()).padStart(2,'0')}`;
}

/* ============================================================
   STATE
   ============================================================ */
const state = {
  songs: [],
  currentIdx: -1,
  audio: null,
  isPlaying: false,
  audioCtx: null,
  analyser: null,
  source: null,
  dataArray: null,
  vizRaf: null,
};

/* ============================================================
   AMBIENT CANVAS — subtle dust particles
   ============================================================ */
class AmbientCanvas {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.particles = [];
    this.resize();
    this.initParticles();
    this.animate();
    window.addEventListener('resize', () => { this.resize(); this.initParticles(); });
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio, 2);
    this.canvas.width = window.innerWidth * dpr;
    this.canvas.height = window.innerHeight * dpr;
    this.ctx.scale(dpr, dpr);
    this.w = window.innerWidth;
    this.h = window.innerHeight;
  }

  initParticles() {
    const count = Math.floor((this.w * this.h) / 25000);
    this.particles = [];
    const isDark = document.documentElement.dataset.theme === 'dark';
    for (let i = 0; i < count; i++) {
      this.particles.push({
        x: Math.random() * this.w,
        y: Math.random() * this.h,
        vx: (Math.random() - 0.5) * 0.15,
        vy: (Math.random() - 0.5) * 0.15 - 0.05,
        r: Math.random() * 1.5 + 0.5,
        opacity: Math.random() * 0.15 + 0.05,
        color: isDark ? '232,227,211' : '26,22,18',
      });
    }
  }

  animate() {
    this.ctx.clearRect(0, 0, this.w, this.h);
    const isDark = document.documentElement.dataset.theme === 'dark';
    const targetColor = isDark ? '232,227,211' : '26,22,18';

    for (const p of this.particles) {
      p.x += p.vx;
      p.y += p.vy;
      if (p.x < -10) p.x = this.w + 10;
      if (p.x > this.w + 10) p.x = -10;
      if (p.y < -10) p.y = this.h + 10;
      if (p.y > this.h + 10) p.y = -10;
      p.color = targetColor;

      this.ctx.beginPath();
      this.ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      this.ctx.fillStyle = `rgba(${p.color},${p.opacity})`;
      this.ctx.fill();
    }

    // connect nearby particles
    for (let i = 0; i < this.particles.length; i++) {
      for (let j = i + 1; j < this.particles.length; j++) {
        const dx = this.particles[i].x - this.particles[j].x;
        const dy = this.particles[i].y - this.particles[j].y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < 120) {
          this.ctx.beginPath();
          this.ctx.moveTo(this.particles[i].x, this.particles[i].y);
          this.ctx.lineTo(this.particles[j].x, this.particles[j].y);
          this.ctx.strokeStyle = `rgba(${this.particles[i].color},${0.03 * (1 - dist / 120)})`;
          this.ctx.lineWidth = 0.5;
          this.ctx.stroke();
        }
      }
    }

    requestAnimationFrame(() => this.animate());
  }
}

/* ============================================================
   AUDIO VISUALIZER
   ============================================================ */
function initAudioContext() {
  if (state.audioCtx) return;
  state.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  state.analyser = state.audioCtx.createAnalyser();
  state.analyser.fftSize = 256;
  state.analyser.smoothingTimeConstant = 0.85;
  state.dataArray = new Uint8Array(state.analyser.frequencyBinCount);
}

function connectAudioSource() {
  if (!state.audioCtx || !state.audio || state.source) return;
  try {
    state.source = state.audioCtx.createMediaElementSource(state.audio);
    state.source.connect(state.analyser);
    state.analyser.connect(state.audioCtx.destination);
  } catch (e) {
    // already connected or cross-origin issue
    console.warn('Audio viz connection failed:', e);
  }
}

function drawVisualizer(canvas, type = 'spectrum', intensity = 1) {
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const dpr = Math.min(window.devicePixelRatio, 2);
  const rect = canvas.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return;

  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  ctx.scale(dpr, dpr);

  const w = rect.width;
  const h = rect.height;
  const isDark = document.documentElement.dataset.theme === 'dark';
  const shu = isDark ? '#c25141' : '#a8341c';
  const sumi = isDark ? 'rgba(232,227,211,' : 'rgba(26,22,18,';

  let data = null;
  if (state.analyser && state.isPlaying) {
    state.analyser.getByteFrequencyData(state.dataArray);
    data = state.dataArray;
  }

  ctx.clearRect(0, 0, w, h);

  if (type === 'spectrum') {
    const barCount = Math.min(64, data ? data.length : 32);
    const gap = 2;
    const barW = (w - gap * (barCount - 1)) / barCount;

    for (let i = 0; i < barCount; i++) {
      let value = 0;
      if (data) {
        const idx = Math.floor(i * data.length / barCount);
        value = data[idx] / 255;
      } else if (state.isPlaying) {
        // fallback simulated waveform
        const t = Date.now() / 1000;
        value = (Math.sin(t * 3 + i * 0.5) * 0.3 + 0.3) * intensity;
      }
      const barH = value * h * 0.85;
      const x = i * (barW + gap);
      const y = h - barH;

      const grad = ctx.createLinearGradient(0, h, 0, y);
      grad.addColorStop(0, shu);
      grad.addColorStop(1, sumi + '0.3)');
      ctx.fillStyle = grad;
      ctx.fillRect(x, y, barW, barH);
    }
  } else if (type === 'wave') {
    ctx.beginPath();
    const points = 120;
    for (let i = 0; i <= points; i++) {
      const x = (i / points) * w;
      let y = h / 2;
      if (data && state.isPlaying) {
        const idx = Math.floor(i * data.length / points);
        y += (data[idx] / 255 - 0.5) * h * 0.8 * intensity;
      } else if (state.isPlaying) {
        const t = Date.now() / 1000;
        y += Math.sin(t * 2 + i * 0.3) * h * 0.15 * intensity;
      }
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = shu;
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // glow
    ctx.save();
    ctx.globalAlpha = 0.15;
    ctx.lineWidth = 8;
    ctx.stroke();
    ctx.restore();
  } else if (type === 'mini') {
    // subtle waveform for mini player
    const points = 60;
    for (let line = 0; line < 3; line++) {
      ctx.beginPath();
      for (let i = 0; i <= points; i++) {
        const x = (i / points) * w;
        let y = h / 2;
        if (data && state.isPlaying) {
          const idx = Math.floor(i * data.length / points);
          const v = (data[idx] / 255) * (1 - line * 0.25);
          y += (v - 0.3) * h * 0.6;
        } else if (state.isPlaying) {
          const t = Date.now() / 1000 + line;
          y += Math.sin(t * 2.5 + i * 0.4) * h * 0.2 * (1 - line * 0.2);
        }
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = line === 0 ? shu : sumi + (0.1 - line * 0.03) + ')';
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }
}

/* ============================================================
   COVER GENERATOR
   ============================================================ */

/* Unsplash 氛围图映射 */
const UNSPLASH_COVERS = {
  warm: 'https://images.unsplash.com/photo-1522383225653-ed111181a951?w=600&q=80',
  fire: 'https://images.unsplash.com/photo-1536098561742-ca998e48cbcc?w=600&q=80',
};

/* SVG fallback — 程序生成抽象封面 */
function generateSVGCover(theme, title) {
  const seed = title.split('').reduce((a, c) => a + c.charCodeAt(0), 0);
  const rng = (n = 1) => {
    const x = Math.sin(seed + n) * 10000;
    return x - Math.floor(x);
  };

  let svg = '';
  if (theme === 'warm') {
    const circles = [];
    for (let i = 0; i < 5; i++) {
      const r = 60 + i * 35 + rng(i) * 20;
      const opacity = 0.06 + rng(i + 10) * 0.08;
      circles.push(`<circle cx="200" cy="200" r="${r}" fill="none" stroke="#a8341c" stroke-width="1" opacity="${opacity}"/>`);
    }
    const waves = [];
    for (let i = 0; i < 6; i++) {
      let d = '';
      const yBase = 120 + i * 32;
      const amp = 15 + rng(i + 20) * 20;
      const freq = 0.012 + rng(i + 30) * 0.008;
      for (let x = 0; x <= 400; x += 4) {
        const y = yBase + Math.sin(x * freq + i * 0.9) * amp + Math.cos(x * freq * 1.7) * (amp * 0.4);
        d += (x === 0 ? 'M' : 'L') + `${x},${y.toFixed(1)}`;
      }
      waves.push(`<path d="${d}" fill="none" stroke="#1a1612" stroke-width="1" opacity="${0.04 + i * 0.015}"/>`);
    }
    svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400">
      <defs><radialGradient id="g" cx="50%" cy="50%" r="70%"><stop offset="0%" stop-color="#ede4d4"/><stop offset="50%" stop-color="#e0d4c0"/><stop offset="100%" stop-color="#d4c4b0"/></radialGradient></defs>
      <rect width="400" height="400" fill="url(#g)"/>${circles.join('')}${waves.join('')}<circle cx="200" cy="200" r="4" fill="#a8341c" opacity="0.3"/></svg>`;
  } else if (theme === 'fire') {
    const rays = [];
    for (let i = 0; i < 24; i++) {
      const angle = (i / 24) * Math.PI * 2 + rng(i) * 0.3;
      const len = 140 + rng(i + 10) * 80;
      const x1 = 200 + Math.cos(angle) * 40;
      const y1 = 200 + Math.sin(angle) * 40;
      const x2 = 200 + Math.cos(angle) * len;
      const y2 = 200 + Math.sin(angle) * len;
      const opacity = 0.08 + rng(i + 20) * 0.18;
      rays.push(`<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="#c25141" stroke-width="1.5" opacity="${opacity}"/>`);
    }
    const rings = [];
    for (let i = 0; i < 3; i++) {
      const r = 50 + i * 30;
      rings.push(`<circle cx="200" cy="200" r="${r}" fill="none" stroke="#e8e3d3" stroke-width="0.5" opacity="0.1"/>`);
    }
    svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400">
      <defs><linearGradient id="g2" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="#2a2018"/><stop offset="50%" stop-color="#1a1410"/><stop offset="100%" stop-color="#3a2820"/></linearGradient></defs>
      <rect width="400" height="400" fill="url(#g2)"/>${rings.join('')}${rays.join('')}<circle cx="200" cy="200" r="20" fill="#c25141" opacity="0.25"/><circle cx="200" cy="200" r="8" fill="#a8341c" opacity="0.5"/></svg>`;
  } else {
    svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400"><rect width="400" height="400" fill="#e8e0d0"/><circle cx="200" cy="200" r="100" fill="none" stroke="#1a1612" stroke-width="0.5" opacity="0.1"/><circle cx="200" cy="200" r="60" fill="none" stroke="#a8341c" stroke-width="0.5" opacity="0.15"/><circle cx="200" cy="200" r="4" fill="#a8341c" opacity="0.3"/></svg>`;
  }

  return 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svg)));
}

function getCoverURL(theme) {
  return UNSPLASH_COVERS[theme] || UNSPLASH_COVERS.warm;
}

/* ============================================================
   LOAD & RENDER
   ============================================================ */
async function loadSongs() {
  try {
    const res = await fetch('songs.json', { cache: 'no-cache' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    state.songs = await res.json();
    renderSongs();
  } catch (e) {
    console.error('Failed to load songs:', e);
    $('#song-list').innerHTML =
      '<div class="error">曲目載入失敗 · Tracks unavailable</div>';
  }
}

function renderSongs() {
  const list = $('#song-list');
  list.innerHTML = '';

  const roman = toRomanNum(state.songs.length);
  $('#track-count').textContent = roman;

  state.songs.forEach((song, idx) => {
    if (idx === 0) {
      const sec = $('#section-template').content.cloneNode(true);
      sec.querySelector('.track-section-num').textContent = toRomanNum(1);
      sec.querySelector('.track-section-title').textContent = '最新曲目 · LATEST RELEASES';
      sec.querySelector('.track-section-romaji').textContent = 'The most recent recordings';
      list.appendChild(sec);
    }

    const tpl = $('#song-template').content.cloneNode(true);
    const el = tpl.querySelector('.track');
    el.dataset.id = song.id;
    el.dataset.idx = idx;

    el.querySelector('.track-no-roman').textContent = `№ ${toRomanNum(idx + 1)}`;
    el.querySelector('.track-no-kanji').textContent = `第${toKanjiNum(idx + 1)}曲`;
    el.querySelector('.track-title').textContent = song.title;
    el.querySelector('.track-subtitle').textContent = song.subtitle || '';
    el.querySelector('.track-style').textContent = song.style;
    el.querySelector('.track-date').textContent = fmtDate(song.date);
    el.querySelector('.track-len').textContent = song.duration;
    el.querySelector('.track-desc').textContent = song.description || '';

    if (song.lyrics) {
      const lyricInner = el.querySelector('.lyric-inner');
      lyricInner.textContent = song.lyrics.trim();
    }

    /* generate cover — Unsplash first, SVG fallback */
    const coverImg = el.querySelector('.track-cover');
    const svgFallback = generateSVGCover(song.theme || 'warm', song.title);
    coverImg.onerror = () => { coverImg.src = svgFallback; };
    coverImg.src = getCoverURL(song.theme || 'warm');

    const playerBtn = el.querySelector('.player-btn');
    playerBtn.addEventListener('click', (ev) => { ev.stopPropagation(); togglePlay(idx); });

    const barWrap = el.querySelector('.player-bar-wrap');
    barWrap.addEventListener('click', (ev) => seek(ev, idx));

    const lyricToggle = el.querySelector('.lyric-toggle');
    const lyric = el.querySelector('.lyric');
    lyricToggle.addEventListener('click', () => {
      const open = lyric.hasAttribute('hidden');
      if (open) {
        lyric.removeAttribute('hidden');
        lyricToggle.setAttribute('aria-expanded', 'true');
        lyricToggle.querySelector('.lyric-toggle-text').textContent = '收起詩詞 · Hide Lyrics';
      } else {
        lyric.setAttribute('hidden', '');
        lyricToggle.setAttribute('aria-expanded', 'false');
        lyricToggle.querySelector('.lyric-toggle-text').textContent = '展開詩詞 · View Lyrics';
      }
    });

    list.appendChild(el);
  });

  $('#mini-btn').addEventListener('click', () => {
    if (state.currentIdx >= 0) togglePlay(state.currentIdx);
  });
  $('#mini-player .mini-bar-wrap').addEventListener('click', (ev) => {
    if (state.currentIdx >= 0) seek(ev, state.currentIdx);
  });

  // scroll animation observer
  const observer = new IntersectionObserver((entries) => {
    entries.forEach(e => {
      if (e.isIntersecting) {
        e.target.classList.add('in');
        observer.unobserve(e.target);
      }
    });
  }, { threshold: 0.06, rootMargin: '0px 0px -60px 0px' });

  $$('.track').forEach(t => observer.observe(t));

  // about section observer
  const aboutObserver = new IntersectionObserver((entries) => {
    entries.forEach(e => {
      if (e.isIntersecting) {
        e.target.classList.add('in');
        aboutObserver.unobserve(e.target);
      }
    });
  }, { threshold: 0.2 });
  const about = $('.about');
  if (about) aboutObserver.observe(about);
}

/* ============================================================
   PLAYER
   ============================================================ */
function togglePlay(idx) {
  const song = state.songs[idx];
  if (!song) return;

  // resume audio context if suspended
  if (state.audioCtx && state.audioCtx.state === 'suspended') {
    state.audioCtx.resume();
  }

  if (state.audio && state.currentIdx === idx) {
    if (state.audio.paused) {
      state.audio.play().catch(e => console.error(e));
      state.isPlaying = true;
      startVizLoop();
    } else {
      state.audio.pause();
      state.isPlaying = false;
      stopVizLoop();
    }
    updatePlayUI();
    return;
  }

  if (state.audio) {
    state.audio.pause();
    state.audio.removeEventListener('timeupdate', onTimeUpdate);
    state.audio.removeEventListener('ended', onEnded);
    state.audio.removeEventListener('loadedmetadata', onLoaded);
    state.audio.removeEventListener('error', onAudioError);
    if (state.source) {
      try { state.source.disconnect(); } catch(e) {}
      state.source = null;
    }
  }

  state.currentIdx = idx;
  state.audio = new Audio(AUDIO_BASE + song.file);
  state.audio.preload = 'metadata';
  state.audio.crossOrigin = 'anonymous';
  state.audio.addEventListener('timeupdate', onTimeUpdate);
  state.audio.addEventListener('ended', onEnded);
  state.audio.addEventListener('loadedmetadata', onLoaded);
  state.audio.addEventListener('error', onAudioError);

  state.audio.play().catch(e => {
    console.error('Play failed:', e);
    state.isPlaying = false;
    updatePlayUI();
  });
  state.isPlaying = true;

  // init audio context on first play
  initAudioContext();
  // connect after a short delay to ensure audio is ready
  setTimeout(connectAudioSource, 50);

  highlightCurrent();
  showMiniPlayer(song);
  updatePlayUI();
  startVizLoop();
}

function onLoaded() {
  if (!state.audio) return;
  const el = $(`[data-idx="${state.currentIdx}"]`);
  if (el) {
    el.querySelector('.player-time').textContent =
      `${fmtTime(0)} / ${fmtTime(state.audio.duration)}`;
  }
  $('#mini-time').textContent = `0:00 / ${fmtTime(state.audio.duration)}`;
}

function onTimeUpdate() {
  if (!state.audio || !isFinite(state.audio.duration) || state.audio.duration === 0) return;
  const pct = (state.audio.currentTime / state.audio.duration) * 100;
  const el = $(`[data-idx="${state.currentIdx}"]`);
  if (el) {
    el.querySelector('.player-bar-pos').style.width = pct + '%';
    el.querySelector('.player-bar-thumb').style.left = pct + '%';
    el.querySelector('.player-time').textContent =
      `${fmtTime(state.audio.currentTime)} / ${fmtTime(state.audio.duration)}`;
  }
  $('#mini-bar-pos').style.width = pct + '%';
  $('#mini-time').textContent =
    `${fmtTime(state.audio.currentTime)} / ${fmtTime(state.audio.duration)}`;
}

function onEnded() {
  state.isPlaying = false;
  updatePlayUI();
  stopVizLoop();
  if (state.currentIdx < state.songs.length - 1) {
    setTimeout(() => togglePlay(state.currentIdx + 1), 400);
  }
}

function onAudioError(e) {
  console.error('Audio error:', e);
  state.isPlaying = false;
  updatePlayUI();
  stopVizLoop();
}

function seek(ev, idx) {
  if (!state.audio || idx !== state.currentIdx) return;
  if (!isFinite(state.audio.duration)) return;
  const rect = ev.currentTarget.getBoundingClientRect();
  const x = ev.clientX - rect.left;
  const pct = Math.max(0, Math.min(1, x / rect.width));
  state.audio.currentTime = pct * state.audio.duration;
}

function updatePlayUI() {
  $$('.track').forEach(t => t.classList.remove('playing'));
  if (state.currentIdx >= 0) {
    const el = $(`[data-idx="${state.currentIdx}"]`);
    if (el) {
      el.classList.add('playing');
      el.querySelector('.player-btn').classList.toggle('on', state.isPlaying);
    }
  }
  $('#mini-btn').classList.toggle('on', state.isPlaying);
}

function highlightCurrent() {
  $$('.track').forEach(t => t.classList.remove('playing'));
  if (state.currentIdx >= 0) {
    const el = $(`[data-idx="${state.currentIdx}"]`);
    if (el) el.classList.add('playing');
  }
}

function showMiniPlayer(song) {
  const mp = $('#mini-player');
  mp.removeAttribute('hidden');
  requestAnimationFrame(() => { mp.dataset.show = 'true'; });
  $('#mini-num').textContent = `第${toKanjiNum(state.currentIdx + 1)}曲`;
  $('#mini-title').textContent = song.title;
}

/* ============================================================
   VISUALIZER LOOP
   ============================================================ */
const vizCanvases = new Map();

function registerViz(canvas, type, intensity = 1) {
  vizCanvases.set(canvas, { type, intensity });
}

function startVizLoop() {
  if (state.vizRaf) return;
  function loop() {
    if (!state.isPlaying) return;
    vizCanvases.forEach((config, canvas) => {
      drawVisualizer(canvas, config.type, config.intensity);
    });
    state.vizRaf = requestAnimationFrame(loop);
  }
  loop();
}

function stopVizLoop() {
  if (state.vizRaf) {
    cancelAnimationFrame(state.vizRaf);
    state.vizRaf = null;
  }
  // clear all canvases
  vizCanvases.forEach((config, canvas) => {
    const ctx = canvas.getContext('2d');
    const rect = canvas.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
  });
}

/* ============================================================
   HERO VIZ — subtle ambient wave
   ============================================================ */
function initHeroViz() {
  const canvas = $('#hero-viz');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const dpr = Math.min(window.devicePixelRatio, 2);

  function resize() {
    const parent = canvas.parentElement;
    const w = parent.offsetWidth;
    const h = parent.offsetHeight;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    ctx.scale(dpr, dpr);
    canvas._w = w;
    canvas._h = h;
  }
  resize();
  window.addEventListener('resize', resize);

  function draw() {
    const w = canvas._w;
    const h = canvas._h;
    if (!w || !h) { requestAnimationFrame(draw); return; }

    ctx.clearRect(0, 0, w, h);
    const isDark = document.documentElement.dataset.theme === 'dark';
    const color = isDark ? '194,81,65' : '168,52,28';

    const t = Date.now() / 1000;
    for (let line = 0; line < 5; line++) {
      ctx.beginPath();
      for (let x = 0; x <= w; x += 2) {
        const freq = 0.003 + line * 0.001;
        const amp = 20 + line * 8;
        const speed = 0.3 + line * 0.1;
        const y = h / 2 + Math.sin(x * freq + t * speed) * amp
                      + Math.sin(x * freq * 2.3 + t * speed * 1.5) * (amp * 0.3);
        if (x === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = `rgba(${color},${0.04 - line * 0.006})`;
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    requestAnimationFrame(draw);
  }
  draw();
}

/* ============================================================
   THEME
   ============================================================ */
function setupTheme() {
  const saved = localStorage.getItem('sj-theme');
  const initial = saved || 'dark';
  document.documentElement.dataset.theme = initial;

  $('#theme-toggle').addEventListener('click', () => {
    const cur = document.documentElement.dataset.theme;
    const next = cur === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    localStorage.setItem('sj-theme', next);
  });
}

/* ============================================================
   NAV SCROLL + SCROLL INDICATOR
   ============================================================ */
function setupNavScroll() {
  const nav = $('nav.nav');
  const scrollProgress = $('.scroll-indicator-progress');
  let ticking = false;
  window.addEventListener('scroll', () => {
    if (!ticking) {
      requestAnimationFrame(() => {
        nav.classList.toggle('scrolled', window.scrollY > 40);
        if (scrollProgress) {
          const h = document.documentElement.scrollHeight - window.innerHeight;
          const pct = h > 0 ? (window.scrollY / h) * 100 : 0;
          scrollProgress.style.height = pct + '%';
        }
        ticking = false;
      });
      ticking = true;
    }
  }, { passive: true });
}

/* ============================================================
   CLOCK
   ============================================================ */
function updateNavTime() {
  const now = new Date();
  const h = String(now.getHours()).padStart(2, '0');
  const m = String(now.getMinutes()).padStart(2, '0');
  $('#nav-time').textContent = `SHENZHEN · ${h}:${m}`;
}

/* ============================================================
   KEYBOARD
   ============================================================ */
function setupKeyboard() {
  document.addEventListener('keydown', (e) => {
    if (e.target.matches('input, textarea, [contenteditable]')) return;
    if (e.code === 'Space' && state.currentIdx >= 0) {
      e.preventDefault();
      togglePlay(state.currentIdx);
    }
  });
}

/* ============================================================
   CURSOR GLOW
   ============================================================ */
function setupCursorGlow() {
  const glow = $('#cursor-glow');
  if (!glow) return;
  let gx = 50, gy = 50;
  let targetGx = 50, targetGy = 50;
  let raf = null;

  document.addEventListener('mousemove', (e) => {
    targetGx = (e.clientX / window.innerWidth) * 100;
    targetGy = (e.clientY / window.innerHeight) * 100;
    if (!raf) {
      raf = requestAnimationFrame(() => {
        gx += (targetGx - gx) * 0.12;
        gy += (targetGy - gy) * 0.12;
        glow.style.setProperty('--gx', gx + '%');
        glow.style.setProperty('--gy', gy + '%');
        raf = null;
      });
    }
  }, { passive: true });
}

/* ============================================================
   INIT
   ============================================================ */
document.addEventListener('DOMContentLoaded', () => {
  setupTheme();
  updateNavTime();
  setInterval(updateNavTime, 30000);
  setupNavScroll();
  setupKeyboard();
  setupCursorGlow();
  loadSongs();

  // ambient particles
  new AmbientCanvas($('#ambient-canvas'));

  // hero viz
  initHeroViz();

  // register track viz canvases after render
  const checkCanvases = setInterval(() => {
    $$('.track-viz').forEach((canvas, i) => {
      if (!vizCanvases.has(canvas)) {
        registerViz(canvas, 'spectrum', 0.7);
      }
    });
    const miniViz = $('#mini-viz');
    if (miniViz && !vizCanvases.has(miniViz)) {
      registerViz(miniViz, 'mini', 0.5);
    }
    if ($$('.track-viz').length > 0) {
      clearInterval(checkCanvases);
    }
  }, 200);
});
