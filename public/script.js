// Enhanced script.js with room functionality
let currentRoom = null;
let userDisplayName = null;
let isHost = false;

// Modified socket connection to include room context
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

const audio = document.getElementById('audio');

// Wake Lock / NoSleep integration
let wakeLock = null;
let noSleep = null;
let keepAwakeEnabled = true;

async function requestWakeLock() {
  try {
    if ('wakeLock' in navigator) {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => {
        if (keepAwakeEnabled && document.visibilityState === 'visible') {
          requestWakeLock().catch(() => {});
        }
      });
    } else {
      if (!noSleep) noSleep = new NoSleep();
      noSleep.enable();
    }
  } catch (err) {
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

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && keepAwakeEnabled) {
    requestWakeLock().catch(() => {});
  }
});

audio.addEventListener('play', () => { if (keepAwakeEnabled) requestWakeLock(); });
audio.addEventListener('pause', () => { releaseWakeLock(); });
audio.addEventListener('ended', () => { /* server advances; keep lock if still playing next */ });

// Create wake lock toggle button
const btnAwake = document.createElement('button');
btnAwake.id = 'btnAwake';
btnAwake.className = 'icon-btn';
btnAwake.innerHTML = '<i class="fa-solid fa-eye"></i>';

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

// Initialize room modal on load
document.addEventListener('DOMContentLoaded', function() {
    // Add wake lock button to player
    const playerRight = document.querySelector('.player-right');
    if (playerRight) {
        playerRight.prepend(btnAwake);
    }
    updateAwakeIcon();
    
    showRoomModal();
    initializeRoomHandlers();
    initializeKaraokeHandlers();
});

function showRoomModal() {
    const modal = document.getElementById('roomModal');
    const app = document.getElementById('app');
    
    if (modal && app) {
        modal.style.display = 'flex';
        app.classList.add('app-hidden');
    }
}

function hideRoomModal() {
    const modal = document.getElementById('roomModal');
    const app = document.getElementById('app');
    
    if (modal && app) {
        modal.style.display = 'none';
        app.classList.remove('app-hidden');
    }
}

function initializeRoomHandlers() {
    const displayNameInput = document.getElementById('displayName');
    const roomIdInput = document.getElementById('roomIdInput');
    const btnJoinRoom = document.getElementById('btnJoinRoom');
    const btnCreateRoom = document.getElementById('btnCreateRoom');
    const btnCopyRoom = document.getElementById('btnCopyRoom');

    if (!displayNameInput || !roomIdInput || !btnJoinRoom || !btnCreateRoom) {
        console.error('Room elements not found');
        return;
    }

    // Join existing room
    btnJoinRoom.addEventListener('click', () => {
        const name = displayNameInput.value.trim();
        const roomId = roomIdInput.value.trim().toUpperCase();
        
        if (!name) {
            alert('Please enter your display name');
            return;
        }
        
        if (!roomId) {
            alert('Please enter a room code');
            return;
        }
        
        joinRoom(name, roomId);
    });

    // Create new room
    btnCreateRoom.addEventListener('click', () => {
        const name = displayNameInput.value.trim();
        
        if (!name) {
            alert('Please enter your display name');
            return;
        }
        
        createRoom(name);
    });

    // Copy room code
    if (btnCopyRoom) {
        btnCopyRoom.addEventListener('click', () => {
            if (currentRoom) {
                navigator.clipboard.writeText(currentRoom);
                btnCopyRoom.innerHTML = '<i class="fa-solid fa-check"></i>';
                setTimeout(() => {
                    btnCopyRoom.innerHTML = '<i class="fa-solid fa-copy"></i>';
                }, 2000);
            }
        });
    }

    // Enter key handlers
    displayNameInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') btnCreateRoom.click();
    });
    
    roomIdInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') btnJoinRoom.click();
    });
}

function createRoom(displayName) {
    userDisplayName = displayName;
    isHost = true;
    
    const btnCreateRoom = document.getElementById('btnCreateRoom');
    btnCreateRoom.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Creating...';
    btnCreateRoom.disabled = true;
    
    // Generate room ID
    const roomId = generateRoomId();
    
    socket.emit('room:create', { 
        roomId: roomId, 
        displayName: displayName 
    });
}

function joinRoom(displayName, roomId) {
    userDisplayName = displayName;
    isHost = false;
    
    const btnJoinRoom = document.getElementById('btnJoinRoom');
    btnJoinRoom.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Joining...';
    btnJoinRoom.disabled = true;
    
    socket.emit('room:join', { 
        roomId: roomId, 
        displayName: displayName 
    });
}

