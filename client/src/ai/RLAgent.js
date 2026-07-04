import { CONFIG } from '../config/gameConfig.js';

function manhattanDistance(pos1, pos2) {
  return Math.abs(pos1[0] - pos2[0]) + Math.abs(pos1[1] - pos2[1]);
}

function isCaptureState(stagId, hunter1Id, hunter2Id, cells) {
  if (stagId === hunter1Id || stagId === hunter2Id) return true;

  const stagPos = cells[stagId];
  const hunter1Pos = cells[hunter1Id];
  const hunter2Pos = cells[hunter2Id];
  return manhattanDistance(stagPos, hunter1Pos) === 1 && manhattanDistance(stagPos, hunter2Pos) === 1;
}

/**
 * Retained policy for the moving stag.
 * Solves a precomputed snapshot MDP for each fixed pair of hunter positions.
 * The only dynamic state is the stag position.
 */
export class StagRLAgent {
  constructor() {
    this.gridSize = CONFIG.rl.gridSize;
    this.gamma = CONFIG.rl.gamma;
    this.terminalReward = -10;
    this.distanceRewardScale = 0.25;
    this.valueIterations = 100;
    this.valueTolerance = 1e-6;
    this.policyCache = new Map();
    this.actionSpace = [
      { action: [-1, 0], name: 'up' },
      { action: [1, 0], name: 'down' },
      { action: [0, -1], name: 'left' },
      { action: [0, 1], name: 'right' },
      { action: [0, 0], name: 'stay' },
    ];
  }

  getAction(stagPos, player1Pos, player2Pos, obstacles = [], blockedPositions = []) {
    const snapshot = this.getPolicySnapshot(obstacles, blockedPositions);
    const stagId = snapshot.coordToId.get(`${stagPos[0]},${stagPos[1]}`);
    const player1Id = snapshot.coordToId.get(`${player1Pos[0]},${player1Pos[1]}`);
    const player2Id = snapshot.coordToId.get(`${player2Pos[0]},${player2Pos[1]}`);

    if (stagId == null || player1Id == null || player2Id == null) return [0, 0];

    const hunterPairKey = `${player1Id}|${player2Id}`;
    const policy = snapshot.policyByHunterPair.get(hunterPairKey);
    const actionIndex = policy?.[stagId];
    if (actionIndex == null || actionIndex < 0) return [0, 0];
    return this.actionSpace[actionIndex].action;
  }

  getPolicySnapshot(obstacles, blockedPositions = []) {
    const obstacleKey = obstacles
      .map(([row, col]) => `${row},${col}`)
      .sort()
      .join('|');
    const blockedKey = blockedPositions
      .map(([row, col]) => `${row},${col}`)
      .sort()
      .join('|');
    const snapshotKey = `${obstacleKey}::${blockedKey}`;

    if (!this.policyCache.has(snapshotKey)) {
      this.policyCache.set(snapshotKey, this.buildPolicySnapshot(obstacles, blockedPositions));
    }

    return this.policyCache.get(snapshotKey);
  }

  buildPolicySnapshot(obstacles, blockedPositions = []) {
    const blockedSet = new Set([
      ...obstacles.map(([row, col]) => `${row},${col}`),
      ...blockedPositions.map(([row, col]) => `${row},${col}`),
    ]);
    const cells = [];
    const coordToId = new Map();

    for (let row = 0; row < this.gridSize; row++) {
      for (let col = 0; col < this.gridSize; col++) {
        if (blockedSet.has(`${row},${col}`)) continue;
        const id = cells.length;
        cells.push([row, col]);
        coordToId.set(`${row},${col}`, id);
      }
    }

    const actionTransitions = Array.from({ length: cells.length }, () => new Int16Array(this.actionSpace.length));
    const legalNeighborCounts = new Uint8Array(cells.length);

    for (let stagId = 0; stagId < cells.length; stagId++) {
      const [row, col] = cells[stagId];
      let legalNeighbors = 0;

      for (let actionIndex = 0; actionIndex < this.actionSpace.length; actionIndex++) {
        const [dr, dc] = this.actionSpace[actionIndex].action;
        const nextId = coordToId.get(`${row + dr},${col + dc}`);
        actionTransitions[stagId][actionIndex] = nextId == null ? stagId : nextId;
        if (actionIndex < 4 && nextId != null) legalNeighbors++;
      }

      legalNeighborCounts[stagId] = legalNeighbors;
    }

    const policyByHunterPair = new Map();
    const valuesByHunterPair = new Map();

    for (let hunter1Id = 0; hunter1Id < cells.length; hunter1Id++) {
      for (let hunter2Id = 0; hunter2Id < cells.length; hunter2Id++) {
        const { policy, values } = this.solveSnapshotPolicy(
          hunter1Id,
          hunter2Id,
          cells,
          actionTransitions,
          legalNeighborCounts,
        );
        const pairKey = `${hunter1Id}|${hunter2Id}`;
        policyByHunterPair.set(pairKey, policy);
        valuesByHunterPair.set(pairKey, values);
      }
    }

    return {
      cells,
      coordToId,
      policyByHunterPair,
      valuesByHunterPair,
    };
  }

