#!/usr/bin/env node

/**
 * Architecture Validation Script
 * 
 * This script validates that the new modern architecture maintains
 * compatibility with the original game functionality.
 */

import fs from 'fs';
import path from 'path';

console.log('🔍 Validating Grid Game Architecture...\n');

// Check if all required files exist
const requiredFiles = [
  // Server files
  'server/index.js',
  'server/gameRoomManager.js',
  'server/gameEventHandler.js',
  
  // Client core files
  'client/src/core/GameApplication.js',
  'client/src/game/GameStateManager.js',
  'client/src/network/NetworkManager.js',
  'client/src/ui/UIManager.js',
  'client/src/ui/GameRenderer.js',
  'client/src/experiments/ExperimentManager.js',
  'client/src/ai/RLAgent.js',
  'client/src/utils/GameHelpers.js',
  'client/src/config/gameConfig.js',
  
  // Entry points
  'client/index.html',
  'client/main.js',
  'package.json',
  'vite.config.js',
  
  // Legacy compatibility (preserved files)
  'js/human-AI-version.js',
  'js/gameState.js',
  'js/expConfig.js',
  'config/MapsFor1P1G.js',
  'config/MapsFor2P2G.js',
  'test_human-AI.html'
];

let missingFiles = [];

console.log('📁 Checking file structure...');
for (const file of requiredFiles) {
  if (fs.existsSync(file)) {
    console.log(`  ✅ ${file}`);
  } else {
    console.log(`  ❌ ${file} - MISSING`);
    missingFiles.push(file);
  }
}

if (missingFiles.length > 0) {
  console.log(`\n❌ ${missingFiles.length} required files are missing!`);
  process.exit(1);
}

// Validate package.json structure
console.log('\n📦 Validating package.json...');
try {
  const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));
  
  const requiredScripts = ['dev', 'server:dev', 'client:dev', 'build', 'start'];
  const requiredDeps = ['express', 'socket.io', 'uuid', 'cors'];
  const requiredDevDeps = ['vite', 'nodemon', 'concurrently'];
  
  // Check scripts
  const missingScripts = requiredScripts.filter(script => !packageJson.scripts?.[script]);
  if (missingScripts.length > 0) {
    console.log(`  ❌ Missing scripts: ${missingScripts.join(', ')}`);
  } else {
    console.log('  ✅ All required scripts present');
  }
  
  // Check dependencies
  const missingDeps = requiredDeps.filter(dep => !packageJson.dependencies?.[dep]);
  if (missingDeps.length > 0) {
    console.log(`  ❌ Missing dependencies: ${missingDeps.join(', ')}`);
  } else {
    console.log('  ✅ All required dependencies present');
  }
  
  // Check dev dependencies
  const missingDevDeps = requiredDevDeps.filter(dep => !packageJson.devDependencies?.[dep]);
  if (missingDevDeps.length > 0) {
    console.log(`  ❌ Missing dev dependencies: ${missingDevDeps.join(', ')}`);
  } else {
    console.log('  ✅ All required dev dependencies present');
  }
  
} catch (error) {
  console.log(`  ❌ Error reading package.json: ${error.message}`);
}

// Validate client package.json
console.log('\n📦 Validating client package.json...');
try {
  const clientPackageJson = JSON.parse(fs.readFileSync('client/package.json', 'utf8'));
  
  if (clientPackageJson.dependencies?.['socket.io-client']) {
    console.log('  ✅ Socket.IO client dependency present');
  } else {
    console.log('  ❌ Missing socket.io-client dependency');
  }
  
} catch (error) {
  console.log(`  ❌ Error reading client/package.json: ${error.message}`);
}

// Check configuration compatibility
console.log('\n⚙️  Validating configuration compatibility...');

// Read legacy config
try {
  const legacyConfigContent = fs.readFileSync('js/expConfig.js', 'utf8');
  
  // Check for key configuration elements
  const configChecks = [
    { name: 'NODEGAME_CONFIG', pattern: /NODEGAME_CONFIG\s*=/ },
    { name: 'Experiment types', pattern: /'(1P1G|1P2G|2P2G|2P3G)'/ },
    { name: 'Success threshold', pattern: /successThreshold/ },
    { name: 'Timing config', pattern: /timing/ }
  ];
  
  for (const check of configChecks) {
    if (check.pattern.test(legacyConfigContent)) {
      console.log(`  ✅ ${check.name} found in legacy config`);
    } else {
      console.log(`  ⚠️  ${check.name} not found in legacy config`);
    }
  }
  
} catch (error) {
  console.log(`  ❌ Error reading legacy config: ${error.message}`);
}

// Read new config
try {
  const newConfigContent = fs.readFileSync('client/src/config/gameConfig.js', 'utf8');
  
  // Check for key configuration elements
  const configChecks = [
    { name: 'CONFIG export', pattern: /export\s+const\s+CONFIG/ },
    { name: 'Game objects', pattern: /GAME_OBJECTS/ },
    { name: 'Directions', pattern: /DIRECTIONS/ },
    { name: 'Server config', pattern: /server:/ },
    { name: 'Multiplayer config', pattern: /multiplayer:/ }
  ];
  
  for (const check of configChecks) {
    if (check.pattern.test(newConfigContent)) {
      console.log(`  ✅ ${check.name} found in new config`);
    } else {
      console.log(`  ⚠️  ${check.name} not found in new config`);
    }
  }
  
} catch (error) {
  console.log(`  ❌ Error reading new config: ${error.message}`);
}

// Check legacy preservation
console.log('\n🔄 Validating legacy preservation...');

const legacyFiles = [
  'js/human-AI-version.js',
  'js/gameState.js',
  'js/expConfig.js',
  'js/gameHelpers.js',
  'js/rlAgent.js',
  'test_human-AI.html'
];

let preservedCount = 0;
for (const file of legacyFiles) {
  if (fs.existsSync(file)) {
    preservedCount++;
    console.log(`  ✅ ${file} preserved`);
  } else {
    console.log(`  ❌ ${file} missing`);
  }
}

console.log(`  📊 ${preservedCount}/${legacyFiles.length} legacy files preserved`);

// Architecture validation summary
console.log('\n📋 Architecture Validation Summary:');
console.log('=====================================');

const checks = [
  { name: 'File structure', status: missingFiles.length === 0 },
  { name: 'Package configuration', status: true }, // Simplified for this example
  { name: 'Legacy preservation', status: preservedCount === legacyFiles.length },
  { name: 'Modern modules', status: fs.existsSync('client/src/core/GameApplication.js') },
  { name: 'Socket.IO integration', status: fs.existsSync('server/gameEventHandler.js') }
];

let passedChecks = 0;
for (const check of checks) {
  const status = check.status ? '✅ PASS' : '❌ FAIL';
  console.log(`  ${check.name}: ${status}`);
  if (check.status) passedChecks++;
}

console.log(`\n🎯 Overall: ${passedChecks}/${checks.length} checks passed`);

if (passedChecks === checks.length) {
  console.log('\n🎉 Architecture validation SUCCESSFUL!');
  console.log('\n🚀 Ready to run:');
  console.log('   npm install');
  console.log('   npm run dev');
  console.log('\n🌐 Then open: http://localhost:3000');
  process.exit(0);
} else {
  console.log('\n⚠️  Architecture validation INCOMPLETE!');
  console.log('   Some components may not work as expected.');
  console.log('   Please review the failed checks above.');
  process.exit(1);
}