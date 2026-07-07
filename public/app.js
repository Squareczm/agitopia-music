/* ============================================================
   声音志 · Sound Journal
   Frontend Logic · 原生 ES6+
   ============================================================ */

const AUDIO_BASE = 'https://audio.ainovalife.com/';

/* ----- helpers ----- */
const $  = (s, p = document) => p.querySelector(s);
const $$ = (s, p = document) => [...p.querySelectorAll(s)];

/* 数字转日式汉字 */
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

/* 数字转罗马 */
function toRomanNum(n) {
  if (n < 1) return '—';
  const map = [['M',1000],['CM',900],['D',500],['CD',400],['C',100],
               ['XC',90],['L',50],['XL',40],['X',10],['IX',9],
               ['V',5],['IV',4],['I',1]];
  let r = '';
  for (const [l, v] of map) { while (n >= v) { r += l; n -= v; } }
  return r;
}

/* 时间格式化 */
function fmtTime(s) {
  if (!isFinite(s) || s < 0) return '0:00';
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60).toString().padStart(2, '0');
  return `${m}:${sec}`;
}

/* 日期格式化 */
function fmtDate(s) {
  const d = new Date(s);
  if (isNaN(d)) return s;
  return `${d.getFullYear()} · ${String(d.getMonth() + 1).padStart(2,'0')} · ${String(d.getDate()).padStart(2,'0')}`;
}

/* ============================================================
   STATE
   ============================================================ */
const state = {
  songs: [],
  currentIdx: -1,
  audio: null,
  isPlaying: false,
};

/* ============================================================
   LOAD SONGS
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
      '<div class="error">曲目載入失敗 · Tracks unavailable, please retry</div>';
  }
}

/* ============================================================
   RENDER
   ============================================================ */
function renderSongs() {
  const list = $('#song-list');
  list.innerHTML = '';

  const roman = toRomanNum(state.songs.length);
  $('#track-count').textContent = roman;

  state.songs.forEach((song, idx) => {
    /* ----- section header for first song ----- */
    if (idx === 0) {
      const sec = $('#section-template').content.cloneNode(true);
      sec.querySelector('.track-section-num').textContent = toRomanNum(1);
      sec.querySelector('.track-section-title').textContent = '最新曲目 · LATEST RELEASES';
      sec.querySelector('.track-section-romaji').textContent = 'The most recent recordings';
      list.appendChild(sec);
    }

    const wrap = document.createElement('div');
    wrap.className = 'track-section';
    const tpl = $('#song-template').content.cloneNode(true);
    const el = tpl.querySelector('.track');
    el.dataset.id = song.id;
    el.dataset.idx = idx;

    el.querySelector('.track-no-kanji').textContent = `第${toKanjiNum(idx + 1)}曲`;
    el.querySelector('.track-no-num').textContent = `№ ${toRomanNum(idx + 1)}`;
    el.querySelector('.track-title').textContent = song.title;
    el.querySelector('.track-subtitle').textContent = song.subtitle || '';
    el.querySelector('.track-style').textContent = song.style;
    el.querySelector('.track-date').textContent = fmtDate(song.date);
    el.querySelector('.track-len').textContent = song.duration;
    el.querySelector('.track-desc').textContent = song.description || '';

    if (song.lyrics) {
      const lyricInner = el.querySelector('.lyric-inner');
      lyricInner.classList.add('with-text');
      lyricInner.textContent = song.lyrics.trim();
    }

    /* player controls */
    const playerBtn = el.querySelector('.player-btn');
    playerBtn.addEventListener('click', (ev) => { ev.stopPropagation(); togglePlay(idx); });

    const barWrap = el.querySelector('.player-bar-wrap');
    barWrap.addEventListener('click', (ev) => seek(ev, idx));

    /* lyric toggle */
    const lyricToggle = el.querySelector('.lyric-toggle');
    const lyric = el.querySelector('.lyric');
    lyricToggle.addEventListener('click', () => {
      const open = lyric.hasAttribute('hidden');
      if (open) {
        lyric.removeAttribute('hidden');
        lyricToggle.setAttribute('aria-expanded', 'true');
        lyricToggle.querySelector('.lyric-toggle-text').textContent =
          '收起詩詞 · Hide Lyrics';
      } else {
        lyric.setAttribute('hidden', '');
        lyricToggle.setAttribute('aria-expanded', 'false');
        lyricToggle.querySelector('.lyric-toggle-text').textContent =
          '展開詩詞 · View Lyrics';
      }
    });

    wrap.appendChild(el);
    list.appendChild(wrap);
  });

  /* ----- mini player setup ----- */
  $('#mini-btn').addEventListener('click', () => {
    if (state.currentIdx >= 0) togglePlay(state.currentIdx);
  });
  $('#mini-player .mini-bar-wrap').addEventListener('click', (ev) => {
    if (state.currentIdx >= 0) seek(ev, state.currentIdx);
  });

  /* ----- scroll fade-in (only for tracks initially outside viewport) ----- */
  const observer = new IntersectionObserver((entries) => {
    entries.forEach(e => {
      if (e.isIntersecting) {
        e.target.classList.add('in');
        observer.unobserve(e.target);
      }
    });
  }, { threshold: 0.04, rootMargin: '0px 0px -40px 0px' });

  $$('.track').forEach(t => observer.observe(t));
}

