export const FORMAL_HUMAN_HUMAN_STUDY_ID = 'human-human-4stage-v1';
export const TEST_HUMAN_HUMAN_STUDY_ID = 'human-human-4stage-test-v1';
export const DIRECT_HUMAN_VLM_2P3G_TEST_ID = 'human-vlm-2p3g-test-v2';
export const FORMAL_HUMAN_HUMAN_FALLBACK_PROFILE = 'human-human-fallback-luna-fast';

export function isFormalHumanHumanStudy(search = '') {
  try {
    const params = new URLSearchParams(search || '');
    return params.get('study') === FORMAL_HUMAN_HUMAN_STUDY_ID;
  } catch (_) {
    return false;
  }
}

export function isTestHumanHumanStudy(search = '') {
  try {
    const params = new URLSearchParams(search || '');
    return params.get('study') === TEST_HUMAN_HUMAN_STUDY_ID;
  } catch (_) {
    return false;
  }
}

export function isDirectHumanVlm2P3GTest(search = '') {
  try {
    const params = new URLSearchParams(search || '');
    return params.get('study') === DIRECT_HUMAN_VLM_2P3G_TEST_ID;
  } catch (_) {
    return false;
  }
}

/**
 * Apply the preregistered four-stage Human-Human study settings before any
 * manager is constructed. Keeping this as a named preset prevents pilot URL
 * options and development defaults from silently changing the formal design.
 */
export function applyFormalHumanHumanStudy(config) {
  if (!config) return config;

  config.study = {
    id: FORMAL_HUMAN_HUMAN_STUDY_ID,
    formal: true,
    assignedCondition: 'human-human',
    fallback: {
      trigger: 'no-human-match-after-5-minutes',
      agentType: 'vlm',
      profile: FORMAL_HUMAN_HUMAN_FALLBACK_PROFILE,
      model: 'gpt-5.6-luna',
      serviceTier: 'fast',
      reasoningEffort: 'none'
    }
  };

  config.game.players.player1.type = 'human';
  config.game.players.player2.type = 'human';
  config.game.experiments.order = ['1P1G', '1P2G', '2P2G', '2P3G'];
  config.game.experiments.numTrials = {
    '1P1G': 3,
    '1P2G': 12,
    '2P2G': 8,
    '2P3G': 12
  };

  // Match the original four-game flow, but wait a full five minutes before
  // changing the assigned Human-Human condition to the registered VLM fallback.
  config.game.timing.waitingForPartnerMinDuration = 9 * 1000;
  config.game.timing.waitingForPartnerMaxDuration = 5 * 60 * 1000;

  config.multiplayer.fallbackAIType = 'vlm';
  config.multiplayer.allowWaitingSkip = false;
  config.multiplayer.waitingMinigame = {
    enabled: true,
    designSource: 'kids-branch-space-hop-v1'
  };
  config.multiplayer.matchPlayReadyTimeout = 5 * 60 * 1000;
  config.multiplayer.matchPool = FORMAL_HUMAN_HUMAN_STUDY_ID;

  config.game.agent.vlm = {
    ...config.game.agent.vlm,
    model: 'gpt-5.6-luna',
    profile: FORMAL_HUMAN_HUMAN_FALLBACK_PROFILE,
    serviceTier: 'fast',
    reasoningEffort: 'none',
    temperature: 0
  };

  return config;
}

/**
 * Short end-to-end QA preset. It uses an isolated matchmaking pool and carries
 * an explicit test label so its data cannot be mistaken for formal sessions.
 */
export function applyTestHumanHumanStudy(config) {
  applyFormalHumanHumanStudy(config);

  config.study = {
    ...config.study,
    id: TEST_HUMAN_HUMAN_STUDY_ID,
    formal: false,
    test: true,
    requiresRealMatchmaking: true,
    assignedCondition: 'human-human-test',
    fallback: {
      ...config.study.fallback,
      trigger: 'tester-presses-enter-or-no-human-match-after-5-minutes'
    }
  };
  config.game.experiments.numTrials = {
    '1P1G': 1,
    '1P2G': 1,
    '2P2G': 1,
    '2P3G': 1
  };
  config.game.fullscreen.defaultEnabled = false;
  config.game.timing.waitingForPartnerMinDuration = 0;
  config.multiplayer.allowWaitingSkip = true;
  config.multiplayer.waitingSkipKey = 'Enter';
  config.multiplayer.matchPool = TEST_HUMAN_HUMAN_STUDY_ID;

  return config;
}

/** Direct, one-trial Human–VLM 2P3G QA preset; never use as formal data. */
export function applyDirectHumanVlm2P3GTest(config) {
  if (!config) return config;

  config.study = {
    id: DIRECT_HUMAN_VLM_2P3G_TEST_ID,
    formal: false,
    test: true,
    assignedCondition: 'human-vlm-direct-test',
    promptVersion: 'vlm-human-visible-v3',
    fallback: {
      trigger: 'direct-test-assignment',
      agentType: 'vlm',
      profile: FORMAL_HUMAN_HUMAN_FALLBACK_PROFILE,
      model: 'gpt-5.6-luna',
      serviceTier: 'fast',
      reasoningEffort: 'none'
    }
  };
  config.game.players.player1.type = 'human';
  config.game.players.player2.type = 'vlm';
  config.game.experiments.order = ['2P3G'];
  config.game.experiments.numTrials = { ...config.game.experiments.numTrials, '2P3G': 1 };
  config.game.successThreshold.enabled = false;
  config.game.fullscreen.defaultEnabled = false;
  config.multiplayer.fallbackAIType = 'vlm';
  config.multiplayer.waitingMinigame = { enabled: false };
  config.game.agent.vlm = {
    ...config.game.agent.vlm,
    model: 'gpt-5.6-luna',
    profile: FORMAL_HUMAN_HUMAN_FALLBACK_PROFILE,
    serviceTier: 'fast',
    reasoningEffort: 'none',
    temperature: 0
  };

  return config;
}
