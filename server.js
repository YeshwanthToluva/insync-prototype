const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// Room management
const rooms = new Map(); // roomId -> { users: Map, host: userId, playlist: [], state: {} }

// Default playlist state
function createDefaultState() {
    return {
        playlist: [],
        currentIndex: 0,
        isPlaying: false,
        positionSec: 0,
        startedAt: null,
        volume: 1
    };
}

// Socket.IO connection handling
io.on('connection', (socket) => {
    console.log(`User connected: ${socket.id}`);
    
    // Room creation
    socket.on('room:create', async ({ roomId, displayName }) => {
        console.log(`Creating room: ${roomId} by ${displayName}`);
        
        // Check if room already exists
        if (rooms.has(roomId)) {
            socket.emit('room:error', { message: 'Room already exists. Please try a different code.' });
            return;
        }
        
        // Create new room
        const room = {
            id: roomId,
            host: socket.id,
            hostName: displayName,
            users: new Map([[socket.id, { displayName, isHost: true }]]),
            playlist: [],
            state: createDefaultState()
        };
        
        // Load playlist for the room
        try {
            const songsJsonPath = path.join(__dirname, 'songs.json');
            let playlist = [];
            
            if (fs.existsSync(songsJsonPath)) {
                const songsData = fs.readFileSync(songsJsonPath, 'utf8');
                playlist = JSON.parse(songsData);
                console.log(`Loaded ${playlist.length} songs from songs.json`);
            } else {
                // Read from directory
                const songsDir = path.join(__dirname, 'public', 'songs');
                if (fs.existsSync(songsDir)) {
                    const files = fs.readdirSync(songsDir).filter(file =>
                        file.toLowerCase().endsWith('.mp3') || 
                        file.toLowerCase().endsWith('.wav') || 
                        file.toLowerCase().endsWith('.ogg') ||
                        file.toLowerCase().endsWith('.m4a')
                    );
                    
                    playlist = files.map(file => {
                        const nameWithoutExt = file.replace(/\.[^/.]+$/, "");
                        const parts = nameWithoutExt.split(' - ');
                        
                        return {
                            title: parts.length > 1 ? parts[1] : nameWithoutExt,
                            artist: parts.length > 1 ? parts[0] : "Unknown Artist",
                            duration: null,
                            filename: file
                        };
                    });
                    console.log(`Found ${playlist.length} songs in directory`);
                }
            }
            
            room.state.playlist = playlist;
            
        } catch (error) {
            console.error('Error loading playlist for room:', error);
        }
        
        rooms.set(roomId, room);
        socket.join(roomId);
        socket.roomId = roomId;
        socket.displayName = displayName;
        
        console.log(`Room ${roomId} created successfully with ${room.state.playlist.length} songs`);
        
        socket.emit('room:created', {
            roomId: roomId,
            hostName: displayName,
            isHost: true
        });
        
        // Send initial state
        socket.emit('sync:state', {
            state: room.state,
            serverTime: Date.now()
        });
        
        // Update room presence
        io.to(roomId).emit('room:presence', { count: room.users.size });
    });
    
    // Room joining
    socket.on('room:join', ({ roomId, displayName }) => {
        console.log(`${displayName} trying to join room: ${roomId}`);
        
        const room = rooms.get(roomId);
        if (!room) {
            socket.emit('room:error', { message: 'Room not found. Please check the room code.' });
            return;
        }
        
        // Add user to room
        room.users.set(socket.id, { displayName, isHost: false });
        socket.join(roomId);
        socket.roomId = roomId;
        socket.displayName = displayName;
        
        console.log(`${displayName} joined room ${roomId} successfully`);
        
        socket.emit('room:joined', {
            roomId: roomId,
            hostName: room.hostName,
            isHost: false
        });
        
        // Notify other users in room
        socket.to(roomId).emit('room:userJoined', { displayName });
        
        // Send current room state
        socket.emit('sync:state', {
            state: room.state,
            serverTime: Date.now()
        });
        
        // Update room presence for all users
        io.to(roomId).emit('room:presence', { count: room.users.size });
    });
    
    // Room rejoin (for reconnections)
    socket.on('room:rejoin', ({ roomId, displayName }) => {
        const room = rooms.get(roomId);
        if (!room) {
            socket.emit('room:error', { message: 'Room no longer exists' });
            return;
        }
        
        // Re-add user to room
        room.users.set(socket.id, { 
            displayName, 
            isHost: room.host === socket.id 
        });
        socket.join(roomId);
        socket.roomId = roomId;
        socket.displayName = displayName;
        
        // Send current state
        socket.emit('sync:state', {
            state: room.state,
            serverTime: Date.now()
        });
        
        io.to(roomId).emit('room:presence', { count: room.users.size });
    });
    
    // Music control events (only for room members)
    socket.on('control:play', () => {
        if (!socket.roomId) return;
        
        const room = rooms.get(socket.roomId);
        if (!room) return;
        
        // Only host can control (remove this check if you want all users to control)
        if (room.host !== socket.id) return;
        
        room.state.isPlaying = true;
        room.state.startedAt = Date.now();
        
        // Broadcast to all users in room
        io.to(socket.roomId).emit('sync:state', {
            state: room.state,
            serverTime: Date.now()
        });
    });
    
    socket.on('control:pause', () => {
        if (!socket.roomId) return;
        
        const room = rooms.get(socket.roomId);
        if (!room) return;
        
        // Only host can control
        if (room.host !== socket.id) return;
        
        room.state.isPlaying = false;
        room.state.startedAt = null;
        
        io.to(socket.roomId).emit('sync:state', {
            state: room.state,
            serverTime: Date.now()
        });
    });
    
    socket.on('control:next', () => {
        if (!socket.roomId) return;
        
        const room = rooms.get(socket.roomId);
        if (!room || room.state.playlist.length === 0) return;
        
        if (room.host !== socket.id) return;
        
        room.state.currentIndex = (room.state.currentIndex + 1) % room.state.playlist.length;
        room.state.positionSec = 0;
        room.state.startedAt = room.state.isPlaying ? Date.now() : null;
        
        io.to(socket.roomId).emit('sync:state', {
            state: room.state,
            serverTime: Date.now()
        });
    });
    
    socket.on('control:prev', () => {
        if (!socket.roomId) return;
        
        const room = rooms.get(socket.roomId);
        if (!room || room.state.playlist.length === 0) return;
        
        if (room.host !== socket.id) return;
        
        room.state.currentIndex = room.state.currentIndex > 0 
            ? room.state.currentIndex - 1 
            : room.state.playlist.length - 1;
        room.state.positionSec = 0;
        room.state.startedAt = room.state.isPlaying ? Date.now() : null;
        
        io.to(socket.roomId).emit('sync:state', {
            state: room.state,
            serverTime: Date.now()
        });
    });
    
    socket.on('control:seek', (position) => {
        if (!socket.roomId) return;
        
        const room = rooms.get(socket.roomId);
        if (!room) return;
        
        if (room.host !== socket.id) return;
        
        room.state.positionSec = position;
        room.state.startedAt = room.state.isPlaying ? Date.now() : null;
        
        io.to(socket.roomId).emit('sync:state', {
            state: room.state,
            serverTime: Date.now()
        });
    });
    
    socket.on('control:playIndex', (index) => {
        if (!socket.roomId) return;
        
        const room = rooms.get(socket.roomId);
        if (!room || !room.state.playlist[index]) return;
        
        if (room.host !== socket.id) return;
        
        room.state.currentIndex = index;
        room.state.positionSec = 0;
        room.state.isPlaying = true;
        room.state.startedAt = Date.now();
        
        io.to(socket.roomId).emit('sync:state', {
            state: room.state,
            serverTime: Date.now()
        });
    });
    
    socket.on('player:ended', () => {
        if (!socket.roomId) return;
        
        const room = rooms.get(socket.roomId);
        if (!room) return;
        
        // Auto-advance to next song
        if (room.state.currentIndex < room.state.playlist.length - 1) {
            room.state.currentIndex++;
            room.state.positionSec = 0;
            room.state.startedAt = Date.now();
            
            io.to(socket.roomId).emit('sync:state', {
                state: room.state,
                serverTime: Date.now()
            });
        } else {
            // End of playlist
            room.state.isPlaying = false;
            room.state.startedAt = null;
            
            io.to(socket.roomId).emit('sync:state', {
                state: room.state,
                serverTime: Date.now()
            });
        }
    });
    
    // Handle disconnection
    socket.on('disconnect', () => {
        console.log(`User disconnected: ${socket.id}`);
        
        if (socket.roomId) {
            const room = rooms.get(socket.roomId);
            if (room) {
                const user = room.users.get(socket.id);
                room.users.delete(socket.id);
                
                if (user) {
                    console.log(`${user.displayName} left room ${socket.roomId}`);
                    socket.to(socket.roomId).emit('room:userLeft', { 
                        displayName: user.displayName 
                    });
                }
                
                // Update room presence
                io.to(socket.roomId).emit('room:presence', { count: room.users.size });
                
                // Clean up empty rooms
                if (room.users.size === 0) {
                    console.log(`Room ${socket.roomId} is empty, cleaning up`);
                    rooms.delete(socket.roomId);
                } else if (room.host === socket.id) {
                    // Transfer host to another user
                    const newHostId = Array.from(room.users.keys())[0];
                    room.host = newHostId;
                    room.users.get(newHostId).isHost = true;
                    console.log(`Host transferred to ${room.users.get(newHostId).displayName}`);
                }
            }
        }
    });
});

