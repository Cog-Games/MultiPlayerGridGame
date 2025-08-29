var ifPlayerShowInFixation = false;
var ifGoalShowInFixation = false;
var ifObstacleShowInFixation = false;
var ifAIShowInFixation = false;

function getCenter(w, h) {
    return {
        x: window.innerWidth / 2 - w / 2 + "px",
        y: window.innerHeight / 2 - h / 2 + "px"
    };
}

function drawGrid(c, currentGoals = null){
    var context = c.getContext("2d");
    c.width = WINSETTING.w;
    c.height = WINSETTING.h;

    c.style.marginLeft = 0;
    c.style.marginTop = 0;

    context.fillStyle = COLORPOOL.line;
    context.fillRect(0 - EXPSETTINGS.padding,
        0 - EXPSETTINGS.padding,
        WINSETTING.w + EXPSETTINGS.padding, WINSETTING.h + EXPSETTINGS.padding);

    // Get current player positions (if available)
    let player1Pos = null;
    let player2Pos = null;

    // Try to get positions from global variables if they exist
    if (typeof player1 !== 'undefined') {
        player1Pos = player1;
    }
    if (typeof player2 !== 'undefined') {
        player2Pos = player2;
    }

    // First pass: draw everything except goals and players
    for (let row = 0; row < gridMatrixList.length; row++) {
        for (let col = 0; col < gridMatrixList.length; col++) {
            const cellVal = gridMatrixList[row][col];
            let color = "#111";

            switch(cellVal) {
                case OBJECT.obstacle:
                    color = COLORPOOL.obstacle;
                    break;
                case OBJECT.goal:
                    // Skip goals in first pass
                    continue;
                default:
                    color = COLORPOOL.map;
            }

            // Draw squares for obstacles, skip players for now
            if (cellVal !== OBJECT.player && cellVal !== OBJECT.ai_player) {
                context.fillStyle = color;
                context.fillRect(col * (EXPSETTINGS.cellSize + EXPSETTINGS.padding) + EXPSETTINGS.padding,
                    row * (EXPSETTINGS.cellSize + EXPSETTINGS.padding) + EXPSETTINGS.padding,
                    EXPSETTINGS.cellSize, EXPSETTINGS.cellSize);
            }
        }
    }

    // Second pass: draw players with overlap detection
    if (player1Pos && player2Pos) {
        // Check if players are in the same position
        if (player1Pos[0] === player2Pos[0] && player1Pos[1] === player2Pos[1]) {
            // Draw overlapping circles
            drawOverlappingCircles(context, player1Pos[1], player1Pos[0]);
        } else {
            // Draw separate circles
            drawCircle(context, COLORPOOL.player, 1/3 * EXPSETTINGS.padding,
                player1Pos[1], player1Pos[0], 0, 2 * Math.PI);
            drawCircle(context, "orange", 1/3 * EXPSETTINGS.padding,
                player2Pos[1], player2Pos[0], 0, 2 * Math.PI);
        }
        } else if (player1Pos && !player2Pos) {
        // Single player case (1P1G, 1P2G) - draw player normally
        // Goals will be drawn in the third pass as background squares
        drawCircle(context, COLORPOOL.player, 1/3 * EXPSETTINGS.padding,
            player1Pos[1], player1Pos[0], 0, 2 * Math.PI);
    } else {
        // Fallback to original method if positions not available
        for (let row = 0; row < gridMatrixList.length; row++) {
            for (let col = 0; col < gridMatrixList.length; col++) {
                const cellVal = gridMatrixList[row][col];
                if (cellVal === OBJECT.player) {
                    drawCircle(context, COLORPOOL.player, 1/3 * EXPSETTINGS.padding,
                        col, row, 0, 2 * Math.PI);
                } else if (cellVal === OBJECT.ai_player) {
                    drawCircle(context, "orange", 1/3 * EXPSETTINGS.padding,
                        col, row, 0, 2 * Math.PI);
                }
            }
        }
    }

    // Second pass: draw goals on top (always visible)
    for (let row = 0; row < gridMatrixList.length; row++) {
        for (let col = 0; col < gridMatrixList.length; col++) {
            const cellVal = gridMatrixList[row][col];

            if (cellVal === OBJECT.goal) {
                // Draw goal as a semi-transparent overlay
                context.fillStyle = COLORPOOL.goal;
                context.globalAlpha = 0.7; // Make it semi-transparent
                context.fillRect(col * (EXPSETTINGS.cellSize + EXPSETTINGS.padding) + EXPSETTINGS.padding,
                    row * (EXPSETTINGS.cellSize + EXPSETTINGS.padding) + EXPSETTINGS.padding,
                    EXPSETTINGS.cellSize, EXPSETTINGS.cellSize);
                context.globalAlpha = 1.0; // Reset transparency
            }
        }
    }

    // Third pass: ALWAYS draw goals at their intended positions (always visible)
    // This ensures goals are always shown even if they were overwritten in the matrix
    if (currentGoals && Array.isArray(currentGoals) && currentGoals.length >= 1) {
        context.fillStyle = COLORPOOL.goal;
        context.globalAlpha = 0.5; // Make it more transparent for overlay

        // Draw all goals (supports 1, 2, or 3 goals)
        for (let i = 0; i < currentGoals.length; i++) {
            if (currentGoals[i] && Array.isArray(currentGoals[i]) && currentGoals[i].length >= 2) {
                context.fillRect(currentGoals[i][1] * (EXPSETTINGS.cellSize + EXPSETTINGS.padding) + EXPSETTINGS.padding,
                    currentGoals[i][0] * (EXPSETTINGS.cellSize + EXPSETTINGS.padding) + EXPSETTINGS.padding,
                    EXPSETTINGS.cellSize, EXPSETTINGS.cellSize);
            }
        }

        context.globalAlpha = 1.0; // Reset transparency
    }
}

