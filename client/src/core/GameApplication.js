import { NetworkManager } from '../network/NetworkManager.js';
import { GameStateManager } from '../game/GameStateManager.js';
import { UIManager } from '../ui/UIManager.js';
import { ExperimentManager } from '../experiments/ExperimentManager.js';
import { TimelineManager } from '../timeline/TimelineManager.js';
import { CONFIG, GameConfigUtils } from '../config/gameConfig.js';

export class GameApplication {
  constructor(container) {
    this.container = container;
    this.networkManager = null;
    this.gameStateManager = null;
    this.uiManager = null;
    this.experimentManager = null;
    this.timelineManager = null;
    this.isInitialized = false;
    this.playerIndex = 0; // 0 = red player, 1 = orange player
    this.gameConfig = null; // Store game configuration from server
    this.useTimelineFlow = true; // Enable timeline flow by default
    this.currentRoomId = null; // Track active multiplayer room ID for export

    // Synchronized human-human turn state
    this._hhSync = {
      pendingMoves: { 0: null, 1: null }
    };

    // Real-time synchronization state
    this._rtSync = {
      syncInterval: null
    };
  }

  async start(options = {}) {
    const { mode = 'human-ai', experimentType = '2P2G', roomId = null, useTimeline = true } = options;

    // Check URL parameters for timeline preference
    const urlParams = new URLSearchParams(window.location.search);
    this.useTimelineFlow = urlParams.get('timeline') !== 'false' && useTimeline;
    const aiParam = urlParams.get('ai');
    if (aiParam) {
      // Accept: 'gpt' | 'rl_joint' | 'rl_individual' | legacy 'ai'
      GameConfigUtils.setPlayerType(2, aiParam);
    }

    console.log(`Starting application with timeline flow: ${this.useTimelineFlow}`);

    try {
      // Initialize components
      await this.initialize(mode, experimentType, roomId);

      // Start the appropriate flow
      if (this.useTimelineFlow) {
        await this.startTimelineFlow(mode, experimentType, roomId);
      } else {
        // Legacy flow
        if (mode === 'human-human') {
          await this.startMultiplayerMode(experimentType, roomId);
        } else {
          await this.startSinglePlayerMode(experimentType);
        }
      }

      console.log('Application started successfully');
    } catch (error) {
      console.error('Failed to start application:', error);
      throw error;
    }
  }

  async initialize(mode, experimentType, roomId) {
    if (this.isInitialized) return;

    // Initialize core managers
    this.gameStateManager = new GameStateManager();
    this.uiManager = new UIManager(this.container);

    // Initialize timeline manager if using timeline flow
    if (this.useTimelineFlow) {
      this.timelineManager = new TimelineManager(this.container);
      this.setupTimelineEventHandlers();
    }

    // Initialize experiment manager with or without timeline
    this.experimentManager = new ExperimentManager(
      this.gameStateManager,
      this.uiManager,
      this.timelineManager
    );

    // Initialize network manager if needed
    const urlParams = new URLSearchParams(window.location.search);
    const skipNetwork = urlParams.get('skipNetwork') === 'true';

    if (!skipNetwork) {
      try {
        this.networkManager = new NetworkManager();
        await this.networkManager.connect();
        this.setupNetworkEventHandlers();
        console.log('✅ Network manager initialized');
        try { window.__NETWORK_MANAGER__ = this.networkManager; } catch (_) { /* ignore */ }
      } catch (error) {
        console.warn('⚠️ Failed to initialize network manager:', error.message);
        console.log('💡 You can test timeline with mock multiplayer using: ?skipNetwork=true');
        this.networkManager = null;
      }
    } else {
      console.log('⚠️ Network connection skipped for testing');
      this.networkManager = null;
    }

    // Set up UI event handlers
    this.setupUIEventHandlers();

    this.isInitialized = true;

    // Proactively fetch and cache GPT model for accurate recording (e.g., partnerFallbackAIType)
    try { await this.experimentManager?.logCurrentAIModel?.(); } catch (_) { /* noop */ }
  }

  async startTimelineFlow(mode, experimentType, roomId) {
    console.log(`🎬 Starting timeline flow for ${mode} mode`);

    // Check if we should skip network connection for testing
    const urlParams = new URLSearchParams(window.location.search);
    const skipNetwork = urlParams.get('skipNetwork') === 'true';

    // Default to configured fallback AI when not explicitly set
    if (!['gpt', 'human', 'rl_joint', 'rl_individual'].includes(CONFIG.game.players.player2.type)) {
      GameConfigUtils.setPlayerType(2, CONFIG.multiplayer.fallbackAIType || 'rl_joint');
    }
    this.uiManager.setPlayerInfo(0, 'human-ai');

    if (!skipNetwork) {
      if (this.networkManager && this.networkManager.isConnected) {
        console.log('🌐 Enabling real multiplayer integration for collaboration phases');
        this.setupMultiplayerTimelineIntegration(experimentType, roomId);
      } else {
        console.log('🤖 Using mock multiplayer for timeline (server not available or skipped)');
        this.setupMockMultiplayerForTimeline();
      }
    }

    // Start the complete timeline flow
    this.timelineManager.start();
  }

