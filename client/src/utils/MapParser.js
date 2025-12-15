
/**
 * Utility to parse ASCII map representations into coordinate-based game design objects.
 *
 * Mapping:
 *  . or ' ' : Empty/Path
 *  #        : Obstacle
 *  1        : Player 1 Start
 *  2        : Player 2 Start
 *  s or *   : Small Goal
 *  B or G   : Big Joint Goal
 */
export const MapParser = {
  parseAsciiMap(asciiGrid) {
    if (!Array.isArray(asciiGrid)) {
      console.error('Invalid ASCII map: must be an array of strings');
      return null;
    }

    const design = {
      initPlayerGrid: null,
      initAIGrid: null,
      smallGoals: [],
      bigGoals: [],
      obstacles: []
      // mapType removed to avoid overwriting existing configuration
    };

    for (let r = 0; r < asciiGrid.length; r++) {
      const rowStr = asciiGrid[r];
      for (let c = 0; c < rowStr.length; c++) {
        const char = rowStr[c];
        const pos = [r, c];

        switch (char) {
          case '#':
            design.obstacles.push(pos);
            break;
          case '1':
            design.initPlayerGrid = pos;
            break;
          case '2':
            design.initAIGrid = pos;
            break;
          case 's':
          case '*':
            design.smallGoals.push(pos);
            break;
          case 'B':
          case 'G':
            design.bigGoals.push(pos);
            break;
          case '.':
          case ' ':
          default:
            // Empty space
            break;
        }
      }
    }

    // Backwards compatibility: populate target1/target2 if small goals exist
    if (design.smallGoals.length >= 1) design.target1 = design.smallGoals[0];
    if (design.smallGoals.length >= 2) design.target2 = design.smallGoals[1];

    return design;
  },

  /**
   * Rotates the ASCII grid 90 degrees clockwise.
   * @param {string[]} grid - Array of strings representing the map
   * @returns {string[]} - Rotated grid
   */
  rotate90(grid) {
    if (!grid || grid.length === 0) return grid;
    const N = grid.length;
    const M = grid[0].length;
    // Create new grid with dimensions M x N
    const newGrid = new Array(M).fill('').map(() => new Array(N).fill(''));

    for (let r = 0; r < N; r++) {
      const rowStr = grid[r];
      for (let c = 0; c < M; c++) {
        // rotate 90 deg clockwise: (r, c) -> (c, N-1-r)
        // newGrid row index is c
        // newGrid col index is N-1-r
        newGrid[c][N - 1 - r] = rowStr[c] || ' '; // handle potentially missing chars
      }
    }
    return newGrid.map(row => row.join(''));
  },

  /**
   * Mirrors the ASCII grid horizontally (left <-> right).
   * @param {string[]} grid
   * @returns {string[]}
   */
  mirror(grid) {
    if (!grid) return grid;
    return grid.map(row => row.split('').reverse().join(''));
  },

  /**
   * Applies random rotation and mirroring to the grid.
   * @param {string[]} grid
   * @returns {string[]}
   */
  transformRandomly(grid) {
    if (!grid) return grid;
    let current = [...grid];

    // Random rotation: 0, 90, 180, 270
    const rotations = Math.floor(Math.random() * 4);
    for (let i = 0; i < rotations; i++) {
      current = this.rotate90(current);
    }

    // Random mirror: 50% chance
    if (Math.random() < 0.5) {
      current = this.mirror(current);
    }

    return current;
  }
};
