# Stable Grid Game - Modern Architecture

A modern, extensible grid-based collaborative game with support for both human-AI and human-human gameplay modes using Socket.IO.

## Features

### Game Modes
- **Human-AI Mode**: Single player collaborates with an AI agent using reinforcement learning
- **Human-Human Mode**: Two players collaborate in real-time over network connection

### Experiment Types
- **1P1G**: Single player, single goal
- **1P2G**: Single player, two goals with dynamic goal presentation
- **2P2G**: Two players, two goals (collaboration required)
- **2P3G**: Two players, three goals with dynamic goal presentation

### Key Features
- Modern ES6+ modular architecture
- Real-time multiplayer support with Socket.IO
- Intelligent RL agent for human-AI mode
- Comprehensive data recording and export
- Success threshold tracking
- Visual game rendering with animations
- Responsive UI with multiple screens

## Architecture

```
├── server/                 # Node.js/Express server
│   ├── index.js           # Main server entry point
│   ├── gameRoomManager.js # Room management for multiplayer
│   └── gameEventHandler.js# Socket.IO event handling
├── client/                # Frontend application
│   ├── src/
│   │   ├── core/          # Core application logic
│   │   ├── game/          # Game state management
│   │   ├── ai/            # RL agent implementation
│   │   ├── ui/            # User interface components
│   │   ├── network/       # Socket.IO client
│   │   ├── experiments/   # Experiment management
│   │   ├── utils/         # Utility functions
│   │   └── config/        # Configuration
│   ├── index.html         # Main HTML file
│   └── main.js           # Application entry point
└── config/               # Legacy map configurations (preserved)
    ├── MapsFor1P1G.js
    ├── MapsFor1P2G.js
    ├── MapsFor2P2G.js
    └── MapsFor2P3G.js
```

## Installation & Setup

1. **Install dependencies**:
```bash
npm install
```

2. **Development mode** (runs both server and client):
```bash
npm run dev
```

3. **Production build**:
```bash
npm run build
npm start
```

## Usage

### Human-AI Mode (Default)
- Navigate to `http://localhost:3000`
- Click "Start Experiment"
- Use arrow keys (↑ ↓ ← →) to control the red player
- The orange AI player will collaborate automatically

### Human-Human Mode
- Player 1: Navigate to `http://localhost:3000?mode=human-human`
- Player 2: Navigate to `http://localhost:3000?mode=human-human`
- Both players click "Ready to Play" when connected
- Both players use arrow keys to control their respective characters

### Custom Experiment Types
Add experiment type parameter:
- `http://localhost:3000?experiment=1P1G`
- `http://localhost:3000?experiment=2P3G`
- `http://localhost:3000?mode=human-human&experiment=2P2G`

## Configuration

### Game Settings
Edit `client/src/config/gameConfig.js`:

```javascript
export const CONFIG = {
  game: {
    matrixSize: 15,           // Grid size
    maxGameLength: 50,        // Max steps per trial
    experiments: {
      order: ['2P2G', '2P3G'], // Experiment sequence
      numTrials: {
        '1P1G': 3,
        '1P2G': 12,
        '2P2G': 12,
        '2P3G': 12
      }
    },
    successThreshold: {
      enabled: true,
      consecutiveSuccessesRequired: 5,
      minTrialsBeforeCheck: 12
    }
  }
};
```

### Server Settings
Edit `server/index.js`:

```javascript
const PORT = process.env.PORT || 3001;
```

## Data Export

- Trial data is automatically exported as JSON at experiment completion
- Data includes: player trajectories, actions, reaction times, goal detection, collaboration success
- Files saved as: `experiment-data-[timestamp].json`

## API Endpoints

### Server Health Check
```
GET /health
```

### Room Statistics
```
GET /api/rooms
```

## Socket.IO Events

### Client → Server
- `join-room`: Join or create a game room
- `player-ready`: Signal ready to start
- `game-action`: Send player action
- `sync-game-state`: Synchronize game state
- `trial-complete`: Signal trial completion

### Server → Client
- `room-joined`: Room join confirmation
- `player-joined`: New player joined room
- `game-started`: Game initialization
- `player-action`: Receive player action
- `game-state-update`: Game state synchronization

## Legacy Compatibility

The refactored version maintains 100% functional compatibility with the original codebase:

- All original experiment types work identically
- Same data recording format
- Preserved timing and behavior
- Original map configurations supported
- Same success criteria and thresholds

### Migration from Legacy
1. Original files are preserved in the root directory
2. New architecture in `client/` and `server/` directories
3. No changes needed to existing data analysis scripts
4. Configuration can be gradually migrated to new format

## Development

### Adding New Experiment Types
1. Add configuration to `gameConfig.js`
2. Implement trial logic in `ExperimentManager.js`
3. Add any specific UI elements in `UIManager.js`
4. Update map data if needed

### Extending AI Behavior
1. Modify `RLAgent.js` for new algorithms
2. Add configuration options in `gameConfig.js`
3. Test with existing experiment types for compatibility

### Adding New Network Events
1. Define event in `gameEventHandler.js` (server)
2. Handle event in `NetworkManager.js` (client)
3. Update UI components as needed

## Testing

Run individual components:
- Server only: `npm run server:dev`
- Client only: `npm run client:dev`
- Build test: `npm run build && npm run preview`

## Performance Considerations

- RL agent policies are cached for repeated goal configurations
- Network messages are throttled to prevent spam
- Game state synchronization is optimized for minimal bandwidth
- Canvas rendering is optimized for smooth 60fps gameplay

## Browser Support

- Modern browsers with ES6+ support
- WebSocket support required for multiplayer mode
- Canvas 2D rendering support required