  setupMultiplayerTimelineIntegration(experimentType, roomId) {
    // Handle multiplayer connection within timeline flow
    this.timelineManager.on('waiting-for-partner', async (data) => {
      console.log('Timeline requesting partner connection...');

      // Ensure we're in human-human mode for this experiment
      CONFIG.game.players.player2.type = 'human';
      console.log('🎮 Set player2 type to human for multiplayer experiment');

      try {
        // Join or create room
        const room = await this.networkManager.joinRoom({
          roomId,
          gameMode: 'human-human',
          experimentType: data.experimentType
        });

        console.log('Joined room during timeline flow:', room);
      } catch (error) {
        console.error('Failed to join room during timeline:', error);
        // Could emit an error event back to timeline here
      }
    });

    // Handle player ready event from timeline
    this.timelineManager.on('player-ready', () => {
      console.log('🎮 Timeline player clicked ready - forwarding to network');
      if (this.networkManager && this.networkManager.isConnected) {
        this.networkManager.setPlayerReady();
      } else {
        console.warn('⚠️ Network manager not available for player ready');
      }
    });

    // Handle match-play space readiness from timeline
    this.timelineManager.on('match-play-ready', () => {
      console.log('🎮 Timeline match-play SPACE pressed - forwarding to network');
      if (this.networkManager && this.networkManager.isConnected) {
        this.networkManager.setMatchPlayReady();
      } else {
        console.warn('⚠️ Network manager not available for match-play-ready');
      }
    });
  }

  setupMockMultiplayerForTimeline() {
    console.log('🤖 Setting up mock multiplayer timeline events...');

    // Mock multiplayer events for timeline testing when server isn't available
    this.timelineManager.on('waiting-for-partner', async (data) => {
      console.log('🤖 Mock: Timeline waiting for partner - simulating connection...');

      // Ensure we're in human-human mode for this experiment (even in mock mode)
      CONFIG.game.players.player2.type = 'human';
      console.log('🎮 Mock: Set player2 type to human for mock multiplayer experiment');

      // Simulate finding a partner after 2 seconds
      setTimeout(() => {
        console.log('🤖 Mock: Partner found, showing ready button');
        this.timelineManager.emit('partner-connected', {
          players: [
            { id: 'mock-player1', name: 'You' },
            { id: 'mock-player2', name: 'AI Partner' }
          ]
        });
      }, 2000);
    });

    this.timelineManager.on('player-ready', () => {
      console.log('🤖 Mock: Player clicked ready, simulating partner ready...');

      // Simulate both players ready after 1 second
      setTimeout(() => {
        console.log('🤖 Mock: Both players ready, starting game');
        this.uiManager.setPlayerInfo(0, 'human-human');
        this.timelineManager.emit('all-players-ready', {
          gameMode: 'human-human',
          players: [
            { id: 'mock-player1', playerIndex: 0 },
            { id: 'mock-player2', playerIndex: 1 }
          ]
        });
      }, 1000);
    });

    console.log('✅ Mock multiplayer timeline events registered');
  }

  setupTimelineEventHandlers() {
    if (!this.timelineManager) return;

    // Handle timeline save-data event
    this.timelineManager.on('save-data', (experimentData) => {
      console.log('💾 Timeline requesting data save:', experimentData);
      this.saveExperimentData(experimentData);
    });

    // Handle trial feedback event
    this.timelineManager.on('show-trial-feedback', (data) => {
      console.log('📊 Timeline requesting trial feedback:', data);
      if (this.experimentManager) {
        this.experimentManager.handleTrialFeedback(data);
      }
    });

    // Handle any multiplayer-specific timeline events
    this.timelineManager.on('partner-connected', () => {
      console.log('👥 Partner connected via timeline');
    });

    this.timelineManager.on('all-players-ready', () => {
      console.log('🎮 All players ready via timeline');
    });

    // Record AI fallback events initiated by the timeline (waiting/match timeouts)
    this.timelineManager.on('fallback-to-ai', (payload) => {
      try {
        const { reason = 'unknown', stage = 'waiting-for-partner', at = Date.now(), fallbackAIType = null } = payload || {};
        // Best-effort: ensure exact GPT model cached before recording
        try { this.experimentManager?.logCurrentAIModel?.(); } catch (_) { /* noop */ }
        this.gameStateManager?.recordPartnerFallback?.({ reason, stage, at, fallbackAIType });
        // Proactively fetch and persist GPT model so fallback AI type can be exact (e.g., gpt-4o)
        try { this.experimentManager?.logCurrentAIModel?.(); } catch (_) { /* noop */ }
      } catch (_) { /* noop */ }
    });

    console.log('📡 Timeline event handlers setup completed');
  }

