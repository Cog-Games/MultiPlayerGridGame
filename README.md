# Multiple Player Grid Game - Socket.IO

A modern grid-based collaborative game supporting both human-AI and human-human gameplay modes. Built with Socket.IO for real-time multiplayer interactions and featuring a dual architecture with both legacy and refactored versions.

## Features

### Game Modes
- **Human-AI Mode**: Single player collaborates with RL agent
- **Human-Human Mode**: Two players collaborate in real-time over network

### Experiment Types
- **1P1G**: Single player, single goal
- **1P2G**: Single player, dynamic two-goal system
- **2P2G**: Two players, two goals (collaboration)
- **2P3G**: Two players, dynamic three-goal system

### Key Features
- Timeline-based experiment flow with legacy compatibility
- Real-time multiplayer with Socket.IO
- Reinforcement learning AI agent with policy caching
- Comprehensive data recording and JSON export
- Success threshold tracking and adaptive trials
- Canvas-based game rendering with animations
- Modular ES6+ architecture

## Architecture

```
├── server/                    # Express/Socket.IO backend
│   ├── index.js              # Main server with API endpoints
│   ├── gameRoomManager.js    # Multiplayer room management
│   ├── gameEventHandler.js   # Socket.IO event processing
│   └── ai/
│       └── gptAgent.js       # GPT agent integration
├── client/                   # Vite frontend application
│   ├── src/
│   │   ├── core/
│   │   │   └── GameApplication.js    # Main app orchestrator
│   │   ├── timeline/
│   │   │   └── TimelineManager.js    # Experiment timeline flow
│   │   ├── experiments/
│   │   │   └── ExperimentManager.js  # Trial management
│   │   ├── game/
│   │   │   └── GameStateManager.js   # Game state & mechanics
│   │   ├── network/
│   │   │   └── NetworkManager.js     # Socket.IO client
│   │   ├── ui/
│   │   │   ├── UIManager.js          # UI rendering
│   │   │   └── GameRenderer.js       # Canvas rendering
│   │   ├── ai/
│   │   │   ├── RLAgent.js           # RL agent implementation
│   │   │   └── GptAgentClient.js    # GPT agent client
│   │   ├── utils/
│   │   │   ├── GameHelpers.js       # Game utilities
│   │   │   ├── MapLoader.js         # Map loading
│   │   │   └── NewGoalGenerator.js  # Dynamic goals
│   │   └── config/
│   │       └── gameConfig.js        # Main configuration
│   ├── index.html                   # Entry HTML
│   └── main.js                     # Application entry
├── config/                          # Map data (API served)
│   ├── MapsFor1P1G.js
│   ├── MapsFor1P2G.js
│   ├── MapsFor2P2G.js
│   └── MapsFor2P3G.js
├── legacyVersion/                   # Original implementation
└── test-*.html                     # Test interfaces
```

## Quick Start

### Installation
```bash
npm install
```

### Development (recommended)
Starts both server (port 3001) and client (port 3000):
```bash
npm run dev
```

### Production
```bash
npm run build    # Build client
npm start        # Start server
```

### Individual Services
```bash
npm run server:dev    # Server only with nodemon
npm run client:dev    # Client only with Vite
npm run preview       # Preview production build
```

## Usage

### Human-AI Mode (Default)
1. Open `http://localhost:3000`
2. Select experiment type or use default
3. Use arrow keys to control red player
4. AI controls orange player automatically

### Human-Human Mode
1. **Player 1**: `http://localhost:3000?mode=human-human&experiment=2P2G`
2. **Player 2**: `http://localhost:3000?mode=human-human&experiment=2P2G`
3. Both click "Ready to Play" when connected
4. Both use arrow keys for their respective players

### URL Parameters
- `?mode=human-human` - Enable multiplayer mode
- `?experiment=2P3G` - Set experiment type
- `?timeline=false` - Use legacy flow instead of timeline
- `?skipNetwork=true` - Test mode without server connection

### Testing Interfaces
- `test-timeline-integration.html` - Timeline system testing
- `test-human-human-sync.html` - Multiplayer synchronization
- `test-integration.js` - Automated integration tests

## Configuration

### Main Game Config
Edit `client/src/config/gameConfig.js`:

```javascript
export const CONFIG = {
  game: {
    matrixSize: 15,           // Grid dimensions
    maxGameLength: 50,        // Max steps per trial
    experiments: {
      order: ['2P2G', '2P3G'], // Sequence order
      numTrials: {
        '1P1G': 3,             // Trial counts per type
        '2P2G': 12,
        '2P3G': 12
      }
    },
    successThreshold: {
      enabled: true,
      consecutiveSuccessesRequired: 5,
      minTrialsBeforeCheck: 12
    },
    players: {
      player1: { color: 'red', type: 'human' },
      player2: { color: 'orange', type: 'ai' }  // or 'human'
    }
  },
  ai: {
    reactionDelay: 500,       // AI response delay (ms)
    policyCache: true         // Enable policy caching
  }
};
```

