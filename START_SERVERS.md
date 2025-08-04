# How to Start the Game Servers

## 🚀 Quick Start (Recommended)

### Option 1: Start Both Servers Together
```bash
npm run dev
```
This starts both the game server (port 3001) and client dev server (port 3000) simultaneously.

### Option 2: Start Servers Separately

**Terminal 1 - Game Server:**
```bash
npm run server:dev
# or: node server/index.js
```

**Terminal 2 - Client Dev Server:**  
```bash
npm run client:dev
# or: npx vite
```

## 🎮 Access the Game

Once both servers are running:

**Timeline Flow (New):**
- Human-AI: `http://localhost:3000/?mode=human-ai`
- Human-Human: `http://localhost:3000/?mode=human-human`

**Legacy Flow:**
- Human-AI: `http://localhost:3000/?mode=human-ai&timeline=false`

## 🔧 Troubleshooting

### Maps Not Loading (Fallback Maps Used)
**Problem:** You see warnings like:
```
⚠️ Server not running or API not available for 1P1G, using fallback maps
💡 To get real maps and enable multiplayer, start the server with: npm run dev
```

**Solution:** Start the game server:
```bash
npm run dev
```

### Server Connection Errors
**Problem:** WebSocket errors or network timeouts

**Solutions:**
1. Make sure port 3001 is not in use by another process
2. Check that both servers are running
3. Try restarting both servers

### Port Already in Use
**Problem:** `Error: listen EADDRINUSE: address already in use :::3000`

**Solutions:**
```bash
# Kill processes on specific ports
lsof -ti:3000 | xargs kill -9
lsof -ti:3001 | xargs kill -9

# Then restart
npm run dev
```

## 📊 Server Status Check

**Game Server Health Check:**
```bash
curl http://localhost:3001/health
```
Should return: `{"status":"OK","timestamp":"..."}`

**Map API Test:**
```bash
curl http://localhost:3001/api/maps/1P1G
```
Should return JSON with map data.

## 🎯 When Servers Are Running

**You should see:**
- ✅ Real map data loaded from server
- ✅ Multiplayer functionality available
- ✅ No fallback map warnings
- ✅ WebSocket connections working

**Console should show:**
```
🗺️ Loading map data from server...
🌐 Fetching 1P1G maps from server...
✅ Loaded 20 1P1G maps from server
...
```