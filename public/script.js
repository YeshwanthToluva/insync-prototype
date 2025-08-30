// script.js
// Frontend synchronization logic using Socket.io, custom audio controls and downloads UI.

const audio = document.getElementById('audio');
// Wake Lock / NoSleep integration
let wakeLock = null;
let noSleep = null;
let keepAwakeEnabled = true; // default ON; expose a toggle button if desired

async function requestWakeLock() {
  try {
    if ('wakeLock' in navigator) {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => {
        // Try to re-acquire if still enabled and page visible
        if (keepAwakeEnabled && document.visibilityState === 'visible') {
          requestWakeLock().catch(() => {});
        }
      });
    } else {
      // Fallback to NoSleep
      if (!noSleep) noSleep = new NoSleep();
      noSleep.enable(); // requires prior user interaction
    }
  } catch (err) {
    // On some mobiles, requests can fail due to battery/power-saving
    // Fallback to NoSleep if available
    try {
      if (!noSleep) noSleep = new NoSleep();
      noSleep.enable();
    } catch (e) {}
  }
}

function releaseWakeLock() {
  if (wakeLock) {
    wakeLock.release().catch(() => {}).finally(() => { wakeLock = null; });
  }
  if (noSleep) {
    try { noSleep.disable(); } catch (e) {}
  }
}

// Reacquire when tab becomes visible again
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && keepAwakeEnabled) {
    requestWakeLock().catch(() => {});
  }
});

// Tie to playback
audio.addEventListener('play', () => { if (keepAwakeEnabled) requestWakeLock(); });
audio.addEventListener('pause', () => { releaseWakeLock(); });
audio.addEventListener('ended', () => { /* server advances; keep lock if still playing next */ });

// Optional: expose a toggle button
// Example: <button id="btnAwake" class="icon-btn"><i class="fa-solid fa-moon"></i></button>
const btnAwake = document.createElement('button');
btnAwake.id = 'btnAwake';
btnAwake.className = 'icon-btn';
btnAwake.innerHTML = '<i class="fa-solid fa-eye"></i>';
document.querySelector('.player-right').prepend(btnAwake);

function updateAwakeIcon() {
  btnAwake.style.opacity = keepAwakeEnabled ? '1' : '0.5';
}
btnAwake.addEventListener('click', async () => {
  keepAwakeEnabled = !keepAwakeEnabled;
  updateAwakeIcon();
  if (keepAwakeEnabled && !audio.paused) {
    await requestWakeLock().catch(() => {});
  } else {
    releaseWakeLock();
  }
});
updateAwakeIcon();

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
// Add this to your script.js file

// Real-time search functionality
document.getElementById('mainSearchInput').addEventListener('input', function(e) {
    const searchQuery = e.target.value.toLowerCase().trim();
    
    // Get all playlist rows
    const playlistRows = document.querySelectorAll('#playlist .playlist-row');
    
    // If search is empty, show all songs
    if (searchQuery === '') {
        playlistRows.forEach(row => {
            row.style.display = 'grid';
        });
        return;
    }
    
    // Filter songs in real-time
    playlistRows.forEach(row => {
        const titleElement = row.children[1]; // Title column
        const artistElement = row.children[2]; // Artist column
        
        const title = titleElement.textContent.toLowerCase();
        const artist = artistElement.textContent.toLowerCase();
        
        // Check if search query matches title or artist
        if (title.includes(searchQuery) || artist.includes(searchQuery)) {
            row.style.display = 'grid'; // Show matching song
        } else {
            row.style.display = 'none'; // Hide non-matching song
        }
    });
});

// Optional: Clear search when clicking outside or pressing Escape
document.getElementById('mainSearchInput').addEventListener('keydown', function(e) {
    if (e.key === 'Escape') {
        e.target.value = '';
        // Show all songs again
        document.querySelectorAll('#playlist .playlist-row').forEach(row => {
            row.style.display = 'grid';
        });
    }
});
// Using lyrics API for dynamic fetching