function generateRoomId() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let result = '';
    for (let i = 0; i < 6; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
}

// Socket event handlers for rooms
socket.on('room:created', (data) => {
    currentRoom = data.roomId;
    updateRoomInfo(data);
    hideRoomModal();
    initializeApp();
});

socket.on('room:joined', (data) => {
    currentRoom = data.roomId;
    isHost = data.isHost;
    updateRoomInfo(data);
    hideRoomModal();
    initializeApp();
});

socket.on('room:error', (data) => {
    alert(data.message);
    
    // Reset buttons
    const btnJoin = document.getElementById('btnJoinRoom');
    const btnCreate = document.getElementById('btnCreateRoom');
    
    if (btnJoin) {
        btnJoin.innerHTML = '<i class="fa-solid fa-door-open"></i> Join Room';
        btnJoin.disabled = false;
    }
    
    if (btnCreate) {
        btnCreate.innerHTML = '<i class="fa-solid fa-plus"></i> Create & Join Room';
        btnCreate.disabled = false;
    }
});

socket.on('room:userJoined', (data) => {
    console.log(`${data.displayName} joined the room`);
});

socket.on('room:userLeft', (data) => {
    console.log(`${data.displayName} left the room`);
});

function updateRoomInfo(data) {
    const roomIdEl = document.getElementById('currentRoomId');
    const hostEl = document.getElementById('roomHost');
    
    if (roomIdEl) roomIdEl.textContent = data.roomId;
    if (hostEl) hostEl.textContent = data.hostName || userDisplayName;
}

function initializeApp() {
    fetchPlaylist();
}

// Playback state management
const Playback = {
  state: null,
  serverTime: 0,
  clientOffset: 0,
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

// Load playlist to render static parts
async function fetchPlaylist() {
  try {
    const res = await fetch('/api/playlist');
    const data = await res.json();
    renderPlaylist(data.playlist);
  } catch (e) {
    console.error('Failed to fetch playlist:', e);
  }
}

// Render playlist rows
function renderPlaylist(list) {
  if (!playlistEl) return;
  
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
  if (syncSkew) syncSkew.textContent = `${Playback.clientOffset} ms`;

  renderPlaylist(state.playlist);
  const current = state.playlist[state.currentIndex];
  
  if (heroTitle) heroTitle.textContent = current ? current.title : 'No song';
  if (heroArtist) heroArtist.textContent = current ? current.artist : '—';
  if (footTitle) footTitle.textContent = heroTitle ? heroTitle.textContent : 'No song';
  if (footArtist) footArtist.textContent = heroArtist ? heroArtist.textContent : '—';
  
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
    updatePlayButton('pause');
  } else {
    audio.pause();
    updatePlayButton('play');
  }

  // Duration UI
  const dur = isFinite(audio.duration) ? audio.duration : (current?.duration || NaN);
  if (totTime) totTime.textContent = fmt(dur);
}

function updatePlayButton(state) {
  const iconClass = state === 'play' ? 'fa-solid fa-play' : 'fa-solid fa-pause';
  
  if (btnPlayPause) btnPlayPause.querySelector('i').className = iconClass;
  if (btnHeroPlay) btnHeroPlay.querySelector('i').className = iconClass;
  if (footPlayPause) footPlayPause.querySelector('i').className = iconClass;
}

// Socket event handlers
socket.on('connect', () => {
    if (connDot) connDot.style.background = '#22c55e';
    if (connText) connText.textContent = 'Connected';
    
    // Rejoin room if we have one
    if (currentRoom && userDisplayName) {
        socket.emit('room:rejoin', { 
            roomId: currentRoom, 
            displayName: userDisplayName 
        });
    }
});

socket.on('disconnect', () => {
    if (connDot) connDot.style.background = '#ef4444';
    if (connText) connText.textContent = 'Disconnected';
});

