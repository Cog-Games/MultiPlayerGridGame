import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { CONFIG, GameConfigUtils } from '../client/src/config/gameConfig.js';
import { GameStateManager } from '../client/src/game/GameStateManager.js';

globalThis.window = { location: { search: '', origin: 'http://localhost' }, io: () => {} };
const fetch = globalThis.fetch;
globalThis.fetch = async () => ({ ok: false, status: 503 });
const { GameApplication } = await import('../client/src/core/GameApplication.js');
const { ExperimentManager } = await import('../client/src/experiments/ExperimentManager.js');
globalThis.fetch = fetch;

function fixture() {
  GameConfigUtils.setPlayerType(1, 'alwaysSignalAgent');
  GameConfigUtils.setPlayerType(2, 'human');
  const gsm = new GameStateManager();
  gsm.initializeTrial(0, '2P3G', { initPlayerGrid: [0, 0], initAIGrid: [0, 2], target1: [4, 4], target2: [8, 8] });
  gsm.trialData.trialPhase = 'test';
  gsm.recordPartnerFallback({ reason: 'waiting-timeout', fallbackAIType: 'alwaysSignalAgent', aiPlayerNumber: 1 });
  gsm.processSynchronizedMovesMapped(2, 'down', 'down');
  gsm.addGoal([2, 2]);
  gsm.markNewGoalPresented([2, 2], 'equal_to_both');
  gsm.isMoving = false;
  gsm.processSynchronizedMovesMapped(2, 'down', 'down');
  gsm.finalizeTrial(false);
  const app = new GameApplication(null);
  app.gameStateManager = gsm;
  app.playerIndex = 1;
  app.lastRoomId = 'retained-room';
  app.timelineManager = { gameMode: 'human-ai' };
  app.recordDataCheckpoint = () => {};
  return app;
}

test('Excel export keeps canonical identity, room and complete separate event sheet', () => {
  const app = fixture();
  CONFIG.server.enableGoogleDriveSave = false;
  let workbook;
  window.XLSX = {
    utils: {
      book_new: () => ({}), aoa_to_sheet: data => data,
      json_to_sheet: rows => rows,
      book_append_sheet: (wb, sheet, name) => { wb[name] = sheet; }
    },
    write: wb => { workbook = wb; return 'dGVzdA=='; }
  };
  app.saveExperimentData({ participantId: 'synthetic-test', participantAgeTotalDays: 3000 },
    { localDownload: false, showAlert: false, notifyTimeline: false });
  assert(workbook?.ExperimentData);
  const [header, values] = workbook.ExperimentData;
  const row = Object.fromEntries(header.map((key, i) => [key, values[i]]));
  assert.equal(row.roomId, 'retained-room');
  assert.equal(row.currentPlayer, 2);
  assert.equal(row.humanPlayerIndex, 1);
  assert.equal(row.rlAgentType, 'sa-model');
  assert.equal(row.partnerFallbackOccurred, true);
  assert(!header.includes('moveEvents'));
  assert.equal(workbook.MoveEvents.length, 4);
  assert.deepEqual(workbook.MoveEvents.map(e => e.playerIndex), [0, 1, 0, 1]);
  assert.equal(workbook.MoveEvents[0].actorType, 'alwaysSignalAgent');
  // Optional artifact for the Python / collabAIdata integration check; contains synthetic data only.
  if (process.env.KIDS_TEST_EXPORT_PATH) fs.writeFileSync(process.env.KIDS_TEST_EXPORT_PATH,
    JSON.stringify({ workbook, trial: { ...app.gameStateManager.experimentData.allTrialsData[0], participantId: 'synthetic-test' } }));
});

test('missing Excel library still downloads the complete JSON export', () => {
  const app = fixture();
  delete window.XLSX;
  let downloaded;
  app.downloadBase64File = (data, filename, mime) => {
    downloaded = { data: JSON.parse(Buffer.from(data, 'base64')), filename, mime }; return true;
  };
  app.saveExperimentData({ participantId: 'synthetic-test' }, { showAlert: false });
  assert.equal(downloaded.mime, 'application/json');
  assert.equal(downloaded.data.allTrialsData[0].moveEvents.length, 4);
  assert.equal(downloaded.data.fallbackEvents.length, 1);
});

test('two-kid startup pins SA fallback even with stale alternative-agent URL parameters', async () => {
  window.location.search = '?kidPartner=human&kidAI=rl_joint&ai=vlm&skipNetwork=true';
  const app = new GameApplication(null);
  app.initialize = async () => {};
  app.uiManager = { setPlayerInfo() {} };
  app.timelineManager = { start() {} };
  await app.start();
  assert.equal(CONFIG.multiplayer.fallbackAIType, 'alwaysSignalAgent');
  assert.equal(CONFIG.game.players.player2.type, 'human');
  window.location.search = '';
});