function drawCircle(c, color, lineWidth, colPos, rowPos, startAngle, tmpAngle) {
    // First draw white background
    c.fillStyle = COLORPOOL.map;
    c.fillRect(colPos * (EXPSETTINGS.cellSize + EXPSETTINGS.padding) + EXPSETTINGS.padding,
        rowPos * (EXPSETTINGS.cellSize + EXPSETTINGS.padding) + EXPSETTINGS.padding,
        EXPSETTINGS.cellSize, EXPSETTINGS.cellSize);

    const circleRadius = EXPSETTINGS.cellSize * 0.4; // Make circles 30% of cell size

    // Then draw circle
    c.beginPath();
    c.lineWidth = lineWidth;
    c.strokeStyle = color;
    c.fillStyle = color;
    c.arc(colPos * (EXPSETTINGS.cellSize + EXPSETTINGS.padding) + EXPSETTINGS.padding + EXPSETTINGS.cellSize/2,
        rowPos * (EXPSETTINGS.cellSize + EXPSETTINGS.padding) + EXPSETTINGS.padding + EXPSETTINGS.cellSize/2,
        circleRadius,
        startAngle, tmpAngle);
    c.fill();
    c.stroke();
}

function drawOverlappingCircles(c, colPos, rowPos) {
    // First draw white background
    c.fillStyle = COLORPOOL.map;
    c.fillRect(colPos * (EXPSETTINGS.cellSize + EXPSETTINGS.padding) + EXPSETTINGS.padding,
        rowPos * (EXPSETTINGS.cellSize + EXPSETTINGS.padding) + EXPSETTINGS.padding,
        EXPSETTINGS.cellSize, EXPSETTINGS.cellSize);

    const circleRadius = EXPSETTINGS.cellSize * 0.35; // Slightly smaller for overlap
    const centerX = colPos * (EXPSETTINGS.cellSize + EXPSETTINGS.padding) + EXPSETTINGS.padding + EXPSETTINGS.cellSize/2;
    const centerY = rowPos * (EXPSETTINGS.cellSize + EXPSETTINGS.padding) + EXPSETTINGS.padding + EXPSETTINGS.cellSize/2;
    const offset = EXPSETTINGS.cellSize * 0.15; // Offset for overlap

    // Draw player1 circle (red) on the left
    c.beginPath();
    c.lineWidth = 1/3 * EXPSETTINGS.padding;
    c.strokeStyle = COLORPOOL.player;
    c.fillStyle = COLORPOOL.player;
    c.arc(centerX - offset, centerY, circleRadius, 0, 2 * Math.PI);
    c.fill();
    c.stroke();

    // Draw player2 circle (orange) on the right
    c.beginPath();
    c.strokeStyle = "orange";
    c.fillStyle = "orange";
    c.arc(centerX + offset, centerY, circleRadius, 0, 2 * Math.PI);
    c.fill();
    c.stroke();
}



