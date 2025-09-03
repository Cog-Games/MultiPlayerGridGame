import { CONFIG } from '../config/gameConfig.js';

// Socket.IO will be loaded from CDN in the HTML
const io = window.io;

export class NetworkManager {
  constructor() {
    this.socket = null;
    this.isConnected = false;
    this.eventHandlers = new Map();
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = CONFIG.server.reconnectAttempts;
  }

  async connect() {
    return new Promise((resolve, reject) => {
      if (!io) {
        reject(new Error('Socket.IO not available. Please ensure the Socket.IO client is loaded.'));
        return;
      }
      
      this.socket = io(CONFIG.server.url, {
        transports: ['websocket'],
        upgrade: false
      });

      this.socket.on('connect', () => {
        console.log('Connected to server');
        this.isConnected = true;
        this.reconnectAttempts = 0;
        resolve();
      });

      this.socket.on('disconnect', (reason) => {
        console.log('Disconnected from server:', reason);
        this.isConnected = false;
        this.emit('disconnect', reason);
        
        // Auto-reconnect logic
        if (reason === 'io server disconnect') {
          // Server initiated disconnect - don't reconnect
          return;
        }
        
        this.handleReconnection();
      });

      this.socket.on('connect_error', (error) => {
        console.error('Connection error:', error);
        this.isConnected = false;
        
        if (this.reconnectAttempts === 0) {
          reject(error);
        }
      });

      // Forward all socket events
      this.setupEventForwarding();
      
      // Connection timeout
      setTimeout(() => {
        if (!this.isConnected) {
          reject(new Error('Connection timeout'));
        }
      }, 10000);
    });
  }

  setupEventForwarding() {
    const events = [
      'room-joined',
      'player-joined',
      'room-full',
      'player-disconnected',
      'player-ready-status',
      'match-play-ready-status',
      'game-started',
      'player-action',
      'game-state-update',
      'trial-completed',
      'experiment-completed',
      'chat-message',
      'error'
    ];

    events.forEach(event => {
      this.socket.on(event, (data) => {
        this.emit(event, data);
      });
    });
  }

  handleReconnection() {
    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      this.reconnectAttempts++;
      console.log(`Attempting to reconnect (${this.reconnectAttempts}/${this.maxReconnectAttempts})`);
      
      setTimeout(() => {
        this.socket.connect();
      }, CONFIG.server.reconnectDelay * this.reconnectAttempts);
    } else {
      console.error('Max reconnection attempts reached');
      this.emit('error', { message: 'Connection lost. Please refresh the page.' });
    }
  }

  // Room management
  async joinRoom(options = {}) {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Join room timeout'));
      }, 10000);

      this.socket.once('room-joined', (data) => {
        clearTimeout(timeout);
        resolve(data);
      });

      this.socket.once('error', (error) => {
        clearTimeout(timeout);
        reject(error);
      });

      this.socket.emit('join-room', options);
    });
  }

  setPlayerReady() {
    if (this.isConnected) {
      this.socket.emit('player-ready');
    }
  }

  setMatchPlayReady() {
    if (this.isConnected) {
      this.socket.emit('match-play-ready');
    }
  }

  // Game actions
  sendGameAction(action) {
    if (this.isConnected) {
      this.socket.emit('game-action', { action });
    }
  }

  syncGameState(gameState) {
    if (this.isConnected) {
      this.socket.emit('sync-game-state', gameState);
    }
  }

  sendTrialComplete(trialData) {
    if (this.isConnected) {
      this.socket.emit('trial-complete', trialData);
    }
  }

  sendExperimentComplete(experimentData) {
    if (this.isConnected) {
      this.socket.emit('experiment-complete', experimentData);
    }
  }

  // Chat (for human-human mode)
  sendChatMessage(message) {
    if (this.isConnected) {
      this.socket.emit('chat-message', message);
    }
  }

  // Event handling
  on(event, handler) {
    if (!this.eventHandlers.has(event)) {
      this.eventHandlers.set(event, []);
    }
    this.eventHandlers.get(event).push(handler);
  }

  off(event, handler) {
    if (this.eventHandlers.has(event)) {
      const handlers = this.eventHandlers.get(event);
      const index = handlers.indexOf(handler);
      if (index > -1) {
        handlers.splice(index, 1);
      }
    }
  }

  emit(event, data) {
    if (this.eventHandlers.has(event)) {
      this.eventHandlers.get(event).forEach(handler => {
        try {
          handler(data);
        } catch (error) {
          console.error(`Error in event handler for ${event}:`, error);
        }
      });
    }
  }

  disconnect() {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }
    this.isConnected = false;
  }
}