  saveExperimentData(data) {
    // Save/export experiment data in legacy-compatible shape
    try {
      // Pull comprehensive trial data from GameStateManager (legacy: allTrialsData)
      const gsData = this.gameStateManager?.getExperimentData?.() || { allTrialsData: [], successThreshold: {} };

      // Participant ID: prefer existing, else try Prolific PID from URL
      let participantId = data.participantId;
      if (!participantId) {
        const params = new URLSearchParams(window.location.search);
        participantId = params.get('PROLIFIC_PID') || params.get('prolific_pid') || `participant_${Date.now()}`;
      }

      // Determine room id (from runtime or payload)
      const roomId = this.currentRoomId || data.roomId || null;

      // Legacy-compatible export object
      const exportObj = {
        participantId,
        timestamp: new Date().toISOString(),
        experimentOrder: (CONFIG?.game?.experiments?.order) || [],
        allTrialsData: gsData.allTrialsData || [],
        questionnaireData: data.questionnaire || null,
        successThreshold: gsData.successThreshold || {},
        completionCode: data.completionCode || '',
        version: (CONFIG?.game?.version) || '2.0.0',
        experimentType: (this.timelineManager?.gameMode === 'human-human') ? 'human-human' : 'human-AI',
        roomId
      };

      const dataStr = JSON.stringify(exportObj, null, 2);

      // Do not save locally (no localStorage / no file download)

      // Try legacy-style Google Drive save via Apps Script using SheetJS if available
      const scriptUrl = CONFIG.server.googleAppsScriptUrl;
      const enableGDrive = CONFIG.server.enableGoogleDriveSave;
      const hasXlsx = typeof window !== 'undefined' && typeof window.XLSX !== 'undefined';

      if (enableGDrive && scriptUrl && hasXlsx) {
        try {
          const XLSX = window.XLSX;
          const wb = XLSX.utils.book_new();

          // Process trial data into a flat table (include roomId as an extra column)
          const trials = exportObj.allTrialsData || [];
          if (trials.length > 0) {
            // Normalize rows to a stable header set to prevent column mismatches
            const processed = trials.map(t => {
              const o = {};
              for (const k in t) {
                const v = t[k];
                // Flatten arrays/objects for Excel cells
                o[k] = (Array.isArray(v) || (v && typeof v === 'object')) ? JSON.stringify(v) : v;
              }
              // Add roomId column to each row (explicit)
              o.roomId = exportObj.roomId || '';
              // Add participantId per row for easier analysis join
              o.participantId = exportObj.participantId;
              // Add current player number (1 or 2) for human-human mode analysis
              o.currentPlayer = (this.playerIndex !== undefined) ? (this.playerIndex + 1) : null;
              // Legacy naming: prefer distanceCondition in exports
              if (o.newGoalConditionType && !o.distanceCondition) {
                o.distanceCondition = o.newGoalConditionType;
              }
              // Drop non-legacy alias from export to avoid confusion
              delete o.newGoalConditionType;
              return o;
            });

            // Build a stable union of all keys across rows
            const headerSet = new Set();
            processed.forEach(row => Object.keys(row).forEach(k => headerSet.add(k)));

            // Prefer a sensible column order for readability; include common fields first if present
            const preferredOrder = [
              'trialIndex', 'experimentType', 'partnerAgentType',
              'currentPlayer', 'participantId', 'roomId',
              'humanPlayerIndex', 'aiPlayerIndex',
              'partnerFallbackOccurred', 'partnerFallbackReason', 'partnerFallbackStage', 'partnerFallbackTime',
              'partnerFallbackAIType',
              'collaborationSucceeded',
              'player1GoalReachedStep', 'player2GoalReachedStep',
              'newGoalPresented', 'newGoalPosition', 'distanceCondition', 'isNewGoalCloserToPlayer2',
              'trialStartTime', 'gptErrorEvents', 'currentPlayerIndex',
              'player1Trajectory', 'player2Trajectory', 'player1Actions', 'player2Actions', 'player1RT', 'player2RT',
              'player1CurrentGoal', 'player2CurrentGoal', 'player1FirstDetectedGoal', 'player2FirstDetectedGoal',
              'player1FinalReachedGoal', 'player2FinalReachedGoal', 'firstDetectedSharedGoal'
            ];
            const headers = [];
            // Add preferred keys that exist
            preferredOrder.forEach(k => { if (headerSet.has(k)) { headers.push(k); headerSet.delete(k); } });
            // Append any remaining keys in alphabetical order for determinism
            headers.push(...Array.from(headerSet).sort());

            // Map row values by header order to avoid misaligned columns
            const wsData = [
              headers,
              ...processed.map(row => headers.map(h => (h in row) ? row[h] : ''))
            ];

            const ws = XLSX.utils.aoa_to_sheet(wsData);
            XLSX.utils.book_append_sheet(wb, ws, 'ExperimentData');
          } else {
            const ws = XLSX.utils.aoa_to_sheet([["No experimental data available"], [new Date().toISOString()]]);
            XLSX.utils.book_append_sheet(wb, ws, 'ExperimentData');
          }

          // Meta sheet
          // Determine partner agent type summary for meta
          const p2Type = (CONFIG?.game?.players?.player2?.type) || '';
          const partnerAgentType = (function(){
            const p1Type = (CONFIG?.game?.players?.player1?.type);
            const p2Type = (CONFIG?.game?.players?.player2?.type);
            const t = (p1Type !== 'human') ? p1Type : ((p2Type !== 'human') ? p2Type : 'human');
            if (t === 'human') return 'human';
            if (t === 'gpt') {
              const model = (CONFIG?.game?.agent?.gpt?.model);
              if (model && String(model).trim().length > 0) {
                return String(model);
              } else {
                console.warn('⚠️ GPT model not cached in CONFIG for export, using configured default');
                return 'gpt-4o'; // matches the configured GPT_MODEL in .env
              }
            }
            if (t === 'rl_joint') return 'joint-rl';
            if (t === 'rl_individual') return 'individual-rl';
            if (t === 'ai') return (CONFIG?.game?.agent?.type === 'individual') ? 'individual-rl' : 'joint-rl'; // legacy safety
            return t || 'unknown';
          })();

          const fallbackEvents = (gsData && Array.isArray(gsData.fallbackEvents)) ? gsData.fallbackEvents : [];
          const metaRows = [
            ['participantId', exportObj.participantId],
            ['roomId', exportObj.roomId || ''],
            ['experimentOrder', JSON.stringify(exportObj.experimentOrder || [])],
            ['experimentType', exportObj.experimentType],
            ['partnerAgentType', partnerAgentType],
            ['fallbackEventCount', fallbackEvents.length],
            ['fallbackEvents', JSON.stringify(fallbackEvents)],
            ['version', exportObj.version],
            ['timestamp', exportObj.timestamp]
          ];
          const metaSheet = XLSX.utils.aoa_to_sheet(metaRows);
          XLSX.utils.book_append_sheet(wb, metaSheet, 'Meta');

          // Questionnaire sheet
          const q = exportObj.questionnaireData || exportObj.questionnaire || {};
          let qSheet;
          if (q && typeof q === 'object' && !Array.isArray(q)) {
            const headers = Object.keys(q);
            const values = headers.map(h => q[h]);
            qSheet = XLSX.utils.aoa_to_sheet([headers, values]);
          } else if (Array.isArray(q)) {
            qSheet = XLSX.utils.aoa_to_sheet(q);
          } else {
            qSheet = XLSX.utils.aoa_to_sheet([["Questionnaire"], [JSON.stringify(q)]]);
          }
          XLSX.utils.book_append_sheet(wb, qSheet, 'Questionnaire');

          // Write workbook and send to Apps Script
          const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
          const base64 = btoa(String.fromCharCode.apply(null, new Uint8Array(wbout)));
          const ts = new Date().toISOString().replace(/[:.]/g, '-');
          const safeId = String(exportObj.participantId).replace(/[^a-zA-Z0-9_-]/g, '_');
          const safeRoom = String(exportObj.roomId || 'no-room').replace(/[^a-zA-Z0-9_-]/g, '_');
          const excelFilename = `experiment_data_${safeId}_room_${safeRoom}_${ts}.xlsx`;

          const formData = new FormData();
          formData.append('filename', excelFilename);
          formData.append('filedata', base64);
          formData.append('filetype', 'excel');

          fetch(scriptUrl, { method: 'POST', mode: 'no-cors', body: formData })
            .then(() => {
              console.log('✅ Google Drive save attempted via Apps Script');
              // Provide user feedback like legacy and notify timeline
              try {
                if (this.timelineManager) {
                  this.timelineManager.emit('data-save-success');
                }
                alert('Data saved successfully!');
              } catch (e) {
                // Ignore UI feedback errors
              }
            })
            .catch(err => {
              console.warn('⚠️ Google Drive save failed. Local saving is disabled.', err);
            });
        } catch (e) {
          console.warn('⚠️ Excel/Apps Script save failed. Local saving is disabled.', e);
        }
      } else {
        console.warn('⚠️ Google Drive save disabled or XLSX not available. Local saving is disabled.');
      }
    } catch (error) {
      console.error('Failed to save/export experiment data:', error);
    }
  }