function fixation(c) {
    var context = c.getContext("2d");
    c.width = WINSETTING.w;
    c.height = WINSETTING.h;

    c.style.marginLeft = 0;
    c.style.marginTop = 0;

    context.fillStyle = COLORPOOL.line;
    context.fillRect(0 - EXPSETTINGS.padding,
        0 - EXPSETTINGS.padding,
        WINSETTING.w + EXPSETTINGS.padding, WINSETTING.h + EXPSETTINGS.padding);

    for (let row = 0; row < gridMatrixList.length; row++) {
        for (let col = 0; col < gridMatrixList.length; col++) {
            const cellVal = gridMatrixList[row][col];
            let color = "#111";
            let shouldShow = false;

            switch(cellVal) {
                case OBJECT.obstacle:
                    color = COLORPOOL.obstacle;
                    shouldShow = ifObstacleShowInFixation;
                    break;
                case OBJECT.player:
                    color = COLORPOOL.player;
                    shouldShow = ifPlayerShowInFixation;
                    break;
                case OBJECT.ai_player:
                    color = COLORPOOL.ai_player;
                    shouldShow = ifAIShowInFixation;
                    break;
                case OBJECT.goal:
                    color = COLORPOOL.goal;
                    shouldShow = ifGoalShowInFixation;
                    break;
                default:
                    color = COLORPOOL.map;
                    shouldShow = true;
            }

            if (!shouldShow) {
                color = COLORPOOL.map;
            }

            if (shouldShow && cellVal === OBJECT.goal) {
                context.fillStyle = color;
                context.fillRect(col * (EXPSETTINGS.cellSize + EXPSETTINGS.padding) + EXPSETTINGS.padding,
                    row * (EXPSETTINGS.cellSize + EXPSETTINGS.padding) + EXPSETTINGS.padding,
                    EXPSETTINGS.cellSize, EXPSETTINGS.cellSize);
            } else if (shouldShow && (cellVal === OBJECT.player || cellVal === OBJECT.ai_player)) {
                drawCircle(context, color, 1/3 * EXPSETTINGS.padding,
                    col, row, 0, 2 * Math.PI);
            } else {
                context.fillStyle = color;
                context.fillRect(col * (EXPSETTINGS.cellSize + EXPSETTINGS.padding) + EXPSETTINGS.padding,
                    row * (EXPSETTINGS.cellSize + EXPSETTINGS.padding) + EXPSETTINGS.padding,
                    EXPSETTINGS.cellSize, EXPSETTINGS.cellSize);
            }
        }
    }
    drawFixation(context, [Math.floor(EXPSETTINGS.matrixsize/2), Math.floor(EXPSETTINGS.matrixsize/2)], 1/5, 2 * EXPSETTINGS.padding);
}

function drawFixation(c, fixationPos, posScale, lineWidth) {
    let col = fixationPos[1];
    let row = fixationPos[0];
    c.lineWidth = lineWidth;
    c.strokeStyle = COLORPOOL.fixation;

    c.beginPath();
    // Horizontal line
    c.moveTo(col * (EXPSETTINGS.cellSize + EXPSETTINGS.padding) + EXPSETTINGS.padding + posScale * EXPSETTINGS.cellSize,
        row * (EXPSETTINGS.cellSize + EXPSETTINGS.padding) + EXPSETTINGS.padding + 1/2 * EXPSETTINGS.cellSize);
    c.lineTo(col * (EXPSETTINGS.cellSize + EXPSETTINGS.padding) + EXPSETTINGS.padding + (1-posScale) * EXPSETTINGS.cellSize,
        row * (EXPSETTINGS.cellSize + EXPSETTINGS.padding) + EXPSETTINGS.padding + 1/2 * EXPSETTINGS.cellSize);

    // Vertical line
    c.moveTo(col * (EXPSETTINGS.cellSize + EXPSETTINGS.padding) + 1/2 * EXPSETTINGS.cellSize + EXPSETTINGS.padding,
        row * (EXPSETTINGS.cellSize + EXPSETTINGS.padding) + posScale * EXPSETTINGS.cellSize + EXPSETTINGS.padding);
    c.lineTo(col * (EXPSETTINGS.cellSize + EXPSETTINGS.padding) + 1/2 * EXPSETTINGS.cellSize + EXPSETTINGS.padding,
        row * (EXPSETTINGS.cellSize + EXPSETTINGS.padding) + (1-posScale) * EXPSETTINGS.cellSize + EXPSETTINGS.padding);
    c.stroke();
}

