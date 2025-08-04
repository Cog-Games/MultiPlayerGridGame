// Map loading and randomization utility based on legacy version
import { CONFIG } from '../config/gameConfig.js';

export class MapLoader {
  constructor() {
    this.mapData = null;
    this.initialize();
  }

  async initialize() {
    this.mapData = await this.loadMapData();
  }

    // Load map data from server API
  async loadMapData() {
    console.log('🗺️ Loading map data from server...');
    
    // Check if server is running first
    const serverRunning = await this.checkServerHealth();
    if (!serverRunning) {
      console.warn('⚠️ Game server not running - using fallback maps for all experiment types');
      console.log('💡 To get real maps and enable multiplayer, start the server with: npm run dev');
      return this.loadAllFallbackMaps();
    }
    
    const experimentTypes = ['1P1G', '1P2G', '2P2G', '2P3G'];
    const maps = {};
    
    for (const expType of experimentTypes) {
      try {
        console.log(`🌐 Fetching ${expType} maps from server...`);
        const response = await fetch(`/api/maps/${expType}`);
        
        if (response.ok) {
          const contentType = response.headers.get('content-type');
          if (contentType && contentType.includes('application/json')) {
            const data = await response.json();
            maps[expType] = data.maps;
            console.log(`✅ Loaded ${data.mapCount} ${expType} maps from server`);
          } else {
            throw new Error('Server returned non-JSON response (likely HTML error page)');
          }
        } else {
          console.warn(`⚠️ Server request failed for ${expType} (${response.status}), using fallback`);
          maps[expType] = this.getFallbackMaps(expType);
        }
      } catch (error) {
        if (error.message.includes('<!DOCTYPE')) {
          console.warn(`⚠️ Server not running or API not available for ${expType}, using fallback maps`);
        } else {
          console.warn(`⚠️ Failed to load ${expType} maps from server, using fallback:`, error.message);
        }
        maps[expType] = this.getFallbackMaps(expType);
      }
    }

    // Log summary of loaded maps
    for (const [expType, mapData] of Object.entries(maps)) {
      const mapCount = mapData ? Object.keys(mapData).length : 0;
      console.log(`🗺️ ${expType}: ${mapCount} maps loaded`);
    }

    return maps;
  }

  // Legacy loading methods removed - now using server API

  // Fallback generation methods
  generate1P1GMaps() {
    console.log('🔧 Generating fallback 1P1G maps...');
    const maps = {};
    // Generate 20 different 1P1G maps with some variety
    for (let i = 0; i < 20; i++) {
      // Add some variation to make maps more interesting
      const startRow = 7;
      const startCol = 1 + (i % 3);
      const goalRow = 2 + Math.floor(i / 4);
      const goalCol = 10 + (i % 5);
      
      maps[String(i)] = [{
        initPlayerGrid: [startRow, startCol],
        target1: [goalRow, goalCol],
        mapType: '1P1G'
      }];
    }
    console.log(`✅ Generated ${Object.keys(maps).length} fallback 1P1G maps`);
    return maps;
  }

  generate1P2GMaps() {
    const maps = {};
    // Generate 20 different 1P2G maps
    for (let i = 0; i < 20; i++) {
      maps[String(i)] = [{
        initPlayerGrid: [7, 1],
        target1: [3, 7],
        target2: [11, 7],
        mapType: '1P2G'
      }];
    }
    return maps;
  }

  generate2P2GMaps() {
    const maps = {};
    // Generate different 2P2G configurations (based on legacy patterns)
    const configurations = [
      { player1: [7, 2], player2: [7, 14], goal1: [1, 8], goal2: [14, 8] },
      { player1: [2, 7], player2: [14, 7], goal1: [8, 1], goal2: [8, 13] },
      { player1: [7, 1], player2: [7, 13], goal1: [3, 7], goal2: [11, 7] },
      { player1: [1, 7], player2: [13, 7], goal1: [7, 3], goal2: [7, 11] },
      { player1: [3, 3], player2: [11, 11], goal1: [3, 11], goal2: [11, 3] },
      { player1: [5, 2], player2: [9, 12], goal1: [2, 7], goal2: [12, 7] },
      { player1: [2, 5], player2: [12, 9], goal1: [7, 2], goal2: [7, 12] },
      { player1: [6, 1], player2: [8, 13], goal1: [1, 6], goal2: [13, 8] }
    ];

    for (let i = 0; i < 99; i++) {
      const config = configurations[i % configurations.length];
      // Add some variation
      const variation = Math.floor(i / configurations.length);

      maps[String(297 + i)] = [{
        initPlayerGrid: config.player1,
        initAIGrid: config.player2,
        target1: config.goal1,
        target2: config.goal2,
        mapType: '2P2G'
      }];
    }
    return maps;
  }

