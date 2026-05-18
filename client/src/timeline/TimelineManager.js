import { CONFIG, GameConfigUtils } from '../config/gameConfig.js';
import {
  calculateAgeFromDob,
  getKidEventIdFromUrl,
  getKidStationIdFromUrl,
  getParticipantIdFromUrl
} from '../utils/ParticipantUtils.js';
import { getPlayerDisplayInfo } from '../utils/DisplayPerspectiveUtils.js';
import { KidWaitMinigame } from './KidWaitMinigame.js';

/**
 * Timeline Manager - Orchestrates the complete experiment flow
 * Matches the legacy expTimeline.js structure exactly
 */
export class TimelineManager {
  constructor(container) {
    this.container = container;
    this.stages = [];
    this.currentStageIndex = 0;
    this.mapData = {};
    // Track whether we've already shown the partner-finding stage
    this.hasShownPartnerFindingStage = false;
    this.waitingTimes = []; // Store waiting time records for export
    this.generatedParticipantId = null;
    this.manualParticipantId = null;
    this.experimentData = {
      participantId: this.getParticipantId(),
      childId: null,
      startTime: new Date().toISOString(),
      consentTime: null,
      experiments: {},
      questionnaire: {},
      participantDob: null,
      participantAgeReferenceDate: null,
      participantAgeYears: null,
      participantAgeMonths: null,
      participantAgeDays: null,
      participantAgeTotalDays: null,
      eventId: getKidEventIdFromUrl() || CONFIG?.kids?.eventId || 'default',
      stationId: getKidStationIdFromUrl() || CONFIG?.kids?.stationId || null,
      warmupTrialCount: 0,
      neutralWaitStartTime: null,
      neutralWaitEndTime: null,
      neutralWaitMs: null,
      kidMatchOutcome: null,
      fallbackReason: null,
      partnerFallbackAIType: null,
      waitMinigameEnabled: false,
      waitMinigameStartTime: null,
      waitMinigameEndTime: null,
      waitMinigameDurationMs: null,
      waitMinigameJumpCount: 0,
      waitMinigameCollisionCount: 0,
      totalScore: 0,
      completed: false
    };
    this.eventHandlers = new Map();

    // Success threshold tracking for collaboration experiments
    this.successThreshold = {
      consecutiveSuccesses: 0,
      totalTrialsCompleted: 0,
      experimentEndedEarly: false,
      lastSuccessTrial: -1,
      successHistory: []
    };

    // Map synchronization for multiplayer
    this.sharedMapData = {};
    this.isMapHost = false;
    this.pendingMapSync = false;
    this.stageAdvanceHandler = null;
    this.stageAdvanceButtonHandler = null;
    this.stageAdvanceButtonId = null;

    // Player information for multiplayer games
    this.playerIndex = 0; // Default to player 0 (red)
    this.gameMode = 'human-ai'; // Default game mode
    this.kidBackgroundMatchmakingStarted = false;
    this.kidTeammateWaitActive = false;
    this.kidWaitMinigame = null;
  }

  isKidMode() {
    return !!CONFIG?.kids?.enabled;
  }

  isKidGameTestMode() {
    return this.isKidMode() && !!CONFIG?.kids?.gameTestMode;
  }

  shouldUseHumanMatching() {
    return !this.isKidMode() || CONFIG?.kids?.partnerMode === 'human';
  }

  getMainKidExperimentType() {
    const mainOrder = GameConfigUtils.getKidMainExperimentOrder?.() || ['2P3G'];
    return mainOrder[mainOrder.length - 1] || '2P3G';
  }

  getTimelineExperimentOrder() {
    if (!this.isKidMode()) {
      return CONFIG.game.experiments.order;
    }

    if (this.isKidGameTestMode()) {
      return GameConfigUtils.getKidMainExperimentOrder?.() || [this.getMainKidExperimentType()];
    }

    const warmupOrder = Array.isArray(CONFIG?.kids?.warmupExperimentOrder)
      ? CONFIG.kids.warmupExperimentOrder
      : ['1P1G', '1P2G'];
    const mainOrder = GameConfigUtils.getKidMainExperimentOrder?.() || [this.getMainKidExperimentType()];
    return [...warmupOrder, ...mainOrder];
  }

  getTrialPhase(experimentType) {
    return this.isKidMode() && String(experimentType || '').startsWith('1P')
      ? 'warmup'
      : 'main_2p';
  }

  getKidSessionMetadata() {
    const eventId = getKidEventIdFromUrl() || CONFIG?.kids?.eventId || 'default';
    const stationId = getKidStationIdFromUrl() || CONFIG?.kids?.stationId || null;
    return { eventId, stationId };
  }