  async startSinglePlayerMode(experimentType) {
    // Configure for human-AI mode
    GameConfigUtils.setPlayerType(2, CONFIG.multiplayer.fallbackAIType || 'rl_joint');

    // Set player info for single player (always player 0 - red)
    this.uiManager.setPlayerInfo(0, 'human-ai');

    // Show main UI
    this.uiManager.showMainScreen();

    // Start experiment sequence
    await this.experimentManager.startExperimentSequence([experimentType]);
  }

  async startMultiplayerMode(experimentType, roomId) {
    // Configure for human-human mode
    CONFIG.game.players.player2.type = 'human';

    // Show lobby screen
    this.uiManager.showLobbyScreen();

    try {
      // Join or create room
      const room = await this.networkManager.joinRoom({
        roomId,
        gameMode: 'human-human',
        experimentType
      });

      console.log('Joined room:', room);

      // Update UI with room info
      this.uiManager.updateLobbyInfo(room);

    } catch (error) {
      console.error('Failed to join room:', error);
      this.uiManager.showError('Failed to join game room. Please try again.');
    }
  }

  setupNetworkEventHandlers() {
    if (!this.networkManager) return;

    // Room events
    this.networkManager.on('room-joined', (data) => {
      console.log('Room joined:', data);
      if (data && data.roomId) {
        this.currentRoomId = data.roomId;
        // Expose room id and a deterministic session seed for client-side sync logic
        try {
          window.__ROOM_ID__ = data.roomId;
          const seedStr = String(data.roomId || '');
          let hash = 0;
          for (let i = 0; i < seedStr.length; i++) {
            hash = ((hash << 5) - hash) + seedStr.charCodeAt(i);
            hash |= 0;
          }
          window.__SESSION_SEED__ = Math.abs(hash);
        } catch (_) { /* ignore */ }
      }

      // Do NOT emit 'partner-connected' here — this fires even when alone.
      // Wait for 'player-joined' event (emitted to others) to signal a partner is present.

      // Set preliminary playerIndex as soon as possible for UI/timeline (before game-started)
      // Prefer server-provided host flag when available
      try {
        if (typeof data.isHost === 'boolean') {
          this.playerIndex = data.isHost ? 0 : 1;
        }
        // Propagate to UI and timeline so color labels render correctly in early stages
        if (this.useTimelineFlow) {
          this.uiManager.setPlayerInfo(this.playerIndex, data.gameMode || 'human-human');
          if (this.timelineManager) this.timelineManager.setPlayerInfo(this.playerIndex, data.gameMode || 'human-human');
        }
      } catch (_) { /* ignore */ }

      if (!this.useTimelineFlow) {
        // Legacy flow
        this.uiManager.updateLobbyInfo(data);
      }
    });

    this.networkManager.on('player-joined', (data) => {
      console.log('Player joined:', data);

      if (this.useTimelineFlow && this.timelineManager) {
        // Notify timeline about partner presence for the other player
        this.timelineManager.emit('partner-connected', data);
      } else {
        // Legacy flow
        this.uiManager.updatePlayerList(data.players);
      }
    });

    // When room becomes full, notify both players with a synchronized timestamp
    this.networkManager.on('room-full', (data) => {
      console.log('Room is full - both players connected:', data);
      // Derive player index from player list and my socket id to update UI promptly
      try {
        const myId = this.networkManager?.socket?.id;
        const idx = Array.isArray(data?.players) ? data.players.findIndex(p => p.id === myId) : -1;
        if (idx === 0 || idx === 1) {
          this.playerIndex = idx;
          if (this.useTimelineFlow) {
            this.uiManager.setPlayerInfo(this.playerIndex, data.gameMode || 'human-human');
            if (this.timelineManager) this.timelineManager.setPlayerInfo(this.playerIndex, data.gameMode || 'human-human');
          }
        }
      } catch (_) { /* ignore */ }
      if (this.useTimelineFlow && this.timelineManager) {
        this.timelineManager.emit('partner-connected', data);
      }
    });

    this.networkManager.on('player-disconnected', (data) => {
      console.log('Player disconnected:', data);

      if (this.useTimelineFlow) {
        // Switch to AI partner and continue via timeline
        console.log('Partner disconnected during timeline flow - switching to AI');
        const fallbackType = (CONFIG?.multiplayer?.fallbackAIType) || 'rl_joint';
        // Determine which player index disconnected (0 or 1)
        let discIdx = null;
        try {
          const gs = this.gameConfig; // set on 'game-started'
          if (gs && Array.isArray(gs.players)) {
            discIdx = gs.players.findIndex(p => p.id === data?.playerId);
          }
        } catch (_) { /* noop */ }
        // Default to the opposite of me if unknown
        if (discIdx !== 0 && discIdx !== 1) {
          discIdx = (this.playerIndex === 0) ? 1 : 0;
        }
        const aiPlayerNumber = discIdx + 1;
        // Update config + managers
        try {
          this.experimentManager?.activateAIFallback?.(fallbackType, aiPlayerNumber);
        } catch (_) { /* noop */ }
        // Best-effort: ensure exact GPT model cached before recording
        try { this.experimentManager?.logCurrentAIModel?.(); } catch (_) { /* noop */ }
        // Record fallback event for export (no UI message)
        try {
          this.gameStateManager?.recordPartnerFallback?.({ reason: 'disconnect', stage: 'in-game', at: Date.now(), fallbackAIType: fallbackType });
        } catch (_) { /* noop */ }
        // Post-upgrade in case model resolved after recording
        try { this.experimentManager?.logCurrentAIModel?.(); } catch (_) { /* noop */ }
        try {
          this.uiManager.setPlayerInfo(this.playerIndex, 'human-ai');
        } catch (_) { /* noop */ }
        try {
          if (this.timelineManager) {
            this.timelineManager.gameMode = 'human-ai';
            // Nudge current waiting/match stages if applicable
            this.timelineManager.emit('partner-connected', { connectedAt: Date.now(), players: data?.players || [] });
            this.timelineManager.emit('all-players-ready', { gameMode: 'human-ai' });
          }
        } catch (_) { /* noop */ }
      } else {
        // Legacy flow
        this.uiManager.updatePlayerList(data.players);
        // Switch to AI in legacy mode as well
        const fallbackType = (CONFIG?.multiplayer?.fallbackAIType) || 'rl_joint';
        let discIdx = null;
        try {
          const gs = this.gameConfig;
          if (gs && Array.isArray(gs.players)) {
            discIdx = gs.players.findIndex(p => p.id === data?.playerId);
          }
        } catch (_) { /* noop */ }
        if (discIdx !== 0 && discIdx !== 1) {
          discIdx = (this.playerIndex === 0) ? 1 : 0;
        }
        const aiPlayerNumber = discIdx + 1;
        try {
          this.experimentManager?.activateAIFallback?.(fallbackType, aiPlayerNumber);
        } catch (_) { /* noop */ }
        // Best-effort: ensure exact GPT model cached before recording
        try { this.experimentManager?.logCurrentAIModel?.(); } catch (_) { /* noop */ }
        // Record fallback event for export (no UI message)
        try {
          this.gameStateManager?.recordPartnerFallback?.({ reason: 'disconnect', stage: 'in-game', at: Date.now(), fallbackAIType: fallbackType });
        } catch (_) { /* noop */ }
        // Post-upgrade in case model resolved after recording
        try { this.experimentManager?.logCurrentAIModel?.(); } catch (_) { /* noop */ }
      }
    });

    // Handle player ready status updates
    this.networkManager.on('player-ready-status', (data) => {
      console.log('Player ready status update:', data);

      if (this.useTimelineFlow && this.timelineManager) {
        // Check if all players are ready based on the updated player list
        const allReady = data.players && data.players.every(p => p.isReady);
        console.log(`All players ready: ${allReady}`, data.players);

        if (allReady) {
          // Only emit all-players-ready if we haven't already done so
          console.log('🎮 All players ready - emitting to timeline');
          this.timelineManager.emit('all-players-ready', {
            gameMode: 'human-human',
            players: data.players
          });
        }
      } else {
        // Legacy flow - update lobby info
        this.uiManager.updatePlayerReadyStatus(data.players);
      }
    });

    // Game events
    this.networkManager.on('game-started', (config) => {
      console.log('Game started:', config);
      this.gameConfig = config;

      // Find this player's index in the config
      const mySocketId = this.networkManager.socket.id;
      const myPlayerConfig = config.players.find(p => p.id === mySocketId);
      if (myPlayerConfig) {
        this.playerIndex = myPlayerConfig.playerIndex;
        console.log(`I am player ${this.playerIndex + 1} (${this.playerIndex === 0 ? 'red' : 'orange'})`);
        // Mark host (playerIndex 0) for client-coordinated actions like new-goal broadcast
        try {
          window.__PLAYER_INDEX__ = this.playerIndex;
          window.__IS_HOST__ = (this.playerIndex === 0);
        } catch (_) { /* ignore */ }
      }

      if (this.useTimelineFlow) {
        // Set player info for timeline flow
        this.uiManager.setPlayerInfo(this.playerIndex, config.gameMode);
        this.timelineManager.setPlayerInfo(this.playerIndex, config.gameMode);
        // Notify timeline that both players are ready
        this.timelineManager.emit('all-players-ready', config);
      } else {
        // Legacy networked game flow
        this.startNetworkedGame(config);
      }
    });

    this.networkManager.on('player-action', (data) => {
      console.log('Player action received:', data);
      this.handleRemotePlayerAction(data);
    });

    this.networkManager.on('game-state-update', (gameState) => {
      console.log('Game state update received');

      // Check if we're in human-human real-time mode
      const isHumanHuman = CONFIG.game.players.player1.type === 'human' &&
                           CONFIG.game.players.player2.type === 'human';
      const isSyncTurns = GameConfigUtils.isSynchronizedHumanTurnsEnabled(gameState?.experimentType);

      // In real-time mode, only sync state periodically to avoid conflicts
      if (isHumanHuman && !isSyncTurns) {
        // 🔧 FIX: More conservative sync conditions to prevent position rollback
        const canSync = this.gameStateManager.shouldSyncState();
        const hasRecentLocalMoves = this.gameStateManager.hasRecentLocalMoves();

        // Only sync if enough time has passed AND we don't have very recent local moves
        if (canSync && !hasRecentLocalMoves) {
          console.log('🔄 Syncing remote state (no recent local moves)');
          this.gameStateManager.syncState(gameState);
          this.uiManager.updateGameDisplay(this.gameStateManager.getCurrentState());
          this.gameStateManager.markStateSynced();
        } else if (hasRecentLocalMoves) {
          console.log('⏸️ Skipping sync - recent local moves detected');
        }
      } else {
        // Normal state sync for other modes
        this.gameStateManager.syncState(gameState);
        this.uiManager.updateGameDisplay(this.gameStateManager.getCurrentState());

        // Clear pending moves for synchronized turns
        if (isSyncTurns) {
          this._hhSync.pendingMoves[0] = null;
          this._hhSync.pendingMoves[1] = null;
        }
      }
    });

    // Error handling
    this.networkManager.on('error', (error) => {
      console.error('Network error:', error);
      this.uiManager.showError(error.message);
    });

    this.networkManager.on('disconnect', () => {
      console.log('Disconnected from server');

      // Stop real-time synchronization on disconnect
      this.stopRealTimeSync();

      this.uiManager.showError('Connection lost. Please refresh the page.');
    });
  }