// Enhanced karaoke with proper fixes
let karaokeInterval;
let isKaraokeActive = false;
let syncedLyrics = [];
let audioElement;

// Keep your existing clean functions
function cleanSongName(name) {
    return name
        .replace(/\([^)]*\)/g, '')
        .replace(/\[[^\]]*\]/g, '')
        .replace(/ft\.|feat\.|featuring/gi, '')
        .replace(/official|video|audio|lyric|hd|4k/gi, '')
        .replace(/\s+/g, ' ')
        .trim();
}

function cleanArtistName(name) {
    return name
        .replace(/\([^)]*\)/g, '')
        .replace(/\[[^\]]*\]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}

// Fixed API fetcher (your working version)
async function fetchLyrics(artist, song) {
    const cleanArtist = cleanArtistName(artist);
    const cleanSong = cleanSongName(song);
    
    console.log(`🎵 Searching for: "${cleanSong}" by "${cleanArtist}"`);
    
    const apiAttempts = [
        // API 1: LRC format
        async () => {
            const response = await fetch(`https://lrclib.net/api/search?artist_name=${encodeURIComponent(cleanArtist)}&track_name=${encodeURIComponent(cleanSong)}`);
            if (response.ok) {
                const data = await response.json();
                if (data && data.length > 0 && data[0].syncedLyrics) {
                    return { type: 'lrc', content: data[0].syncedLyrics };
                }
            }
            throw new Error('LRCLib failed');
        },
        
        // API 2: Your working APIs
        async () => {
            const response = await fetch(`https://corsproxy.io/?https://api.lyrics.ovh/v1/${encodeURIComponent(cleanArtist)}/${encodeURIComponent(cleanSong)}`);
            if (response.ok) {
                const data = await response.json();
                if (data.lyrics && data.lyrics.trim()) {
                    return { type: 'plain', content: data.lyrics };
                }
            }
            throw new Error('Lyrics.ovh failed');
        }
    ];
    
    // Try each API
    for (let i = 0; i < apiAttempts.length; i++) {
        try {
            console.log(`📡 Trying API ${i + 1}...`);
            
            const timeoutPromise = new Promise((_, reject) =>
                setTimeout(() => reject(new Error('API timeout')), 5000)
            );
            
            const result = await Promise.race([apiAttempts[i](), timeoutPromise]);
            
            if (result && result.content && result.content.trim()) {
                console.log(`✅ Success with API ${i + 1}! Type: ${result.type}`);
                return result;
            }
        } catch (error) {
            console.log(`❌ API ${i + 1} failed:`, error.message);
        }
    }
    
    console.log('🎭 All APIs failed, using demo lyrics');
    return { type: 'plain', content: createDemoLyrics(cleanArtist, cleanSong) };
}

// Parse LRC format
function parseLrcLyrics(lrcContent) {
    const lines = lrcContent.split('\n');
    const lyrics = [];
    
    for (const line of lines) {
        if (line.trim() === '') continue;
        
        const match = line.match(/^\[(\d{2}):(\d{2})(?:\.(\d{2}))?\](.*)$/);
        if (match) {
            const minutes = parseInt(match[1]);
            const seconds = parseInt(match[2]);
            const centiseconds = parseInt(match[3] || '0');
            const text = match[4].trim();
            
            const timestamp = (minutes * 60 + seconds) * 1000 + centiseconds * 10;
            
            if (text) {
                lyrics.push({
                    timestamp: timestamp,
                    text: text
                });
            }
        }
    }
    
    lyrics.sort((a, b) => a.timestamp - b.timestamp);
    console.log(`📝 Parsed ${lyrics.length} synced lyric lines`);
    return lyrics;
}