test('disconnect, transition and inactivity routes activate SA on the departed side for either child', () => {
  for (const local of [0, 1]) for (const route of ['disconnect', 'transition', 'inactivity']) {
    const app = fixture();
    GameConfigUtils.setPlayerType(1, 'human');
    GameConfigUtils.setPlayerType(2, 'human');
    app.gameStateManager.initializeTrial(1, '2P2G',
      { initPlayerGrid: [0, 0], initAIGrid: [0, 2], target1: [4, 4], target2: [8, 8] });
    app.playerIndex = local;
    const manager = Object.create(ExperimentManager.prototype);
    Object.assign(manager, { gameStateManager: app.gameStateManager,
      rlAgent: {}, committedAgent: {}, alwaysCommittedAgent: {}, alwaysSignalAgent: {}, signalAgent: {}, twoStageSignalAgent: {},
      setupIndependentAIAfterHumanGoal() {}, setupAIMovement() {}, logCurrentAIModel() {} });
    app.experimentManager = manager;
    app.timelineManager = { gameMode: 'human-human', emit() {}, recordKidMatchFallback() {} };
    app.uiManager = { setPlayerInfo() {}, showGameStatus() {} };
    app._inactivityTracking.enabled = true;
    if (route === 'disconnect') {
      const listeners = {};
      app.networkManager = { on: (name, callback) => { listeners[name] = callback; } };
      app.setupNetworkEventHandlers();
      listeners['player-disconnected']({ playerId: 'departed' });
    } else if (route === 'transition') app.activateAIFallbackForExperiment('2P2G');
    else app.activateAIFallbackDueToInactivity();
    assert.equal(manager.aiPlayerNumber, 2 - local);
    if (route === 'disconnect') {
      assert.equal(app._inactivityTracking.enabled, false);
      const count = app.gameStateManager.trialData.partnerFallbackEvents.length;
      app.activateAIFallbackDueToInactivity();
      assert.equal(app.gameStateManager.trialData.partnerFallbackEvents.length, count);
    }
    assert.equal(CONFIG.game.players[`player${2 - local}`].type, 'alwaysSignalAgent');
    assert.equal(app.gameStateManager.trialData.partnerAgentType, 'SA-model');
    assert.equal(app.gameStateManager.trialData.humanPlayerIndex, local);
  }
});

test('synchronized SA observes current input once and does not decide on wall bumps or after arrival', async () => {
  const app = fixture();
  const gsm = app.gameStateManager;
  gsm.initializeTrial(1, '2P2G', { initPlayerGrid: [0, 0], initAIGrid: [0, 2], target1: [4, 4], target2: [8, 8] });
  const manager = Object.create(ExperimentManager.prototype);
  let calls = 0;
  Object.assign(manager, { aiPlayerNumber: 1, gameStateManager: gsm,
    uiManager: { updateGameDisplay() {} }, alwaysSignalAgent: { getAIAction(state, td, side, pending) {
      calls++;
      assert.equal(td, gsm.trialData, 'model must receive the stable live recording');
      assert.equal(side, 1); assert.deepEqual(pending, [1, 0]);
      assert.equal(td.player2Actions.length, 0);
      return [1, 0];
    } } });
  GameConfigUtils.setPlayerType(1, 'alwaysSignalAgent');
  GameConfigUtils.setPlayerType(2, 'human');
  await manager.handleSynchronizedMove('down');
  assert.equal(calls, 1);
  assert.equal(gsm.trialData.player2Actions.length, 1);
  gsm.currentState.player2 = [0, 2]; gsm.isMoving = false;
  await manager.handleSynchronizedMove('up');
  assert.equal(calls, 1);
  gsm.currentState.player1 = [4, 4]; gsm.isMoving = false;
  await manager.handleSynchronizedMove('down');
  assert.equal(calls, 1);
});


test('real SA decisions persist across manager moves and into the finalized export', async () => {
  const app = fixture();
  const gsm = app.gameStateManager;
  gsm.initializeTrial(1, '2P2G', { initPlayerGrid: [0, 0], initAIGrid: [0, 2], target1: [4, 4], target2: [8, 8] });
  const manager = Object.create(ExperimentManager.prototype);
  Object.assign(manager, { aiPlayerNumber: 1, gameStateManager: gsm,
    uiManager: { updateGameDisplay() {} }, alwaysSignalAgent: manager.createAlwaysSignalAgent() });
  GameConfigUtils.setPlayerType(1, 'alwaysSignalAgent');
  GameConfigUtils.setPlayerType(2, 'human');
  let resets = 0;
  const reset = manager.alwaysSignalAgent.reset.bind(manager.alwaysSignalAgent);
  manager.alwaysSignalAgent.reset = () => { resets++; reset(); };
  await manager.handleSynchronizedMove('down');
  gsm.isMoving = false;
  await manager.handleSynchronizedMove('down');
  assert.equal(resets, 1);
  assert.equal(gsm.trialData.sharedAgencyModelVersion, 'local-fallback-2026-05-28');
  assert.equal(gsm.trialData.alwaysSignalAgentPlayer1SampledJointGoalHistory.length, 2);
  gsm.finalizeTrial(false);
  assert.equal(gsm.experimentData.allTrialsData.at(-1).alwaysSignalAgentPlayer1SampledJointGoalHistory.length, 2);
});
