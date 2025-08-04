# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

### Start Development Environment
```bash
npm run dev                    # Start both server (3001) and client (3000) concurrently
npm run server:dev            # Start only game server with nodemon
npm run client:dev             # Start only Vite dev server
```

### Build and Production
```bash
npm run build                  # Build client with Vite
npm run preview               # Preview production build
npm start                     # Start production server
```

### Testing Commands
```bash
node test-integration.js      # Run automated integration tests
npm run dev                   # Then visit http://localhost:3000/test-timeline-integration.html
```

### Health Checks
```bash
curl http://localhost:3001/health                # Server health check
curl http://localhost:3001/api/maps/1P1G         # Test map API endpoint
curl http://localhost:3001/api/rooms             # Check room statistics
```

## Architecture Overview

This is a **modern grid-based collaborative game** supporting both human-AI and human-human gameplay modes. The project uses a **dual architecture** with both legacy and refactored versions running side-by-side.

### Key Architecture Components

**Frontend (client/src/):**
- `GameApplication.js` - Main application orchestrator, handles initialization and flow control
- `TimelineManager.js` - New timeline-based experiment flow (preferred)
- `ExperimentManager.js` - Experiment logic and trial management
- `GameStateManager.js` - Core game state and mechanics
- `NetworkManager.js` - Socket.IO client for multiplayer
- `UIManager.js` - UI rendering and event handling
- `RLAgent.js` - Reinforcement learning AI agent

**Backend (server/):**
- `index.js` - Express server with Socket.IO, map API endpoints
- `gameRoomManager.js` - Multiplayer room management
- `gameEventHandler.js` - Socket.IO event processing

### Game Flow Architecture

The system supports **two flow types**:

1. **Timeline Flow** (new, preferred): Uses `TimelineManager` for structured experiment stages
2. **Legacy Flow**: Direct experiment execution via `ExperimentManager`

Timeline flow is enabled by default but can be disabled with `?timeline=false` URL parameter.

### Experiment Types
- **1P1G**: Single player, single goal
- **1P2G**: Single player, dynamic two-goal system  
- **2P2G**: Two players, two goals (collaboration)
- **2P3G**: Two players, dynamic three-goal system

### Game Modes
- **Human-AI**: Player collaborates with RL agent (`CONFIG.game.players.player2.type = 'ai'`)
- **Human-Human**: Two networked human players (`CONFIG.game.players.player2.type = 'human'`)

## Configuration System

**Main Config**: `client/src/config/gameConfig.js`
- Game parameters (matrix size, timing, success thresholds)
- Player configuration and experiment sequences
- Environment variable handling with fallbacks

**Map Data**: `/config/` directory contains JavaScript files with map configurations:
- `MapsFor1P1G.js`, `MapsFor1P2G.js`, `MapsFor2P2G.js`, `MapsFor2P3G.js`
- Served via API endpoints: `/api/maps/{experimentType}`

## Network Architecture

**Socket.IO Events:**
- Client→Server: `join-room`, `player-ready`, `game-action`, `sync-game-state`
- Server→Client: `room-joined`, `player-joined`, `game-started`, `player-action`

**REST Endpoints:**
- `/health` - Server health check
- `/api/rooms` - Room statistics  
- `/api/maps/{experimentType}` - Map data as JSON
- `/config/{mapFile}` - Raw map configuration files

## Key Implementation Details

### Player Indexing System
- **UI/Network Layer**: 0-based (player 0 = red, player 1 = orange)
- **Game Logic**: 1-based (player 1 = red, player 2 = orange)
- Conversion handled in `GameApplication.handlePlayerMove()` via `playerNumber = this.playerIndex + 1`

### Data Recording
- Trial data exported as JSON on completion
- Includes trajectories, actions, reaction times, collaboration metrics
- Files saved as `experiment-data-[timestamp].json`

### AI Agent Integration
- RL agent in `client/src/ai/RLAgent.js`
- Policy caching for repeated goal configurations
- Configurable delays and decision algorithms

### Multiplayer Synchronization
- Real-time state sync via Socket.IO
- Game state managed by `GameStateManager.syncState()`
- Move validation and collision detection on both client and server

## Development Patterns

### Adding New Experiment Types
1. Update `gameConfig.js` experiment configuration
2. Implement trial logic in `ExperimentManager.js`
3. Add UI components in `UIManager.js`
4. Create corresponding map data files in `/config/`

### Timeline Integration
- Use `TimelineManager` events for structured experiment flow
- Handle `waiting-for-partner`, `all-players-ready`, `save-data` events
- Timeline provides better stage management than direct experiment execution

### Testing Modes
- `?skipNetwork=true` - Test multiplayer features without server connection
- `?timeline=false` - Use legacy experiment flow
- `?mode=human-human&experiment=2P2G` - Specific mode/experiment combinations

## Technical Dependencies

- **Frontend**: Vite, Socket.IO client, Canvas 2D rendering
- **Backend**: Express, Socket.IO server, CORS support
- **ES6 Modules**: All code uses modern import/export syntax
- **No Testing Framework**: Manual testing via HTML test files and integration scripts

## Legacy Compatibility

Original experiment files preserved in root directory for data analysis compatibility. New modular architecture in `client/` and `server/` directories maintains 100% functional equivalence with legacy system.