import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import { GameRoomManager } from './gameRoomManager.js';
import { GameEventHandler } from './gameEventHandler.js';

const app = express();
const server = createServer(app);
const io = new Server(server, {
  cors: {
    origin: "http://localhost:3000",
    methods: ["GET", "POST"]
  }
});

app.use(cors());
app.use(express.json());

// Initialize game managers
const roomManager = new GameRoomManager();
const eventHandler = new GameEventHandler(roomManager);

// Socket.IO connection handling
io.on('connection', (socket) => {
  console.log(`Player connected: ${socket.id}`);
  
  // Handle game events
  eventHandler.handleConnection(socket, io);
  
  socket.on('disconnect', () => {
    console.log(`Player disconnected: ${socket.id}`);
    eventHandler.handleDisconnection(socket, io);
  });
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// Get room stats
app.get('/api/rooms', (req, res) => {
  res.json(roomManager.getRoomStats());
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});