import { CONFIG } from '../config/gameConfig.js';
import { GameHelpers } from '../utils/GameHelpers.js';

const PLAYER_IDS = ['player1', 'player2', 'player3', 'player4'];
const ACTIONS = [
  [-1, 0],
  [1, 0],
  [0, -1],
  [0, 1],
];

export class GroupForagingStateManager {
  constructor() {
    this.state = null;
    this.stepCount = 0;
    this.events = [];
    this.scores = {};
    this.sharingOutcome = null;
  }

  initializePhase(mapConfig, initialScores = {}) {
    this.stepCount = 0;
    this.events = [];
    this.sharingOutcome = null;
    this.scores = Object.fromEntries(
      PLAYER_IDS.map(player => [player, initialScores[player] ?? CONFIG.game.rewards.initialScore]),
    );

    this.state = {
      phase: 'group',
      size: mapConfig.size,
      players: Object.fromEntries(
        PLAYER_IDS.map(player => [player, [...mapConfig.playerStarts[player]]]),
      ),
      stags: mapConfig.stags.map(stag => [...stag]),
      rabbits: mapConfig.rabbits.map(rabbit => [...rabbit]),
      obstacles: mapConfig.obstacles ? mapConfig.obstacles.map(obstacle => [...obstacle]) : [],
      inventories: Object.fromEntries(PLAYER_IDS.map(player => [player, 0])),
      signals: Object.fromEntries(PLAYER_IDS.map(player => [player, false])),
    };

    return this.state;
  }

  normalizeAction(action) {
    if (!Array.isArray(action) || action.length !== 2) return [0, 0];
    const [dr, dc] = action;
    if (!Number.isInteger(dr) || !Number.isInteger(dc)) return [0, 0];
    return Math.abs(dr) + Math.abs(dc) <= 1 ? [dr, dc] : [0, 0];
  }

  movePlayer(player, action) {
    if (!PLAYER_IDS.includes(player)) return false;

    const movement = this.normalizeAction(action?.movement ?? action);
    if (movement[0] === 0 && movement[1] === 0) return false;

    const current = this.state.players[player];
    const next = this.resolveMove(current, movement);
    this.state.players[player] = next;
    this.stepCount++;

    const captures = this.collectFood(player);
    this.recordEvent(player, movement, captures);
    return true;
  }

  moveStags() {
    const movements = [];
    const nextStags = this.state.stags.map(stag => (stag ? [...stag] : null));
    const reservedPositions = new Set(
      this.state.stags
        .filter(Boolean)
        .map(pos => this.getPositionKey(pos)),
    );

    for (let index = 0; index < this.state.stags.length; index++) {
      const stag = this.state.stags[index];
      if (!stag) continue;

      reservedPositions.delete(this.getPositionKey(stag));
      const movement = this.getStagMovement(stag, index, reservedPositions);
      const next = this.resolveMove(stag, movement, {
        avoidPlayers: true,
        avoidFood: true,
        stagIndex: index,
        reservedPositions,
      });

      movements.push({ index, movement });
      nextStags[index] = next;
      reservedPositions.add(this.getPositionKey(next));
    }

    this.state.stags = nextStags;

    this.recordEvent('stags', movements, []);
    return movements;
  }

  getAutomatedPlayerAction(player) {
    const position = this.state.players[player];
    const targets = [
      ...this.state.rabbits.filter(Boolean),
      ...this.state.stags.filter(Boolean),
    ];
    if (!targets.length) return ACTIONS[0];

    const target = targets
      .map(pos => ({ pos, distance: GameHelpers.manhattanDistance(position, pos) }))
      .sort((a, b) => a.distance - b.distance)[0].pos;

    return this.getStepToward(position, target);
  }

  getStepToward(start, target) {
    return ACTIONS
      .map(action => ({
        action,
        next: this.resolveMove(start, action),
      }))
      .map(candidate => ({
        ...candidate,
        distance: GameHelpers.manhattanDistance(candidate.next, target),
      }))
      .sort((a, b) => a.distance - b.distance)[0].action;
  }

