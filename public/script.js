// script.js
// Frontend synchronization logic using Socket.io, custom audio controls and downloads UI.

const audio = document.getElementById('audio');
const socket = io();

// DOM references
const connDot = document.getElementById('connDot');
const connText = document.getElementById('connText');
const userCount = document.getElementById('userCount');
const syncSkew = document.getElementById('syncSkew');

const btnPrev = document.getElementById('btnPrev');
const btnPlayPause = document.getElementById('btnPlayPause');
const btnNext = document.getElementById('btnNext');

const btnHeroPlay = document.getElementById('btnHeroPlay');

const heroTitle = document.getElementById('heroTitle');
const heroArtist = document.getElementById('heroArtist');
const playlistEl = document.getElementById('playlist');

const footTitle = document.getElementById('footTitle');
const footArtist = document.getElementById('footArtist');

const curTime = document.getElementById('curTime');
const totTime = document.getElementById('totTime');

const progressBar = document.getElementById('progressBar');
const progressFill = document.getElementById('progressFill');
const progressHandle = document.getElementById('progressHandle');

const footPrev = document.getElementById('footPrev');
const footPlayPause = document.getElementById('footPlayPause');
const footNext = document.getElementById('footNext');

const volume = document.getElementById('volume');

const searchInput = document.getElementById('searchInput');
const suggestions = document.getElementById('suggestions');
const btnDownload = document.getElementById('btnDownload');
const downloadList = document.getElementById('downloadList');
const btnRefresh = document.getElementById('btnRefresh');

const Playback = {
  state: null,
  serverTime: 0,
  clientOffset: 0, // serverTime - clientNow
  gettingSync: false
};

