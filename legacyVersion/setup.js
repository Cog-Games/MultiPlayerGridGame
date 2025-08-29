const DIRECTIONS = {
  arrowleft: {
    code: 37,
    movement: [0,-1],
  },
  arrowup: {
    code: 38,
    movement: [-1,0],
  },
  arrowright: {
    code: 39,
    movement: [0,1],
  },
  arrowdown: {
    code: 40,
    movement: [1,0],
  }
};


const ACTIONSPACE = [[0,1],[0,-1],[1,0],[-1,0]];

const NOISEACTIONSPACE = [[0,1],[0,-1],[1,0],[-1,0]];

const EXPSETTINGS = {
  padding: 2,
  cellSize: 40,
  matrixsize: 15
  };

const WINSETTING = {
  w: (EXPSETTINGS.cellSize + EXPSETTINGS.padding) * EXPSETTINGS.matrixsize + EXPSETTINGS.padding,
  h: (EXPSETTINGS.cellSize + EXPSETTINGS.padding) * EXPSETTINGS.matrixsize + EXPSETTINGS.padding

}

const COLORPOOL = {
  map: "white",
  line: "grey",
  obstacle: "black",
  player: "red",
  goal: "blue",
  fixation: "black"

}
const OBJECT = {
  blank: 0,
  obstacle: 1,
  player: 2,
  ai_player: 3,
  goal: 9
}

// Responsive sizing: make cellSize/grid scale with window size
function recalcResponsiveGridSize() {
  try {
    var gridCellsPerSide = EXPSETTINGS.matrixsize;
    var pad = EXPSETTINGS.padding;

    // Safety margins so canvas doesn't touch window edges or overlays
    var horizontalMargin = 40; // px
    var verticalMargin = 40;   // px

    // Compute the maximum canvas size that fits in the window
    var maxCanvasWidth = Math.max(200, (window.innerWidth || document.documentElement.clientWidth || 800) - horizontalMargin);
    var maxCanvasHeight = Math.max(200, (window.innerHeight || document.documentElement.clientHeight || 600) - verticalMargin);

    // Invert: canvasSize = (cell + pad) * N + pad => cell = (canvasSize - pad)/N - pad
    var cellFromWidth = Math.floor(((maxCanvasWidth - pad) / gridCellsPerSide) - pad);
    var cellFromHeight = Math.floor(((maxCanvasHeight - pad) / gridCellsPerSide) - pad);

    // Choose the limiting dimension and clamp to a sensible range
    var newCellSize = Math.min(cellFromWidth, cellFromHeight);
    var MIN_CELL_SIZE = 30; // ensure visible on tiny windows
    var MAX_CELL_SIZE = 40; // avoid excessively large cells on huge screens
    newCellSize = Math.max(MIN_CELL_SIZE, Math.min(MAX_CELL_SIZE, newCellSize));

    // If calculation failed, keep previous cell size
    if (!isFinite(newCellSize) || newCellSize <= 0) return;

    // Update globals used by rendering code
    EXPSETTINGS.cellSize = newCellSize;
    WINSETTING.w = (EXPSETTINGS.cellSize + pad) * gridCellsPerSide + pad;
    WINSETTING.h = (EXPSETTINGS.cellSize + pad) * gridCellsPerSide + pad;

    // If a canvas already exists, resize and request a redraw
    var canvas = document.getElementById('gameCanvas') || document.querySelector('canvas');
    if (canvas) {
      canvas.width = WINSETTING.w;
      canvas.height = WINSETTING.h;

      // Trigger whichever redraw function is available
      if (typeof window.nodeGameUpdateGameDisplay === 'function' && window.gameData) {
        window.nodeGameUpdateGameDisplay();
      } else if (typeof window.updateGameDisplay === 'function') {
        window.updateGameDisplay();
      } else if (typeof window.drawGrid === 'function') {
        window.drawGrid(canvas, window.gameData ? window.gameData.currentGoals : null);
      }
    }
  } catch (e) {
    // Fail silently to avoid breaking experiment flow
    // console.warn('Responsive grid sizing error:', e);
  }
}

// Initialize responsive sizing immediately (in case this file loads before others)
recalcResponsiveGridSize();

// Also recalc after DOM is ready and on window resize
if (typeof window !== 'undefined') {
  window.addEventListener('DOMContentLoaded', recalcResponsiveGridSize);
  window.addEventListener('resize', recalcResponsiveGridSize);
}