  getStagMovement(stag, stagIndex, reservedPositions = new Set()) {
    const playerPositions = Object.values(this.state.players);
    const candidates = ACTIONS
      .map(action => ({
        action,
        next: this.resolveMove(stag, action, {
          avoidPlayers: true,
          avoidFood: true,
          stagIndex,
          reservedPositions,
        }),
      }))
      .filter(candidate => candidate.next[0] !== stag[0] || candidate.next[1] !== stag[1]);

    if (!candidates.length) return [0, 0];

    return candidates
      .map(candidate => ({
        ...candidate,
        nearestPlayerDistance: Math.min(
          ...playerPositions.map(player => GameHelpers.manhattanDistance(candidate.next, player)),
        ),
      }))
      .sort((a, b) => b.nearestPlayerDistance - a.nearestPlayerDistance)[0].action;
  }

  resolveMove(start, action, options = {}) {
    const next = GameHelpers.transition(start, action);
    if (!this.isValidPosition(next) || this.isObstacle(next)) return [...start];
    if (options.avoidPlayers && this.isOccupiedByPlayer(next)) return [...start];
    if (options.avoidFood && this.isOccupiedByRabbit(next)) return [...start];
    if (options.avoidFood && this.isOccupiedByOtherStag(next, options.stagIndex)) return [...start];
    if (options.reservedPositions?.has(this.getPositionKey(next))) return [...start];
    return next;
  }

  getPositionKey(pos) {
    return `${pos[0]},${pos[1]}`;
  }

  collectFood(player) {
    const captures = [];
    const pos = this.state.players[player];

    const rabbitIndex = this.state.rabbits.findIndex(rabbit => rabbit && GameHelpers.manhattanDistance(pos, rabbit) === 0);
    if (rabbitIndex >= 0) {
      this.state.rabbits[rabbitIndex] = null;
      this.state.inventories[player] += CONFIG.game.rewards.rabbitCapture;
      captures.push({ type: 'small', player, amount: CONFIG.game.rewards.rabbitCapture });
    }

    for (let index = 0; index < this.state.stags.length; index++) {
      const stag = this.state.stags[index];
      if (!stag) continue;

      const participants = PLAYER_IDS.filter(id => GameHelpers.manhattanDistance(this.state.players[id], stag) <= 1);
      if (participants.length < 2) continue;

      this.state.stags[index] = null;
      for (const participant of participants) {
        this.state.inventories[participant] += CONFIG.game.rewards.stagCapture;
      }
      captures.push({
        type: 'large',
        players: participants,
        amount: CONFIG.game.rewards.stagCapture,
      });
    }

    return captures;
  }

  resolveSharing(decisions) {
    const kept = Object.fromEntries(PLAYER_IDS.map(player => [player, 0]));
    const dyadPools = {
      'player1|player2': 0,
      'player3|player4': 0,
    };
    let publicPool = 0;

    for (const player of PLAYER_IDS) {
      const inventory = this.state.inventories[player];
      const choice = decisions[player] || 'keep';

      if (choice === 'group') {
        publicPool += inventory;
      } else if (choice === 'dyad') {
        const key = this.getDyadKey(player);
        dyadPools[key] += inventory;
      } else {
        kept[player] += inventory;
      }
    }

    const dyadShares = Object.fromEntries(PLAYER_IDS.map(player => [player, 0]));
    for (const [key, pool] of Object.entries(dyadPools)) {
      const [left, right] = key.split('|');
      const share = (pool * CONFIG.game.groupPhase.dyadShareMultiplier) / 2;
      dyadShares[left] += share;
      dyadShares[right] += share;
    }

    const publicShare = (publicPool * CONFIG.game.groupPhase.publicGoodMultiplier) / PLAYER_IDS.length;
    const phasePayoffs = Object.fromEntries(
      PLAYER_IDS.map(player => [player, kept[player] + dyadShares[player] + publicShare]),
    );

    for (const player of PLAYER_IDS) {
      this.scores[player] += phasePayoffs[player];
    }

    this.sharingOutcome = {
      decisions: { ...decisions },
      inventories: { ...this.state.inventories },
      kept,
      dyadPools,
      publicPool,
      publicShare,
      phasePayoffs,
      finalScores: this.getScores(),
    };
    return this.sharingOutcome;
  }