// =================================================================================================
// Additional Drawing Functions (moved from nodeGameExperiments.js)
// =================================================================================================

/**
 * Update game display using current game data
 */
function updateGameDisplay() {
    if (typeof drawGrid === 'function') {
        // Set global variables that drawGrid expects
        window.gridMatrixList = window.gameData ? window.gameData.gridMatrix : [];
        window.player1 = window.gameData ? window.gameData.player1 : null;
        window.player2 = window.gameData ? window.gameData.player2 : null;

        var canvas = document.querySelector('canvas') || createGameCanvas();
        var currentGoals = window.gameData ? window.gameData.currentGoals : null;
        drawGrid(canvas, currentGoals);
    }
}

/**
 * Create game canvas if it doesn't exist
 */
function createGameCanvas() {
    var canvas = document.createElement('canvas');
    canvas.id = 'gameCanvas'; // Set the ID so it can be found later
    canvas.width = WINSETTING.w;
    canvas.height = WINSETTING.h;
    canvas.style.border = '2px solid #333';
    canvas.style.display = 'block';
    canvas.style.margin = '20px auto';

    var container = document.getElementById('container') || document.body;
    container.appendChild(canvas);

    return canvas;
}

/**
 * Draw fixation display (matching testExpWithAI.js)
 */
function drawFixationDisplay(canvas) {
    var context = canvas.getContext("2d");
    canvas.width = WINSETTING.w;
    canvas.height = WINSETTING.h;

    canvas.style.marginLeft = 0;
    canvas.style.marginTop = 0;

    // Draw background
    context.fillStyle = COLORPOOL.line;
    context.fillRect(0 - EXPSETTINGS.padding,
        0 - EXPSETTINGS.padding,
        WINSETTING.w + EXPSETTINGS.padding, WINSETTING.h + EXPSETTINGS.padding);

    // Draw empty grid (all cells as map color)
    var gridSize = window.gameData ? window.gameData.gridMatrix.length : EXPSETTINGS.matrixsize;
    for (let row = 0; row < gridSize; row++) {
        for (let col = 0; col < gridSize; col++) {
            context.fillStyle = COLORPOOL.map;
            context.fillRect(col * (EXPSETTINGS.cellSize + EXPSETTINGS.padding) + EXPSETTINGS.padding,
                row * (EXPSETTINGS.cellSize + EXPSETTINGS.padding) + EXPSETTINGS.padding,
                EXPSETTINGS.cellSize, EXPSETTINGS.cellSize);
        }
    }

    // Draw fixation cross in center
    drawFixationCross(context, [Math.floor(EXPSETTINGS.matrixsize/2), Math.floor(EXPSETTINGS.matrixsize/2)], 1/5, 2 * EXPSETTINGS.padding);
}

/**
 * Draw fixation cross in center (alias for drawFixation with different parameter name)
 */
function drawFixationCross(context, fixationPos, posScale, lineWidth) {
    // This is the same as drawFixation but with 'context' parameter name
    drawFixation(context, fixationPos, posScale, lineWidth);
}

// =================================================================================================
// nodeGame Drawing Functions (moved from nodeGameExperiments.js)
// =================================================================================================

/**
 * Update game display for nodeGame experiments
 */
function nodeGameUpdateGameDisplay() {
    if (typeof drawGrid === 'function') {
        // Set global variables that drawGrid expects
        window.gridMatrixList = gameData.gridMatrix;
        window.player1 = gameData.player1;
        window.player2 = gameData.player2;

        var canvas = document.querySelector('canvas') || nodeGameCreateGameCanvas();
        drawGrid(canvas, gameData.currentGoals);

        // Pre-calculate RL policy asynchronously after goal is visually presented
        if (window.RLAgent && window.RLAgent.precalculatePolicyForGoalsAsync && gameData.currentGoals && gameData.currentGoals.length > 0) {
            // Check if this is a new goal presentation (3 goals instead of 2) and hasn't been pre-calculated yet
            if (gameData.currentGoals.length === 3 && !window.newGoalPreCalculated) {
                // console.log('⚡ New goal visually rendered on map, starting async pre-calculation:', gameData.currentGoals);
                // Use async function to ensure goal is visible before pre-calculation starts
                // This prevents lag in goal presentation while still pre-calculating for faster AI response
                window.RLAgent.precalculatePolicyForGoalsAsync(gameData.currentGoals, (success) => {
                    if (success) {
                        window.newGoalPreCalculated = true; // Mark as pre-calculated
                        // console.log('✅ Background pre-calculation completed - AI ready to act');
                    } else {
                        // console.warn('⚠️ Background pre-calculation failed');
                    }
                }, gameData.currentExperiment);
            }
        }
    }
}