// API Routes
app.get('/api/playlist', (req, res) => {
    try {
        // First try to read from songs.json if it exists
        const songsJsonPath = path.join(__dirname, 'songs.json');
        if (fs.existsSync(songsJsonPath)) {
            const songsData = fs.readFileSync(songsJsonPath, 'utf8');
            const playlist = JSON.parse(songsData);
            res.json({ playlist });
            return;
        }
        
        // Fallback: read directory contents
        const songsDir = path.join(__dirname, 'public', 'songs');
        if (!fs.existsSync(songsDir)) {
            res.json({ playlist: [] });
            return;
        }
        
        const files = fs.readdirSync(songsDir).filter(file =>
            file.toLowerCase().endsWith('.mp3') || 
            file.toLowerCase().endsWith('.wav') || 
            file.toLowerCase().endsWith('.ogg') ||
            file.toLowerCase().endsWith('.m4a')
        );
        
        const playlist = files.map((file, index) => {
            // Try to parse filename for title/artist
            const nameWithoutExt = file.replace(/\.[^/.]+$/, "");
            const parts = nameWithoutExt.split(' - ');
            
            return {
                title: parts.length > 1 ? parts[1] : nameWithoutExt,
                artist: parts.length > 1 ? parts[0] : "Unknown Artist",
                duration: null, // Will be detected by audio element
                filename: file
            };
        });
        
        console.log(`Found ${playlist.length} songs in directory`);
        res.json({ playlist });
        
    } catch (error) {
        console.error('Error reading playlist:', error);
        res.status(500).json({ error: 'Failed to load playlist' });
    }
});