// Display lyrics WITHOUT interfering with audio
function displaySyncedLyrics(lyricsResult) {
    const lyricsDisplay = document.getElementById('lyricsDisplay');
    
    if (!lyricsResult || !lyricsResult.content) {
        lyricsDisplay.innerHTML = `
            <div class="lyrics-error">
                <i class="fa-solid fa-exclamation-triangle"></i>
                <p>Sorry, lyrics not available for this song</p>
            </div>
        `;
        return;
    }
    
    if (lyricsResult.type === 'lrc') {
        syncedLyrics = parseLrcLyrics(lyricsResult.content);
        
        if (syncedLyrics.length > 0) {
            const lyricsHTML = syncedLyrics.map((lyric, index) => 
                `<p data-line="${index}" data-timestamp="${lyric.timestamp}" class="lyric-line">${lyric.text}</p>`
            ).join('');
            
            lyricsDisplay.innerHTML = lyricsHTML;
            startSmoothSyncedKaraoke();
            return;
        }
    }
    
    // Fallback to plain text
    displayPlainTextLyrics(lyricsResult.content);
}

// FIXED: Smooth synced karaoke without audio interference
function startSmoothSyncedKaraoke() {
    audioElement = document.getElementById('audio');
    
    if (!audioElement) {
        console.error('Audio element not found');
        displayPlainTextLyrics('Audio not available - using auto-scroll');
        return;
    }
    
    console.log('🎤 Starting smooth synced karaoke');
    
    // Clear any existing interval
    if (karaokeInterval) {
        clearInterval(karaokeInterval);
    }
    
    // SMOOTH sync without interfering with audio - reduced frequency
    karaokeInterval = setInterval(() => {
        // Only check if audio is playing
        if (!audioElement || audioElement.paused) return;
        
        const currentTime = audioElement.currentTime * 1000;
        const lines = document.querySelectorAll('#lyricsDisplay .lyric-line');
        
        // Find current lyric (efficient search)
        let currentIndex = -1;
        for (let i = syncedLyrics.length - 1; i >= 0; i--) {
            if (currentTime >= syncedLyrics[i].timestamp) {
                currentIndex = i;
                break;
            }
        }
        
        // Only update if different from current highlight
        const currentHighlight = document.querySelector('.lyric-highlight');
        const newHighlight = currentIndex >= 0 ? lines[currentIndex] : null;
        
        if (currentHighlight !== newHighlight) {
            // Remove all highlights
            lines.forEach(line => line.classList.remove('lyric-highlight'));
            
            // Add new highlight
            if (newHighlight) {
                newHighlight.classList.add('lyric-highlight');
                newHighlight.scrollIntoView({ 
                    behavior: 'smooth', 
                    block: 'center' 
                });
            }
        }
        
    }, 100); // Check every 100ms instead of 16ms - much smoother for audio
    
    console.log('✅ Smooth synced karaoke started');
}

// Plain text display (fallback)
function displayPlainTextLyrics(lyricsText) {
    const lyricsDisplay = document.getElementById('lyricsDisplay');
    const lines = lyricsText.split('\n').filter(line => line.trim() !== '');
    
    const lyricsHTML = lines.map((line, index) => {
        let className = 'lyric-line';
        if (line.includes('[') && line.includes(']')) {
            className += ' lyric-section';
        }
        return `<p data-line="${index}" class="${className}">${line.trim()}</p>`;
    }).join('');
    
    lyricsDisplay.innerHTML = lyricsHTML;
    startPlainTextKaraoke();
}

// Auto-scroll for plain text
function startPlainTextKaraoke() {
    const lines = document.querySelectorAll('#lyricsDisplay .lyric-line');
    let currentLine = 0;
    
    if (lines.length === 0) return;
    
    karaokeInterval = setInterval(() => {
        lines.forEach(line => line.classList.remove('lyric-highlight'));
        
        if (lines[currentLine]) {
            lines[currentLine].classList.add('lyric-highlight');
            lines[currentLine].scrollIntoView({ 
                behavior: 'smooth', 
                block: 'center' 
            });
        }
        
        currentLine++;
        if (currentLine >= lines.length) {
            clearInterval(karaokeInterval);
        }
    }, 2800);
}