  setupUIEventHandlers() {
    // Player ready button
    this.uiManager.on('player-ready', () => {
      if (this.networkManager) {
        this.networkManager.setPlayerReady();
      }
    });

    // Game actions
    this.uiManager.on('player-move', async (direction) => {
      // Always allow free movement in single-player experiments (1P1G, 1P2G)
      try {
        const state = this.gameStateManager?.getCurrentState?.();
        const expType = state?.experimentType || '';
        const isTwoPlayerExperiment = String(expType).includes('2P');
        const hasTwoPlayersInState = !!(state?.player1 && state?.player2);
        if (!isTwoPlayerExperiment || !hasTwoPlayersInState) {
          // In 1P games (or before 2P players are fully set), ignore any sync logic
          this.handlePlayerMove(direction);
          return;
        }
      } catch (_) { /* fall through to original logic */ }

      // If player2 is AI/GPT and synchronized moves are enabled, delegate to ExperimentManager
      // Determine if the other player (not me) is AI/GPT
      const otherIdx = (this.playerIndex === 0) ? 1 : 0;
      const otherType = CONFIG.game?.players?.[otherIdx === 0 ? 'player1' : 'player2']?.type;
      const sync = CONFIG.game?.agent?.synchronizedMoves;
      const isAIPartner = otherType !== 'human';

      // Human-human synchronized turns: intercept and coordinate
      const hhSyncEnabled = GameConfigUtils.isSynchronizedHumanTurnsEnabled(this.gameStateManager?.getCurrentState?.()?.experimentType);
      const inNetworkedPlay = !!(this.networkManager && this.networkManager.isConnected);
      const isHumanHuman = !isAIPartner && inNetworkedPlay;
      if (hhSyncEnabled && isHumanHuman) {
        try {
          await this.handleHumanHumanSynchronizedMove(direction);
        } catch (e) {
          console.warn('HH sync move failed, falling back to immediate move:', e?.message || e);
          this.handlePlayerMove(direction);
        }
        return;
      }

      if (isAIPartner && sync && this.experimentManager?.handleSynchronizedMove) {
        try {
          await this.experimentManager.handleSynchronizedMove(direction);
        } catch (e) {
          console.warn('Synchronized move failed, falling back to local move:', e?.message || e);
          this.handlePlayerMove(direction);
        }
      } else {
        this.handlePlayerMove(direction);
      }
    });

    // Experiment controls
    this.uiManager.on('start-experiment', (experimentType) => {
      this.experimentManager.startExperiment(experimentType);
    });

    this.uiManager.on('restart-experiment', () => {
      this.experimentManager.restart();
    });
  }

