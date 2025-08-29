// server.js
// Node.js + Express + Socket.io backend for synchronized playback, playlist, and downloads

const express = require('express'); // Web server [7]
const path = require('path'); // Built-in
const fs = require('fs'); // Built-in
const { spawn } = require('child_process'); // Built-in
const http = require('http');
const app = express();
const server = http.createServer(app);
const { Server } = require('socket.io');
// Socket.IO v4 server for real-time sync [8]
const io = new Server(server, {
  cors: { origin: true },
  pingInterval: 25000,
  pingTimeout: 20000
});

const PUBLIC_DIR = path.join(__dirname, 'public');
const SONGS_DIR = path.join(PUBLIC_DIR, 'songs');
const SONGS_JSON = path.join(__dirname, 'songs.json');

// Serve static assets and MP3s efficiently with express.static
// Express handles byte-range requests enabling seeking and streaming support [7][10]
app.use(express.static(PUBLIC_DIR, {
  fallthrough: true,
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.mp3')) {
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    }
  }
}));

app.use(express.json());

// In-memory global playback state maintained by the server as the source of truth.
// Clients request sync and adopt this state (with serverTime compensation).
let state = {
  playlist: [], // array of {id,title,artist,filename,duration}
  currentIndex: 0,
  isPlaying: false,
  // The last known position in seconds when 'startedAt' was set
  positionSec: 0,
  // Unix ms timestamp on the server when playback started/resumed for drift compensation
  startedAt: 0,
  // Increment to invalidate stale client actions if needed
  version: 0
};

// Active downloads map: downloadId -> { title, status, progress, error }
const downloads = new Map();

// Utility to load songs.json
function loadPlaylist() {
  try {
    const data = fs.readFileSync(SONGS_JSON, 'utf-8');
    state.playlist = JSON.parse(data);
  } catch (e) {
    console.warn('songs.json not found or invalid, initializing empty playlist');
    state.playlist = [];
  }
}

// Write helper to broadcast state to all clients
function broadcastState() {
  io.emit('sync:state', {
    state,
    serverTime: Date.now()
  });
}

// Calculate current playback position based on server time to keep clients in sync
function getCurrentPositionSec() {
  if (!state.isPlaying) return state.positionSec;
  const elapsed = (Date.now() - state.startedAt) / 1000;
  return state.positionSec + Math.max(0, elapsed);
}

// Advance to next track
function nextTrack() {
  if (state.playlist.length === 0) return;
  state.currentIndex = (state.currentIndex + 1) % state.playlist.length;
  state.positionSec = 0;
  state.startedAt = Date.now();
  state.isPlaying = true;
  state.version++;
  broadcastState();
}

// Previous track (restart if >3s in)
function prevTrack() {
  if (state.playlist.length === 0) return;
  const pos = getCurrentPositionSec();
  if (pos > 3) {
    state.positionSec = 0;
    state.startedAt = Date.now();
    state.version++;
  } else {
    state.currentIndex = (state.currentIndex - 1 + state.playlist.length) % state.playlist.length;
    state.positionSec = 0;
    state.startedAt = Date.now();
    state.isPlaying = true;
    state.version++;
  }
  broadcastState();
}

// REST: get current playlist
app.get('/api/playlist', (req, res) => {
  res.json({ playlist: state.playlist });
});

// REST: trigger playlist regeneration (scan songs dir)
app.post('/api/playlist/refresh', (req, res) => {
  // Run the Python script to regenerate songs.json
  const py = spawn('python3', [path.join(__dirname, 'generate_playlist.py')], { cwd: __dirname });
  let stderr = '';
  py.stderr.on('data', d => stderr += d.toString());
  py.on('close', code => {
    if (code !== 0) {
      return res.status(500).json({ ok: false, error: 'Playlist generation failed', stderr });
    }
    loadPlaylist();
    state.version++;
    broadcastState();
    return res.json({ ok: true, count: state.playlist.length });
  });
});