// Compute human mm:ss
function fmt(sec) {
  if (!isFinite(sec) || sec == null) return '0:00';
  const s = Math.max(0, Math.floor(sec));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r.toString().padStart(2,'0')}`;
}

// Load playlist to render static parts (also updated via socket sync)
async function fetchPlaylist() {
  const res = await fetch('/api/playlist');
  const data = await res.json();
  renderPlaylist(data.playlist);
}

// Render playlist rows
function renderPlaylist(list) {
  playlistEl.innerHTML = '';
  list.forEach((song, i) => {
    const row = document.createElement('div');
    row.className = 'playlist-row';
    row.dataset.index = i;
    row.innerHTML = `
      <div>${i+1}</div>
      <div>${song.title}</div>
      <div>${song.artist}</div>
      <div>${song.duration ? fmt(song.duration) : '—'}</div>
    `;
    row.addEventListener('click', () => {
      socket.emit('control:playIndex', i);
    });
    playlistEl.appendChild(row);
  });
}

// Update active row highlight
function highlightCurrent(index) {
  document.querySelectorAll('.playlist-row').forEach(r => r.classList.remove('active'));
  const row = document.querySelector(`.playlist-row[data-index="${index}"]`);
  if (row) row.classList.add('active');
}

// Set audio src according to state
function setAudioSrc(song) {
  if (!song) {
    audio.removeAttribute('src');
    return;
  }
  const url = `/songs/${encodeURIComponent(song.filename)}`;
  if (audio.src.endsWith(encodeURIComponent(song.filename))) return;
  audio.src = url;
}

// Sync playback state from server with drift correction
function applyState({ state, serverTime }) {
  Playback.state = state;
  Playback.serverTime = serverTime;
  Playback.clientOffset = serverTime - Date.now();
  syncSkew.textContent = `${Playback.clientOffset} ms`;

  renderPlaylist(state.playlist);
  const current = state.playlist[state.currentIndex];
  heroTitle.textContent = current ? current.title : 'No song';
  heroArtist.textContent = current ? current.artist : '—';
  footTitle.textContent = heroTitle.textContent;
  footArtist.textContent = heroArtist.textContent;
  highlightCurrent(state.currentIndex);

  setAudioSrc(current);

  // Target position = state.positionSec plus elapsed since startedAt
  let targetPos = state.positionSec;
  if (state.isPlaying && state.startedAt) {
    const elapsed = (serverTime - state.startedAt) / 1000;
    targetPos += Math.max(0, elapsed);
  }

  // Only seek if drift > 250ms to avoid choppy UX
  if (Math.abs(audio.currentTime - targetPos) > 0.25) {
    audio.currentTime = targetPos;
  }

  if (state.isPlaying) {
    audio.play().catch(() => {});
    btnPlayPause.querySelector('i').className = 'fa-solid fa-pause';
    btnHeroPlay.querySelector('i').className = 'fa-solid fa-pause';
    footPlayPause.querySelector('i').className = 'fa-solid fa-pause';
  } else {
    audio.pause();
    btnPlayPause.querySelector('i').className = 'fa-solid fa-play';
    btnHeroPlay.querySelector('i').className = 'fa-solid fa-play';
    footPlayPause.querySelector('i').className = 'fa-solid fa-play';
  }

  // Duration UI
  const dur = isFinite(audio.duration) ? audio.duration : (current?.duration || NaN);
  totTime.textContent = fmt(dur);
}

// Presence
socket.on('presence:count', ({ count }) => {
  userCount.textContent = count;
});

// Connectivity
socket.on('connect', () => {
  connDot.style.background = '#22c55e';
  connText.textContent = 'Connected';
});
socket.on('disconnect', () => {
  connDot.style.background = '#ef4444';
  connText.textContent = 'Disconnected';
});

// Receive canonical sync state
socket.on('sync:state', payload => {
  applyState(payload);
});

// Controls
function togglePlay() {
  if (!Playback.state) return;
  if (Playback.state.isPlaying) socket.emit('control:pause');
  else socket.emit('control:play');
}
btnPlayPause.addEventListener('click', togglePlay);
btnHeroPlay.addEventListener('click', togglePlay);
footPlayPause.addEventListener('click', togglePlay);

btnNext.addEventListener('click', () => socket.emit('control:next'));
btnPrev.addEventListener('click', () => socket.emit('control:prev'));
footNext.addEventListener('click', () => socket.emit('control:next'));
footPrev.addEventListener('click', () => socket.emit('control:prev'));

// Progress dragging / seek
let dragging = false;
function updateProgressUI() {
  const d = isFinite(audio.duration) ? audio.duration : (Playback?.state?.playlist[Playback?.state?.currentIndex]?.duration || 0);
  const t = audio.currentTime || 0;
  curTime.textContent = fmt(t);
  totTime.textContent = fmt(d);
  const pct = d > 0 ? Math.min(100, (t / d) * 100) : 0;
  progressFill.style.width = `${pct}%`;
  progressHandle.style.left = `${pct}%`;
}
audio.addEventListener('timeupdate', () => { if (!dragging) updateProgressUI(); });
audio.addEventListener('loadedmetadata', () => updateProgressUI());

function barSeek(e) {
  const rect = progressBar.getBoundingClientRect();
  const x = Math.min(Math.max(0, e.clientX - rect.left), rect.width);
  const pct = x / rect.width;
  const d = audio.duration || 0;
  const target = pct * d;
  socket.emit('control:seek', target);
}
progressBar.addEventListener('click', barSeek);

progressHandle.addEventListener('mousedown', (e) => {
  e.preventDefault();
  dragging = true;
  const move = (ev) => {
    const rect = progressBar.getBoundingClientRect();
    const x = Math.min(Math.max(0, ev.clientX - rect.left), rect.width);
    const pct = x / rect.width;
    progressFill.style.width = `${pct*100}%`;
    progressHandle.style.left = `${pct*100}%`;
  };
  const up = (ev) => {
    const rect = progressBar.getBoundingClientRect();
    const x = Math.min(Math.max(0, ev.clientX - rect.left), rect.width);
    const pct = x / rect.width;
    const d = audio.duration || 0;
    const target = pct * d;
    socket.emit('control:seek', target);
    dragging = false;
    window.removeEventListener('mousemove', move);
    window.removeEventListener('mouseup', up);
  };
  window.addEventListener('mousemove', move);
  window.addEventListener('mouseup', up);
});

// Auto-advance: notify server when current ends
audio.addEventListener('ended', () => {
  socket.emit('player:ended');
});

// Volume
volume.addEventListener('input', () => {
  audio.volume = parseFloat(volume.value);
});

// Download UI
btnDownload.addEventListener('click', async () => {
  const q = searchInput.value.trim();
  if (!q) return;
  btnDownload.disabled = true;
  btnDownload.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
  try {
    const res = await fetch('/api/download', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: q })
    });
    const data = await res.json();
    if (!data.ok) {
      addDownloadCard({ id: 'err_'+Date.now(), title: q, status: 'failed', progress: 0, error: data.error || 'Failed' });
    }
  } catch (e) {
    addDownloadCard({ id: 'err_'+Date.now(), title: q, status: 'failed', progress: 0, error: 'Network error' });
  } finally {
    btnDownload.disabled = false;
    btnDownload.innerHTML = '<i class="fa-solid fa-download"></i>';
  }
});

// Download progress updates
socket.on('download:update', payload => {
  addDownloadCard(payload);
});

function addDownloadCard({ id, title, status, progress, error }) {
  let el = document.getElementById(id);
  if (!el) {
    el = document.createElement('div');
    el.id = id;
    el.className = 'dl';
    el.innerHTML = `
      <div class="row">
        <strong class="t"></strong>
        <span class="s"></span>
      </div>
      <div class="bar"><div class="fill"></div></div>
      <div class="err" style="color:#ef4444;margin-top:4px;"></div>
    `;
    downloadList.prepend(el);
  }
  el.querySelector('.t').textContent = title;
  const s = el.querySelector('.s');
  const f = el.querySelector('.fill');
  const e = el.querySelector('.err');

  if (status === 'running') {
    s.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Downloading ${progress}%`;
    f.style.width = `${progress || 0}%`;
    e.textContent = '';
  } else if (status === 'completed') {
    s.innerHTML = `<i class="fa-solid fa-circle-check" style="color:#22c55e"></i> Completed`;
    f.style.width = `100%`;
    e.textContent = '';
    // Auto-refresh playlist after brief delay
    setTimeout(refreshPlaylist, 500);
  } else if (status === 'failed') {
    s.innerHTML = `<i class="fa-solid fa-triangle-exclamation" style="color:#ef4444"></i> Failed`;
    f.style.width = `0%`;
    e.textContent = error || 'Unknown error';
  }
}

// Manual refresh
async function refreshPlaylist() {
  try {
    const res = await fetch('/api/playlist/refresh', { method: 'POST' });
    const data = await res.json();
    // State will also sync via socket
  } catch (e) {}
}
btnRefresh.addEventListener('click', refreshPlaylist);

// Minimal suggestions (client-side): quick suffixes for search UX
const popular = [
  "lofi hip hop radio",
  "top hits 2024",
  "classical study music",
  "edm mix",
  "piano chill"
];
searchInput.addEventListener('input', () => {
  const q = searchInput.value.trim().toLowerCase();
  suggestions.innerHTML = '';
  if (!q) return;
  popular.filter(p => p.includes(q)).slice(0,5).forEach(sug => {
    const li = document.createElement('li');
    li.textContent = sug;
    li.addEventListener('click', () => {
      searchInput.value = sug;
      suggestions.innerHTML = '';
    });
    suggestions.appendChild(li);
  });
});

// Initial load
fetchPlaylist();