  // Event system
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
          console.error(`Error in timeline event handler for ${event}:`, error);
        }
      });
    }
  }

  // Set player information for multiplayer games
  setPlayerInfo(playerIndex, gameMode) {
    this.playerIndex = playerIndex;
    this.gameMode = gameMode || 'human-ai';
    console.log(`🎮 TimelineManager: Set player info - Player ${playerIndex + 1} (${playerIndex === 0 ? 'red' : 'orange'}) in ${this.gameMode} mode`);
  }

  /**
   * Create the complete timeline stages matching legacy structure
   */
  createTimelineStages() {
    this.stages = [];

    console.log('📋 Creating comprehensive timeline stages...');

    if (this.isKidMode()) {
      if (!this.isKidGameTestMode()) {
        this.stages.push({
          type: 'fullscreen_prompt',
          handler: () => this.showFullscreenPromptStage()
        });
        this.stages.push({
          type: 'dob',
          handler: () => this.showDobStage()
        });
        if (this.shouldUseHumanMatching()) {
          this.stages.push({
            type: 'kid_background_matchmaking',
            handler: () => this.startKidBackgroundMatchmaking()
          });
        }
        this.stages.push({
          type: 'welcome_info',
          handler: () => this.showWelcomeInfoStage()
        });
      }
    } else {
      // 1. Consent form
      this.stages.push({
        type: 'consent',
        handler: () => this.showConsentStage()
      });

      // 2. Welcome info
      this.stages.push({
        type: 'welcome_info',
        handler: () => this.showWelcomeInfoStage()
      });
    }

    // 3-6. Add stages for each experiment in order
    const experimentOrder = this.getTimelineExperimentOrder();
    this.experimentData.experimentOrder = experimentOrder;
    for (let expIndex = 0; expIndex < experimentOrder.length; expIndex++) {
      const experimentType = experimentOrder[expIndex];
      const numTrials = CONFIG.game.experiments.numTrials[experimentType];

      console.log(`📋 Adding stages for experiment: ${experimentType}`);

      // Instructions for this experiment
      if (!this.isKidGameTestMode()) {
        this.stages.push({
          type: 'instructions',
          experimentType: experimentType,
          experimentIndex: expIndex,
          handler: () => this.showInstructionsStage(experimentType, expIndex)
        });
      }

      // Waiting room only for true human-human multiplayer experiments
      // For human-AI mode, 2P experiments run with AI as the second player
      const isMultiplayer = experimentType.includes('2P');
      console.log(`🔍 Experiment ${experimentType}: isMultiplayer=${isMultiplayer}`);

      const shouldMatchHumanPartner = !this.isKidMode() || this.shouldUseHumanMatching();
      if (this.isKidMode() && isMultiplayer && shouldMatchHumanPartner) {
        if (!this.hasShownPartnerFindingStage) {
          this.stages.push({
            type: 'kid_teammate_wait',
            experimentType: experimentType,
            experimentIndex: expIndex,
            handler: () => this.showKidTeammateWaitingStage(experimentType, expIndex)
          });
          this.hasShownPartnerFindingStage = true;
        }
      } else if (isMultiplayer && shouldMatchHumanPartner) {
        // Only show the partner-finding (waiting) stage once across all 2P games
        if (!this.hasShownPartnerFindingStage) {
          console.log(`➕ Adding waiting + match-play stages for ${experimentType}`);
          // Stage 1: Waiting for partner (spinner + status)
          this.stages.push({
            type: 'waiting_for_partner',
            experimentType: experimentType,
            experimentIndex: expIndex,
            handler: () => this.showWaitingForPartnerStage(experimentType, expIndex)
          });
          // Stage 2: Match play gate (Game is Ready! press space)
          this.stages.push({
            type: 'match_play',
            experimentType: experimentType,
            experimentIndex: expIndex,
            showPartnerFoundMessage: true,
            handler: () => this.showMatchPlayStage(experimentType, expIndex)
          });
          this.hasShownPartnerFindingStage = true;
        } else {
          console.log(`➕ Skipping waiting stage for ${experimentType}; adding match-play only`);
          // Only add the match play gate for subsequent 2P experiments
          // But first check if partner is still connected
          this.stages.push({
            type: 'check_partner_presence',
            experimentType: experimentType,
            experimentIndex: expIndex,
            handler: () => this.checkPartnerPresenceAndProceed(experimentType, expIndex)
          });
          this.stages.push({
            type: 'match_play',
            experimentType: experimentType,
            experimentIndex: expIndex,
            showPartnerFoundMessage: false,
            handler: () => this.showMatchPlayStage(experimentType, expIndex)
          });
        }
      }

      // Add trial stages (fixation -> trial -> feedback sequence)
      if (experimentType.includes('2P') && CONFIG.game.successThreshold.enabled && !this.isKidGameTestMode()) {
        // Dynamic collaboration stages
        this.addCollaborationExperimentStages(experimentType, expIndex);
      } else {
        // Fixed number of trials
        for (let i = 0; i < numTrials; i++) {
          this.addTrialStages(experimentType, expIndex, i);
        }
      }
    }

    if (!this.isKidGameTestMode()) {
      // 7. Game performance feedback
      this.stages.push({
        type: 'game-feedback',
        handler: () => this.showGameFeedbackStage()
      });

      // 8. Post-questionnaire
      this.stages.push({
        type: 'questionnaire',
        handler: () => this.showQuestionnaireStage()
      });

      // 9. End info with data saving
      this.stages.push({
        type: 'end-info',
        handler: () => this.showEndExperimentInfoStage()
      });
    }

    if (this.isKidMode()) {
      this.stages.push({
        type: 'local-complete',
        handler: () => this.showKidLocalCompletionStage()
      });
    } else {
      // 10. Prolific redirect
      this.stages.push({
        type: 'prolific-redirect',
        handler: () => this.showProlificRedirectStage()
      });
    }

    console.log(`📋 Timeline created with ${this.stages.length} total stages`);
    console.log('📋 Stages:', this.stages.map((stage, index) => `${index}: ${stage.type}`).join(', '));
  }

  /**
   * Add trial stages: fixation -> trial -> post-trial feedback
   */
  addTrialStages(experimentType, experimentIndex, trialIndex) {
    // Fixation screen
    this.stages.push({
      type: 'fixation',
      experimentType: experimentType,
      experimentIndex: experimentIndex,
      trialIndex: trialIndex,
      handler: () => this.showFixationStage(experimentType, experimentIndex, trialIndex)
    });

    // Main trial
    this.stages.push({
      type: 'trial',
      experimentType: experimentType,
      experimentIndex: experimentIndex,
      trialIndex: trialIndex,
      handler: () => this.runTrialStage(experimentType, experimentIndex, trialIndex)
    });

    // Post-trial feedback
    this.stages.push({
      type: 'post-trial',
      experimentType: experimentType,
      experimentIndex: experimentIndex,
      trialIndex: trialIndex,
      handler: () => this.showPostTrialStage(experimentType, experimentIndex, trialIndex)
    });
  }

  /**
   * Add collaboration experiment stages with dynamic success threshold
   */
  addCollaborationExperimentStages(experimentType, experimentIndex) {
    // Initialize success threshold tracking for this experiment
    this.initializeSuccessThresholdTracking();

    // Add initial trial stages - more will be added dynamically based on performance
    this.addTrialStages(experimentType, experimentIndex, 0);
  }

  /**
   * Start the timeline
   */
  start() {
    this.createTimelineStages();
    this.currentStageIndex = 0;
    this.runCurrentStage();
  }

  /**
   * Run the current stage
   */
  runCurrentStage() {
    if (this.currentStageIndex >= this.stages.length) {
      console.log('🏁 Timeline completed!');
      return;
    }

    const stage = this.stages[this.currentStageIndex];
    this.clearStageAdvanceControls();
    console.log(`🎬 Running stage ${this.currentStageIndex}: ${stage.type}`);

    try {
      stage.handler();
      this.applyKidVisualTheme();
    } catch (error) {
      console.error(`❌ Error running stage ${stage.type}:`, error);
      this.nextStage();
    }
  }

  /**
   * Advance to next stage
   */
  nextStage() {
    console.log(`➡️ Advancing from stage ${this.currentStageIndex} to ${this.currentStageIndex + 1}`);
    this.currentStageIndex++;
    this.runCurrentStage();
  }

  skipNextMatchPlayStageIfPresent() {
    const nextStage = this.stages[this.currentStageIndex + 1];
    if (nextStage?.type === 'match_play') {
      this.currentStageIndex++;
    }
  }

  /**
   * Stage Implementations
   */

  clearStageAdvanceControls() {
    if (this.stageAdvanceHandler) {
      window.removeEventListener('keydown', this.stageAdvanceHandler, true);
      document.removeEventListener('keydown', this.stageAdvanceHandler, true);
      this.stageAdvanceHandler = null;
    }

    if (this.stageAdvanceButtonId && this.stageAdvanceButtonHandler) {
      const button = document.getElementById(this.stageAdvanceButtonId);
      if (button) {
        button.removeEventListener('click', this.stageAdvanceButtonHandler);
      }
    }

    this.stageAdvanceButtonHandler = null;
    this.stageAdvanceButtonId = null;
  }

  setupStageAdvanceControls({ buttonId, onAdvance, focusSelector = '[data-stage-focus="true"]' }) {
    this.clearStageAdvanceControls();
    this.applyKidVisualTheme();

    let advancing = false;
    const advance = async (event) => {
      if (event) {
        event.preventDefault();
        if (typeof event.stopPropagation === 'function') {
          event.stopPropagation();
        }
      }

      if (advancing) return;
      advancing = true;

      try {
        await onAdvance();
      } catch (error) {
        console.error('❌ Error advancing timeline stage:', error);
        advancing = false;
      }
    };

    this.stageAdvanceHandler = (event) => {
      if (event.code === 'Space' || event.key === ' ' || event.key === 'Spacebar') {
        advance(event);
      }
    };

    window.addEventListener('keydown', this.stageAdvanceHandler, true);
    document.addEventListener('keydown', this.stageAdvanceHandler, true);

    if (buttonId) {
      const button = document.getElementById(buttonId);
      if (button) {
        this.stageAdvanceButtonId = buttonId;
        this.stageAdvanceButtonHandler = () => advance();
        button.addEventListener('click', this.stageAdvanceButtonHandler);
      }
    }

    const focusTarget = this.container.querySelector(focusSelector);
    if (focusTarget && typeof focusTarget.focus === 'function') {
      if (!focusTarget.hasAttribute('tabindex')) {
        focusTarget.setAttribute('tabindex', '-1');
      }

      const focus = () => focusTarget.focus({ preventScroll: true });
      if (typeof window.requestAnimationFrame === 'function') {
        window.requestAnimationFrame(focus);
      } else {
        setTimeout(focus, 0);
      }
    }
  }

  applyKidVisualTheme() {
    if (!this.isKidMode() || !this.container) return;

    const root = Array.from(this.container.children || []).find((child) => child.tagName !== 'STYLE');
    if (!root) return;

    root.classList.add('kid-ui-stage');
    root.style.fontFamily = 'Arial, Helvetica, sans-serif';

    if (root.querySelector('[data-kid-ui-theme="true"]')) return;

    root.insertAdjacentHTML('afterbegin', `
      <style data-kid-ui-theme="true">
        .kid-ui-stage {
          background: #f7fbff !important;
          color: #1f2937;
          font-family: Arial, Helvetica, sans-serif;
        }
        .kid-ui-stage [data-stage-focus="true"] {
          background: #ffffff !important;
          border: 2px solid #d8e9ff !important;
          border-radius: 12px !important;
          box-shadow: 0 10px 24px rgba(0, 70, 140, 0.12) !important;
          color: #1f2937 !important;
        }
        .kid-ui-stage h1,
        .kid-ui-stage h2 {
          color: #1f2937 !important;
          font-weight: 800 !important;
          line-height: 1.15 !important;
          letter-spacing: 0 !important;
        }
        .kid-ui-stage h3,
        .kid-ui-stage h4 {
          color: #344054 !important;
          font-weight: 700 !important;
          line-height: 1.2 !important;
          letter-spacing: 0 !important;
        }
        .kid-ui-stage p,
        .kid-ui-stage li,
        .kid-ui-stage label,
        .kid-ui-stage div {
          letter-spacing: 0;
        }
        .kid-ui-stage button {
          background: #007bff !important;
          color: #ffffff !important;
          border: none !important;
          border-radius: 9px !important;
          box-shadow: 0 4px 0 #005fc9 !important;
          font-weight: 700 !important;
          letter-spacing: 0 !important;
        }
        .kid-ui-stage button:disabled {
          background: #9aa8b5 !important;
          box-shadow: 0 4px 0 #7d8894 !important;
          cursor: not-allowed !important;
        }
        .kid-ui-stage input,
        .kid-ui-stage select,
        .kid-ui-stage textarea {
          border: 2px solid #bac7d6 !important;
          border-radius: 8px !important;
          background: #ffffff !important;
          color: #1f2937 !important;
          font-family: Arial, Helvetica, sans-serif !important;
        }
        .kid-ui-stage [role="alert"] {
          color: #dc3545 !important;
        }
      </style>
    `);
  }

  tryEnterFullscreen() {
    try {
      if (!document.fullscreenElement && document.documentElement && document.documentElement.requestFullscreen) {
        const maybePromise = document.documentElement.requestFullscreen();
        if (maybePromise && typeof maybePromise.catch === 'function') {
          maybePromise.catch(() => {});
        }
      }
    } catch (_) {
      // Ignore fullscreen failures in embedded browsers and continue windowed.
    }
  }

  showFullscreenPromptStage() {
    this.container.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:center;min-height:100vh;background:#f7fbff;padding:24px;font-family:Arial, sans-serif;">
        <div data-stage-focus="true" tabindex="-1" style="color:#243044;text-align:center;max-width:760px;width:100%;padding:34px 30px;border:3px solid #007bff;border-radius:14px;background:#fff;box-shadow:0 10px 24px rgba(0, 70, 140, 0.14);">
          <div aria-hidden="true" style="display:flex;justify-content:center;gap:10px;margin-bottom:16px;">
            <span style="width:18px;height:18px;background:#ffcc00;border-radius:4px;transform:rotate(10deg);display:inline-block;"></span>
            <span style="width:18px;height:18px;background:#2cc6a0;border-radius:50%;display:inline-block;"></span>
            <span style="width:18px;height:18px;background:#7c8cff;border-radius:4px;transform:rotate(-10deg);display:inline-block;"></span>
          </div>
          <h1 style="margin:0 0 12px;font-size:46px;line-height:1.05;color:#1f2937;">Welcome to the Game!</h1>
          <p style="margin:0 0 24px;font-size:25px;line-height:1.35;color:#344054;">Get ready to play.</p>
          <div style="display:inline-flex;align-items:center;justify-content:center;gap:12px;flex-wrap:wrap;font-size:26px;font-weight:bold;color:#333;">
            <span>Press</span>
            <span style="font-family:monospace;background:#eef4ff;border:2px solid #9cc8ff;padding:8px 16px;border-radius:8px;box-shadow:0 3px 0 #b7d7ff;">Space Bar</span>
            <span>to begin</span>
          </div>
        </div>
      </div>
    `;

    this.setupStageAdvanceControls({
      onAdvance: async () => {
        if (CONFIG?.game?.fullscreen?.defaultEnabled || CONFIG?.game?.fullscreen?.enabled) {
          this.tryEnterFullscreen();
        }
        this.nextStage();
      }
    });
  }

  showDobStage() {
    const currentYear = new Date().getFullYear();
    const initialParticipantId = getParticipantIdFromUrl() || '';
    const escapedParticipantId = String(initialParticipantId)
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
    this.container.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:center;min-height:100vh;background:#f8f9fa;padding:20px;">
        <div data-stage-focus="true" tabindex="-1" style="background:white;padding:36px;border-radius:10px;box-shadow:0 4px 6px rgba(0,0,0,0.1);max-width:640px;width:100%;text-align:center;">
          <h2 style="color:#333;margin:0 0 12px;font-size:30px;">Before we begin</h2>
          <p style="font-size:18px;color:#333;line-height:1.5;margin:0 0 24px;">Please enter the participant ID and date of birth.</p>

          <form id="dobForm" style="display:flex;flex-direction:column;gap:18px;align-items:stretch;">
            <label style="font-weight:bold;color:#333;text-align:left;">
              Participant ID
              <input id="participantIdInput" required type="text" autocomplete="off" autocapitalize="characters" spellcheck="false" maxlength="32" placeholder="C001" value="${escapedParticipantId}" style="width:100%;box-sizing:border-box;margin-top:6px;padding:12px;border:1px solid #bbb;border-radius:6px;font-size:16px;">
            </label>

            <div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;text-align:left;">
              <label style="font-weight:bold;color:#333;">
                Month
                <select id="dobMonth" required style="width:100%;margin-top:6px;padding:12px;border:1px solid #bbb;border-radius:6px;font-size:16px;background:white;">
                  <option value="">Month</option>
                  ${Array.from({ length: 12 }, (_, i) => `<option value="${i + 1}">${i + 1}</option>`).join('')}
                </select>
              </label>
              <label style="font-weight:bold;color:#333;">
                Day
                <select id="dobDay" required style="width:100%;margin-top:6px;padding:12px;border:1px solid #bbb;border-radius:6px;font-size:16px;background:white;">
                  <option value="">Day</option>
                  ${Array.from({ length: 31 }, (_, i) => `<option value="${i + 1}">${i + 1}</option>`).join('')}
                </select>
              </label>
              <label style="font-weight:bold;color:#333;">
                Year
                <input id="dobYear" required type="text" inputmode="numeric" pattern="[0-9]{4}" maxlength="4" placeholder="YYYY" style="width:100%;box-sizing:border-box;margin-top:6px;padding:12px;border:1px solid #bbb;border-radius:6px;font-size:16px;">
              </label>
            </div>

            <div id="dobError" role="alert" style="min-height:22px;color:#dc3545;font-size:15px;text-align:center;"></div>

            <button id="dobContinueBtn" type="submit" style="align-self:center;background:#007bff;color:white;border:none;padding:13px 28px;font-size:18px;border-radius:6px;cursor:pointer;">
              Continue
            </button>
          </form>
        </div>
      </div>
    `;

    const form = document.getElementById('dobForm');
    const errorEl = document.getElementById('dobError');
    const setError = (message) => {
      if (errorEl) errorEl.textContent = message || '';
    };

    form.addEventListener('submit', (event) => {
      event.preventDefault();
      const participantId = String(document.getElementById('participantIdInput')?.value || '').trim();
      const year = Number(document.getElementById('dobYear')?.value);
      const month = Number(document.getElementById('dobMonth')?.value);
      const day = Number(document.getElementById('dobDay')?.value);
      const dob = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      const ageInfo = calculateAgeFromDob(dob, new Date());

      if (!participantId) {
        setError('Please enter a participant ID.');
        return;
      }
      if (!/^[A-Za-z0-9_-]+$/.test(participantId)) {
        setError('Participant ID can use letters, numbers, hyphen, or underscore.');
        return;
      }
      if (!ageInfo) {
        setError('Please enter a real date of birth that is not in the future.');
        return;
      }

      Object.assign(this.experimentData, ageInfo);
      this.setParticipantId(participantId);
      this.nextStage();
    });

    document.getElementById('participantIdInput')?.focus();
  }

  showConsentStage() {
    this.container.innerHTML = `
      <div style="display: flex; align-items: center; justify-content: center; min-height: 100vh; background: #f8f9fa;">
        <div style="max-width: 800px; margin: 20px; background: white; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); padding: 40px;">
          <h1 style="color: #333; text-align: center; margin-bottom: 30px;">Informed Consent for Research Participation</h1>

          <div style="max-height: 400px; overflow-y: auto; padding: 20px; border: 1px solid #ddd; border-radius: 5px; margin-bottom: 30px; background: #fafafa;">
            <h3>Key Information</h3>
            <p>This consent form asks you to take part in a research study. This study is conducted by researchers at Duke University and UCLA.</p>

            <h4>Purpose</h4>
            <p>The purpose of this study is to investigate how people make decisions.</p>

            <h4>What you will be asked to do</h4>
            <p>You will be playing a series of navigation games on a 2D grid map. Afterward, you will complete some questionnaires regarding your game experience. The study will take approximately 10 minutes to complete.</p>

            <h4>Benefits and Risks</h4>
            <p>There are no foreseen risks or benefits for participating in this study. Should any of the content cause you distress at any point throughout the study, you may stop at any time.</p>

            <h4>Confidentiality</h4>
            <p>We do not ask for your name or any other information that might identify you. Although collected data may be made public or used for future research purposes, your identity will always remain confidential.</p>

            <h4>Voluntary nature of participation</h4>
            <p>Your participation in this research study is voluntary. You may withdraw at any time and you may choose not to answer any question, but you must proceed to the final screen of the study in order to receive your completion code, which you must submit in order to be paid.</p>

            <h4>Compensation</h4>
            <p>You will receive $3 for your participation in this study, and an additional bonus (up to $1) if you finish the task beyond a certain threshold.</p>

            <h4>Contact Information</h4>
            <p>For questions about the study or for research-related complaints, concerns or suggestions about the research, contact Dr. Tamar Kushnir at (919) 660-5640 during regular business hours. For questions about your rights as a participant contact the Duke Campus Institutional Review Board at campusirb@duke.edu. Please reference Protocol ID# 2024-0427 in your email.</p>

            <h4>Agreement</h4>
            <p>By clicking the button below, you acknowledge that your participation in the study is voluntary, you are 18 years of age or older, and that you are aware that you may choose to terminate your participation in the study at any time and for any reason.</p>
          </div>

          <div style="text-align: center;">
            <label style="display: flex; align-items: center; justify-content: center; margin-bottom: 20px; font-size: 16px;">
              <input type="checkbox" id="consentCheckbox" style="margin-right: 10px; transform: scale(1.2);">
              I have read and understood the above information, and I consent to participate in this study.
            </label>

            <button id="continueBtn" disabled style="background: #28a745; color: white; border: none; padding: 12px 30px; font-size: 16px; border-radius: 5px; cursor: not-allowed; margin-right: 10px;">
              Continue to Experiment
            </button>

            <button onclick="window.close()" style="background: #dc3545; color: white; border: none; padding: 12px 30px; font-size: 16px; border-radius: 5px; cursor: pointer;">
              Decline and Exit
            </button>
          </div>
        </div>
      </div>
    `;

    // Add interactivity
    const checkbox = document.getElementById('consentCheckbox');
    const continueBtn = document.getElementById('continueBtn');

    checkbox.addEventListener('change', () => {
      if (checkbox.checked) {
        continueBtn.disabled = false;
        continueBtn.style.cursor = 'pointer';
        continueBtn.style.background = '#28a745';
      } else {
        continueBtn.disabled = true;
        continueBtn.style.cursor = 'not-allowed';
        continueBtn.style.background = '#6c757d';
      }
    });

    continueBtn.addEventListener('click', () => {
      if (!checkbox.checked) return;

      this.experimentData.consentTime = new Date().toISOString();
      console.log('✅ Consent obtained');
      this.nextStage();
    });
  }

  showWelcomeInfoStage() {
    if (this.isKidMode()) {
      this.showKidWelcomeInfoStage();
      return;
    }

    const preferFullscreen = !!(CONFIG?.game?.fullscreen?.defaultEnabled ?? CONFIG?.fullscreen?.defaultEnabled);
    const promptText = preferFullscreen ? 'enter the fullscreen and start the game' : 'start the game';
    this.container.innerHTML = `
      <div style="display: flex; align-items: center; justify-content: center; min-height: 100vh; background: #f8f9fa;">
        <div data-stage-focus="true" tabindex="-1" style="background: white; padding: 40px; border-radius: 10px; box-shadow: 0 4px 6px rgba(0,0,0,0.1); max-width: 800px; text-align: center;">
          <h2 style="color: #333; margin-bottom: 30px; font-size: 36px;">Welcome to the Game!</h2>

          <div style="display: flex; justify-content: center; align-items: center; width: 100%;">
            <div style="text-align: center; line-height: 1.6; margin-bottom: 30px; font-size: 22px; max-width: 600px;">
              <p style="margin-bottom: 10px;">
                You will play a navigation game where hungry travelers need to reach restaurants as quickly as possible.
              </p>
              <p style="margin-bottom: 20px;">
                <span style="color: #007bff; font-weight: bold;">
                  Your goal: Use the arrow keys to guide your traveler to a restaurant.
                </span>
              </p>
              <p style="margin-bottom: 20px;">
                Next, let's see how to play the game!
              </p>
            </div>
          </div>

          <div style="margin-top: 30px;">
            <p style="font-size: 22px; font-weight: bold; color: #333; margin-bottom: 20px;">
              Press the <span style="background-color: #f0f0f0; padding: 2px 6px; border-radius: 4px; font-family: monospace; border: 1px solid #ccc;">spacebar</span> to ${promptText}!
            </p>
            <button id="welcome-continue-btn" style="background: #007bff; color: white; border: none; padding: 14px 28px; font-size: 18px; border-radius: 6px; cursor: pointer;">
              Continue
            </button>
          </div>
        </div>
      </div>
    `;

    this.setupStageAdvanceControls({
      buttonId: 'welcome-continue-btn',
      onAdvance: async () => {
        if (preferFullscreen) {
          this.tryEnterFullscreen();
        }
        console.log('🎮 Starting game sequence');
        this.nextStage();
      }
    });
  }

  showKidWelcomeInfoStage() {
    this.container.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:center;min-height:100vh;background:#f7fbff;padding:20px;font-family:Arial, sans-serif;">
        <div data-stage-focus="true" tabindex="-1" style="background:white;padding:22px 26px;border-radius:12px;box-shadow:0 10px 24px rgba(0,70,140,0.12);max-width:900px;width:100%;text-align:center;border:2px solid #d8e9ff;">
          <h1 style="color:#1f2937;margin:0 0 8px;font-size:34px;line-height:1.1;">Welcome to the Game!</h1>

          <div style="display:flex;justify-content:center;align-items:center;width:100%;">
            <div style="text-align:center;line-height:1.5;margin-bottom:8px;font-size:20px;max-width:720px;color:#222;">
              <p style="margin:0 0 8px;">In this game, hungry travelers need to reach restaurants as quickly as possible.</p>
              <p style="margin:0;color:#006be6;font-weight:bold;">Your goal: Use the arrow keys to guide your traveler to a restaurant.</p>
            </div>
          </div>

          <div style="background:#f8fbff;border:2px solid #007bff;border-radius:12px;padding:18px;margin:12px auto 0;max-width:860px;">
            <h2 style="color:#1f2937;margin:0 0 16px;font-size:18px;">Example Map and Buttons</h2>
            <div style="display:grid;grid-template-columns:minmax(290px,0.85fr) minmax(430px,1.15fr);gap:22px;align-items:center;">
              <div style="display:flex;justify-content:center;align-items:center;gap:18px;flex-wrap:wrap;">
                <div aria-label="Example game map" style="display:grid;grid-template-columns:repeat(5,36px);grid-template-rows:repeat(5,36px);gap:3px;border:2px solid #2f3a4a;padding:7px;background:white;border-radius:9px;box-shadow:0 4px 10px rgba(0,0,0,0.06);">
                  ${Array.from({ length: 25 }, (_, i) => {
                    const goal = i === 3;
                    const player = i === 11;
                    const bg = goal ? '#007bff' : (player ? 'red' : '#f8f9fa');
                    const radius = goal ? '4px' : (player ? '50%' : '0');
                    const shadow = player ? 'box-shadow:0 2px 5px rgba(255,0,0,0.25);' : '';
                    return `<div style="background:${bg};border:1px solid #d7dde6;border-radius:${radius};${shadow}"></div>`;
                  }).join('')}
                </div>
                <div style="display:flex;flex-direction:column;gap:10px;font-size:16px;color:#333;text-align:left;">
                  <div style="display:flex;align-items:center;gap:8px;"><div style="width:18px;height:18px;background:red;border-radius:50%;"></div><span>Traveler</span></div>
                  <div style="display:flex;align-items:center;gap:8px;"><div style="width:18px;height:18px;background:#007bff;border-radius:4px;"></div><span>Restaurant</span></div>
                </div>
              </div>

              <div style="display:flex;justify-content:center;align-items:center;">
                <div style="display:grid;grid-template-columns:230px 176px;grid-template-rows:54px 54px 22px;column-gap:18px;row-gap:7px;align-items:start;justify-content:center;">
                  <div aria-label="Space bar" style="grid-column:1;grid-row:2;width:230px;height:54px;border:2px solid #bac7d6;border-radius:9px;display:flex;align-items:center;justify-content:center;background:#fff;box-shadow:0 4px 0 #d7dde6;font-size:18px;font-weight:bold;letter-spacing:1px;color:#222;">SPACE BAR</div>
                  <div style="grid-column:1;grid-row:3;color:#475467;font-size:15px;text-align:center;">start or continue</div>
                  <div aria-label="Arrow keys" style="grid-column:2;grid-row:1 / span 2;display:grid;grid-template-columns:repeat(3,54px);grid-template-rows:repeat(2,54px);gap:7px;">
                    <div></div>
                    <div style="width:54px;height:54px;border:2px solid #bac7d6;border-radius:9px;display:flex;align-items:center;justify-content:center;background:#fff;box-shadow:0 4px 0 #d7dde6;font-size:30px;font-weight:bold;color:#1f2937;">↑</div>
                    <div></div>
                    <div style="width:54px;height:54px;border:2px solid #bac7d6;border-radius:9px;display:flex;align-items:center;justify-content:center;background:#fff;box-shadow:0 4px 0 #d7dde6;font-size:30px;font-weight:bold;color:#1f2937;">←</div>
                    <div style="width:54px;height:54px;border:2px solid #bac7d6;border-radius:9px;display:flex;align-items:center;justify-content:center;background:#fff;box-shadow:0 4px 0 #d7dde6;font-size:30px;font-weight:bold;color:#1f2937;">↓</div>
                    <div style="width:54px;height:54px;border:2px solid #bac7d6;border-radius:9px;display:flex;align-items:center;justify-content:center;background:#fff;box-shadow:0 4px 0 #d7dde6;font-size:30px;font-weight:bold;color:#1f2937;">→</div>
                  </div>
                  <div style="grid-column:2;grid-row:3;color:#475467;font-size:15px;text-align:center;">move your traveler</div>
                </div>
              </div>
            </div>

          <div style="margin-top:16px;">
            <p style="font-size:22px;font-weight:bold;color:#243044;margin:0;">
              Press the <span style="background:#eef4ff;border:2px solid #9cc8ff;padding:4px 10px;border-radius:7px;font-family:monospace;">spacebar</span> to begin!
            </p>
          </div>
        </div>
      </div>
    `;

    // Guide image and TTS controls are intentionally hidden in this version.
    // this.setupKidWelcomeSpeech();
    this.setupStageAdvanceControls({
      onAdvance: async () => {
        try {
          window.speechSynthesis?.cancel?.();
        } catch (_) {
          // Ignore speech cleanup failures.
        }
        this.nextStage();
      }
    });
  }

  setupKidWelcomeSpeech() {
    try {
      if (!('speechSynthesis' in window) || !('SpeechSynthesisUtterance' in window)) return;

      const btnSpeak = document.getElementById('btnSpeak');
      const btnStop = document.getElementById('btnStop');
      const statusEl = document.getElementById('speakStatus');
      const text = [
        'Hello! Welcome to the game.',
        'You will play a navigation game.',
        'Hungry travelers need to reach restaurants as quickly as possible.',
        'Your goal is to use the arrow keys to guide your traveler to a restaurant.',
        'When you are ready, press the space bar to begin.'
      ].join(' ');

      const synth = window.speechSynthesis;
      const speak = () => {
        synth.cancel();
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.lang = 'en-US';
        utterance.rate = 0.8;
        utterance.pitch = 1.15;
        utterance.volume = 1.0;
        utterance.onstart = () => { if (statusEl) statusEl.textContent = 'Speaking...'; };
        utterance.onend = () => { if (statusEl) statusEl.textContent = ''; };
        synth.speak(utterance);
      };
      const stop = () => {
        synth.cancel();
        if (statusEl) statusEl.textContent = '';
      };

      btnSpeak?.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        speak();
      });
      btnStop?.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        stop();
      });
    } catch (_) {
      // Speech support is optional.
    }
  }

  startKidBackgroundMatchmaking(advance = true) {
    if (!this.isKidMode() || !this.shouldUseHumanMatching()) {
      if (advance) this.nextStage();
      return;
    }

    if (!this.kidBackgroundMatchmakingStarted) {
      this.kidBackgroundMatchmakingStarted = true;
      const { eventId, stationId } = this.getKidSessionMetadata();
      const participantId = this.getParticipantId();
      const childId = this.experimentData.childId || participantId;
      this.experimentData.eventId = eventId;
      this.experimentData.stationId = stationId;
      this.experimentData.queueStartTime = new Date().toISOString();

      this.emit('waiting-for-partner', {
        experimentType: this.getMainKidExperimentType(),
        eventId,
        stationId,
        participantId,
        childId,
        background: true
      });
    }

    if (advance) this.nextStage();
  }

  recordKidMatchFallback(reason, fallbackAIType) {
    const now = Date.now();
    const fallbackLabel = fallbackAIType === 'alwaysSignalAgent'
      ? (CONFIG?.kids?.committedAgentLabel || 'sampleJointGoalAndRSASignal_fromStart')
      : fallbackAIType;
    this.stopKidWaitMinigame();
    this.experimentData.kidMatchOutcome = 'committed_fallback';
    this.experimentData.fallbackReason = reason;
    this.experimentData.partnerFallbackAIType = fallbackLabel || null;
    if (!this.experimentData.neutralWaitEndTime) {
      this.experimentData.neutralWaitEndTime = new Date(now).toISOString();
    }
    if (this._neutralWaitStartedAtMs && this.experimentData.neutralWaitMs == null) {
      this.experimentData.neutralWaitMs = now - this._neutralWaitStartedAtMs;
    }
  }

  recordKidMatchSuccess() {
    const now = Date.now();
    this.stopKidWaitMinigame();
    this.experimentData.kidMatchOutcome = 'human';
    this.experimentData.fallbackReason = null;
    this.experimentData.partnerFallbackAIType = null;
    this.experimentData.matchReadyTime = new Date(now).toISOString();
    if (!this.experimentData.neutralWaitEndTime) {
      this.experimentData.neutralWaitEndTime = new Date(now).toISOString();
    }
    if (this._neutralWaitStartedAtMs && this.experimentData.neutralWaitMs == null) {
      this.experimentData.neutralWaitMs = now - this._neutralWaitStartedAtMs;
    }
  }

  resetKidWaitMinigameData() {
    this.experimentData.waitMinigameEnabled = false;
    this.experimentData.waitMinigameStartTime = null;
    this.experimentData.waitMinigameEndTime = null;
    this.experimentData.waitMinigameDurationMs = null;
    this.experimentData.waitMinigameJumpCount = 0;
    this.experimentData.waitMinigameCollisionCount = 0;
  }

  startKidWaitMinigame(canvasId) {
    this.stopKidWaitMinigame();
    this.resetKidWaitMinigameData();

    const canvas = document.getElementById(canvasId);
    if (!canvas || typeof canvas.getContext !== 'function') {
      return;
    }

    try {
      this.kidWaitMinigame = new KidWaitMinigame(canvas, {
        onStats: (stats) => this.updateKidWaitMinigameData(stats)
      });
      const stats = this.kidWaitMinigame.start();
      this.updateKidWaitMinigameData(stats);
    } catch (error) {
      console.warn('Unable to start kid wait mini-game:', error);
      this.kidWaitMinigame = null;
      this.resetKidWaitMinigameData();
    }
  }

  stopKidWaitMinigame() {
    if (!this.kidWaitMinigame) return null;

    const minigame = this.kidWaitMinigame;
    this.kidWaitMinigame = null;
    const stats = minigame.stop();
    this.updateKidWaitMinigameData(stats);
    return stats;
  }

  updateKidWaitMinigameData(stats = {}) {
    if (!stats || stats.enabled !== true) return;

    this.experimentData.waitMinigameEnabled = true;
    if (stats.startTime && !this.experimentData.waitMinigameStartTime) {
      this.experimentData.waitMinigameStartTime = new Date(stats.startTime).toISOString();
    }
    if (stats.endTime) {
      this.experimentData.waitMinigameEndTime = new Date(stats.endTime).toISOString();
    }
    if (typeof stats.durationMs === 'number') {
      this.experimentData.waitMinigameDurationMs = stats.durationMs;
    }
    if (typeof stats.jumpCount === 'number') {
      this.experimentData.waitMinigameJumpCount = stats.jumpCount;
    }
    if (typeof stats.collisionCount === 'number') {
      this.experimentData.waitMinigameCollisionCount = stats.collisionCount;
    }
  }

  showKidTeammateFoundReminder(onComplete) {
    const playerDisplay = getPlayerDisplayInfo(this.playerIndex, this.gameMode);

    this.container.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:center;min-height:100vh;background:#f8f9fa;">
        <div data-stage-focus="true" tabindex="-1" style="background:white;padding:36px;border-radius:10px;box-shadow:0 4px 8px rgba(0,0,0,0.12);max-width:680px;width:calc(100% - 32px);text-align:center;">
          <h1 style="font-size:34px;color:#222;margin:0 0 14px;">We found your teammate!</h1>
          <p style="font-size:24px;line-height:1.45;color:#333;margin:0 auto 12px;max-width:560px;">
            Let's start the team game.
          </p>
          <p style="font-size:22px;line-height:1.45;color:#333;margin:0 auto 24px;max-width:560px;">
            Remember, you are the <strong style="color:${playerDisplay.selfColorValue};">${playerDisplay.displaySelfColor}</strong> dot.
            Your teammate is the <strong style="color:${playerDisplay.partnerColorValue};">${playerDisplay.displayPartnerColor}</strong> dot.
          </p>
          <div style="display:flex;justify-content:center;align-items:center;gap:42px;margin:18px auto 26px;">
            <div style="display:flex;flex-direction:column;align-items:center;gap:10px;">
              <div style="width:92px;height:92px;border-radius:50%;background:${playerDisplay.selfColorValue};box-shadow:0 6px 14px rgba(0,0,0,0.2);border:4px solid #222;"></div>
              <div style="font-size:20px;font-weight:bold;color:#222;">You</div>
            </div>
            <div style="font-size:34px;color:#777;">+</div>
            <div style="display:flex;flex-direction:column;align-items:center;gap:10px;">
              <div style="width:72px;height:72px;border-radius:50%;background:${playerDisplay.partnerColorValue};box-shadow:0 5px 12px rgba(0,0,0,0.16);border:3px solid #ddd;"></div>
              <div style="font-size:18px;color:#555;">Teammate</div>
            </div>
          </div>
          <p style="font-size:20px;color:#555;margin:0;">Press the space bar to start.</p>
        </div>
      </div>
    `;

    this.setupStageAdvanceControls({
      onAdvance: async () => {
        if (typeof onComplete === 'function') {
          await onComplete();
        }
      }
    });
  }

  showInstructionsStage(experimentType, experimentIndex) {
    const instructions = this.getInstructionsForExperiment(experimentType);

    this.container.innerHTML = instructions.html;
    const instructionCard = this.container.firstElementChild?.firstElementChild;
    if (instructionCard) {
      instructionCard.setAttribute('data-stage-focus', 'true');
      instructionCard.setAttribute('tabindex', '-1');
      if (!this.isKidMode()) {
        instructionCard.insertAdjacentHTML(
          'beforeend',
          `
            <div style="margin-top: 24px;">
              <button id="instruction-continue-btn" style="background: #007bff; color: white; border: none; padding: 14px 28px; font-size: 18px; border-radius: 6px; cursor: pointer;">
                Continue
              </button>
            </div>
          `
        );
      }
    }

    this.setupStageAdvanceControls({
      buttonId: this.isKidMode() ? null : 'instruction-continue-btn',
      onAdvance: async () => {
        console.log(`📋 Instructions completed for ${experimentType}`);
        this.nextStage();
      }
    });
  }

  showKidTeammateWaitingStage(experimentType, experimentIndex) {
    if (!this.shouldUseHumanMatching()) {
      this.gameMode = 'human-ai';
      this.nextStage();
      return;
    }

    if (!this.kidBackgroundMatchmakingStarted) {
      this.startKidBackgroundMatchmaking(false);
    }

    const { eventId, stationId } = this.getKidSessionMetadata();
    const configuredWait = Number(CONFIG?.kids?.teammateWaitMaxDuration) || (2 * 60 * 1000);
    const maxWaitMs = Math.max(1000, Math.min(configuredWait, 2 * 60 * 1000));
    const waitingStartTime = Date.now();
    let finished = false;
    let countdownTimer = null;
    let timeoutId = null;
    let hiddenSkipHandler = null;

    this.kidTeammateWaitActive = true;
    this._neutralWaitStartedAtMs = waitingStartTime;
    this.experimentData.eventId = eventId;
    this.experimentData.stationId = stationId;
    this.experimentData.neutralWaitStartTime = new Date(waitingStartTime).toISOString();
    this.experimentData.neutralWaitEndTime = null;
    this.experimentData.neutralWaitMs = null;
    this.experimentData.kidMatchOutcome = 'pending';

    const assetBase = CONFIG?.kids?.assetBasePath || '/kids/figs';
    const guideSrc = `${assetBase}/guide-kid.gif`;
    const smileSrc = `${assetBase}/smile-face.svg`;

    this.container.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:center;min-height:100vh;background:#f8f9fa;">
        <div style="background:white;padding:32px;border-radius:10px;box-shadow:0 4px 8px rgba(0,0,0,0.12);max-width:720px;width:calc(100% - 32px);text-align:center;">
          <!--
          <img src="${guideSrc}" alt="Friendly guide" style="width:120px;height:120px;object-fit:contain;margin-bottom:10px;" onerror="this.onerror=null;this.src='${smileSrc}'">
          -->
          <h1 style="font-size:34px;color:#222;margin:8px 0 12px;">Finding your teammate...</h1>
          <p style="font-size:22px;line-height:1.5;color:#333;margin:0 auto 18px;max-width:560px;">
            We are looking for your teammate. You can press SPACE while the next game gets ready.
          </p>

          <div class="kid-wait-minigame" aria-label="Waiting mini-game">
            <canvas id="kidWaitMinigameCanvas" class="kid-wait-minigame-canvas" width="640" height="240"></canvas>
            <p class="kid-wait-minigame-hint">Press SPACE to hop while we look.</p>
          </div>

          <div style="height:12px;background:#e9ecef;border-radius:999px;overflow:hidden;margin:0 auto 12px;max-width:520px;">
            <div id="kidWaitProgress" style="width:0%;height:100%;background:#007bff;border-radius:999px;transition:width .4s linear;"></div>
          </div>
          <p id="kidWaitStatus" style="font-size:18px;color:#555;margin:0;">Still looking for your teammate...</p>
        </div>
      </div>

      <style>
        .kid-wait-minigame {
          margin:18px auto 22px;
          max-width:600px;
          border:2px solid #b9d7ff;
          border-radius:12px;
          background:#eef7ff;
          overflow:hidden;
          box-shadow:inset 0 0 0 1px rgba(255,255,255,.7);
        }
        .kid-wait-minigame-canvas {
          display:block;
          width:100%;
          height:240px;
        }
        .kid-wait-minigame-hint {
          margin:0;
          padding:10px 12px 12px;
          font-size:18px;
          color:#28536b;
          background:#ffffff;
          border-top:1px solid #d8e9ff;
        }
      </style>
    `;

    this.startKidWaitMinigame('kidWaitMinigameCanvas');

    const cleanup = () => {
      this.kidTeammateWaitActive = false;
      this.stopKidWaitMinigame();
      if (countdownTimer) clearInterval(countdownTimer);
      if (timeoutId) clearTimeout(timeoutId);
      if (hiddenSkipHandler) document.removeEventListener('keydown', hiddenSkipHandler);
      this.off('all-players-ready', allReadyHandler);
    };

    const finishWithFallback = (reason) => {
      if (finished) return;
      finished = true;
      cleanup();

      const waitingEndTime = Date.now();
      const waitingDuration = waitingEndTime - waitingStartTime;
      const fallbackType = (CONFIG?.multiplayer?.fallbackAIType)
        || GameConfigUtils.resolveKidCommittedAgentType?.()
        || 'committedAgent';
      const aiPlayerNumber = (this.playerIndex === 0) ? 2 : 1;

      this.recordWaitingTime(waitingStartTime, waitingEndTime, waitingDuration, reason, experimentType, experimentIndex);
      this.recordKidMatchFallback(reason, fallbackType);
      GameConfigUtils.setPlayerType(aiPlayerNumber, fallbackType);
      this.gameMode = 'human-ai';

      try { this.emit('kid-matchmaking-cancelled', { reason }); } catch (_) { /* noop */ }
      try { this.emit('fallback-to-ai', { reason, stage: 'kid-teammate-wait', at: Date.now(), fallbackAIType: fallbackType }); } catch (_) { /* noop */ }
      this.emit('ai-fallback-activated', { fallbackType, aiPlayerNumber });
      this.showKidTeammateFoundReminder(() => this.nextStage());
    };

    const allReadyHandler = (config) => {
      if (finished) return;
      finished = true;
      cleanup();

      const waitingEndTime = Date.now();
      const waitingDuration = waitingEndTime - waitingStartTime;
      this.gameMode = 'human-human';
      this.recordWaitingTime(waitingStartTime, waitingEndTime, waitingDuration, 'teammate_found', experimentType, experimentIndex);
      this.recordKidMatchSuccess();
      if (config?.gameMode) this.gameMode = config.gameMode;
      this.showKidTeammateFoundReminder(() => this.nextStage());
    };

    this.on('all-players-ready', allReadyHandler);
    this.emit('kid-teammate-barrier-ready', {
      experimentType,
      experimentIndex,
      eventId,
      stationId,
      participantId: this.getParticipantId(),
      childId: this.experimentData.childId || this.getParticipantId()
    });

    hiddenSkipHandler = (event) => {
      if (event.code !== 'Enter' && event.key !== 'Enter') return;
      event.preventDefault();
      event.stopPropagation();
      finishWithFallback('teammate-wait-enter-skip');
    };
    document.addEventListener('keydown', hiddenSkipHandler);

    const progress = document.getElementById('kidWaitProgress');
    const status = document.getElementById('kidWaitStatus');
    countdownTimer = setInterval(() => {
      const elapsed = Date.now() - waitingStartTime;
      const pct = Math.min(100, Math.round((elapsed / maxWaitMs) * 100));
      if (progress) progress.style.width = `${pct}%`;
      const remainingSeconds = Math.max(0, Math.ceil((maxWaitMs - elapsed) / 1000));
      if (status) {
        status.textContent = remainingSeconds > 0
          ? `Still looking for your teammate...`
          : 'The next game is almost ready...';
      }
    }, 500);

    timeoutId = setTimeout(() => {
      finishWithFallback('teammate-wait-timeout');
    }, maxWaitMs);
  }

  checkPartnerPresenceAndProceed(experimentType, experimentIndex) {
    console.log(`🔍 Checking partner presence for ${experimentType} transition...`);

    // Check if we're in human-human mode and if partner is still connected
    const isP2Human = (CONFIG?.game?.players?.player2?.type === 'human');

    if (isP2Human) {
      // Check if we have network connection and partner
      this.emit('check-partner-status', { experimentType, experimentIndex });

      // Set up a flag to track if we should proceed or skip
      this.partnerStatusChecked = false;
      this.shouldSkipMatchPlay = false;

      // Give a longer timeout to check partner status
      setTimeout(() => {
        if (!this.partnerStatusChecked) {
          console.log('⏰ Partner status check timeout - assuming partner disconnected');
          this.shouldSkipMatchPlay = true;
          this.partnerStatusChecked = true;
        }

        // If we're still in human-human mode after the check, proceed to match-play
        const stillHuman = (CONFIG?.game?.players?.player2?.type === 'human');
        if (stillHuman && !this.shouldSkipMatchPlay) {
          console.log('✅ Partner still connected, proceeding to match-play stage');
          this.nextStage();
        } else {
          console.log('🤖 Partner disconnected, switching to AI mode');
          this.gameMode = 'human-ai';
          // Skip the match-play stage since we're now in AI mode
          this.nextStage(); // This will skip the match-play stage
        }
      }, 3000); // 3 second timeout to allow partner status check
    } else {
      // Already in AI mode, skip match-play stage
      console.log('🤖 Already in AI mode, skipping match-play stage');
      this.gameMode = 'human-ai';
      this.nextStage(); // This will skip the match-play stage
    }
  }

  showWaitingForPartnerStage(experimentType, experimentIndex) {
    // Configurable min/max wait windows (fallback to legacy single value)
    const minWaitMs = (CONFIG?.game?.timing?.waitingForPartnerMinDuration)
      || (CONFIG?.game?.timing?.waitingForPartnerDuration) || 5000;
    const maxWaitMs = (CONFIG?.game?.timing?.waitingForPartnerMaxDuration) || 15000;
    const readyAt = Date.now() + minWaitMs;
    let partnerFound = false;

    // Record waiting start time
    const waitingStartTime = Date.now();
    console.log('⏱️ [WAITING] Partner search started at:', new Date(waitingStartTime).toISOString());
    this.container.innerHTML = `
      <div style="display: flex; align-items: center; justify-content: center; min-height: 100vh; background: #f8f9fa;">
        <div id="waiting-room" style="background: white; padding: 40px; border-radius: 10px; box-shadow: 0 4px 6px rgba(0,0,0,0.1); max-width: 600px; text-align: center;">
          <h2 style="color: #333; margin-bottom: 30px;">Finding another player ...</h2>

          <div style="margin-bottom: 30px;">
            <div style="display: inline-block; width: 40px; height: 40px; border: 4px solid #f3f3f3; border-top: 4px solid #007bff; border-radius: 50%; animation: spin 1s linear infinite;"></div>
          </div>

          <p style="font-size: 18px; color: #666; margin-bottom: 20px;">Connecting you with another player...</p>

          <p style="font-size: 14px; color: #999; margin-bottom: 15px;">
            This may take a few moments.
          </p>

          <div style="background: #e8f4fd; border: 1px solid #bee5eb; border-radius: 8px; padding: 15px; margin-top: 20px;">
            <p style="font-size: 14px; color: #0c5460; margin: 0; font-weight: 500;">
              💰 Your waiting time (if it exceeds 5 minutes) will be compensated ($0.5 per minute).<br/>
              Thank you for your patience!
            </p>
          </div>


        </div>
      </div>

      <style>
        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
      </style>
    `;

    // If player2 is NOT human, only wait for the minimum duration, then proceed
    const isP2Human = (CONFIG?.game?.players?.player2?.type === 'human');
    if (!isP2Human) {
      this.gameMode = 'human-ai';
      setTimeout(() => {
        // Ensure we still reflect a non-human partner; keep current type (ai or gpt)
        this.nextStage();
      }, Math.max(0, readyAt - Date.now()));
      return;
    }

    // HUMAN-HUMAN FLOW BELOW
    // Add spacebar skip option for testing (only allowed after minimum wait window)
    const handleSkipWaiting = (event) => {
      if (event.code === 'Space' || event.key === ' ') {
        event.preventDefault();
        if (Date.now() < readyAt) return; // enforce minimum wait

        // Record waiting end time and duration for skip
        const waitingEndTime = Date.now();
        const waitingDuration = waitingEndTime - waitingStartTime;
        console.log('⏱️ [WAITING] Skipped after waiting duration:', waitingDuration + 'ms (' + (waitingDuration / 1000).toFixed(1) + 's)');

        // Store waiting time data for export
        this.recordWaitingTime(waitingStartTime, waitingEndTime, waitingDuration, 'skip', experimentType, experimentIndex);

        document.removeEventListener('keydown', handleSkipWaiting);
        console.log('⏭️ Skipping multiplayer waiting after min wait - continuing with AI partner');
        const fallbackType = (CONFIG?.multiplayer?.fallbackAIType) || 'rl_joint';
        const aiPlayerNumber = (this.playerIndex === 0) ? 2 : 1;
        GameConfigUtils.setPlayerType(aiPlayerNumber, fallbackType);
        try { this.emit('fallback-to-ai', { reason: 'waiting-skip', stage: 'waiting-for-partner', at: Date.now(), fallbackAIType: fallbackType }); } catch (_) { /* noop */ }
        this.emit('ai-fallback-activated', { fallbackType, aiPlayerNumber });
        this.skipNextMatchPlayStageIfPresent();
        this.nextStage();
      }
    };
    document.addEventListener('keydown', handleSkipWaiting);

    // Attempt real partner connection for human-human
    this.emit('waiting-for-partner', { experimentType, experimentIndex });

    // Optional cancel button behavior
    const cancelBtn = document.getElementById('cancel-wait-btn');
    if (cancelBtn) {
      cancelBtn.onclick = () => {
        console.log('⚠️ Waiting canceled by user');
        window.close();
      };
    }

    // When partner connects, advance to the match stage after minimum wait
    const partnerConnectedHandler = (payload) => {
      console.log('👥 Partner connected - will advance after minimum waiting time', payload);
      this.gameMode = 'human-human';
      partnerFound = true;

      // Record waiting end time and duration
      const waitingEndTime = Date.now();
      const waitingDuration = waitingEndTime - waitingStartTime;
      console.log('⏱️ [WAITING] Partner found! Waiting duration:', waitingDuration + 'ms (' + (waitingDuration / 1000).toFixed(1) + 's)');

      // Store waiting time data for export
      this.recordWaitingTime(waitingStartTime, waitingEndTime, waitingDuration, 'partner_found', experimentType, experimentIndex);

      document.removeEventListener('keydown', handleSkipWaiting);
      this.off('partner-connected', partnerConnectedHandler);
      let targetAt = readyAt;
      if (payload && payload.connectedAt) {
        const serverTarget = payload.connectedAt + minWaitMs;
        targetAt = Math.max(targetAt, serverTarget);
      }
      const delay = Math.max(0, targetAt - Date.now());
      setTimeout(() => this.nextStage(), delay);
    };

    // Ensure single handler for this stage
    this.eventHandlers.delete('partner-connected');
    this.on('partner-connected', partnerConnectedHandler);

    // Fallback after maximum wait if no partner connected
    setTimeout(() => {
      if (!partnerFound) {
        // Record waiting end time and duration for timeout
        const waitingEndTime = Date.now();
        const waitingDuration = waitingEndTime - waitingStartTime;
        console.log('⏱️ [WAITING] Timeout after waiting duration:', waitingDuration + 'ms (' + (waitingDuration / 1000).toFixed(1) + 's)');

        // Store waiting time data for export
        this.recordWaitingTime(waitingStartTime, waitingEndTime, waitingDuration, 'timeout', experimentType, experimentIndex);

        console.log(`⌛ No partner found after ${maxWaitMs}ms - falling back to AI mode`);
        const fallbackType = (CONFIG?.multiplayer?.fallbackAIType) || 'rl_joint';
        const aiPlayerNumber = (this.playerIndex === 0) ? 2 : 1;
        GameConfigUtils.setPlayerType(aiPlayerNumber, fallbackType);
        this.gameMode = 'human-ai';
        document.removeEventListener('keydown', handleSkipWaiting);
        // Notify app to record this fallback event
        try { this.emit('fallback-to-ai', { reason: 'waiting-timeout', stage: 'waiting-for-partner', at: Date.now(), fallbackAIType: fallbackType }); } catch (_) { /* noop */ }
        // Notify ExperimentManager to activate AI fallback
        try { if (!CONFIG?.debug?.disableConsoleLogs) console.log(`[DEBUG] Timeline emitting ai-fallback-activated event (waiting timeout)`); } catch (_) {}
        this.emit('ai-fallback-activated', { fallbackType, aiPlayerNumber });
        this.skipNextMatchPlayStageIfPresent();
        this.nextStage();
      }
    }, maxWaitMs);
  }

  showReadyToPlayStage(experimentType, experimentIndex) {
    const humanHuman = this.isHumanHumanMode() && CONFIG.game.players.player2.type === 'human';

    if (humanHuman) {
      // Human-human: Ready button flow
      this.container.innerHTML = `
        <div style="display: flex; align-items: center; justify-content: center; min-height: 100vh; background: #f8f9fa;">
          <div style="background: white; padding: 40px; border-radius: 10px; box-shadow: 0 4px 6px rgba(0,0,0,0.1); max-width: 600px; text-align: center;">
            <h2 style="color: #333; margin-bottom: 20px;">Partner Found</h2>
            <p style="font-size: 16px; color: #333; margin-bottom: 15px;">Click ready when you're prepared to start.</p>
            <button id="ready-btn" style="background: #28a745; color: white; border: none; padding: 12px 30px; border-radius: 5px; font-size: 16px; cursor: pointer;">
              Ready to Play
            </button>
            <p style="margin-top: 15px; font-size: 12px; color: #666;">Waiting for both players to be ready...</p>
          </div>
        </div>
        <style>
          #ready-btn:hover { background: #218838 !important; }
        </style>
      `;

      const readyBtn = document.getElementById('ready-btn');
      if (readyBtn) {
        readyBtn.onclick = () => {
          readyBtn.disabled = true;
          readyBtn.textContent = 'Waiting for partner...';
          readyBtn.style.background = '#6c757d';
          this.emit('player-ready');
        };
      }

      const allPlayersReadyHandler = () => {
        console.log('🎮 All players ready - proceed to match play gate');
        this.off('all-players-ready', allPlayersReadyHandler);
        this.nextStage();
      };

      // Ensure single handler for this stage
      this.eventHandlers.delete('all-players-ready');
      this.on('all-players-ready', allPlayersReadyHandler);
    } else {
      // Human-AI: Immediately proceed to the match play gate screen
      this.nextStage();
    }
  }

  showMatchPlayStage(experimentType, experimentIndex) {
    // Unified match play gate (Game is Ready!); requires BOTH players to press SPACE to proceed
    const currentStage = this.stages[this.currentStageIndex] || {};
    const showPartnerMsg = currentStage.showPartnerFoundMessage !== false; // default true unless explicitly false
    const playerDisplay = getPlayerDisplayInfo(this.playerIndex, this.gameMode);
    const partnerMsgHtml = showPartnerMsg
      ? `<p><strong>${this.isHumanHumanMode() ? 'Another player found!' : 'Another player found and connection established!'}</strong></p>`
      : '';

    this.container.innerHTML = `
      <div style="display: flex; align-items: center; justify-content: center; min-height: 100vh; background: #f8f9fa;">
        <div data-stage-focus="true" tabindex="-1" style="max-width: 600px; margin: 20px; background: white; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); padding: 40px; text-align: center;">
          <h1 style="color: #28a745; margin-bottom: 30px;">✅ Game is Ready!</h1>
          <div style="font-size: 20px; color: #333; margin-bottom: 20px;">
            ${partnerMsgHtml}
            <p style="margin-top: 10px; font-size: 20px;">
              ${playerDisplay.instructionText}
              <span style="display:inline-block; width: 14px; height: 14px; background-color: ${playerDisplay.selfColorValue}; border-radius: 50%; vertical-align: middle; margin-left: 6px;"></span>
            </p>
            <p>Press SPACE to start the game!</p>
            <p style="font-size: 14px;">${this.isHumanHumanMode() ? 'Both players must press SPACE to begin.' : ''}</p>
            <button id="match-play-start-btn" style="background: #28a745; color: white; border: none; padding: 14px 28px; font-size: 18px; border-radius: 6px; cursor: pointer; margin-top: 12px;">
              Start
            </button>
            <div id="match-status" style="font-size: 14px; color: #666; display: none; margin-top: 12px;">Waiting for the other player to press space...</div>
          </div>
        </div>
      </div>
    `;

    this.setupStageAdvanceControls({
      buttonId: 'match-play-start-btn',
      onAdvance: async () => {
        // Signal match-play readiness
        this.emit('match-play-ready');

        // In human-human mode, wait for server game-started (mapped to all-players-ready)
        // In human-AI mode, proceed immediately
        if (this.isHumanHumanMode() && CONFIG.game.players.player2.type === 'human') {
          const status = document.getElementById('match-status');
          if (status) status.style.display = 'block';

          // Start a timeout to fall back to AI if the other player
          // does not press SPACE within the configured threshold
          const readyTimeoutMs = (CONFIG?.multiplayer?.matchPlayReadyTimeout ?? 10000);
          let timeoutId = null;
          const fallbackToAI = () => {
            try {
              console.log(`⌛ Match-play wait exceeded (${readyTimeoutMs}ms) - falling back to AI mode`);
              const fallbackType = (CONFIG?.multiplayer?.fallbackAIType) || 'rl_joint';
              const aiPlayerNumber = (this.playerIndex === 0) ? 2 : 1;
            try { if (!CONFIG?.debug?.disableConsoleLogs) console.log(`[DEBUG] Timeline fallback - fallbackType: ${fallbackType}`); } catch (_) {}
              GameConfigUtils.setPlayerType(aiPlayerNumber, fallbackType);
            try { if (!CONFIG?.debug?.disableConsoleLogs) console.log(`[DEBUG] Timeline fallback - After setPlayerType, Player2: ${CONFIG.game.players.player2.type}`); } catch (_) {}
              this.gameMode = 'human-ai';
              // Clean up listener to avoid double-proceed if server emits later
              this.off('all-players-ready', allReadyHandler);

              // Notify ExperimentManager to activate AI fallback
            try { if (!CONFIG?.debug?.disableConsoleLogs) console.log(`[DEBUG] Timeline emitting ai-fallback-activated event`); } catch (_) {}
              this.emit('ai-fallback-activated', { fallbackType, aiPlayerNumber });
            } catch (_) { /* noop */ }
            this.nextStage();
          };

          const allReadyHandler = () => {
            this.off('all-players-ready', allReadyHandler);
            if (timeoutId) {
              clearTimeout(timeoutId);
              timeoutId = null;
            }
            this.nextStage();
          };
          // Ensure single listener
          this.eventHandlers.delete('all-players-ready');
          this.on('all-players-ready', allReadyHandler);

          // Arm the timeout after we start listening for readiness
          timeoutId = setTimeout(() => {
            const fallbackType = (CONFIG?.multiplayer?.fallbackAIType) || 'rl_joint';
            try { this.emit('fallback-to-ai', { reason: 'match-play-timeout', stage: 'match-play', at: Date.now(), fallbackAIType: fallbackType }); } catch (_) { /* noop */ }
            fallbackToAI();
          }, readyTimeoutMs);
        } else {
          this.nextStage();
        }
      }
    });
  }

  showFixationStage(experimentType, experimentIndex, trialIndex) {
    this.container.innerHTML = `
      <div style="display: flex; align-items: center; justify-content: center; min-height: 100vh; background: #f8f9fa;">
        <div style="text-align: center;">
          <div id="fixation-canvas-container"></div>
          <div style="margin-top: 20px; font-size: 14px; color: #666;">
          </div>
        </div>
      </div>
    `;

    // Emit event to show fixation display
    this.emit('show-fixation', { experimentType, experimentIndex, trialIndex });

    // Add spacebar skip option for testing
    const handleSkip = (event) => {
      if (event.code === 'Space' || event.key === ' ') {
        event.preventDefault();
        document.removeEventListener('keydown', handleSkip);
        console.log('⏭️ Fixation skipped by user');
        this.nextStage();
      }
    };
    document.addEventListener('keydown', handleSkip);

    // Auto-advance after fixation duration
    console.log(`⏰ Setting fixation timeout for ${CONFIG.game.timing.fixationDuration}ms`);
    const timeoutId = setTimeout(() => {
      document.removeEventListener('keydown', handleSkip);
      console.log(`⚡ Fixation completed for trial ${trialIndex} - advancing to next stage`);
      this.nextStage();
    }, CONFIG.game.timing.fixationDuration);

    // Store timeout ID for potential cleanup
    this.currentFixationTimeout = timeoutId;
  }

  runTrialStage(experimentType, experimentIndex, trialIndex) {
    console.log(`🎮 Starting trial ${trialIndex} of ${experimentType}`);
    const trialPhase = this.getTrialPhase(experimentType);

    // Determine legend based on actual player index whenever it's a 2P experiment
    // This stays consistent even if mode switches to human-AI mid-session
    let playerDisplay = getPlayerDisplayInfo(0, 'human-ai');
    if (experimentType.includes('2P')) {
      playerDisplay = getPlayerDisplayInfo(this.playerIndex, this.gameMode);
    }

    // Create trial container with game canvas area
    this.container.innerHTML = `
      <div style="display: flex; align-items: center; justify-content: center; min-height: 100vh; background: #f8f9fa;">
        <div style="text-align: center; max-width: 800px; width: 100%;">
          <h3 id="game-title" style="margin-bottom: 10px;">Game ${experimentIndex + 1}</h3>
          <h4 id="trial-info" style="margin-bottom: 20px;">Round ${trialIndex + 1}</h4>
          <div id="game-canvas-container" style="margin: 0 auto; position: relative; display: flex; justify-content: center;">
            <!-- Game canvas will be inserted here by ExperimentManager -->
          </div>
          <div style="margin-top: 20px; font-size: 14px; color: #666;">
            <p>${playerDisplay.instructionText} <span style="display: inline-block; width: 18px; height: 18px; background-color: ${playerDisplay.selfColorValue}; border-radius: 50%; vertical-align: middle;"></span> Use arrow keys to move.</p>
          </div>
        </div>
      </div>
    `;

    // Emit event to start trial
    this.emit('start-trial', {
      experimentType,
      experimentIndex,
      trialIndex,
      trialPhase,
      onComplete: (result) => {
        if (result && typeof result === 'object') {
          result.trialPhase = trialPhase;
          if (result.trialData && typeof result.trialData === 'object') {
            result.trialData.trialPhase = trialPhase;
          }
        }
        if (trialPhase === 'warmup') {
          this.experimentData.warmupTrialCount = (Number(this.experimentData.warmupTrialCount) || 0) + 1;
        }
        // Store trial result
        if (!this.experimentData.experiments[experimentType]) {
          this.experimentData.experiments[experimentType] = [];
        }
        this.experimentData.experiments[experimentType].push(result);

        // Update success threshold tracking for collaboration experiments
        if (experimentType.includes('2P') && CONFIG.game.successThreshold.enabled) {
          this.updateSuccessThresholdTracking(result.success, trialIndex);
        }

        console.log(`✅ Trial ${trialIndex} completed`);
        this.nextStage();
      }
    });
  }

  showPostTrialStage(experimentType, experimentIndex, trialIndex) {
    // Get the last trial result
    const trialResult = this.experimentData.experiments[experimentType]?.[trialIndex];
    const success = trialResult?.success || false;

    // Instead of creating a new page, show feedback as overlay on the current game canvas
    // Find the existing game canvas container
    const gameCanvasContainer = document.getElementById('game-canvas-container');

    if (gameCanvasContainer) {
      // Show feedback overlay on the existing game canvas
      this.emit('show-trial-feedback', {
        success,
        experimentType,
        trialIndex,
        canvasContainer: gameCanvasContainer
      });
    } else {
      // Fallback: create a new container if game canvas not found
      this.container.innerHTML = `
        <div style="display: flex; align-items: center; justify-content: center; min-height: 100vh; background: #f8f9fa;">
          <div style="text-align: center; max-width: 600px; width: 100%;">
            <h3 style="margin-bottom: 10px;">Game ${experimentIndex + 1}</h3>
            <h4 style="margin-bottom: 20px;">Round ${trialIndex + 1} Results</h4>
            <div id="feedbackCanvasContainer" style="margin: 0 auto 20px auto; position: relative; display: flex; justify-content: center;"></div>
          </div>
        </div>
      `;

      this.emit('show-trial-feedback', {
        success,
        experimentType,
        trialIndex,
        canvasContainer: document.getElementById('feedbackCanvasContainer')
      });
    }

    // Auto-advance after feedback duration
    setTimeout(() => {
      console.log(`📊 Post-trial feedback completed for trial ${trialIndex}`);

      // Check if we should continue to next trial or end the experiment
      if (experimentType.includes('2P') && CONFIG.game.successThreshold.enabled) {
        // Dynamic trial progression for collaboration experiments
        if (this.shouldContinueToNextTrial(experimentType, trialIndex)) {
          console.log(`Continuing to next trial for ${experimentType}`);
          // Add the next trial stages dynamically
          this.addNextTrialStages(experimentType, experimentIndex, trialIndex + 1);
          this.nextStage();
        } else {
          console.log(`Ending ${experimentType} experiment`);
          // Skip to next experiment or completion stage
          this.skipToNextExperimentOrCompletion(experimentType);
        }
      } else {
        // Normal progression for non-collaboration experiments
        this.nextStage();
      }
    }, CONFIG.game.timing.feedbackDisplayDuration);
  }

  showGameFeedbackStage() {
    if (this.isKidMode()) {
      this.showKidGameFeedbackStage();
      return;
    }

    // Build legacy-compatible metrics based on collected trial results
    const allResults = Object.values(this.experimentData.experiments).flat();
    const trials = allResults.map(r => r?.trialData || r).filter(Boolean);

    const totalTrials = trials.length;

    // Total time in minutes between first trial start and last trial end
    let totalTimeMinutes = 0;
    if (trials.length > 0) {
      const firstStart = Math.min(...trials.map(t => Number(t.trialStartTime || 0) || 0));
      const lastEnd = Math.max(...trials.map(t => Number(t.endTime || t.trialEndTime || 0) || 0));
      const totalMs = Math.max(0, lastEnd - firstStart);
      totalTimeMinutes = Math.round(totalMs / (1000 * 60));
    }

    const hasCollaborationTrials = trials.some(t => String(t.experimentType || '').includes('2P'));
    const hasSinglePlayerTrials = trials.some(t => String(t.experimentType || '').includes('1P'));

    // Single-player success: t.completed === true
    let singlePlayerSuccessRate = 0;
    if (hasSinglePlayerTrials) {
      const sp = trials.filter(t => String(t.experimentType || '').includes('1P'));
      const spSuccess = sp.filter(t => t.completed === true).length;
      singlePlayerSuccessRate = sp.length > 0 ? Math.round((spSuccess / sp.length) * 100) : 0;
    }

    // Collaboration success: t.collaborationSucceeded === true
    let collaborationSuccessRate = 0;
    if (hasCollaborationTrials) {
      const cp = trials.filter(t => String(t.experimentType || '').includes('2P'));
      const cpSuccess = cp.filter(t => t.collaborationSucceeded === true).length;
      collaborationSuccessRate = cp.length > 0 ? Math.round((cpSuccess / cp.length) * 100) : 0;
    }

    // Render legacy UI and content
    this.container.innerHTML = `
      <div style="display: flex; align-items: center; justify-content: center; min-height: 100vh; background: #f8f9fa;">
        <div style="background: white; padding: 40px; border-radius: 10px; box-shadow: 0 4px 6px rgba(0,0,0,0.1); max-width: 700px; width: 100%; text-align: center;">
          <h2 style="color: #333; margin-bottom: 30px;">🎮 Game Performance Summary</h2>

          <div style="background: #f8f9fa; border-radius: 8px; padding: 30px; margin-bottom: 30px;">
            <h3 style="color: #666; margin-bottom: 20px;">Your Results</h3>

            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 20px; margin-bottom: 20px;">
              <div style="background: white; padding: 20px; border-radius: 8px; border-left: 4px solid #007bff;">
                <h4 style="color: #007bff; margin-bottom: 10px; font-size: 18px;">📊 Total Trials</h4>
                <p style="font-size: 24px; font-weight: bold; color: #333; margin: 0;">${totalTrials}</p>
              </div>

              <div style="background: white; padding: 20px; border-radius: 8px; border-left: 4px solid #28a745;">
                <h4 style="color: #28a745; margin-bottom: 10px; font-size: 18px;">⏱️ Total Time</h4>
                <p style="font-size: 24px; font-weight: bold; color: #333; margin: 0;">${totalTimeMinutes} min</p>
              </div>

              ${hasSinglePlayerTrials ? `
                <div style="background: white; padding: 20px; border-radius: 8px; border-left: 4px solid #ffc107;">
                  <h4 style="color: #ffc107; margin-bottom: 10px; font-size: 18px;">🎯 Single Player Success</h4>
                  <p style="font-size: 24px; font-weight: bold; color: #333; margin: 0;">${singlePlayerSuccessRate}%</p>
                  <p style=\"font-size: 14px; color: #666; margin: 5px 0 0 0;\">(${trials.filter(t => String(t.experimentType || '').includes('1P')).length} single player trials)</p>
                </div>
              ` : ''}

              ${hasCollaborationTrials ? `
                <div style="background: white; padding: 20px; border-radius: 8px; border-left: 4px solid #dc3545;">
                  <h4 style="color: #dc3545; margin-bottom: 10px; font-size: 18px;">🤝 Collaboration Success</h4>
                  <p style="font-size: 24px; font-weight: bold; color: #333; margin: 0;">${collaborationSuccessRate}%</p>
                  <p style=\"font-size: 14px; color: #666; margin: 5px 0 0 0;\">(${trials.filter(t => String(t.experimentType || '').includes('2P')).length} collaboration trials)</p>
                </div>
              ` : ''}
            </div>
          </div>

          <div style="background: #e8f5e8; border: 2px solid #28a745; border-radius: 8px; padding: 25px; margin-bottom: 30px;">
            <h3 style="color: #28a745; margin-bottom: 15px;">📝 Almost Done!</h3>
            <p style="font-size: 18px; color: #333; margin-bottom: 15px;">
              Thank you for completing the game trials!
            </p>
            <p style="font-size: 16px; color: #666; margin-bottom: 0;">
              To finish the experiment, we kindly ask you to fill out a short questionnaire about your experience.
              This will help us understand your thoughts and improve our research.
            </p>
          </div>

          <div style="text-align: center;">
            <button id="continueToQuestionnaireBtn" style="
              background: #28a745;
              color: white;
              border: none;
              padding: 15px 30px;
              font-size: 18px;
              border-radius: 8px;
              cursor: pointer;
              box-shadow: 0 4px 8px rgba(0,0,0,0.2);
              transition: all 0.3s ease;
            " onmouseover="this.style.background='#218838'" onmouseout="this.style.background='#28a745'">
              📋 Continue to Questionnaire
            </button>
          </div>
        </div>
      </div>
    `;

    // Ensure questionnaire stage exists (legacy-compatible safeguard)
    const hasQuestionnaireStage = this.stages.some(s => s.type === 'questionnaire');
    if (!hasQuestionnaireStage) {
      this.stages.push({ type: 'questionnaire', handler: () => this.showQuestionnaireStage() });
    }

    // Proceed on button click
    const btn = document.getElementById('continueToQuestionnaireBtn');
    if (btn) {
      btn.addEventListener('click', () => {
        console.log('🎮 Game Feedback Stage: Continue button clicked');
        this.nextStage();
      });
    }
  }

  showKidGameFeedbackStage() {
    const allResults = Object.values(this.experimentData.experiments).flat();
    const trials = allResults.map(r => r?.trialData || r).filter(Boolean);
    const totalTrials = trials.length;

    let totalTimeMinutes = 0;
    if (trials.length > 0) {
      const firstStart = Math.min(...trials.map(t => Number(t.trialStartTime || 0) || 0));
      const lastEnd = Math.max(...trials.map(t => Number(t.endTime || t.trialEndTime || 0) || 0));
      totalTimeMinutes = Math.round(Math.max(0, lastEnd - firstStart) / (1000 * 60));
    }

    const singlePlayerTrials = trials.filter(trial => String(trial.experimentType || '').includes('1P'));
    const collaborationTrials = trials.filter(trial => String(trial.experimentType || '').includes('2P'));
    const successfulSinglePlayer = singlePlayerTrials.filter(trial => trial.completed === true).length;
    const successfulCollaborations = collaborationTrials.filter(trial => trial.collaborationSucceeded === true).length;
    const singleRateDisplay = singlePlayerTrials.length
      ? `${Math.round((successfulSinglePlayer / singlePlayerTrials.length) * 100)}%`
      : '-';
    const collabRateDisplay = collaborationTrials.length
      ? `${Math.round((successfulCollaborations / collaborationTrials.length) * 100)}%`
      : '-';

    this.container.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:center;min-height:100vh;background:#f8f9fa;">
        <div data-stage-focus="true" tabindex="-1" style="background:white;padding:10px;border-radius:10px;box-shadow:0 4px 6px rgba(0,0,0,0.1);max-width:1100px;width:100%;text-align:center;">
          <h2 style="color:#333;margin-bottom:5px;">Game Performance Summary</h2>

          <div style="background:#f8f9fa;border-radius:8px;padding:15px;margin-bottom:10px;">
            <h3 style="color:#666;margin-bottom:10px;font-size:16px;">Your Results</h3>

            <div style="display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;margin-bottom:10px;align-items:stretch;">
              <div style="background:white;padding:12px;border-radius:8px;border-left:4px solid #007bff;">
                <h4 style="color:#007bff;margin-bottom:5px;font-size:14px;">Total Trials</h4>
                <p style="font-size:20px;font-weight:bold;color:#333;margin:0;">${totalTrials}</p>
              </div>
              <div style="background:white;padding:12px;border-radius:8px;border-left:4px solid #28a745;">
                <h4 style="color:#28a745;margin-bottom:5px;font-size:14px;">Total Time</h4>
                <p style="font-size:20px;font-weight:bold;color:#333;margin:0;">${totalTimeMinutes} min</p>
              </div>
              <div style="background:white;padding:12px;border-radius:8px;border-left:4px solid #ffc107;">
                <h4 style="color:#ffc107;margin-bottom:5px;font-size:14px;">Single Player Success</h4>
                <p style="font-size:20px;font-weight:bold;color:#333;margin:0;">${singleRateDisplay}</p>
                <p style="font-size:12px;color:#666;margin:2px 0 0 0;">(${singlePlayerTrials.length} single player trials)</p>
              </div>
              <div style="background:white;padding:12px;border-radius:8px;border-left:4px solid #dc3545;">
                <h4 style="color:#dc3545;margin-bottom:5px;font-size:14px;">Collaboration Success</h4>
                <p style="font-size:20px;font-weight:bold;color:#333;margin:0;">${collabRateDisplay}</p>
                <p style="font-size:12px;color:#666;margin:2px 0 0 0;">(${collaborationTrials.length} collaboration trials)</p>
              </div>
            </div>
          </div>

          <div style="background:#e8f5e8;border:2px solid #28a745;border-radius:8px;padding:15px;margin-bottom:5px;">
            <h3 style="color:#28a745;margin-bottom:8px;font-size:16px;">Almost Done!</h3>
            <p style="font-size:16px;color:#333;margin-bottom:8px;">Thank you for completing the game! We just have few more questions for you to answer!</p>
          </div>

          <div style="text-align:center;">
            <button id="continueToQuestionnaireBtn" style="background:#28a745;color:white;border:none;padding:12px 25px;font-size:16px;border-radius:8px;cursor:pointer;box-shadow:0 4px 8px rgba(0,0,0,0.2);transition:all 0.3s ease;">
              Press the space bar to continue!
            </button>
          </div>
        </div>
      </div>
    `;

    const hasQuestionnaireStage = this.stages.some(s => s.type === 'questionnaire');
    if (!hasQuestionnaireStage) {
      this.stages.push({ type: 'questionnaire', handler: () => this.showQuestionnaireStage() });
    }

    this.setupStageAdvanceControls({
      buttonId: 'continueToQuestionnaireBtn',
      onAdvance: async () => this.nextStage()
    });
  }

  showQuestionnaireStage() {
    if (this.isKidMode()) {
      this.showKidQuestionnaireStage();
      return;
    }

    // Match legacy two-page questionnaire exactly
    this.container.innerHTML = `
      <div style="display: flex; align-items: center; justify-content: center; min-height: 100vh; background: #f8f9fa;">
        <div style="background: white; padding: 40px; border-radius: 10px; box-shadow: 0 4px 6px rgba(0,0,0,0.1); max-width: 800px; width: 100%;">
          <h2 style="color: #333; margin-bottom: 30px; text-align: center;">Post-Experiment Questionnaire</h2>

          <form id="questionnaireForm">
            <div id="questionnairePage1">
              <h3 style="color: #666; margin-bottom: 20px;">Page 1 of 2</h3>

              <div style="margin-bottom: 25px;">
                <label style="display: block; font-weight: bold; margin-bottom: 10px; color: #333;">
                  Do you think the other player is a person or an AI?
                </label>
                <div style="display: flex; flex-direction: column; gap: 8px;">
                  ${[
                    'Definitely a person',
                    'Probably a person',
                    'Not sure',
                    'Probably an AI',
                    'Definitely an AI'
                  ].map(v => `
                    <label style=\"display: flex; align-items: center; cursor: pointer;\">
                      <input type=\"radio\" name=\"ai_detection\" value=\"${v}\" required style=\"margin-right: 10px;\">${v}
                    </label>
                  `).join('')}
                </div>
              </div>

              <div style="margin-bottom: 25px;">
                <label style="display: block; font-weight: bold; margin-bottom: 10px; color: #333;">
                  To what extent do you think the other player was a good collaborator?
                </label>
                <div style="display: flex; flex-direction: column; gap: 8px;">
                  ${[
                    'Very poor collaborator',
                    'Poor collaborator',
                    'Neutral',
                    'Good collaborator',
                    'Very good collaborator'
                  ].map(v => `
                    <label style=\"display: flex; align-items: center; cursor: pointer;\">
                      <input type=\"radio\" name=\"collaboration_rating\" value=\"${v}\" required style=\"margin-right: 10px;\">${v}
                    </label>
                  `).join('')}
                </div>
              </div>

              <div style="margin-bottom: 25px;">
                <label style="display: block; font-weight: bold; margin-bottom: 10px; color: #333;">
                  What is the color of the "Next Page" button in this survey?
                </label>
                <div style="display: flex; flex-direction: column; gap: 8px;">
                  ${[
                    'Definitely blue',
                    'Probably blue',
                    'Not sure',
                    'Probably red',
                    'Definitely red'
                  ].map(v => `
                    <label style=\"display: flex; align-items: center; cursor: pointer;\">
                      <input type=\"radio\" name=\"attention_check\" value=\"${v}\" required style=\"margin-right: 10px;\">${v}
                    </label>
                  `).join('')}
                </div>
              </div>

              <div style="margin-bottom: 25px;">
                <label style="display: block; font-weight: bold; margin-bottom: 10px; color: #333;">
                  Would you play with the other player again?
                </label>
                <div style="display: flex; flex-direction: column; gap: 8px;">
                  ${[
                    'Definitely not play again',
                    'Probably not play again',
                    'Not sure',
                    'Probably play again',
                    'Definitely play again'
                  ].map(v => `
                    <label style=\"display: flex; align-items: center; cursor: pointer;\">
                      <input type=\"radio\" name=\"play_again\" value=\"${v}\" required style=\"margin-right: 10px;\">${v}
                    </label>
                  `).join('')}
                </div>
              </div>

              <div style="text-align: center; margin-top: 30px;">
                <button type="button" id="nextPageBtn" style="
                  background: #007bff; color: white; border: none; padding: 12px 24px; font-size: 16px; border-radius: 5px; cursor: pointer;">Next Page</button>
              </div>
            </div>

            <div id="questionnairePage2" style="display: none;">
              <h3 style="color: #666; margin-bottom: 20px;">Page 2 of 2</h3>

              <div style="margin-bottom: 25px;">
                <label style="display: block; font-weight: bold; margin-bottom: 10px; color: #333;">
                  Did you use any strategy in the game? If yes, what was it?
                </label>
                <textarea name="strategy" rows="4" style="width: 100%; padding: 10px; border: 1px solid #ddd; border-radius: 5px; font-family: inherit; resize: vertical;" placeholder="Please describe your strategy..."></textarea>
              </div>

              <div style="margin-bottom: 25px;">
                <label style="display: block; font-weight: bold; margin-bottom: 10px; color: #333;">
                  Some people have cats as their pets, true or false?
                </label>
                <textarea name="cat_question" rows="4" style="width: 100%; padding: 10px; border: 1px solid #ddd; border-radius: 5px; font-family: inherit; resize: vertical;" placeholder="Please answer true or false..."></textarea>
              </div>

              <div style="margin-bottom: 25px;">
                <label style="display: block; font-weight: bold; margin-bottom: 10px; color: #333;">
                  What do you think the purpose of this experiment is?
                </label>
                <textarea name="purpose" rows="4" style="width: 100%; padding: 10px; border: 1px solid #ddd; border-radius: 5px; font-family: inherit; resize: vertical;" placeholder="Please share your thoughts..."></textarea>
              </div>

              <div style="margin-bottom: 25px;">
                <label style="display: block; font-weight: bold; margin-bottom: 10px; color: #333;">
                  Do you have any questions or comments?
                </label>
                <textarea name="comments" rows="4" style="width: 100%; padding: 10px; border: 1px solid #ddd; border-radius: 5px; font-family: inherit; resize: vertical;" placeholder="Any additional feedback..."></textarea>
              </div>

              <div style="text-align: center; margin-top: 30px;">
                <button type="button" id="prevPageBtn" style="background: #6c757d; color: white; border: none; padding: 12px 24px; font-size: 16px; border-radius: 5px; cursor: pointer; margin-right: 10px;">Previous Page</button>
                <button type="submit" id="submitBtn" style="background: #28a745; color: white; border: none; padding: 12px 24px; font-size: 16px; border-radius: 5px; cursor: pointer;">Submit</button>
              </div>
            </div>
          </form>
        </div>
      </div>
    `;

    // Navigation and validation like legacy
    const nextBtn = document.getElementById('nextPageBtn');
    const prevBtn = document.getElementById('prevPageBtn');
    const page1 = document.getElementById('questionnairePage1');
    const page2 = document.getElementById('questionnairePage2');

    if (nextBtn) {
      nextBtn.addEventListener('click', () => {
        const required = ['ai_detection', 'collaboration_rating', 'attention_check', 'play_again'];
        let valid = true;
        required.forEach((name) => {
          const el = document.querySelector(`input[name="${name}"]:checked`);
          if (!el) {
            valid = false;
            const any = document.querySelector(`input[name="${name}"]`);
            if (any) {
              const group = any.closest('div').parentElement;
              group.style.border = '2px solid #dc3545';
              group.style.borderRadius = '5px';
              group.style.padding = '10px';
            }
          }
        });
        if (valid) {
          page1.style.display = 'none';
          page2.style.display = 'block';
        } else {
          alert('Please answer all required questions before proceeding.');
        }
      });
    }

    if (prevBtn) {
      prevBtn.addEventListener('click', () => {
        page2.style.display = 'none';
        page1.style.display = 'block';
      });
    }

    document.getElementById('questionnaireForm').addEventListener('submit', (event) => {
      event.preventDefault();
      const formData = new FormData(event.target);
      const answers = {};
      for (const [k, v] of formData.entries()) {
        answers[k] = v;
      }
      this.experimentData.questionnaire = answers;
      console.log('📝 Questionnaire completed');
      this.nextStage();
    });
  }

  showKidQuestionnaireStage() {
    const questions = [
      {
        name: 'ai_detection',
        title: 'Page 1 of 3',
        prompt: 'Do you think the other player is a person or a computer?',
        options: [
          'Definitely a person',
          'Probably a person',
          'Not sure',
          'Probably a computer',
          'Definitely a computer'
        ]
      },
      {
        name: 'collaboration_rating',
        title: 'Page 2 of 3',
        prompt: 'How well did the other player collaborate with you?',
        options: [
          'Very poor collaborator',
          'Poor collaborator',
          'Neutral',
          'Good collaborator',
          'Very good collaborator'
        ]
      },
      {
        name: 'play_again',
        title: 'Page 3 of 3',
        prompt: 'Would you like to play this game again in the future?',
        options: [
          'Definitely not play again',
          'Probably not play again',
          'Not sure',
          'Probably play again',
          'Definitely play again'
        ]
      }
    ];

    const answers = {};
    let questionIndex = 0;
    let selectedIndex = 2;

    const renderQuestion = () => {
      const question = questions[questionIndex];
      const optionsHtml = question.options.map((option, index) => {
        const selected = index === selectedIndex;
        return `
          <div data-idx="${index}" style="
            padding:12px 16px;
            margin:8px 0;
            border-radius:10px;
            border:2px solid ${selected ? '#4f46e5' : '#e5e7eb'};
            background:${selected ? '#eef2ff' : '#ffffff'};
            color:#333;
            font-size:18px;
            text-align:center;
          ">${option}</div>
        `;
      }).join('');

      this.container.innerHTML = `
        <div style="display:flex;align-items:center;justify-content:center;min-height:100vh;background:#f8f9fa;padding:20px;">
          <div data-stage-focus="true" tabindex="-1" style="background:white;padding:32px;border-radius:16px;box-shadow:0 10px 25px rgba(0,0,0,0.1);width:100%;max-width:720px;">
            <div style="text-align:center;margin-bottom:12px;color:#6b7280;font-weight:600;">Post-Game Questionnaire</div>
            <div style="text-align:center;margin-bottom:8px;color:#6b7280;font-weight:600;">${question.title}</div>
            <h2 style="text-align:center;margin:8px 0 20px;color:#111827;">${question.prompt}</h2>
            <div style="margin-bottom:16px;text-align:center;color:#6b7280;">Use Up and Down arrows to choose, press Space to confirm</div>
            <div id="options" style="display:flex;flex-direction:column;">${optionsHtml}</div>
          </div>
        </div>
      `;

      const focusTarget = this.container.querySelector('[data-stage-focus="true"]');
      if (focusTarget && typeof focusTarget.focus === 'function') {
        setTimeout(() => focusTarget.focus({ preventScroll: true }), 0);
      }
      this.applyKidVisualTheme();
    };

    const handleKeys = (event) => {
      if (event.code === 'ArrowUp' || event.key === 'ArrowUp') {
        event.preventDefault();
        selectedIndex = Math.max(0, selectedIndex - 1);
        renderQuestion();
      } else if (event.code === 'ArrowDown' || event.key === 'ArrowDown') {
        event.preventDefault();
        selectedIndex = Math.min(questions[questionIndex].options.length - 1, selectedIndex + 1);
        renderQuestion();
      } else if (event.code === 'Space' || event.key === ' ') {
        event.preventDefault();
        answers[questions[questionIndex].name] = questions[questionIndex].options[selectedIndex];
        if (questionIndex < questions.length - 1) {
          questionIndex += 1;
          selectedIndex = 2;
          renderQuestion();
        } else {
          document.removeEventListener('keydown', handleKeys, true);
          this.experimentData.questionnaire = answers;
          this.nextStage();
        }
      }
    };

    renderQuestion();
    document.addEventListener('keydown', handleKeys, true);
  }

  showEndExperimentInfoStage() {
    const completionCode = this.generateCompletionCode();

    this.container.innerHTML = `
      <div style="display: flex; align-items: center; justify-content: center; min-height: 100vh; background: #f8f9fa;">
        <div style="background: white; padding: 40px; border-radius: 10px; box-shadow: 0 4px 6px rgba(0,0,0,0.1); max-width: 600px; text-align: center;">
          <h2 style="color: #28a745; margin-bottom: 30px;">🎉 Experiment Complete!</h2>

          <p style="font-size: 18px; margin-bottom: 20px;">
            Thank you for participating in our study!
          </p>

          <div style="background: #fff3cd; padding: 20px; border-radius: 8px; margin-bottom: 20px; border: 1px solid #ffeeba; color: #856404;">
            We are saving your data now. Your completion code will be shown after your data has been saved successfully.
          </div>

          <div style="margin-bottom: 30px;">
            <div id="saving-status" style="display: inline-block; margin: 10px; color: #666;">📊 Saving your data...</div>
          </div>

          <button id="continueBtn" style="background: #007bff; color: white; border: none; padding: 15px 30px; font-size: 18px; border-radius: 5px; cursor: pointer;">
            Continue
          </button>
        </div>
      </div>
    `;

    // Save data (emit event for external handler)
    this.experimentData.completed = true;
    this.experimentData.completionCode = completionCode;
    this.experimentData.endTime = new Date().toISOString();

    this.emit('save-data', this.experimentData);
    // If external saving is enabled, disable Continue until save succeeds
    const continueBtn = document.getElementById('continueBtn');
    try {
      if (CONFIG?.server?.enableGoogleDriveSave && continueBtn) {
        continueBtn.disabled = true;
        continueBtn.style.opacity = '0.6';
        continueBtn.style.cursor = 'not-allowed';
        continueBtn.textContent = 'Saving...';
      }
    } catch (e) {
      // Fail open if config inaccessible
    }

    // Safety: If save takes too long or fails silently, allow manual continue after a grace period
    try {
      if (CONFIG?.server?.enableGoogleDriveSave) {
        setTimeout(() => {
          const el = document.getElementById('saving-status');
          const btn = document.getElementById('continueBtn');
          if (el && btn && btn.disabled) {
            el.textContent = '⚠️ Save taking longer than expected. You may continue.';
            el.style.color = '#dc3545';
            btn.disabled = false;
            btn.style.opacity = '1';
            btn.style.cursor = 'pointer';
            btn.textContent = 'Continue';
          }
        }, 15000);
      }
    } catch (_) { /* noop */ }

    // Update UI when data save succeeds (legacy-style: auto-advance)
    const handleSaved = () => {
      const el = document.getElementById('saving-status');
      if (el) {
        el.textContent = '✅ Data saved successfully!';
        el.style.color = '#28a745';
      }
      if (continueBtn) {
        continueBtn.disabled = false;
        continueBtn.style.opacity = '1';
        continueBtn.style.cursor = 'pointer';
        continueBtn.textContent = 'Continue';
      }
      // Remove handler and move to next stage automatically
      this.off('data-save-success', handleSaved);
      this.nextStage();
    };
    // Ensure single listener
    this.eventHandlers.delete('data-save-success');
    this.on('data-save-success', handleSaved);

    document.getElementById('continueBtn').addEventListener('click', () => {
      console.log('💾 Data saving initiated');
      if (continueBtn && continueBtn.disabled) {
        console.log('⏳ Waiting for data-save success before continuing');
        return;
      }
      this.nextStage();
    });
  }

  showKidLocalCompletionStage() {
    this.container.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:center;min-height:100vh;background:#f8f9fa;">
        <div style="background:white;padding:40px;border-radius:10px;box-shadow:0 4px 6px rgba(0,0,0,0.1);max-width:600px;text-align:center;">
          <h2 style="color:#28a745;margin-bottom:20px;">Experiment Complete!</h2>
          <p style="font-size:18px;margin-bottom:12px;">Thank you for playing the game.</p>
          <p style="font-size:16px;color:#666;margin-bottom:0;">You may close this page now.</p>
        </div>
      </div>
    `;
  }

  showProlificRedirectStage() {
    const code = (CONFIG?.game?.prolificCompletionCode) || this.experimentData.completionCode || 'CTNDR8GV';

    this.container.innerHTML = `
      <div style="display: flex; align-items: center; justify-content: center; min-height: 100vh; background: #f8f9fa;">
        <div style="background: white; padding: 40px; border-radius: 10px; box-shadow: 0 4px 6px rgba(0,0,0,0.1); max-width: 600px; text-align: center;">
          <h2 style="color: #333; margin-bottom: 20px;">🎉 Experiment Complete!</h2>
          <p style="font-size: 16px; margin-bottom: 12px;">Thank you for completing the experiment!</p>
          <p style="font-size: 14px; color: #666; margin-bottom: 20px;">Please copy the code below and submit it in Prolific.</p>

          <div style="background: #e8f5e8; border: 2px solid #28a745; border-radius: 8px; padding: 20px; margin: 20px 0;">
            <h3 style="color: #28a745; margin-bottom: 10px;">Your Completion Code</h3>
            <div style="background: white; border: 2px dashed #28a745; border-radius: 5px; padding: 15px; margin: 10px 0;">
              <p id="completionCodeText" style="font-size: 24px; font-weight: bold; color: #28a745; margin: 0; font-family: monospace; letter-spacing: 2px;">${code}</p>
            </div>
            <p style="font-size: 14px; color: #666; margin: 10px 0 0 0;">Copy this code now to complete your submission in Prolific.</p>
            <div style="margin-top: 12px;">
              <button id="copyCodeBtn" style="background: #007bff; color: white; border: none; padding: 10px 16px; font-size: 14px; border-radius: 5px; cursor: pointer;">Copy Code</button>
              <span id="copyStatus" style="margin-left: 10px; font-size: 14px; color: #28a745; display: none;">Copied!</span>
            </div>
          </div>
        </div>
      </div>
    `;

    // Wire up Copy button with clipboard API (with fallback)
    try {
      const copyBtn = document.getElementById('copyCodeBtn');
      const codeEl = document.getElementById('completionCodeText');
      const statusEl = document.getElementById('copyStatus');
      if (copyBtn && codeEl) {
        copyBtn.addEventListener('click', async () => {
          const text = (codeEl.textContent || '').trim();
          try {
            if (navigator.clipboard && navigator.clipboard.writeText) {
              await navigator.clipboard.writeText(text);
            } else {
              const tmp = document.createElement('textarea');
              tmp.value = text;
              document.body.appendChild(tmp);
              tmp.select();
              document.execCommand('copy');
              document.body.removeChild(tmp);
            }
            if (statusEl) {
              statusEl.style.display = 'inline';
              copyBtn.textContent = 'Copied!';
              copyBtn.style.background = '#28a745';
              setTimeout(() => {
                statusEl.style.display = 'none';
                copyBtn.textContent = 'Copy Code';
                copyBtn.style.background = '#007bff';
              }, 2000);
            }
          } catch (e) {
            console.warn('Copy failed:', e);
          }
        });
      }
    } catch (_) { /* noop */ }
  }

  /**
   * Helper methods
   */

  isHumanHumanMode() {
    // Prefer explicit runtime state, then config, then URL param
    if (this.gameMode === 'human-human') return true;

    if (GameConfigUtils && typeof GameConfigUtils.isHumanHumanMode === 'function') {
      if (GameConfigUtils.isHumanHumanMode()) return true;
    }

    const urlParams = new URLSearchParams(window.location.search);
    const mode = urlParams.get('mode');
    return mode === 'human-human';
  }

  getInstructionsForExperiment(experimentType) {
    const instructions = {
      '1P1G': {
        html: `
          <div style="display: flex; align-items: center; justify-content: center; min-height: 100vh; background: #f8f9fa;">
            <div style="background: white; padding: 40px; border-radius: 10px; box-shadow: 0 4px 6px rgba(0,0,0,0.1); max-width: 800px; text-align: center;">
              <h2 style="color: #333; margin-bottom: 30px; font-size: 36px;">Game 1</h2>
              <h3 style="color: #000; margin-bottom: 20px; font-size: 24px;">Before we begin, let's practice a few rounds!</h3>
              <div style="background: #e8f5e8; border: 1px solid #c3e6cb; border-radius: 8px; padding: 28px; margin-bottom: 30px;">
                <ul style="font-size: 22px; color: #155724; margin-bottom: 15px; line-height: 1.6; text-align: left; padding-left: 20px;">
                  <li>You are the traveler <span style=\"display: inline-block; width: 20px; height: 20px; background-color: red; border-radius: 50%; vertical-align: middle; margin: 0 4px;\"></span>.</li>
                  <li>There is one restaurant <span style=\"display: inline-block; width: 20px; height: 20px; background-color: #007bff; border-radius: 3px; vertical-align: middle; margin: 0 4px;\"></span> on the map.</li>
                  <li>Use the arrow keys (↑↓←→) to reach a restaurant.</li>
                </ul>
              </div>
              <p style="font-size: 22px; margin-top: 30px;">Press <strong>space bar</strong> to begin.</p>
            </div>
          </div>
        `
      },
      '1P2G': {
        html: `
          <div style="display: flex; align-items: center; justify-content: center; min-height: 100vh; background: #f8f9fa;">
            <div style="background: white; padding: 40px; border-radius: 10px; box-shadow: 0 4px 6px rgba(0,0,0,0.1); max-width: 800px; text-align: center;">
              <h2 style="color: #333; margin-bottom: 30px; font-size: 36px;">Game 2</h2>
              <h3 style="color: #000; margin-bottom: 20px; font-size: 24px;">Great job!</h3>
              <div style="background: #e8f5e8; border: 1px solid #c3e6cb; border-radius: 8px; padding: 28px; margin-bottom: 30px;">
                <p style="font-size: 22px; color: #155724; margin-bottom: 15px; line-height: 1.6; text-align: left;">
                  Now there will be several identical restaurants on the map.
                </p>
                <ul style="font-size: 22px; color: #155724; margin-bottom: 15px; line-height: 1.6; text-align: left; padding-left: 20px;">
                  <li>Each round, you can <strong>win</strong> by getting to one of the restaurants.</li>
                  <li>Note that some restaurants are already open when the round starts. Others may appear later.</li>
                  <li>For each round that you win, you earn an additional 10 cents.</li>
                </ul>
              </div>
              <p style="font-size: 22px; margin-top: 30px;">Press <strong>space bar</strong> to begin.</p>
            </div>
          </div>
        `
      },
      '2P2G': {
        html: `
          <div style="display: flex; align-items: center; justify-content: center; min-height: 100vh; background: #f8f9fa;">
            <div style="background: white; padding: 40px; border-radius: 10px; box-shadow: 0 4px 6px rgba(0,0,0,0.1); max-width: 800px; text-align: center;">
              <h2 style="color: #333; margin-bottom: 30px; font-size: 36px;">Game 3</h2>
              <h3 style="color: #000; margin-bottom: 20px; font-size: 24px;">Well done!</h3>
              <div style="background: #e8f5e8; border: 1px solid #c3e6cb; border-radius: 8px; padding: 28px; margin-bottom: 30px;">
                <p style="font-size: 22px; color: #155724; margin-bottom: 15px; line-height: 1.6; text-align: left;">
                  Let's continue. In this new game, you will collaborate with another player.
                </p>
                <ul style="font-size: 22px; color: #155724; margin-bottom: 15px; line-height: 1.6; text-align: left; padding-left: 20px;">
                  <li>Each round, you can <strong> win </strong> if both of you go to the <strong> same </strong> restaurant.</li>
                  <li>You lose the round if you end up at different restaurants.</li>
                  <li>Movement: Both players move one step at a time - the action will only take effect after both players have pressed their buttons.</li>
                  <li>For each round that you win, you earn an additional 10 cents.</li>
                </ul>
              </div>
              <p style="font-size: 22px; margin-top: 30px;">Press <strong>space bar</strong> to begin.</p>
            </div>
          </div>
        `
      },
      '2P3G': {
        html: `
          <div style="display: flex; align-items: center; justify-content: center; min-height: 100vh; background: #f8f9fa;">
            <div style="background: white; padding: 40px; border-radius: 10px; box-shadow: 0 4px 6px rgba(0,0,0,0.1); max-width: 800px; text-align: center;">
              <h2 style="color: #333; margin-bottom: 30px; font-size: 36px;">Game 4</h2>
              <h3 style="color: #000; margin-bottom: 20px; font-size: 24px;">Good job!</h3>
              <div style="background: #e8f5e8; border: 1px solid #c3e6cb; border-radius: 8px; padding: 28px; margin-bottom: 30px;">
                <p style="font-size: 22px; color: #155724; margin-bottom: 15px; line-height: 1.6; text-align: left;">
                  Now, let's start the final game! You will collaborate with the same player as before.
                </p>
                <ul style="font-size: 22px; color: #155724; margin-bottom: 15px; line-height: 1.6; text-align: left; padding-left: 20px;">
                  <li>Each round, you can <strong> win </strong> if both of you go to the <strong> same </strong> restaurant.</li>
                  <li>You lose the round if you end up at different restaurants.</li>
                  <li> <strong> Note that some restaurants are already open when the round starts. Others may appear later.</strong></li>
                  <li>For each round that you win, you earn an additional 10 cents.</li>
                </ul>
              </div>
              <p style="font-size: 22px; margin-top: 30px;">Press <strong>space bar</strong> to begin.</p>
            </div>
          </div>
        `
      }
    };

    return instructions[experimentType] || {
      html: `
        <div style="display: flex; align-items: center; justify-content: center; min-height: 100vh; background: #f8f9fa;">
          <div style="background: white; padding: 40px; border-radius: 10px; box-shadow: 0 4px 6px rgba(0,0,0,0.1); max-width: 800px; text-align: center;">
            <h2 style="color: #333; margin-bottom: 30px;">Game Instructions</h2>
            <p style="font-size: 18px; margin-bottom: 30px;">Use arrow keys to navigate and reach the goals.</p>
            <p style="font-size: 20px; margin-top: 30px;">Press <strong>space bar</strong> to begin.</p>
          </div>
        </div>
      `
    };
  }

  generateParticipantId() {
    return 'P' + Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
  }

  setParticipantId(participantId) {
    const cleanParticipantId = String(participantId || '').trim();
    if (!cleanParticipantId) return null;

    this.manualParticipantId = cleanParticipantId;
    if (this.experimentData) {
      this.experimentData.participantId = cleanParticipantId;
      this.experimentData.childId = cleanParticipantId;
    }
    return cleanParticipantId;
  }

  getParticipantId() {
    if (this.experimentData?.participantId) {
      return this.experimentData.participantId;
    }
    if (this.manualParticipantId) {
      return this.manualParticipantId;
    }
    const urlParticipantId = getParticipantIdFromUrl();
    if (urlParticipantId) {
      return urlParticipantId;
    }
    if (!this.generatedParticipantId) {
      this.generatedParticipantId = this.generateParticipantId();
    }
    return this.generatedParticipantId;
  }

  generateCompletionCode() {
    return (CONFIG?.game?.prolificCompletionCode) || 'CTNDR8GV';
  }

  /**
   * Initialize success threshold tracking for a new experiment
   */
  initializeSuccessThresholdTracking() {
    this.successThreshold.consecutiveSuccesses = 0;
    this.successThreshold.totalTrialsCompleted = 0;
    this.successThreshold.experimentEndedEarly = false;
    this.successThreshold.lastSuccessTrial = -1;
    this.successThreshold.successHistory = [];
  }

  /**
   * Update success threshold tracking after a trial
   */
  updateSuccessThresholdTracking(success, trialIndex) {
    this.successThreshold.totalTrialsCompleted++;
    this.successThreshold.successHistory.push(success);

    if (success) {
      this.successThreshold.consecutiveSuccesses++;
      this.successThreshold.lastSuccessTrial = trialIndex;
    } else {
      this.successThreshold.consecutiveSuccesses = 0;
    }

    console.log(`Success threshold update - Trial ${trialIndex + 1}: ${success ? 'SUCCESS' : 'FAILURE'}`);
    console.log(`  Consecutive successes: ${this.successThreshold.consecutiveSuccesses}/${CONFIG.game.successThreshold.consecutiveSuccessesRequired}`);
    console.log(`  Total trials: ${this.successThreshold.totalTrialsCompleted}/${CONFIG.game.successThreshold.maxTrials}`);
  }

  /**
   * Check if experiment should end due to success threshold
   */
  shouldEndExperimentDueToSuccessThreshold() {
    if (!CONFIG.game.successThreshold.enabled) {
      return false;
    }

    const config = CONFIG.game.successThreshold;
    const tracking = this.successThreshold;

    // Check if we've reached the maximum trials
    if (tracking.totalTrialsCompleted >= config.maxTrials) {
      console.log(`Experiment ending: Reached maximum trials (${config.maxTrials})`);
      return true;
    }

    // Check if we have enough trials and consecutive successes
    if (tracking.totalTrialsCompleted >= config.minTrialsBeforeCheck &&
        tracking.consecutiveSuccesses >= config.consecutiveSuccessesRequired) {
      console.log(`Experiment ending: Success threshold met (${tracking.consecutiveSuccesses} consecutive successes after ${tracking.totalTrialsCompleted} trials)`);
      this.successThreshold.experimentEndedEarly = true;
      return true;
    }

    return false;
  }

  /**
   * Check if we should continue to next trial
   */
  shouldContinueToNextTrial(experimentType, trialIndex) {
    // Only apply to collaboration games
    if (!experimentType.includes('2P')) {
      return trialIndex < CONFIG.game.experiments.numTrials[experimentType] - 1;
    }

    // Check if experiment should end due to success threshold
    if (this.shouldEndExperimentDueToSuccessThreshold()) {
      console.log(`Ending ${experimentType} experiment due to success threshold`);
      return false;
    }

    // Check if we've reached the configured number of trials for this specific experiment
    const maxTrials = CONFIG.game.experiments.numTrials[experimentType] || CONFIG.game.successThreshold.maxTrials;
    if (trialIndex >= maxTrials - 1) {
      console.log(`Ending ${experimentType} experiment: Completed ${maxTrials} trials`);
      return false;
    }

    return true;
  }

  /**
   * Add next trial stages dynamically (similar to legacy addNextTrialStages)
   */
  addNextTrialStages(experimentType, experimentIndex, trialIndex) {
    // Find the current post-trial stage index
    const currentStageIndex = this.currentStageIndex;

    // Insert the next trial stages after the current post-trial stage
    const stagesToInsert = [
      {
        type: 'fixation',
        experimentType: experimentType,
        experimentIndex: experimentIndex,
        trialIndex: trialIndex,
        handler: () => this.showFixationStage(experimentType, experimentIndex, trialIndex)
      },
      {
        type: 'trial',
        experimentType: experimentType,
        experimentIndex: experimentIndex,
        trialIndex: trialIndex,
        handler: () => this.runTrialStage(experimentType, experimentIndex, trialIndex)
      },
      {
        type: 'post-trial',
        experimentType: experimentType,
        experimentIndex: experimentIndex,
        trialIndex: trialIndex,
        handler: () => this.showPostTrialStage(experimentType, experimentIndex, trialIndex)
      }
    ];

    // Insert stages after current stage
    this.stages.splice(currentStageIndex + 1, 0, ...stagesToInsert);

    console.log(`Added next trial stages for ${experimentType} trial ${trialIndex + 1}`);
  }

  /**
   * Skip to next experiment or completion stage (similar to legacy)
   */
  skipToNextExperimentOrCompletion(currentExperimentType) {
    console.log(`Skipping to next experiment or completion from ${currentExperimentType}`);

    // Find the next stage that's either a different experiment or completion
    let nextStageIndex = this.currentStageIndex + 1;
    console.log(`Starting search from stage ${nextStageIndex}`);
    console.log(`Total stages in timeline: ${this.stages.length}`);

    while (nextStageIndex < this.stages.length) {
      const nextStage = this.stages[nextStageIndex];
      console.log(`Checking stage ${nextStageIndex}: ${nextStage.type}`);

      // If it's a different experiment type, game-feedback stage, questionnaire stage, or completion stage, stop here
      if (nextStage.type === 'game-feedback' ||
          nextStage.type === 'questionnaire' ||
          nextStage.type === 'completion' ||
          (nextStage.experimentType && nextStage.experimentType !== currentExperimentType)) {
        console.log(`Found stopping point: ${nextStage.type}`);
        break;
      }
      nextStageIndex++;
    }

    // Set the current stage to the found stage
    this.currentStageIndex = nextStageIndex;

    // If we found a valid next stage and it's a different experiment, reset success threshold
    if (this.currentStageIndex < this.stages.length) {
      const nextStage = this.stages[this.currentStageIndex];
      if (nextStage.experimentType && nextStage.experimentType !== currentExperimentType) {
        console.log(`Switching from ${currentExperimentType} to ${nextStage.experimentType} - resetting success threshold`);
        this.initializeSuccessThresholdTracking();
      }
      console.log(`Skipped to stage ${this.currentStageIndex}: ${nextStage.type}`);
      this.runCurrentStage();
    } else {
      console.log('No more stages to run');
    }
  }

  // Record waiting time data for export
  recordWaitingTime(startTime, endTime, duration, reason, experimentType, experimentIndex) {
    const waitingDurationSeconds = Math.round(duration / 1000 * 10) / 10; // Round to 1 decimal place

    // Store in experiment data for Excel export
    if (!this.experimentData.waitingDuration) {
      this.experimentData.waitingDuration = 0;
    }
    this.experimentData.waitingDuration += waitingDurationSeconds;

    // Store detailed waiting info
    if (!this.experimentData.waitingDetails) {
      this.experimentData.waitingDetails = [];
    }
    this.experimentData.waitingDetails.push({
      experimentType: experimentType,
      experimentIndex: experimentIndex,
      durationSeconds: waitingDurationSeconds,
      reason: reason,
      startTime: new Date(startTime).toISOString(),
      endTime: new Date(endTime).toISOString()
    });

    console.log('📊 [WAITING] Recorded waiting time:', waitingDurationSeconds + 's (total: ' + this.experimentData.waitingDuration + 's)');
  }
}
