export class GameEventHandler {
  constructor(roomManager) {
    this.roomManager = roomManager;
  }

  handleConnection(socket, io) {
    // Join room
    socket.on('join-room', (data) => {
      try {
        const { roomId, gameMode = 'human-ai', experimentType = '2P2G' } = data;
        const room = this.roomManager.joinRoom(socket.id, roomId, gameMode);
        
        socket.join(room.id);
        socket.emit('room-joined', {
          roomId: room.id,
          gameMode: room.gameMode,
          experimentType: room.experimentType,
          players: room.players,
          isHost: room.players[0].id === socket.id
        });

        // Notify other players
        socket.to(room.id).emit('player-joined', {
          playerId: socket.id,
          players: room.players
        });

        // If room is now full, notify both players with a synchronized timestamp
        if (room.players.length === room.maxPlayers) {
          io.to(room.id).emit('room-full', {
            roomId: room.id,
            players: room.players,
            connectedAt: Date.now()
          });
        }

        console.log(`Player ${socket.id} joined room ${room.id}`);
      } catch (error) {
        socket.emit('error', { message: error.message });
      }
    });

    // Player ready at the Ready screen (button click)
    socket.on('player-ready', () => {
      const room = this.roomManager.getPlayerRoom(socket.id);
      if (room) {
        this.roomManager.setPlayerReady(socket.id, true);

        io.to(room.id).emit('player-ready-status', {
          playerId: socket.id,
          players: room.players
        });
        // Note: Do NOT start the game here; wait for match-play space press
      }
    });

    // Match play ready (SPACE pressed on "Game is Ready" screen)
    socket.on('match-play-ready', () => {
      const room = this.roomManager.getPlayerRoom(socket.id);
      if (room) {
        this.roomManager.setPlayerMatchReady(socket.id, true);

        // Optionally broadcast status updates here if UI needs it
        io.to(room.id).emit('match-play-ready-status', {
          playerId: socket.id,
          players: room.players
        });

        // Start game only when BOTH players have pressed space
        if (this.roomManager.areAllPlayersMatchReady(room.id)) {
          this.startGame(room, io);
        }
      }
    });

    // Game actions
    socket.on('game-action', (data) => {
      const room = this.roomManager.getPlayerRoom(socket.id);
      if (room && room.status === 'playing') {
        // Broadcast action to other players
        socket.to(room.id).emit('player-action', {
          playerId: socket.id,
          action: data.action,
          timestamp: Date.now()
        });
      }
    });

    // Game state sync
    socket.on('sync-game-state', (gameState) => {
      const room = this.roomManager.getPlayerRoom(socket.id);
      if (room) {
        this.roomManager.updateGameState(room.id, gameState);
        socket.to(room.id).emit('game-state-update', gameState);
      }
    });

    // Trial completion
    socket.on('trial-complete', (trialData) => {
      const room = this.roomManager.getPlayerRoom(socket.id);
      if (room) {
        io.to(room.id).emit('trial-completed', {
          playerId: socket.id,
          trialData
        });
      }
    });

    // Experiment completion
    socket.on('experiment-complete', (experimentData) => {
      const room = this.roomManager.getPlayerRoom(socket.id);
      if (room) {
        this.roomManager.setRoomStatus(room.id, 'finished');
        // Reset readiness flags so next game requires both players to press again
        try {
          if (Array.isArray(room.players)) {
            room.players.forEach(p => {
              p.isReady = false;
              p.isMatchReady = false;
            });
          }
        } catch (_) { /* noop */ }
        io.to(room.id).emit('experiment-completed', {
          playerId: socket.id,
          experimentData
        });
      }
    });

    // Chat messages (for human-human mode)
    socket.on('chat-message', (message) => {
      const room = this.roomManager.getPlayerRoom(socket.id);
      if (room) {
        socket.to(room.id).emit('chat-message', {
          playerId: socket.id,
          message,
          timestamp: Date.now()
        });
      }
    });
  }

  handleDisconnection(socket, io) {
    const room = this.roomManager.getPlayerRoom(socket.id);
    if (room) {
      // Notify other players
      socket.to(room.id).emit('player-disconnected', {
        playerId: socket.id,
        players: room.players.filter(p => p.id !== socket.id)
      });

      // Handle room cleanup
      this.roomManager.leaveRoom(socket.id);
    }
  }

  startGame(room, io) {
    this.roomManager.setRoomStatus(room.id, 'playing');
    
    const gameConfig = {
      experimentType: room.experimentType,
      gameMode: room.gameMode,
      players: room.players.map((p, index) => ({
        id: p.id,
        playerIndex: index,
        type: room.gameMode === 'human-human' ? 'human' : (index === 0 ? 'human' : 'ai')
      }))
    };

    io.to(room.id).emit('game-started', gameConfig);
    console.log(`Game started in room ${room.id}`);

    // Prepare for potential next game: reset readiness flags
    try {
      if (Array.isArray(room.players)) {
        room.players.forEach(p => {
          p.isReady = false;
          p.isMatchReady = false;
        });
      }
    } catch (_) { /* noop */ }
  }
}