  generate2P3GMaps() {
    const maps = {};
    // 2P3G maps are similar to 2P2G but start with only 2 goals
    // The third goal appears dynamically during gameplay
    const configurations = [
      { player1: [7, 2], player2: [7, 14], goal1: [1, 8], goal2: [14, 8] },
      { player1: [2, 7], player2: [14, 7], goal1: [8, 1], goal2: [8, 13] },
      { player1: [7, 1], player2: [7, 13], goal1: [3, 7], goal2: [11, 7] },
      { player1: [1, 7], player2: [13, 7], goal1: [7, 3], goal2: [7, 11] },
      { player1: [3, 3], player2: [11, 11], goal1: [3, 11], goal2: [11, 3] },
      { player1: [5, 2], player2: [9, 12], goal1: [2, 7], goal2: [12, 7] },
      { player1: [2, 5], player2: [12, 9], goal1: [7, 2], goal2: [7, 12] },
      { player1: [6, 1], player2: [8, 13], goal1: [1, 6], goal2: [13, 8] }
    ];

    for (let i = 0; i < 99; i++) {
      const config = configurations[i % configurations.length];

      maps[String(397 + i)] = [{
        initPlayerGrid: config.player1,
        initAIGrid: config.player2,
        target1: config.goal1,
        target2: config.goal2,
        mapType: '2P3G'
      }];
    }
    return maps;
  }

  // Get maps for specific experiment type
  getMapsForExperiment(experimentType) {
    console.log(`🎯 Getting maps for experiment: ${experimentType}`);
    
    if (!this.mapData) {
      console.warn('⚠️ Map data not loaded yet, using fallback');
      return this.getFallbackMaps(experimentType);
    }

    const mapData = this.mapData[experimentType];
    if (!mapData) {
      console.error(`❌ No map data available for experiment type: ${experimentType}`);
      return this.getFallbackMaps(experimentType);
    }
    
    console.log(`✅ Found ${Object.keys(mapData).length} maps for ${experimentType}`);
    return mapData;
  }

  // Get fallback maps when config files are not available
  getFallbackMaps(experimentType) {
    switch (experimentType) {
      case '1P1G':
        return this.generate1P1GMaps();
      case '1P2G':
        return this.generate1P2GMaps();
      case '2P2G':
        return this.generate2P2GMaps();
      case '2P3G':
        return this.generate2P3GMaps();
      default:
        console.error(`Unknown experiment type: ${experimentType}`);
        return {};
    }
  }

  // Select random maps from map data (legacy compatible)
  selectRandomMaps(mapData, nTrials) {
    if (!mapData || typeof mapData !== 'object') {
      console.error('Invalid map data provided:', mapData);
      return [];
    }

    const keys = Object.keys(mapData);
    if (keys.length === 0) {
      console.error('No keys found in map data');
      return [];
    }

    const selectedMaps = [];
    for (let i = 0; i < nTrials; i++) {
      const randomKey = keys[Math.floor(Math.random() * keys.length)];
      // Map data structure is: { "key": [{ designObject }] }
      const mapArray = mapData[randomKey];
      if (Array.isArray(mapArray) && mapArray.length > 0) {
        selectedMaps.push({ ...mapArray[0] }); // Clone the design object
      }
    }

    console.log(`Selected ${selectedMaps.length} random maps from ${keys.length} available maps`);
    return selectedMaps;
  }

  // Get random map for collaboration games (post trial 12)
  getRandomMapForCollaborationGame(experimentType, trialIndex) {
    // After trial 12, use random sampling
    if (trialIndex >= CONFIG.game.successThreshold.randomSamplingAfterTrial) {
      const mapData = this.getMapsForExperiment(experimentType);
      console.log(`Getting random map for ${experimentType} trial ${trialIndex + 1}, mapData:`, mapData);

      if (!mapData || Object.keys(mapData).length === 0) {
        console.error(`No map data available for ${experimentType}`);
        return this.createFallbackDesign(experimentType);
      }

      const randomMaps = this.selectRandomMaps(mapData, 1);
      if (randomMaps.length === 0) {
        console.error(`No random maps selected for ${experimentType}`);
        return this.createFallbackDesign(experimentType);
      }

      return randomMaps[0];
    } else {
      // Use pre-selected map from timeline (this would be handled by TimelineManager)
      console.log(`Using timeline map data for ${experimentType} trial ${trialIndex}`);
      return null; // Signal to use timeline data
    }
  }

  // Create fallback design when no map data available
  createFallbackDesign(experimentType) {
    const fallbackDesigns = {
      '1P1G': {
        initPlayerGrid: [7, 1],
        target1: [7, 7],
        mapType: '1P1G'
      },
      '1P2G': {
        initPlayerGrid: [7, 1],
        target1: [3, 7],
        target2: [11, 7],
        mapType: '1P2G'
      },
      '2P2G': {
        initPlayerGrid: [7, 2],
        initAIGrid: [7, 14],
        target1: [1, 8],
        target2: [14, 8],
        mapType: '2P2G'
      },
      '2P3G': {
        initPlayerGrid: [7, 2],
        initAIGrid: [7, 14],
        target1: [1, 8],
        target2: [14, 8],
        mapType: '2P3G'
      }
    };

    return fallbackDesigns[experimentType] || fallbackDesigns['1P1G'];
  }

  // Server health check
  async checkServerHealth() {
    try {
      const response = await fetch('/health', { 
        method: 'GET',
        timeout: 2000 // 2 second timeout
      });
      return response.ok;
    } catch (error) {
      return false;
    }
  }

  // Load all fallback maps when server is unavailable
  loadAllFallbackMaps() {
    console.log('🔧 Loading all fallback maps...');
    return {
      '1P1G': this.getFallbackMaps('1P1G'),
      '1P2G': this.getFallbackMaps('1P2G'),
      '2P2G': this.getFallbackMaps('2P2G'),
      '2P3G': this.getFallbackMaps('2P3G')
    };
  }
}

// Create singleton instance
export const mapLoader = new MapLoader();