app.post('/api/playlist/refresh', (req, res) => {
    res.json({ ok: true });
});

app.post('/api/download', (req, res) => {
    const { query } = req.body;
    console.log(`Download requested: ${query}`);
    res.json({ ok: true });
});

// Serve songs with range support for seeking
app.get('/songs/:filename', (req, res) => {
    const filename = req.params.filename;
    const filePath = path.join(__dirname, 'public', 'songs', filename);
    
    console.log(`Serving song: ${filePath}`);
    
    if (fs.existsSync(filePath)) {
        const stat = fs.statSync(filePath);
        const fileSize = stat.size;
        const range = req.headers.range;
        
        if (range) {
            // Handle range requests for audio seeking
            const parts = range.replace(/bytes=/, "").split("-");
            const start = parseInt(parts[0], 10);
            const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
            const chunksize = (end - start) + 1;
            const file = fs.createReadStream(filePath, { start, end });
            
            res.writeHead(206, {
                'Content-Range': `bytes ${start}-${end}/${fileSize}`,
                'Accept-Ranges': 'bytes',
                'Content-Length': chunksize,
                'Content-Type': 'audio/mpeg',
                'Cache-Control': 'public, max-age=3600'
            });
            file.pipe(res);
        } else {
            // Full file request
            res.writeHead(200, {
                'Content-Length': fileSize,
                'Content-Type': 'audio/mpeg',
                'Accept-Ranges': 'bytes',
                'Cache-Control': 'public, max-age=3600'
            });
            fs.createReadStream(filePath).pipe(res);
        }
    } else {
        console.log(`File not found: ${filePath}`);
        res.status(404).json({ error: 'Song not found' });
    }
});