/**
 * Create game canvas for nodeGame experiments
 */
function nodeGameCreateGameCanvas() {
    var canvas = document.createElement('canvas');
    canvas.id = 'gameCanvas'; // Set the ID so it can be found later
    canvas.width = WINSETTING.w;
    canvas.height = WINSETTING.h;
    canvas.style.border = '2px solid #333';
    canvas.style.display = 'block';
    canvas.style.margin = '20px auto';

    var container = document.getElementById('container') || document.body;
    container.appendChild(canvas);

    return canvas;
}

/**
 * Draw fixation display for nodeGame experiments (matching testExpWithAI.js)
 */
function nodeGameDrawFixationDisplay(canvas) {
    var context = canvas.getContext("2d");
    canvas.width = WINSETTING.w;
    canvas.height = WINSETTING.h;

    canvas.style.marginLeft = 0;
    canvas.style.marginTop = 0;

    // Draw background
    context.fillStyle = COLORPOOL.line;
    context.fillRect(0 - EXPSETTINGS.padding,
        0 - EXPSETTINGS.padding,
        WINSETTING.w + EXPSETTINGS.padding, WINSETTING.h + EXPSETTINGS.padding);

    // Draw empty grid (all cells as map color)
    for (let row = 0; row < gameData.gridMatrix.length; row++) {
        for (let col = 0; col < gameData.gridMatrix.length; col++) {
            context.fillStyle = COLORPOOL.map;
            context.fillRect(col * (EXPSETTINGS.cellSize + EXPSETTINGS.padding) + EXPSETTINGS.padding,
                row * (EXPSETTINGS.cellSize + EXPSETTINGS.padding) + EXPSETTINGS.padding,
                EXPSETTINGS.cellSize, EXPSETTINGS.cellSize);
        }
    }

    // Draw fixation cross in center
    nodeGameDrawFixationCross(context, [Math.floor(EXPSETTINGS.matrixsize/2), Math.floor(EXPSETTINGS.matrixsize/2)], 1/5, 2 * EXPSETTINGS.padding);
}

/**
 * Draw circle for players in fixation (nodeGame version)
 */
function nodeGameDrawCircle(context, color, lineWidth, colPos, rowPos, startAngle, tmpAngle) {
    // First draw white background
    context.fillStyle = COLORPOOL.map;
    context.fillRect(colPos * (EXPSETTINGS.cellSize + EXPSETTINGS.padding) + EXPSETTINGS.padding,
        rowPos * (EXPSETTINGS.cellSize + EXPSETTINGS.padding) + EXPSETTINGS.padding,
        EXPSETTINGS.cellSize, EXPSETTINGS.cellSize);

    const circleRadius = EXPSETTINGS.cellSize * 0.4;

    // Then draw circle
    context.beginPath();
    context.lineWidth = lineWidth;
    context.strokeStyle = color;
    context.fillStyle = color;
    context.arc(colPos * (EXPSETTINGS.cellSize + EXPSETTINGS.padding) + EXPSETTINGS.padding + EXPSETTINGS.cellSize/2,
        rowPos * (EXPSETTINGS.cellSize + EXPSETTINGS.padding) + EXPSETTINGS.padding + EXPSETTINGS.cellSize/2,
        circleRadius,
        startAngle, tmpAngle);
    context.fill();
    context.stroke();
}


/**
 * Create game canvas
 */
function createGameCanvas() {
    // Use the exact same parameters as the human-AI version
    const canvas = document.createElement('canvas');
    canvas.id = 'gameCanvas';

    // Use WINSETTING dimensions like human-AI version
    canvas.width = WINSETTING.w;
    canvas.height = WINSETTING.h;

    canvas.style.border = '2px solid #333';
    canvas.style.display = 'block';
    canvas.style.margin = '0 auto';
    canvas.style.marginLeft = 0;
    canvas.style.marginTop = 0;

    console.log('Created canvas with ID:', canvas.id, 'Size:', canvas.width, 'x', canvas.height);
    return canvas;
}

// =================================================================================================
// Human-Human Version Drawing Functions
// =================================================================================================