// FIXED: Karaoke start with proper event listeners
document.addEventListener('DOMContentLoaded', function() {
    // Start karaoke button
    const startBtn = document.getElementById('btnKaraoke');
    if (startBtn) {
        startBtn.addEventListener('click', startKaraoke);
    }
    
    // FIXED: Close button event listener
    const stopBtn = document.getElementById('btnStopKaraoke');
    if (stopBtn) {
        stopBtn.addEventListener('click', stopKaraoke);
    }
    
    // FIXED: Auto-detect song changes
    const heroTitle = document.getElementById('heroTitle');
    if (heroTitle) {
        const observer = new MutationObserver(function(mutations) {
            mutations.forEach(function(mutation) {
                if (mutation.type === 'childList' || mutation.type === 'characterData') {
                    console.log('🔄 Song changed, stopping karaoke');
                    if (isKaraokeActive) {
                        stopKaraoke();
                    }
                }
            });
        });
        
        observer.observe(heroTitle, { 
            childList: true, 
            characterData: true, 
            subtree: true 
        });
    }
});

// Start karaoke function
async function startKaraoke() {
    if (isKaraokeActive) return;
    
    const currentSong = document.getElementById('heroTitle').textContent;
    const currentArtist = document.getElementById('heroArtist').textContent;
    
    if (currentSong === 'No song' || currentArtist === '—') {
        alert('Please select a song first!');
        return;
    }
    
    const karaokeSection = document.getElementById('karaokeSection');
    karaokeSection.style.display = 'block';
    
    const lyricsDisplay = document.getElementById('lyricsDisplay');
    lyricsDisplay.innerHTML = `
        <div class="loading-lyrics">
            <i class="fa-solid fa-spinner fa-spin"></i>
            <p>🎵 Loading lyrics...</p>
            <small>"${cleanSongName(currentSong)}" by ${cleanArtistName(currentArtist)}</small>
        </div>
    `;
    
    const startBtn = document.getElementById('btnKaraoke');
    startBtn.innerHTML = '<i class="fa-solid fa-hourglass-half"></i> Loading...';
    startBtn.disabled = true;
    isKaraokeActive = true;
    
    // Fetch and display lyrics
    const lyricsResult = await fetchLyrics(currentArtist, currentSong);
    
    startBtn.innerHTML = '<i class="fa-solid fa-microphone"></i> 🎤 Karaoke Active';
    startBtn.disabled = false;
    
    displaySyncedLyrics(lyricsResult);
}

// FIXED: Stop karaoke function
function stopKaraoke() {
    console.log('🛑 Stopping karaoke');
    
    const karaokeSection = document.getElementById('karaokeSection');
    const karaokeBtn = document.getElementById('btnKaraoke');
    
    // Hide section
    if (karaokeSection) {
        karaokeSection.style.display = 'none';
    }
    
    // Reset button
    if (karaokeBtn) {
        karaokeBtn.innerHTML = '<i class="fa-solid fa-microphone"></i> Start Karaoke';
        karaokeBtn.disabled = false;
    }
    
    // Clear interval
    if (karaokeInterval) {
        clearInterval(karaokeInterval);
        karaokeInterval = null;
    }
    
    // Reset variables
    isKaraokeActive = false;
    syncedLyrics = [];
    
    console.log('✅ Karaoke stopped');
}

// Demo lyrics
function createDemoLyrics(artist, song) {
    return `🎵 "${song}" by ${artist} 🎵

[Verse 1]
This is your karaoke moment
Sing along with the beat
Every word becomes a memory
Make this song complete

[Chorus]
Live the music, feel the rhythm
Let your voice fill up the room
This is more than just a song
This is where your dreams can bloom

🎤 Enjoy the karaoke experience! 🎤`;
}



fetchPlaylist();