  async startNetworkedGame(config) {
    // Set player info in UI manager
    this.uiManager.setPlayerInfo(this.playerIndex, config.gameMode);

    // Set player info in timeline manager if using timeline flow
    if (this.timelineManager) {
      this.timelineManager.setPlayerInfo(this.playerIndex, config.gameMode);
    }

    // Hide lobby, show game
    this.uiManager.showGameScreen();

    // Start real-time synchronization if in human-human mode
    this.startRealTimeSync();

    // Configure multiplayer experiment
    await this.experimentManager.startMultiplayerExperiment(config);
  }

  startRealTimeSync() {
    // Check if we need real-time synchronization
    const isHumanHuman = CONFIG.game.players.player1.type === 'human' &&
                         CONFIG.game.players.player2.type === 'human';

    if (!isHumanHuman) return;

    // Start periodic state synchronization to ensure consistency
    this._rtSync.syncInterval = setInterval(() => {
      if (this.networkManager && this.networkManager.isConnected) {
        // Send periodic state sync to maintain consistency
        if (this.gameStateManager.shouldSyncState()) {
          this.networkManager.syncGameState(this.gameStateManager.getCurrentState());
          this.gameStateManager.markStateSynced();
        }
      }
    }, CONFIG.multiplayer.realTimeMovement.stateSyncInterval);

    console.log('Real-time synchronization started');
  }