/**
 * Draw fixation display matching exact human-AI version parameters
 */
function drawFixationDisplayHumanHuman(canvas) {
    const context = canvas.getContext("2d");
    canvas.width = WINSETTING.w;
    canvas.height = WINSETTING.h;

    canvas.style.marginLeft = 0;
    canvas.style.marginTop = 0;

    // Draw background using COLORPOOL.line like human-AI version
    context.fillStyle = COLORPOOL.line;
    context.fillRect(0 - EXPSETTINGS.padding,
        0 - EXPSETTINGS.padding,
        WINSETTING.w + EXPSETTINGS.padding,
        WINSETTING.h + EXPSETTINGS.padding);

    // Draw empty grid (all cells as map color) like human-AI version
    for (let row = 0; row < EXPSETTINGS.matrixsize; row++) {
        for (let col = 0; col < EXPSETTINGS.matrixsize; col++) {
            context.fillStyle = COLORPOOL.map;
            context.fillRect(col * (EXPSETTINGS.cellSize + EXPSETTINGS.padding) + EXPSETTINGS.padding,
                row * (EXPSETTINGS.cellSize + EXPSETTINGS.padding) + EXPSETTINGS.padding,
                EXPSETTINGS.cellSize, EXPSETTINGS.cellSize);
        }
    }

    // Draw fixation cross in center like human-AI version
    drawFixationCrossHumanHuman(context, [Math.floor(EXPSETTINGS.matrixsize / 2), Math.floor(EXPSETTINGS.matrixsize / 2)], 1 / 5, 2 * EXPSETTINGS.padding);
}

/**
 * Draw fixation cross matching exact human-AI version parameters
 */
function drawFixationCrossHumanHuman(context, fixationPos, posScale, lineWidth) {
    let col = fixationPos[1];
    let row = fixationPos[0];
    context.lineWidth = lineWidth;
    context.strokeStyle = COLORPOOL.fixation;

    context.beginPath();
    // Horizontal line
    context.moveTo(col * (EXPSETTINGS.cellSize + EXPSETTINGS.padding) + EXPSETTINGS.padding + posScale * EXPSETTINGS.cellSize,
        row * (EXPSETTINGS.cellSize + EXPSETTINGS.padding) + EXPSETTINGS.padding + 1 / 2 * EXPSETTINGS.cellSize);
    context.lineTo(col * (EXPSETTINGS.cellSize + EXPSETTINGS.padding) + EXPSETTINGS.padding + (1 - posScale) * EXPSETTINGS.cellSize,
        row * (EXPSETTINGS.cellSize + EXPSETTINGS.padding) + EXPSETTINGS.padding + 1 / 2 * EXPSETTINGS.cellSize);

    // Vertical line
    context.moveTo(col * (EXPSETTINGS.cellSize + EXPSETTINGS.padding) + 1 / 2 * EXPSETTINGS.cellSize + EXPSETTINGS.padding,
        row * (EXPSETTINGS.cellSize + EXPSETTINGS.padding) + posScale * EXPSETTINGS.cellSize + EXPSETTINGS.padding);
    context.lineTo(col * (EXPSETTINGS.cellSize + EXPSETTINGS.padding) + 1 / 2 * EXPSETTINGS.cellSize + EXPSETTINGS.padding,
        row * (EXPSETTINGS.cellSize + EXPSETTINGS.padding) + (1 - posScale) * EXPSETTINGS.cellSize + EXPSETTINGS.padding);
    context.stroke();
}



/**
 * Draw fixation cross in center (nodeGame version)
 */
