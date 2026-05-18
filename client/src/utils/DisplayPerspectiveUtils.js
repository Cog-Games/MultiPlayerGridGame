import { CONFIG, GAME_OBJECTS } from '../config/gameConfig.js';

export function isHumanHumanDisplayPerspective(gameMode) {
  return gameMode === 'human-human';
}

export function getCanonicalPlayerIndexFromObjectType(objectType) {
  return objectType === GAME_OBJECTS.ai_player ? 1 : 0;
}

export function getPlayerDisplayColor(objectType, viewerPlayerIndex = 0, gameMode = 'human-ai') {
  const canonicalPlayerIndex = getCanonicalPlayerIndexFromObjectType(objectType);

  if (isHumanHumanDisplayPerspective(gameMode)) {
    return canonicalPlayerIndex === viewerPlayerIndex
      ? CONFIG.visual.colors.player1
      : CONFIG.visual.colors.player2;
  }

  return canonicalPlayerIndex === 0
    ? CONFIG.visual.colors.player1
    : CONFIG.visual.colors.player2;
}

export function getPlayerDisplayInfo(playerIndex = 0, gameMode = 'human-ai') {
  if (isHumanHumanDisplayPerspective(gameMode)) {
    return {
      displayPerspectiveEnabled: true,
      displaySelfColor: 'red',
      displayPartnerColor: 'orange',
      canonicalPlayerIndex: Number.isInteger(playerIndex) ? playerIndex : null,
      selfColorValue: CONFIG.visual.colors.player1,
      partnerColorValue: CONFIG.visual.colors.player2,
      selfLabel: 'the red dot',
      partnerLabel: 'the orange dot',
      instructionText: 'You are the red dot. Your teammate is the orange dot.'
    };
  }

  const isPlayerTwo = playerIndex === 1;
  return {
    displayPerspectiveEnabled: false,
    displaySelfColor: isPlayerTwo ? 'orange' : 'red',
    displayPartnerColor: isPlayerTwo ? 'red' : 'orange',
    canonicalPlayerIndex: Number.isInteger(playerIndex) ? playerIndex : null,
    selfColorValue: isPlayerTwo ? CONFIG.visual.colors.player2 : CONFIG.visual.colors.player1,
    partnerColorValue: isPlayerTwo ? CONFIG.visual.colors.player1 : CONFIG.visual.colors.player2,
    selfLabel: isPlayerTwo ? 'Player 2 (Orange)' : 'Player 1 (Red)',
    partnerLabel: isPlayerTwo ? 'Player 1 (Red)' : 'Player 2 (Orange)',
    instructionText: `You are ${isPlayerTwo ? 'Player 2 (Orange)' : 'Player 1 (Red)'}.`
  };
}