  solveSnapshotPolicy(hunter1Id, hunter2Id, cells, actionTransitions, legalNeighborCounts) {
    const terminalState = new Uint8Array(cells.length);
    for (let stagId = 0; stagId < cells.length; stagId++) {
      terminalState[stagId] = isCaptureState(stagId, hunter1Id, hunter2Id, cells) ? 1 : 0;
    }

    const values = new Float32Array(cells.length);
    const nextValues = new Float32Array(cells.length);
    for (let stagId = 0; stagId < cells.length; stagId++) {
      if (terminalState[stagId]) values[stagId] = this.terminalReward;
    }

    for (let iter = 0; iter < this.valueIterations; iter++) {
      let maxDelta = 0;

      for (let stagId = 0; stagId < cells.length; stagId++) {
        if (terminalState[stagId]) {
          nextValues[stagId] = this.terminalReward;
          continue;
        }

        let bestQ = -Infinity;
        for (let actionIndex = 0; actionIndex < this.actionSpace.length; actionIndex++) {
          const nextId = actionTransitions[stagId][actionIndex];
          const qValue = this.getSnapshotQValue(
            nextId,
            hunter1Id,
            hunter2Id,
            values,
            terminalState,
            cells,
          );
          if (qValue > bestQ) bestQ = qValue;
        }

        nextValues[stagId] = bestQ;
        const delta = Math.abs(bestQ - values[stagId]);
        if (delta > maxDelta) maxDelta = delta;
      }

      values.set(nextValues);
      if (maxDelta < this.valueTolerance) break;
    }

    const policy = new Int8Array(cells.length).fill(4);
    for (let stagId = 0; stagId < cells.length; stagId++) {
      if (terminalState[stagId]) continue;
      policy[stagId] = this.extractGreedyAction(
        stagId,
        hunter1Id,
        hunter2Id,
        values,
        terminalState,
        actionTransitions,
        legalNeighborCounts,
        cells,
      );
    }

    return { policy, values };
  }

  extractGreedyAction(stagId, hunter1Id, hunter2Id, values, terminalState, actionTransitions, legalNeighborCounts, cells) {
    let bestActionIndex = 4;
    let bestQ = -Infinity;
    let bestTieBreak = null;

    for (let actionIndex = 0; actionIndex < this.actionSpace.length; actionIndex++) {
      const nextId = actionTransitions[stagId][actionIndex];
      const qValue = this.getSnapshotQValue(
        nextId,
        hunter1Id,
        hunter2Id,
        values,
        terminalState,
        cells,
      );

      const tieBreak = this.getTieBreakScore(
        stagId,
        nextId,
        terminalState,
        legalNeighborCounts,
        actionIndex,
      );

      const isBetter =
        qValue > bestQ + this.valueTolerance ||
        (Math.abs(qValue - bestQ) <= this.valueTolerance && this.compareTieBreaks(tieBreak, bestTieBreak) > 0);

      if (isBetter) {
        bestActionIndex = actionIndex;
        bestQ = qValue;
        bestTieBreak = tieBreak;
      }
    }

    return bestActionIndex;
  }

  getSnapshotQValue(nextId, hunter1Id, hunter2Id, values, terminalState, cells) {
    if (terminalState[nextId]) return this.terminalReward;

    const nextPos = cells[nextId];
    const hunter1Pos = cells[hunter1Id];
    const hunter2Pos = cells[hunter2Id];
    const distanceReward =
      this.distanceRewardScale *
      (manhattanDistance(nextPos, hunter1Pos) + manhattanDistance(nextPos, hunter2Pos));

    return distanceReward + this.gamma * values[nextId];
  }

  getTieBreakScore(stagId, nextId, terminalState, legalNeighborCounts, actionIndex) {
    const isLegalDirectionalMove = actionIndex < 4 && nextId !== stagId;
    const isValidAction = actionIndex === 4 || isLegalDirectionalMove;
    const isNonStayAction = isLegalDirectionalMove ? 1 : 0;

    return [
      terminalState[nextId] ? 0 : 1,
      isLegalDirectionalMove ? 1 : 0,
      isValidAction ? 1 : 0,
      isNonStayAction,
      legalNeighborCounts[nextId],
      -actionIndex,
    ];
  }

  compareTieBreaks(left, right) {
    if (!right) return 1;
    for (let i = 0; i < left.length; i++) {
      if (left[i] !== right[i]) return left[i] - right[i];
    }
    return 0;
  }
}