### Map Configuration
Maps served via API from `/config/` directory:
- Accessible at `/api/maps/{experimentType}`
- Format: `{ maps: [{ matrix: [[...]], goals: [...] }] }`

### Environment Variables
```bash
PORT=3001                    # Server port
NODE_ENV=development         # Environment
```

## Data Recording & Export

### Automatic Export
- JSON export at experiment completion
- Files: `experiment-data-[timestamp].json`
- Includes trajectories, actions, reaction times, success metrics

### Data Structure
```javascript
{
  participantId: "uuid",
  experimentType: "2P2G",
  trials: [{
    trialNumber: 1,
    playerTrajectories: { player1: [...], player2: [...] },
    actions: [{ playerId, action, timestamp, reactionTime }],
    goalDetection: [...],
    collaborationSuccess: true,
    trialDuration: 15.4
  }]
}
```

## API Endpoints

### Health & Status
```
GET /health              # Server health check
GET /api/rooms           # Active room statistics
```

### Map Data
```
GET /api/maps/1P1G       # Get maps for experiment type
GET /api/maps/2P2G       # Returns JSON map configurations
```

### Configuration Files (Legacy)
```
GET /config/MapsFor1P1G.js    # Raw JS map files
```

## Network Events

### Client → Server
- `join-room` - Join/create multiplayer room
- `player-ready` - Signal ready to start game
- `game-action` - Send player movement/action
- `sync-game-state` - Request state synchronization

### Server → Client
- `room-joined` - Room join confirmation with room info
- `player-joined` - Notify new player in room
- `game-started` - Game initialization signal
- `player-action` - Broadcast player actions
- `game-state-update` - Synchronized game state

## Game Flow & Timeline System

### Timeline Manager (Preferred)
Modern structured experiment flow with stage management:
- `waiting-for-partner` - Multiplayer connection phase
- `all-players-ready` - Game initialization
- `save-data` - Data recording triggers
- Automatic progression through experiment stages

### Legacy Flow Fallback
Direct experiment execution via `ExperimentManager`:
- Enable with `?timeline=false` URL parameter
- Maintains backward compatibility

### Player Indexing System
- **Network/UI Layer**: 0-based (player 0 = red, player 1 = orange)
- **Game Logic**: 1-based (player 1 = red, player 2 = orange)
- Automatic conversion in `GameApplication.handlePlayerMove()`

## Development

### Architecture Patterns
1. **Modular Design**: Each component has single responsibility
2. **Event-Driven**: Timeline and network events drive flow
3. **State Management**: Centralized in `GameStateManager`
4. **Dual Compatibility**: Legacy and modern systems coexist

### Adding Features
```javascript
// 1. Add to gameConfig.js
export const CONFIG = {
  newFeature: { enabled: true, params: {...} }
};

// 2. Implement in relevant manager
class FeatureManager {
  handleFeature() { /* implementation */ }
}

// 3. Connect via events
this.emit('new-feature-event', data);
```

### Testing & Validation
```bash
# Automated integration tests
node test-integration.js

# Manual testing interfaces
npm run dev
# Visit test-*.html files at localhost:3000

# Health checks
curl http://localhost:3001/health
curl http://localhost:3001/api/maps/2P2G
```

## Legacy System

### Preserved Components
- Original files in `legacyVersion/` directory
- All original experiment logic maintained
- Data format compatibility preserved
- Configuration files serve as API endpoints

### Migration Benefits
1. **Performance**: Modular loading reduces initial bundle size
2. **Maintainability**: Clear separation of concerns
3. **Extensibility**: Timeline system enables complex experiments
4. **Compatibility**: Zero breaking changes to existing functionality

## Technical Requirements

### Runtime Dependencies
- **Node.js**: 16+ with ES modules support
- **Browser**: ES6+ support, WebSocket, Canvas 2D
- **Network**: Socket.IO for real-time multiplayer

### Performance Optimizations
- RL agent policy caching for repeated configurations
- Canvas rendering optimized for 60fps gameplay
- Network message throttling prevents spam
- Lazy loading of experiment components

### Browser Compatibility
- Chrome 88+, Firefox 85+, Safari 14+
- WebSocket support required for multiplayer
- Canvas 2D context required for game rendering