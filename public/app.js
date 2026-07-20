/* ============================================================
   声音志 · Sound Journal — 交互引擎
   粒子声场 / Web Audio 可视化 / 唱片播放器
   ============================================================ */

const AUDIO_BASE = 'https://audio.ainovalife.com/';

const $  = (s, p = document) => p.querySelector(s);
const $$ = (s, p = document) => [...p.querySelectorAll(s)];

const REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const FINE_POINTER = window.matchMedia('(hover: hover) and (pointer: fine)').matches;

/* 主题色谱：fire 炽 / warm 暖 */
const ACCENTS = {
  fire: { hex: '#ff5a36', rgb: [255, 90, 54] },
  warm: { hex: '#e6a550', rgb: [230, 165, 80] },
};
const DEFAULT_COVERS = {
  fire: 'https://images.unsplash.com/photo-1536098561742-ca998e48cbcc?w=600&q=80',
  warm: 'https://images.unsplash.com/photo-1522383225653-ed111181a951?w=600&q=80',
};
const accentOf = song => ACCENTS[song.theme] || ACCENTS.fire;
const coverOf  = song => song.coverImage || DEFAULT_COVERS[song.theme] || DEFAULT_COVERS.fire;

function fmtTime(s) {
  if (!isFinite(s) || s < 0) return '0:00';
  const m = Math.floor(s / 60);
  return `${m}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
}

function fmtDate(s) {
  const d = new Date(s);
  if (isNaN(d)) return s;
  return `${d.getFullYear()} · ${String(d.getMonth() + 1).padStart(2, '0')} · ${String(d.getDate()).padStart(2, '0')}`;
}

/* ============================================================
   STATE
   ============================================================ */
const state = {
  songs: [],
  currentIdx: -1,
  isPlaying: false,
  accent: ACCENTS.fire,
  audio: new Audio(),
  audioCtx: null,
  analyser: null,
  freqData: null,
  energy: 0,        // 平滑后的低频能量 0..1
};
state.audio.crossOrigin = 'anonymous';
state.audio.preload = 'metadata';

const RING_LEN = 2 * Math.PI * 48.5; // track-progress 圆周

/* ============================================================
   氛围背景 — 极光流体
   ============================================================ */
class Aurora {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    canvas.width = 192;
    canvas.height = 108;
    this.t = Math.random() * 100;
    this.blobs = [
      { x: 0.25, y: 0.3, r: 0.5, sp: 0.00021, ph: 0.0, mix: 0.9 },
      { x: 0.75, y: 0.6, r: 0.55, sp: 0.00016, ph: 2.1, mix: 0.55 },
      { x: 0.5, y: 0.85, r: 0.45, sp: 0.00026, ph: 4.2, mix: 0.4 },
      { x: 0.6, y: 0.15, r: 0.4, sp: 0.00012, ph: 5.6, mix: 0.3 },
    ];
  }
  draw(dt) {
    this.t += dt;
    const { ctx, canvas } = this;
    const w = canvas.width, h = canvas.height;
    ctx.clearRect(0, 0, w, h);
    const [ar, ag, ab] = state.accent.rgb;
    for (const b of this.blobs) {
      const x = (b.x + Math.sin(this.t * b.sp + b.ph) * 0.18) * w;
      const y = (b.y + Math.cos(this.t * b.sp * 1.3 + b.ph) * 0.15) * h;
      const r = b.r * w * (1 + Math.sin(this.t * b.sp * 2 + b.ph) * 0.12);
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      const cr = Math.round(ar * b.mix + 20 * (1 - b.mix));
      const cg = Math.round(ag * b.mix + 24 * (1 - b.mix));
      const cb = Math.round(ab * b.mix + 58 * (1 - b.mix));
      g.addColorStop(0, `rgba(${cr},${cg},${cb},0.55)`);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
    }
  }
}

/* ============================================================
   Hero — 3D 粒子声场球
   ============================================================ */
class Sphere {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.rotY = 0;
    this.rotX = 0.35;
    this.mouseRX = 0;
    this.mouseRY = 0;
    this.targetMRX = 0;
    this.targetMRY = 0;
    this.pulse = 0;
    this.points = [];
    const N = 750;
    const golden = Math.PI * (3 - Math.sqrt(5));
    for (let i = 0; i < N; i++) {
      const y = 1 - (i / (N - 1)) * 2;
      const rad = Math.sqrt(1 - y * y);
      const th = golden * i;
      this.points.push({
        x: Math.cos(th) * rad, y, z: Math.sin(th) * rad,
        mix: Math.random(),           // 白 ↔ 强调色 混合比
        tw: Math.random() * Math.PI * 2, // 闪烁相位
      });
    }
    this.resize();
    if (FINE_POINTER) {
      window.addEventListener('pointermove', e => {
        this.targetMRY = (e.clientX / window.innerWidth - 0.5) * 0.6;
        this.targetMRX = (e.clientY / window.innerHeight - 0.5) * 0.4;
      });
    }
  }
  resize() {
    const rect = this.canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.max(1, rect.width * dpr);
    this.canvas.height = Math.max(1, rect.height * dpr);
    this.dpr = dpr;
    this.w = rect.width;
    this.h = rect.height;
  }
  draw(dt) {
    const { ctx } = this;
    const e = state.energy;
    this.pulse += (e - this.pulse) * 0.08;
    this.rotY += dt * 0.00016 * (1 + this.pulse * 1.6);
    this.mouseRX += (this.targetMRX - this.mouseRX) * 0.04;
    this.mouseRY += (this.targetMRY - this.mouseRY) * 0.04;

    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.w, this.h);

    const cx = this.w / 2, cy = this.h / 2;
    const R = Math.min(this.w, this.h) * 0.34 * (1 + this.pulse * 0.22);
    const fov = 3.2;
    const cosY = Math.cos(this.rotY + this.mouseRY), sinY = Math.sin(this.rotY + this.mouseRY);
    const cosX = Math.cos(this.rotX + this.mouseRX), sinX = Math.sin(this.rotX + this.mouseRX);
    const [ar, ag, ab] = state.accent.rgb;
    const now = performance.now() * 0.001;

    // 核心辉光
    const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, R * 1.4);
    glow.addColorStop(0, `rgba(${ar},${ag},${ab},${0.10 + this.pulse * 0.22})`);
    glow.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, this.w, this.h);

    // 粒子
    for (const p of this.points) {
      const x1 = p.x * cosY + p.z * sinY;
      const z1 = -p.x * sinY + p.z * cosY;
      const y2 = p.y * cosX - z1 * sinX;
      const z2 = p.y * sinX + z1 * cosX;
      const s = fov / (fov + z2);
      const px = cx + x1 * R * s;
      const py = cy + y2 * R * s;
      const depth = (s - 0.75) / 0.55; // 0..1
      if (depth <= 0) continue;
      const twinkle = 0.65 + 0.35 * Math.sin(now * 1.6 + p.tw);
      const alpha = Math.min(1, depth * 0.85 * twinkle + this.pulse * 0.25);
      const size = Math.max(0.4, depth * 1.9 * (1 + this.pulse * 0.9));
      const rr = Math.round(236 + (ar - 236) * p.mix);
      const gg = Math.round(231 + (ag - 231) * p.mix);
      const bb = Math.round(221 + (ab - 221) * p.mix);
      ctx.fillStyle = `rgba(${rr},${gg},${bb},${alpha})`;
      ctx.beginPath();
      ctx.arc(px, py, size, 0, 6.2832);
      ctx.fill();
    }

    // 环绕声谱环
    const ringR = R * 1.28;
    const bars = 96;
    ctx.lineWidth = 1.4;
    for (let i = 0; i < bars; i++) {
      const a = (i / bars) * Math.PI * 2 + this.rotY * 0.5;
      let v;
      if (state.analyser && state.freqData) {
        v = state.freqData[Math.floor((i / bars) * state.freqData.length * 0.7)] / 255;
      } else {
        v = 0.08 + 0.05 * Math.sin(now * 1.2 + i * 0.5);
      }
      const len = 4 + v * R * 0.22;
      const x1 = cx + Math.cos(a) * ringR, y1 = cy + Math.sin(a) * ringR;
      const x2 = cx + Math.cos(a) * (ringR + len), y2 = cy + Math.sin(a) * (ringR + len);
      ctx.strokeStyle = `rgba(${ar},${ag},${ab},${0.15 + v * 0.75})`;
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
    }
  }
}

/* ============================================================
   唱片环形频谱
   ============================================================ */
class DiscViz {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
  }
  resize() {
    const rect = this.canvas.getBoundingClientRect();
    if (!rect.width) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = rect.width * dpr;
    this.canvas.height = rect.height * dpr;
    this.dpr = dpr;
    this.w = rect.width;
    this.h = rect.height;
  }
  draw(active) {
    const { ctx } = this;
    if (!this.w) this.resize();
    if (!this.w) return;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.w, this.h);
    const cx = this.w / 2, cy = this.h / 2;
    const base = Math.min(this.w, this.h) * 0.415;
    const [ar, ag, ab] = state.accent.rgb;
    const bars = 72;
    const now = performance.now() * 0.001;
    for (let i = 0; i < bars; i++) {
      const a = (i / bars) * Math.PI * 2 - Math.PI / 2;
      let v;
      if (active && state.analyser && state.freqData && state.isPlaying) {
        v = state.freqData[Math.floor((i / bars) * state.freqData.length * 0.72)] / 255;
      } else {
        v = 0.05 + 0.03 * Math.sin(now + i * 0.6);
      }
      const len = 3 + v * base * 0.42;
      ctx.strokeStyle = `rgba(${ar},${ag},${ab},${0.12 + v * 0.85})`;
      ctx.lineWidth = 2;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * base, cy + Math.sin(a) * base);
      ctx.lineTo(cx + Math.cos(a) * (base + len), cy + Math.sin(a) * (base + len));
      ctx.stroke();
    }
  }
  clear() {
    if (!this.w) return;
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.ctx.clearRect(0, 0, this.w, this.h);
  }
}

/* ============================================================
   自定义光标
   ============================================================ */
function initCursor() {
  if (!FINE_POINTER || REDUCED) return;
  const wrap = $('#cursor');
  const dot = $('.cursor-dot', wrap);
  const ring = $('.cursor-ring', wrap);
  let x = -100, y = -100, rx = -100, ry = -100;
  window.addEventListener('pointermove', e => {
    x = e.clientX; y = e.clientY;
    dot.style.transform = `translate(${x}px,${y}px) translate(-50%,-50%)`;
  });
  (function follow() {
    rx += (x - rx) * 0.16;
    ry += (y - ry) * 0.16;
    ring.style.transform = `translate(${rx}px,${ry}px) translate(-50%,-50%)`;
    requestAnimationFrame(follow);
  })();
  document.addEventListener('mouseover', e => {
    if (e.target.closest('[data-cursor], a, button')) wrap.classList.add('is-hover');
  });
  document.addEventListener('mouseout', e => {
    if (e.target.closest('[data-cursor], a, button')) wrap.classList.remove('is-hover');
  });
  window.addEventListener('pointerdown', () => wrap.classList.add('is-down'));
  window.addEventListener('pointerup', () => wrap.classList.remove('is-down'));
}

/* ============================================================
   磁吸按钮
   ============================================================ */
function initMagnetic() {
  if (!FINE_POINTER || REDUCED) return;
  $$('.magnetic').forEach(el => {
    el.addEventListener('pointermove', e => {
      const r = el.getBoundingClientRect();
      const dx = e.clientX - (r.left + r.width / 2);
      const dy = e.clientY - (r.top + r.height / 2);
      el.style.transform = `translate(${dx * 0.18}px, ${dy * 0.28}px)`;
    });
    el.addEventListener('pointerleave', () => { el.style.transform = ''; });
  });
}

/* ============================================================
   音频引擎
   ============================================================ */
function ensureAudioGraph() {
  if (state.audioCtx) return;
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    state.audioCtx = new Ctx();
    const src = state.audioCtx.createMediaElementSource(state.audio);
    state.analyser = state.audioCtx.createAnalyser();
    state.analyser.fftSize = 512;
    state.analyser.smoothingTimeConstant = 0.82;
    src.connect(state.analyser);
    state.analyser.connect(state.audioCtx.destination);
    state.freqData = new Uint8Array(state.analyser.frequencyBinCount);
  } catch (_) {
    state.analyser = null;
    state.freqData = null;
  }
}

function updateAccent(song) {
  state.accent = accentOf(song);
  const root = document.documentElement.style;
  root.setProperty('--accent', state.accent.hex);
  const [r, g, b] = state.accent.rgb;
  root.setProperty('--accent-soft', `rgba(${r},${g},${b},0.16)`);
}

const trackRefs = []; // { el, viz, progressFg, song }

function setTrackUI(idx, playing) {
  trackRefs.forEach((ref, i) => {
    ref.el.classList.toggle('is-active', i === idx);
    ref.el.classList.toggle('is-playing', i === idx && playing);
  });
  const bar = $('#player-bar');
  bar.classList.toggle('is-playing', playing);
  if (idx < 0) return;
  const song = state.songs[idx];
  $('#pb-title').textContent = song.title;
  $('#pb-sub').textContent = `${song.style} · ${song.subtitle || ''}`;
  $('#pb-cover').src = coverOf(song);
}

function playTrack(idx) {
  const song = state.songs[idx];
  if (!song) return;
  ensureAudioGraph();
  if (state.audioCtx && state.audioCtx.state === 'suspended') state.audioCtx.resume();

  if (state.currentIdx !== idx) {
    state.currentIdx = idx;
    state.audio.src = AUDIO_BASE + song.file;
    updateAccent(song);
    if ('mediaSession' in navigator) {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: song.title,
        artist: song.artist || 'James',
        album: '声音志',
        artwork: [{ src: coverOf(song), sizes: '600x600', type: 'image/jpeg' }],
      });
    }
  }
  state.audio.play().then(() => {
    state.isPlaying = true;
    setTrackUI(idx, true);
    showPlayerBar();
  }).catch(() => {});
}

function pauseTrack() {
  state.audio.pause();
  state.isPlaying = false;
  setTrackUI(state.currentIdx, false);
}

function toggleTrack(idx) {
  if (state.currentIdx === idx && state.isPlaying) pauseTrack();
  else playTrack(idx);
}

function showPlayerBar() {
  const bar = $('#player-bar');
  if (bar.hidden) {
    bar.hidden = false;
    requestAnimationFrame(() => bar.classList.add('show'));
    document.body.classList.add('has-player');
  } else {
    bar.classList.add('show');
  }
}

function initAudioEvents() {
  const a = state.audio;
  a.addEventListener('play', () => { state.isPlaying = true; setTrackUI(state.currentIdx, true); });
  a.addEventListener('pause', () => { state.isPlaying = false; setTrackUI(state.currentIdx, false); });
  a.addEventListener('ended', () => playTrack((state.currentIdx + 1) % state.songs.length));
  a.addEventListener('timeupdate', () => {
    const pct = a.duration ? a.currentTime / a.duration : 0;
    $('#pb-seek-pos').style.width = `${pct * 100}%`;
    $('#pb-time').textContent = `${fmtTime(a.currentTime)} / ${fmtTime(a.duration)}`;
    const ref = trackRefs[state.currentIdx];
    if (ref) ref.progressFg.style.strokeDashoffset = String(RING_LEN * (1 - pct));
  });

  $('#pb-toggle').addEventListener('click', () => {
    if (state.currentIdx < 0) playTrack(0);
    else if (state.isPlaying) pauseTrack();
    else playTrack(state.currentIdx);
  });
  $('#pb-prev').addEventListener('click', () => {
    if (!state.songs.length) return;
    playTrack((state.currentIdx - 1 + state.songs.length) % state.songs.length);
  });
  $('#pb-next').addEventListener('click', () => {
    if (!state.songs.length) return;
    playTrack((state.currentIdx + 1) % state.songs.length);
  });
  $('#pb-seek').addEventListener('click', e => {
    const a = state.audio;
    if (!a.duration) return;
    const r = e.currentTarget.getBoundingClientRect();
    a.currentTime = ((e.clientX - r.left) / r.width) * a.duration;
  });

  if ('mediaSession' in navigator) {
    navigator.mediaSession.setActionHandler('previoustrack', () => $('#pb-prev').click());
    navigator.mediaSession.setActionHandler('nexttrack', () => $('#pb-next').click());
  }
}

/* ============================================================
   渲染曲目
   ============================================================ */
function renderTracks(songs) {
  const list = $('#song-list');
  list.innerHTML = '';
  const tpl = $('#song-template');

  songs.forEach((song, i) => {
    const node = tpl.content.cloneNode(true);
    const el = $('.track', node);
    el.dataset.id = song.id;

    $('.track-ghost', node).textContent = song.title.charAt(0);
    $('.track-no', node).textContent = String(i + 1).padStart(2, '0');
    $('.track-style', node).textContent = song.style || '';
    $('.track-date', node).textContent = fmtDate(song.date);
    $('.track-len', node).textContent = song.duration || '';
    $('.track-title', node).textContent = song.title;
    $('.track-subtitle', node).textContent = song.subtitle || '';
    $('.track-desc', node).textContent = song.description || '';

    const cover = $('.track-cover', node);
    cover.src = coverOf(song);
    cover.alt = song.title;
    cover.loading = 'lazy';

    $('.track-play', node).addEventListener('click', () => toggleTrack(i));

    const lyricBtn = $('.lyric-toggle', node);
    const lyricBox = $('.lyric', node);
    if (song.lyrics) {
      $('.lyric-inner', node).textContent = song.lyrics;
      lyricBtn.addEventListener('click', () => {
        const open = lyricBox.hidden;
        lyricBox.hidden = !open;
        lyricBtn.setAttribute('aria-expanded', String(open));
        $('.lyric-toggle-text', node).textContent = open ? '收起歌詞' : '展開歌詞';
      });
    } else {
      lyricBtn.style.display = 'none';
    }

    list.appendChild(node);

    trackRefs.push({
      el,
      song,
      viz: new DiscViz($('.track-viz', el)),
      progressFg: $('.track-progress-fg', el),
    });
  });

  // 入场 reveal
  const io = new IntersectionObserver(entries => {
    entries.forEach(en => {
      if (en.isIntersecting) {
        en.target.classList.add('in');
        io.unobserve(en.target);
      }
    });
  }, { threshold: 0.12 });
  trackRefs.forEach(ref => io.observe(ref.el));
}

/* ============================================================
   主循环
   ============================================================ */
let sphere = null;
let aurora = null;
let pbVizCtx = null;
let lastTs = 0;

function loop(ts) {
  const dt = Math.min(50, ts - lastTs || 16);
  lastTs = ts;

  if (state.analyser && state.freqData) {
    state.analyser.getByteFrequencyData(state.freqData);
    let bass = 0;
    const n = Math.min(16, state.freqData.length);
    for (let i = 2; i < n; i++) bass += state.freqData[i];
    const target = state.isPlaying ? bass / (n - 2) / 255 : 0;
    state.energy += (target - state.energy) * 0.12;
  } else {
    state.energy *= 0.95;
  }

  if (aurora) aurora.draw(dt);
  if (sphere) sphere.draw(dt);

  const ref = trackRefs[state.currentIdx];
  if (ref) ref.viz.draw(true);

  // 播放条底部频谱
  if (pbVizCtx && !$('#player-bar').hidden) {
    const { ctx, w, h, dpr } = pbVizCtx;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const [ar, ag, ab] = state.accent.rgb;
    const bars = 80;
    const bw = w / bars;
    for (let i = 0; i < bars; i++) {
      let v = 0;
      if (state.analyser && state.freqData && state.isPlaying) {
        v = state.freqData[Math.floor((i / bars) * state.freqData.length * 0.75)] / 255;
      }
      const bh = 2 + v * h * 0.85;
      ctx.fillStyle = `rgba(${ar},${ag},${ab},${0.10 + v * 0.5})`;
      ctx.fillRect(i * bw, h - bh, bw * 0.55, bh);
    }
  }

  requestAnimationFrame(loop);
}

/* ============================================================
   杂项：时钟 / 滚动进度 / 预载
   ============================================================ */
function initChrome() {
  const timeEl = $('#nav-time');
  const tick = () => {
    const d = new Date();
    timeEl.textContent = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  };
  tick();
  setInterval(tick, 10000);

  const bar = $('#scroll-progress-bar');
  window.addEventListener('scroll', () => {
    const max = document.documentElement.scrollHeight - window.innerHeight;
    bar.style.transform = `scaleX(${max > 0 ? window.scrollY / max : 0})`;
  }, { passive: true });

  window.addEventListener('resize', () => {
    if (sphere) sphere.resize();
    trackRefs.forEach(r => r.viz.resize());
    sizePbViz();
  });
}

function sizePbViz() {
  const c = $('#pb-viz');
  const rect = c.getBoundingClientRect();
  if (!rect.width) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  c.width = rect.width * dpr;
  c.height = rect.height * dpr;
  pbVizCtx = { ctx: c.getContext('2d'), w: rect.width, h: rect.height, dpr };
}

function hidePreloader() {
  $('#preloader').classList.add('done');
  document.body.classList.add('loaded');
}

/* ============================================================
   启动
   ============================================================ */
async function init() {
  initCursor();
  initChrome();
  initAudioEvents();

  aurora = new Aurora($('#aurora'));
  sphere = new Sphere($('#hero-sphere'));

  $('#hero-play').addEventListener('click', () => toggleTrack(state.currentIdx < 0 ? 0 : state.currentIdx));
  initMagnetic();

  try {
    const res = await fetch('songs.json');
    state.songs = await res.json();
  } catch (_) {
    $('#song-list').innerHTML = '<div class="loading"><span class="loading-text">暫時無法載入</span></div>';
  }

  if (state.songs.length) {
    renderTracks(state.songs);
    $('#track-count').textContent = String(state.songs.length).padStart(2, '0');
    updateAccent(state.songs[0]);
  }

  sizePbViz();

  // 首帧就绪标记（测试锚点）
  sphere.draw(16);
  $('#hero-sphere').dataset.ready = 'true';

  if (!REDUCED) {
    requestAnimationFrame(loop);
  } else {
    aurora.draw(16);
    sphere.draw(16);
  }

  // 预载退场
  if (document.readyState === 'complete') setTimeout(hidePreloader, 600);
  else window.addEventListener('load', () => setTimeout(hidePreloader, 600));
  setTimeout(hidePreloader, 2600); // 兜底
}

init();