  getDyadKey(player) {
    return player === 'player1' || player === 'player2' ? 'player1|player2' : 'player3|player4';
  }

  isValidPosition(pos) {
    return pos[0] >= 0 && pos[0] < this.state.size && pos[1] >= 0 && pos[1] < this.state.size;
  }

  isObstacle(pos) {
    return this.state.obstacles.some(obstacle => obstacle[0] === pos[0] && obstacle[1] === pos[1]);
  }

  isOccupiedByPlayer(pos) {
    return Object.values(this.state.players).some(player => player[0] === pos[0] && player[1] === pos[1]);
  }

  isOccupiedByRabbit(pos) {
    return this.state.rabbits.some(rabbit => rabbit && rabbit[0] === pos[0] && rabbit[1] === pos[1]);
  }

  isOccupiedByOtherStag(pos, currentIndex = null) {
    return this.state.stags.some((stag, index) => (
      stag && index !== currentIndex && stag[0] === pos[0] && stag[1] === pos[1]
    ));
  }

  recordEvent(agent, action, captures) {
    this.events.push({
      agent,
      action,
      actionLabel: agent === 'stags' ? 'move-stags' : this.getActionLabel(action),
      captures,
      time: Date.now(),
      positions: this.getPositions(),
      inventories: { ...this.state.inventories },
    });
  }

  getActionLabel(action) {
    const [dr, dc] = action;
    if (dr === -1 && dc === 0) return 'up';
    if (dr === 1 && dc === 0) return 'down';
    if (dr === 0 && dc === -1) return 'left';
    if (dr === 0 && dc === 1) return 'right';
    if (dr === 0 && dc === 0) return 'stay';
    return 'unknown';
  }

  getPositions() {
    return {
      players: Object.fromEntries(PLAYER_IDS.map(player => [player, [...this.state.players[player]]])),
      stags: this.state.stags.map(stag => stag ? [...stag] : null),
      rabbits: this.state.rabbits.map(rabbit => rabbit ? [...rabbit] : null),
      obstacles: this.state.obstacles.map(obstacle => [...obstacle]),
    };
  }

  getScores() {
    return { ...this.scores };
  }

  getRenderState() {
    return this.state;
  }

  getSymbolicState({ currentActor = null, condition = null } = {}) {
    return {
      phase: 'group-foraging',
      actionCount: this.stepCount,
      actionLimit: CONFIG.game.groupPhase.collectionActionLimit,
      currentActor,
      condition,
      positions: this.getPositions(),
      inventories: { ...this.state.inventories },
      scores: this.getScores(),
      remainingFood: {
        largeTargets: this.state.stags.filter(Boolean).length,
        smallTargets: this.state.rabbits.filter(Boolean).length,
      },
      recentActions: this.events.slice(-10).map(event => ({
        agent: event.agent,
        action: event.actionLabel,
        captures: event.captures,
        positions: event.positions,
      })),
    };
  }

  getAsciiGrid() {
    const size = this.state.size;
    const grid = Array.from({ length: size }, () => Array(size).fill('.'));

    for (const [row, col] of this.state.obstacles) grid[row][col] = '#';
    for (const rabbit of this.state.rabbits) {
      if (rabbit) grid[rabbit[0]][rabbit[1]] = 'r';
    }
    for (const stag of this.state.stags) {
      if (stag) grid[stag[0]][stag[1]] = 'S';
    }
    for (const [player, pos] of Object.entries(this.state.players)) {
      grid[pos[0]][pos[1]] = player.replace('player', 'P');
    }

    return [
      'Legend: P1-P4=players, S=large moving target, r=small fixed target, #=obstacle, .=empty',
      ...grid.map((row, index) => `${String(index).padStart(2, '0')}: ${row.map(cell => cell.padEnd(2, ' ')).join(' ')}`),
      `Cols: ${Array.from({ length: size }, (_, col) => String(col).padStart(2, '0')).join(' ')}`,
    ].join('\n');
  }
}