/* ============================================================
   PLAYER
   ============================================================ */
function togglePlay(idx) {
  const song = state.songs[idx];
  if (!song) return;

  /* same song: toggle */
  if (state.audio && state.currentIdx === idx) {
    if (state.audio.paused) {
      state.audio.play().catch(e => console.error(e));
      state.isPlaying = true;
    } else {
      state.audio.pause();
      state.isPlaying = false;
    }
    updatePlayUI();
    return;
  }

  /* switch to new song */
  if (state.audio) {
    state.audio.pause();
    state.audio.removeEventListener('timeupdate', onTimeUpdate);
    state.audio.removeEventListener('ended', onEnded);
    state.audio.removeEventListener('loadedmetadata', onLoaded);
    state.audio.removeEventListener('error', onAudioError);
  }

  state.currentIdx = idx;
  state.audio = new Audio(AUDIO_BASE + song.file);
  state.audio.preload = 'metadata';
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

  highlightCurrent();
  showMiniPlayer(song);
  updatePlayUI();
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
  /* auto-advance */
  if (state.currentIdx < state.songs.length - 1) {
    setTimeout(() => togglePlay(state.currentIdx + 1), 400);
  }
}

function onAudioError(e) {
  console.error('Audio error:', e);
  state.isPlaying = false;
  updatePlayUI();
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

function showMiniPlayer(song) {
  const mp = $('#mini-player');
  mp.removeAttribute('hidden');
  /* next frame to allow display change before opacity transition */
  requestAnimationFrame(() => { mp.dataset.show = 'true'; });
  $('#mini-num').textContent = `第${toKanjiNum(state.currentIdx + 1)}曲`;
  $('#mini-title').textContent = song.title;
}

/* ============================================================
   THEME
   ============================================================ */
function setupTheme() {
  const saved = localStorage.getItem('sj-theme');
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const initial = saved || (prefersDark ? 'dark' : 'light');
  document.documentElement.dataset.theme = initial;

  $('#theme-toggle').addEventListener('click', () => {
    const cur = document.documentElement.dataset.theme;
    const next = cur === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    localStorage.setItem('sj-theme', next);
  });
}

/* ============================================================
   NAV — clock & scroll style
   ============================================================ */
function updateNavTime() {
  const now = new Date();
  const h = String(now.getHours()).padStart(2, '0');
  const m = String(now.getMinutes()).padStart(2, '0');
  $('#nav-time').textContent = `SHENZHEN · ${h}:${m}`;
}

function setupNavScroll() {
  const nav = $('nav.nav');
  let ticking = false;
  window.addEventListener('scroll', () => {
    if (!ticking) {
      requestAnimationFrame(() => {
        nav.classList.toggle('scrolled', window.scrollY > 40);
        ticking = false;
      });
      ticking = true;
    }
  }, { passive: true });
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
   INIT
   ============================================================ */
document.addEventListener('DOMContentLoaded', () => {
  setupTheme();
  updateNavTime();
  setInterval(updateNavTime, 30000);
  setupNavScroll();
  setupKeyboard();
  loadSongs();
});