  stopRealTimeSync() {
    if (this._rtSync.syncInterval) {
      clearInterval(this._rtSync.syncInterval);
      this._rtSync.syncInterval = null;
    }

    // Clear real-time sync state
    if (this.gameStateManager && this.gameStateManager.clearRealTimeSync) {
      this.gameStateManager.clearRealTimeSync();
    }

    console.log('Real-time synchronization stopped');
  }

  handlePlayerMove(direction) {
    // Use the correct player index (1-based for game logic, but add 1 since processPlayerMove expects 1 or 2)
    const playerNumber = this.playerIndex + 1; // Convert 0,1 to 1,2
    const timestamp = Date.now();

    // Check if we're in human-human real-time mode
    const isHumanHuman = this.networkManager && this.networkManager.isConnected &&
                         CONFIG.game.players.player1.type === 'human' &&
                         CONFIG.game.players.player2.type === 'human';

    const isSyncTurns = GameConfigUtils.isSynchronizedHumanTurnsEnabled(
      this.gameStateManager?.getCurrentState?.()?.experimentType
    );

    // Use real-time movement system for human-human free movement
    if (isHumanHuman && !isSyncTurns) {
      // Process move with real-time synchronization
      const moveResult = this.gameStateManager.processPlayerMoveRealTime(
        playerNumber,
        direction,
        timestamp,
        true, // isLocal
        this.playerIndex // currentPlayerIndex (0 or 1)
      );

      if (!moveResult.success) {
        if (moveResult.reason === 'throttled') {
          // Silently ignore throttled moves
          return;
        }
        console.warn('Move rejected:', moveResult.reason);
        return;
      }

      // Update UI immediately for local moves
      this.uiManager.updateGameDisplay(this.gameStateManager.getCurrentState());

      // Send move with timestamp to network
      if (this.networkManager.isConnected) {
        this.networkManager.sendGameAction({
          type: 'move',
          direction: direction,
          playerIndex: this.playerIndex,
          timestamp: timestamp,
          moveId: moveResult.moveId
        });

        // Sync full state periodically to ensure consistency
        if (this.gameStateManager.shouldSyncState()) {
          this.networkManager.syncGameState(this.gameStateManager.getCurrentState());
          this.gameStateManager.markStateSynced();
        }
      }

      // Check for trial completion
      if (moveResult.trialComplete) {
        this.handleTrialComplete(moveResult);
      }

      return;
    }

    // Original synchronous processing for other modes
    const moveResult = this.gameStateManager.processPlayerMove(playerNumber, direction, this.playerIndex);

    // Send to network if in multiplayer mode
    if (this.networkManager && this.networkManager.isConnected) {
      this.networkManager.sendGameAction({
        type: 'move',
        direction,
        playerIndex: this.playerIndex,
        timestamp: timestamp
      });
    }

    // Update UI
    this.uiManager.updateGameDisplay(this.gameStateManager.getCurrentState());

    // Check for trial completion
    if (moveResult.trialComplete) {
      this.handleTrialComplete(moveResult);
    }
  }