// Admin dashboard route
app.get('/admin', (req, res) => {
    res.send(`
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>InSync Admin Dashboard</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { 
            font-family: 'Inter', Arial, sans-serif; 
            background: #0f0f0f; 
            color: #fff; 
            padding: 20px;
            line-height: 1.6;
        }
        .header { 
            text-align: center; 
            margin-bottom: 30px; 
        }
        .header h1 { 
            color: #3b82f6; 
            font-size: 2rem; 
            margin-bottom: 10px;
        }
        .stats { 
            display: grid; 
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); 
            gap: 20px; 
            margin-bottom: 30px;
        }
        .stat-card { 
            background: #1a1a1a; 
            border: 1px solid #333; 
            border-radius: 8px; 
            padding: 20px; 
            text-align: center;
        }
        .stat-number { 
            font-size: 2rem; 
            font-weight: bold; 
            color: #3b82f6; 
        }
        .stat-label { 
            color: #999; 
            margin-top: 5px;
        }
        .rooms-container { 
            display: grid; 
            gap: 20px;
        }
        .room-card { 
            background: #1a1a1a; 
            border: 1px solid #333; 
            border-radius: 12px; 
            padding: 20px; 
            position: relative;
        }
        .room-header { 
            display: flex; 
            justify-content: space-between; 
            align-items: center; 
            margin-bottom: 15px;
            flex-wrap: wrap;
        }
        .room-id { 
            font-size: 1.5rem; 
            font-weight: bold; 
            color: #3b82f6;
        }
        .room-host { 
            background: #10b981; 
            color: white; 
            padding: 4px 12px; 
            border-radius: 20px; 
            font-size: 0.9rem;
        }
        .users-list { 
            display: flex; 
            flex-wrap: wrap; 
            gap: 8px; 
            margin-bottom: 15px;
        }
        .user-tag { 
            background: #374151; 
            padding: 4px 12px; 
            border-radius: 16px; 
            font-size: 0.9rem;
        }
        .now-playing { 
            background: #292929; 
            border-left: 4px solid #3b82f6; 
            padding: 15px; 
            border-radius: 0 8px 8px 0; 
        }
        .song-title { 
            font-weight: bold; 
            margin-bottom: 5px;
        }
        .song-artist { 
            color: #999;
        }
        .playback-status { 
            display: flex; 
            align-items: center; 
            gap: 10px; 
            margin-top: 10px;
        }
        .status-playing { 
            color: #10b981; 
        }
        .status-paused { 
            color: #f59e0b; 
        }
        .empty-state { 
            text-align: center; 
            color: #666; 
            padding: 40px; 
            font-style: italic;
        }
        .refresh-btn {
            background: #3b82f6;
            color: white;
            border: none;
            padding: 10px 20px;
            border-radius: 6px;
            cursor: pointer;
            font-size: 1rem;
            margin-bottom: 20px;
        }
        .refresh-btn:hover {
            background: #2563eb;
        }
        @media (max-width: 768px) {
            .room-header { flex-direction: column; align-items: flex-start; gap: 10px; }
            .stats { grid-template-columns: 1fr 1fr; }
        }
    </style>
</head>
<body>
    <div class="header">
        <h1>🎵 InSync Admin Dashboard</h1>
        <button class="refresh-btn" onclick="location.reload()">🔄 Refresh</button>
    </div>
    
    <div class="stats">
        <div class="stat-card">
            <div class="stat-number" id="totalRooms">0</div>
            <div class="stat-label">Active Rooms</div>
        </div>
        <div class="stat-card">
            <div class="stat-number" id="totalUsers">0</div>
            <div class="stat-label">Connected Users</div>
        </div>
        <div class="stat-card">
            <div class="stat-number" id="playingRooms">0</div>
            <div class="stat-label">Rooms Playing</div>
        </div>
    </div>

    <div class="rooms-container" id="roomsContainer">
        <div class="empty-state">Loading rooms...</div>
    </div>

    <script>
        async function loadDashboard() {
            try {
                const response = await fetch('/admin/data');
                const data = await response.json();
                
                // Update stats
                document.getElementById('totalRooms').textContent = data.totalRooms;
                document.getElementById('totalUsers').textContent = data.totalUsers;
                document.getElementById('playingRooms').textContent = data.playingRooms;
                
                // Update rooms
                const container = document.getElementById('roomsContainer');
                
                if (data.rooms.length === 0) {
                    container.innerHTML = '<div class="empty-state">No active rooms</div>';
                    return;
                }
                
                container.innerHTML = data.rooms.map(room => \`
                    <div class="room-card">
                        <div class="room-header">
                            <div class="room-id">Room: \${room.id}</div>
                            <div class="room-host">👑 \${room.hostName}</div>
                        </div>
                        
                        <div class="users-list">
                            \${room.users.map(user => \`
                                <span class="user-tag">\${user.displayName}\${user.isHost ? ' 👑' : ''}</span>
                            \`).join('')}
                        </div>
                        
                        \${room.currentSong ? \`
                            <div class="now-playing">
                                <div class="song-title">🎵 \${room.currentSong.title}</div>
                                <div class="song-artist">by \${room.currentSong.artist}</div>
                                <div class="playback-status">
                                    <span class="\${room.isPlaying ? 'status-playing' : 'status-paused'}">
                                        \${room.isPlaying ? '▶️ Playing' : '⏸️ Paused'}
                                    </span>
                                    <span>|\${room.currentIndex + 1}/\${room.playlistLength}</span>
                                </div>
                            </div>
                        \` : \`
                            <div class="now-playing">
                                <div class="song-title">No song selected</div>
                                <div class="song-artist">Playlist: \${room.playlistLength} songs</div>
                            </div>
                        \`}
                    </div>
                \`).join('');
                
            } catch (error) {
                console.error('Failed to load dashboard:', error);
                document.getElementById('roomsContainer').innerHTML = 
                    '<div class="empty-state">Error loading data</div>';
            }
        }
        
        // Load initially
        loadDashboard();
        
        // Auto-refresh every 3 seconds
        setInterval(loadDashboard, 3000);
    </script>
</body>
</html>
    `);
});

// Admin data API
app.get('/admin/data', (req, res) => {
    try {
        const roomsData = [];
        let totalUsers = 0;
        let playingRooms = 0;
        
        rooms.forEach((room, roomId) => {
            totalUsers += room.users.size;
            if (room.state.isPlaying) playingRooms++;
            
            const currentSong = room.state.playlist[room.state.currentIndex];
            
            roomsData.push({
                id: roomId,
                hostName: room.hostName,
                users: Array.from(room.users.values()),
                currentSong: currentSong || null,
                isPlaying: room.state.isPlaying,
                currentIndex: room.state.currentIndex,
                playlistLength: room.state.playlist.length
            });
        });
        
        res.json({
            totalRooms: rooms.size,
            totalUsers: totalUsers,
            playingRooms: playingRooms,
            rooms: roomsData
        });
    } catch (error) {
        console.error('Admin data error:', error);
        res.status(500).json({ error: 'Failed to get admin data' });
    }
});



// Start server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`🎵 InSync server running on port ${PORT}`);
    console.log(`📱 Open http://localhost:${PORT} in your browser`);
    console.log(`🎶 Songs directory: ${path.join(__dirname, 'public', 'songs')}`);
});

