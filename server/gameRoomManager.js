import { v4 as uuidv4 } from 'uuid';

export class GameRoomManager {
  constructor() {
    this.rooms = new Map();
    this.playerRooms = new Map(); // Track which room each player is in
  }

  createRoom(gameMode = 'human-ai', experimentType = '2P2G') {
    const roomId = uuidv4();
    const room = {
      id: roomId,
      gameMode, // 'human-ai' or 'human-human'
      experimentType, // '1P1G', '1P2G', '2P2G', '2P3G'
      players: [],
      gameState: null,
      status: 'waiting', // 'waiting', 'playing', 'finished'
      createdAt: new Date(),
      maxPlayers: gameMode === 'human-human' ? 2 : 1
    };
    
    this.rooms.set(roomId, room);
    return room;
  }

  joinRoom(playerId, roomId = null, gameMode = 'human-ai') {
    let room;
    
    if (roomId) {
      room = this.rooms.get(roomId);
      if (!room) {
        throw new Error('Room not found');
      }
    } else {
      // Find available room or create new one
      room = this.findAvailableRoom(gameMode) || this.createRoom(gameMode);
    }

    if (room.players.length >= room.maxPlayers) {
      throw new Error('Room is full');
    }

    // Remove player from previous room if exists
    this.leaveRoom(playerId);

    // Add player to room
    const player = {
      id: playerId,
      joinedAt: new Date(),
      isReady: false,
      isMatchReady: false
    };
    
    room.players.push(player);
    this.playerRooms.set(playerId, room.id);
    
    return room;
  }

  leaveRoom(playerId) {
    const roomId = this.playerRooms.get(playerId);
    if (roomId) {
      const room = this.rooms.get(roomId);
      if (room) {
        room.players = room.players.filter(p => p.id !== playerId);
        
        // Delete empty rooms
        if (room.players.length === 0) {
          this.rooms.delete(roomId);
        }
      }
      this.playerRooms.delete(playerId);
    }
  }

  findAvailableRoom(gameMode) {
    for (const room of this.rooms.values()) {
      if (room.gameMode === gameMode && 
          room.status === 'waiting' && 
          room.players.length < room.maxPlayers) {
        return room;
      }
    }
    return null;
  }

  getRoom(roomId) {
    return this.rooms.get(roomId);
  }

  getPlayerRoom(playerId) {
    const roomId = this.playerRooms.get(playerId);
    return roomId ? this.rooms.get(roomId) : null;
  }

  updateGameState(roomId, gameState) {
    const room = this.rooms.get(roomId);
    if (room) {
      room.gameState = gameState;
      room.lastUpdated = new Date();
    }
  }

  setRoomStatus(roomId, status) {
    const room = this.rooms.get(roomId);
    if (room) {
      room.status = status;
    }
  }

  setPlayerReady(playerId, isReady = true) {
    const room = this.getPlayerRoom(playerId);
    if (room) {
      const player = room.players.find(p => p.id === playerId);
      if (player) {
        player.isReady = isReady;
      }
    }
  }

  setPlayerMatchReady(playerId, isReady = true) {
    const room = this.getPlayerRoom(playerId);
    if (room) {
      const player = room.players.find(p => p.id === playerId);
      if (player) {
        player.isMatchReady = isReady;
      }
    }
  }

  areAllPlayersReady(roomId) {
    const room = this.rooms.get(roomId);
    return room && room.players.length === room.maxPlayers && 
           room.players.every(p => p.isReady);
  }

  areAllPlayersMatchReady(roomId) {
    const room = this.rooms.get(roomId);
    return room && room.players.length === room.maxPlayers &&
           room.players.every(p => p.isMatchReady);
  }

  getRoomStats() {
    return {
      totalRooms: this.rooms.size,
      activeRooms: Array.from(this.rooms.values()).filter(r => r.status === 'playing').length,
      waitingRooms: Array.from(this.rooms.values()).filter(r => r.status === 'waiting').length,
      totalPlayers: this.playerRooms.size
    };
  }

  cleanupInactiveRooms(maxAge = 30 * 60 * 1000) { // 30 minutes
    const now = new Date();
    for (const [roomId, room] of this.rooms.entries()) {
      if (now - room.createdAt > maxAge && room.status === 'waiting' && room.players.length === 0) {
        this.rooms.delete(roomId);
      }
    }
  }
}