// Update presence count to be room-specific
socket.on('room:presence', ({ count }) => {
    if (userCount) userCount.textContent = count;
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

// Event listeners for controls
if (btnPlayPause) btnPlayPause.addEventListener('click', togglePlay);
if (btnHeroPlay) btnHeroPlay.addEventListener('click', togglePlay);
if (footPlayPause) footPlayPause.addEventListener('click', togglePlay);

if (btnNext) btnNext.addEventListener('click', () => socket.emit('control:next'));
if (btnPrev) btnPrev.addEventListener('click', () => socket.emit('control:prev'));
if (footNext) footNext.addEventListener('click', () => socket.emit('control:next'));
if (footPrev) footPrev.addEventListener('click', () => socket.emit('control:prev'));

// Progress dragging / seek
let dragging = false;

function updateProgressUI() {
  const d = isFinite(audio.duration) ? audio.duration : (Playback?.state?.playlist[Playback?.state?.currentIndex]?.duration || 0);
  const t = audio.currentTime || 0;
  if (curTime) curTime.textContent = fmt(t);
  if (totTime) totTime.textContent = fmt(d);
  const pct = d > 0 ? Math.min(100, (t / d) * 100) : 0;
  if (progressFill) progressFill.style.width = `${pct}%`;
  if (progressHandle) progressHandle.style.left = `${pct}%`;
}

audio.addEventListener('timeupdate', () => { if (!dragging) updateProgressUI(); });
audio.addEventListener('loadedmetadata', () => updateProgressUI());

function barSeek(e) {
  if (!progressBar) return;
  const rect = progressBar.getBoundingClientRect();
  const x = Math.min(Math.max(0, e.clientX - rect.left), rect.width);
  const pct = x / rect.width;
  const d = audio.duration || 0;
  const target = pct * d;
  socket.emit('control:seek', target);
}

if (progressBar) progressBar.addEventListener('click', barSeek);

if (progressHandle) {
  progressHandle.addEventListener('mousedown', (e) => {
    e.preventDefault();
    dragging = true;
    const move = (ev) => {
      if (!progressBar) return;
      const rect = progressBar.getBoundingClientRect();
      const x = Math.min(Math.max(0, ev.clientX - rect.left), rect.width);
      const pct = x / rect.width;
      if (progressFill) progressFill.style.width = `${pct*100}%`;
      if (progressHandle) progressHandle.style.left = `${pct*100}%`;
    };
    const up = (ev) => {
      if (!progressBar) return;
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
}

// Auto-advance: notify server when current ends
audio.addEventListener('ended', () => {
  socket.emit('player:ended');
});

// Volume
if (volume) {
  volume.addEventListener('input', () => {
    audio.volume = parseFloat(volume.value);
  });
}

// Download UI
if (btnDownload) {
  btnDownload.addEventListener('click', async () => {
    if (!searchInput) return;
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
}

// Download progress updates
socket.on('download:update', payload => {
  addDownloadCard(payload);
});

function addDownloadCard({ id, title, status, progress, error }) {
  if (!downloadList) return;
  
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
  } catch (e) {}
}

if (btnRefresh) {
  btnRefresh.addEventListener('click', refreshPlaylist);
}

// Search suggestions
const popular = [
  "lofi hip hop radio",
  "top hits 2024",
  "classical study music",
  "edm mix",
  "piano chill"
];

if (searchInput && suggestions) {
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
}

// Real-time search functionality
const mainSearchInput = document.getElementById('mainSearchInput');
if (mainSearchInput) {
  mainSearchInput.addEventListener('input', function(e) {
      const searchQuery = e.target.value.toLowerCase().trim();
      const playlistRows = document.querySelectorAll('#playlist .playlist-row');
      
      if (searchQuery === '') {
          playlistRows.forEach(row => {
              row.style.display = 'grid';
          });
          return;
      }
      
      playlistRows.forEach(row => {
          const titleElement = row.children[1];
          const artistElement = row.children[2];
          
          const title = titleElement.textContent.toLowerCase();
          const artist = artistElement.textContent.toLowerCase();
          
          if (title.includes(searchQuery) || artist.includes(searchQuery)) {
              row.style.display = 'grid';
          } else {
              row.style.display = 'none';
          }
      });
  });

  mainSearchInput.addEventListener('keydown', function(e) {
      if (e.key === 'Escape') {
          e.target.value = '';
          document.querySelectorAll('#playlist .playlist-row').forEach(row => {
              row.style.display = 'grid';
          });
      }
  });
}

// Karaoke functionality
let karaokeInterval;
let isKaraokeActive = false;
let syncedLyrics = [];
let audioElement;

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

async function fetchLyrics(artist, song) {
    const cleanArtist = cleanArtistName(artist);
    const cleanSong = cleanSongName(song);
    
    console.log(`🎵 Searching for: "${cleanSong}" by "${cleanArtist}"`);
    
    const apiAttempts = [
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

function displaySyncedLyrics(lyricsResult) {
    const lyricsDisplay = document.getElementById('lyricsDisplay');
    if (!lyricsDisplay) return;
    
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
    
    displayPlainTextLyrics(lyricsResult.content);
}

function startSmoothSyncedKaraoke() {
    audioElement = document.getElementById('audio');
    
    if (!audioElement) {
        console.error('Audio element not found');
        displayPlainTextLyrics('Audio not available - using auto-scroll');
        return;
    }
    
    console.log('🎤 Starting smooth synced karaoke');
    
    if (karaokeInterval) {
        clearInterval(karaokeInterval);
    }
    
    karaokeInterval = setInterval(() => {
        if (!audioElement || audioElement.paused) return;
        
        const currentTime = audioElement.currentTime * 1000;
        const lines = document.querySelectorAll('#lyricsDisplay .lyric-line');
        
        let currentIndex = -1;
        for (let i = syncedLyrics.length - 1; i >= 0; i--) {
            if (currentTime >= syncedLyrics[i].timestamp) {
                currentIndex = i;
                break;
            }
        }
        
        const currentHighlight = document.querySelector('.lyric-highlight');
        const newHighlight = currentIndex >= 0 ? lines[currentIndex] : null;
        
        if (currentHighlight !== newHighlight) {
            lines.forEach(line => line.classList.remove('lyric-highlight'));
            
            if (newHighlight) {
                newHighlight.classList.add('lyric-highlight');
                newHighlight.scrollIntoView({ 
                    behavior: 'smooth', 
                    block: 'center' 
                });
            }
        }
        
    }, 100);
    
    console.log('✅ Smooth synced karaoke started');
}

function displayPlainTextLyrics(lyricsText) {
    const lyricsDisplay = document.getElementById('lyricsDisplay');
    if (!lyricsDisplay) return;
    
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

function initializeKaraokeHandlers() {
    const startBtn = document.getElementById('btnKaraoke');
    if (startBtn) {
        startBtn.addEventListener('click', startKaraoke);
    }
    
    const stopBtn = document.getElementById('btnStopKaraoke');
    if (stopBtn) {
        stopBtn.addEventListener('click', stopKaraoke);
    }
    
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
}

async function startKaraoke() {
    if (isKaraokeActive) return;
    
    const currentSong = document.getElementById('heroTitle')?.textContent;
    const currentArtist = document.getElementById('heroArtist')?.textContent;
    
    if (currentSong === 'No song' || currentArtist === '—') {
        alert('Please select a song first!');
        return;
    }
    
    const karaokeSection = document.getElementById('karaokeSection');
    if (karaokeSection) {
        karaokeSection.style.display = 'block';
    }
    
    const lyricsDisplay = document.getElementById('lyricsDisplay');
    if (lyricsDisplay) {
        lyricsDisplay.innerHTML = `
            <div class="loading-lyrics">
                <i class="fa-solid fa-spinner fa-spin"></i>
                <p>🎵 Loading lyrics...</p>
                <small>"${cleanSongName(currentSong)}" by ${cleanArtistName(currentArtist)}</small>
            </div>
        `;
    }
    
    const startBtn = document.getElementById('btnKaraoke');
    if (startBtn) {
        startBtn.innerHTML = '<i class="fa-solid fa-hourglass-half"></i> Loading...';
        startBtn.disabled = true;
    }
    
    isKaraokeActive = true;
    
    const lyricsResult = await fetchLyrics(currentArtist, currentSong);
    
    if (startBtn) {
        startBtn.innerHTML = '<i class="fa-solid fa-microphone"></i> 🎤 Karaoke Active';
        startBtn.disabled = false;
    }
    
    displaySyncedLyrics(lyricsResult);
}

function stopKaraoke() {
    console.log('🛑 Stopping karaoke');
    
    const karaokeSection = document.getElementById('karaokeSection');
    const karaokeBtn = document.getElementById('btnKaraoke');
    
    if (karaokeSection) {
        karaokeSection.style.display = 'none';
    }
    
    if (karaokeBtn) {
        karaokeBtn.innerHTML = '<i class="fa-solid fa-microphone"></i> Start Karaoke';
        karaokeBtn.disabled = false;
    }
    
    if (karaokeInterval) {
        clearInterval(karaokeInterval);
        karaokeInterval = null;
    }
    
    isKaraokeActive = false;
    syncedLyrics = [];
    
    console.log('✅ Karaoke stopped');
}

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