function nodeGameDrawFixationCross(context, fixationPos, posScale, lineWidth) {
    let col = fixationPos[1];
    let row = fixationPos[0];
    context.lineWidth = lineWidth;
    context.strokeStyle = COLORPOOL.fixation;

    context.beginPath();
    // Horizontal line
    context.moveTo(col * (EXPSETTINGS.cellSize + EXPSETTINGS.padding) + EXPSETTINGS.padding + posScale * EXPSETTINGS.cellSize,
        row * (EXPSETTINGS.cellSize + EXPSETTINGS.padding) + EXPSETTINGS.padding + 1/2 * EXPSETTINGS.cellSize);
    context.lineTo(col * (EXPSETTINGS.cellSize + EXPSETTINGS.padding) + EXPSETTINGS.padding + (1-posScale) * EXPSETTINGS.cellSize,
        row * (EXPSETTINGS.cellSize + EXPSETTINGS.padding) + EXPSETTINGS.padding + 1/2 * EXPSETTINGS.cellSize);

    // Vertical line
    context.moveTo(col * (EXPSETTINGS.cellSize + EXPSETTINGS.padding) + 1/2 * EXPSETTINGS.cellSize + EXPSETTINGS.padding,
        row * (EXPSETTINGS.cellSize + EXPSETTINGS.padding) + posScale * EXPSETTINGS.cellSize + EXPSETTINGS.padding);
    context.lineTo(col * (EXPSETTINGS.cellSize + EXPSETTINGS.padding) + 1/2 * EXPSETTINGS.cellSize + EXPSETTINGS.padding,
        row * (EXPSETTINGS.cellSize + EXPSETTINGS.padding) + (1-posScale) * EXPSETTINGS.cellSize + EXPSETTINGS.padding);
    context.stroke();
}


/**
 * Draw a circle for human-human visualization
 */
function drawCircleHumanHuman(ctx, color, lineWidth, colPos, rowPos, startAngle, endAngle) {
    const centerX = colPos * (EXPSETTINGS.cellSize + EXPSETTINGS.padding) + EXPSETTINGS.padding + EXPSETTINGS.cellSize / 2;
    const centerY = rowPos * (EXPSETTINGS.cellSize + EXPSETTINGS.padding) + EXPSETTINGS.padding + EXPSETTINGS.cellSize / 2;
    const radius = EXPSETTINGS.cellSize * 0.4; // Adjust size as needed

    ctx.beginPath();
    ctx.lineWidth = lineWidth;
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.arc(centerX, centerY, radius, startAngle, endAngle);
    ctx.fill();
    ctx.stroke();
}

/**
 * Draw overlapping circles for when players are in the same position
 */
function drawOverlappingCirclesHumanHuman(ctx, colPos, rowPos) {
    // First draw white background
    ctx.fillStyle = COLORPOOL.map;
    ctx.fillRect(colPos * (EXPSETTINGS.cellSize + EXPSETTINGS.padding) + EXPSETTINGS.padding,
        rowPos * (EXPSETTINGS.cellSize + EXPSETTINGS.padding) + EXPSETTINGS.padding,
        EXPSETTINGS.cellSize, EXPSETTINGS.cellSize);

    const circleRadius = EXPSETTINGS.cellSize * 0.35; // Slightly smaller for overlap
    const centerX = colPos * (EXPSETTINGS.cellSize + EXPSETTINGS.padding) + EXPSETTINGS.padding + EXPSETTINGS.cellSize / 2;
    const centerY = rowPos * (EXPSETTINGS.cellSize + EXPSETTINGS.padding) + EXPSETTINGS.padding + EXPSETTINGS.cellSize / 2;
    const offset = EXPSETTINGS.cellSize * 0.15; // Offset for overlap

    // Determine colors based on player order (with fallback)
    const playerOrder = window.playerOrder || { isFirstPlayer: true }; // Fallback to first player
    let firstColor, secondColor;

    if (playerOrder.isFirstPlayer) {
        // I am the first player (red), partner is second (orange)
        firstColor = COLORPOOL.player; // red
        secondColor = "orange";
    } else {
        // I am the second player (orange), partner is first (red)
        firstColor = "orange";
        secondColor = COLORPOOL.player; // red
    }

    // Draw first player circle on the left
    ctx.beginPath();
    ctx.lineWidth = 1 / 3 * EXPSETTINGS.padding;
    ctx.strokeStyle = firstColor;
    ctx.fillStyle = firstColor;
    ctx.arc(centerX - offset, centerY, circleRadius, 0, 2 * Math.PI);
    ctx.fill();
    ctx.stroke();

    // Draw second player circle on the right
    ctx.beginPath();
    ctx.strokeStyle = secondColor;
    ctx.fillStyle = secondColor;
    ctx.arc(centerX + offset, centerY, circleRadius, 0, 2 * Math.PI);
    ctx.fill();
    ctx.stroke();
}

// Make visualization functions globally accessible
window.createGameCanvas = createGameCanvas;
window.nodeGameCreateGameCanvas = nodeGameCreateGameCanvas;
window.drawGrid = drawGrid;
window.updateGameDisplay = updateGameDisplay;
window.nodeGameUpdateGameDisplay = nodeGameUpdateGameDisplay;