  handleRemotePlayerAction(data) {
    const { action } = data;

    if (action.type === 'move') {
      // Determine which player this action is from (opposite of local player)
      const remotePlayerNumber = action.playerIndex + 1; // Convert 0,1 to 1,2

      // Only process if it's not from the same player (avoid duplicate processing)
      if (action.playerIndex !== this.playerIndex) {
        // Check if we're in human-human real-time mode
        const isHumanHuman = CONFIG.game.players.player1.type === 'human' &&
                             CONFIG.game.players.player2.type === 'human';

        const isSyncTurns = GameConfigUtils.isSynchronizedHumanTurnsEnabled(
          this.gameStateManager?.getCurrentState?.()?.experimentType
        );

        let moveResult;

        // Use real-time movement system for human-human free movement
        if (isHumanHuman && !isSyncTurns) {
          // Process remote move immediately with throttling
          moveResult = this.gameStateManager.processPlayerMoveRealTime(
            remotePlayerNumber,
            action.direction,
            action.timestamp || Date.now(),
            false, // isLocal = false
            action.playerIndex // currentPlayerIndex from remote player (0 or 1)
          );
        } else {
          // Original synchronous processing for other modes
          moveResult = this.gameStateManager.processPlayerMove(remotePlayerNumber, action.direction, action.playerIndex);
        }

        // Update UI immediately for synchronous processing or optimistic updates
        this.uiManager.updateGameDisplay(this.gameStateManager.getCurrentState());

        // Check for trial completion
        if (moveResult && moveResult.trialComplete) {
          this.handleTrialComplete(moveResult);
        }
      }
      return;
    }

    // Human-human synchronized turns: collect partner's proposed move
    if (action.type === 'proposed-move') {
      const hhSyncEnabled = GameConfigUtils.isSynchronizedHumanTurnsEnabled(this.gameStateManager?.getCurrentState?.()?.experimentType);
      if (!hhSyncEnabled) return;
      const isHost = !!(typeof window !== 'undefined' && window.__IS_HOST__);
      const fromIdx = action.playerIndex;
      this._hhSync.pendingMoves[fromIdx] = action.direction;

      // Host resolves the turn when both moves are present
      if (isHost) {
        this.tryResolveHumanHumanTurn();
      }
    }
  }

  async handleHumanHumanSynchronizedMove(direction) {
    // Store my proposed move
    this._hhSync.pendingMoves[this.playerIndex] = direction;

    // Broadcast proposed move to partner
    if (this.networkManager && this.networkManager.isConnected) {
      this.networkManager.sendGameAction({
        type: 'proposed-move',
        direction,
        playerIndex: this.playerIndex,
        timestamp: Date.now()
      });
    }

    // If host, attempt to resolve immediately if partner move already arrived
    const isHost = !!(typeof window !== 'undefined' && window.__IS_HOST__);
    if (isHost) {
      this.tryResolveHumanHumanTurn();
    }
  }

  tryResolveHumanHumanTurn() {
    const m0 = this._hhSync.pendingMoves[0];
    const m1 = this._hhSync.pendingMoves[1];
    if (!m0 || !m1) return; // Wait for both

    // Apply both moves simultaneously (uses shared synchronized step with stepCount++)
    const result = this.gameStateManager.processSynchronizedMoves(m0, m1);
    // Redraw
    this.uiManager.updateGameDisplay(this.gameStateManager.getCurrentState());
    // Broadcast full state to partner
    if (this.networkManager && this.networkManager.isConnected) {
      this.networkManager.syncGameState(this.gameStateManager.getCurrentState());
    }
    // Clear pending moves
    this._hhSync.pendingMoves[0] = null;
    this._hhSync.pendingMoves[1] = null;

    if (result?.trialComplete) {
      this.handleTrialComplete(result);
    }
  }

  handleTrialComplete(result) {
    // Send completion to network if needed
    if (this.networkManager && this.networkManager.isConnected) {
      this.networkManager.sendTrialComplete(result);
    }

    // Let experiment manager handle the completion
    this.experimentManager.handleTrialComplete(result);
  }

  // Cleanup
  destroy() {
    // Stop real-time synchronization
    this.stopRealTimeSync();

    if (this.networkManager) {
      this.networkManager.disconnect();
    }

    if (this.uiManager) {
      this.uiManager.destroy();
    }

    this.isInitialized = false;
  }
}