// REST: start a yt-dlp download given a query or URL
app.post('/api/download', (req, res) => {
  const { query } = req.body || {};
  if (!query || typeof query !== 'string' || query.trim().length === 0) {
    return res.status(400).json({ ok: false, error: 'Query or URL is required' });
  }

  const downloadId = 'dl_' + Math.random().toString(36).slice(2);
  const proc = spawn(path.join(__dirname, 'download_song.sh'), [query], {
    cwd: __dirname,
    env: process.env
  });

  downloads.set(downloadId, { title: query, status: 'running', progress: 0, error: null });
  io.emit('download:update', { id: downloadId, status: 'running', progress: 0, title: query });

  let stderr = '';
  proc.stdout.on('data', chunk => {
    const line = chunk.toString();
    // Naive progress parse for yt-dlp "[download]  42.3% ..."; robust enough for UI [9][11]
    const m = line.match(/\[download\]\s+(\d+(?:\.\d+)?)%/i);
    if (m) {
      const p = Math.max(0, Math.min(100, parseFloat(m[1])));
      const d = downloads.get(downloadId);
      if (d) {
        d.progress = p;
        io.emit('download:update', { id: downloadId, status: 'running', progress: p, title: query });
      }
    }
  });
  proc.stderr.on('data', chunk => {
    stderr += chunk.toString();
  });
  proc.on('close', code => {
    const d = downloads.get(downloadId);
    if (code === 0) {
      if (d) {
        d.status = 'completed';
        d.progress = 100;
      }
      // Regenerate playlist and notify clients
      const py = spawn('python3', [path.join(__dirname, 'generate_playlist.py')], { cwd: __dirname });
      py.on('close', c2 => {
        loadPlaylist();
        state.version++;
        io.emit('download:update', { id: downloadId, status: 'completed', progress: 100, title: query });
        broadcastState();
      });
    } else {
      if (d) {
        d.status = 'failed';
        d.error = stderr || 'Unknown error';
      }
      io.emit('download:update', { id: downloadId, status: 'failed', progress: 0, title: query, error: d?.error });
    }
  });

  res.json({ ok: true, id: downloadId });
});

// Socket.io real-time synchronization
io.on('connection', (socket) => {
  // Send initial state with server time for drift correction on the client [8]
  socket.emit('sync:state', { state, serverTime: Date.now() });

  // Live user count
  io.emit('presence:count', { count: io.engine.clientsCount });

  socket.on('disconnect', () => {
    io.emit('presence:count', { count: io.engine.clientsCount });
  });

  // Control events: only the server mutates the state; clients broadcast intents.
  socket.on('control:play', () => {
    if (state.playlist.length === 0) return;
    if (!state.isPlaying) {
      state.isPlaying = true;
      state.startedAt = Date.now();
      state.version++;
      broadcastState();
    }
  });

  socket.on('control:pause', () => {
    if (state.isPlaying) {
      state.positionSec = getCurrentPositionSec();
      state.isPlaying = false;
      state.startedAt = 0;
      state.version++;
      broadcastState();
    }
  });

  socket.on('control:seek', (posSec) => {
    if (typeof posSec !== 'number' || !isFinite(posSec)) return;
    state.positionSec = Math.max(0, posSec);
    if (state.isPlaying) state.startedAt = Date.now();
    state.version++;
    broadcastState();
  });

  socket.on('control:next', () => nextTrack());
  socket.on('control:prev', () => prevTrack());

  socket.on('control:playIndex', (index) => {
    if (typeof index !== 'number' || !isFinite(index)) return;
    if (index < 0 || index >= state.playlist.length) return;
    state.currentIndex = index;
    state.positionSec = 0;
    state.isPlaying = true;
    state.startedAt = Date.now();
    state.version++;
    broadcastState();
  });

  // Client indicates a track ended locally -> server advances canonically
  socket.on('player:ended', () => {
    nextTrack();
  });
});

loadPlaylist();

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});

