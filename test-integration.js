#!/usr/bin/env node

/**
 * Integration Test Script for TimelineManager + ExperimentManager
 * Run with: node test-integration.js
 */

import { createRequire } from 'module';
const require = createRequire(import.meta.url);

// Mock DOM environment for server-side testing
global.document = {
    getElementById: () => ({ innerHTML: '', appendChild: () => {}, scrollTop: 0, scrollHeight: 0 }),
    createElement: () => ({ className: '', innerHTML: '', textContent: '', onclick: null }),
    addEventListener: () => {},
    removeEventListener: () => {},
    body: { focus: () => {}, appendChild: () => {}, removeChild: () => {} }
};

global.window = {
    location: { search: '', href: '' },
    close: () => {},
    URL: { createObjectURL: () => '', revokeObjectURL: () => {} }
};

global.URLSearchParams = class URLSearchParams {
    constructor(search) { this.params = {}; }
    get(key) { return null; }
};

// Import classes
import { TimelineManager } from './client/src/timeline/TimelineManager.js';
import { ExperimentManager } from './client/src/experiments/ExperimentManager.js';

// Mock managers for testing
class MockGameStateManager {
    constructor() {
        this.currentState = { player1: null, player2: null, currentGoals: [] };
        this.trialData = {};
    }
    
    initializeTrial(trialIndex, experimentType, design) {
        console.log(`[Mock] Initializing trial ${trialIndex} for ${experimentType}`);
        return true;
    }
    
    getCurrentState() { return this.currentState; }
    getCurrentTrialData() { return this.trialData; }
    finalizeTrial(success) { 
        console.log(`[Mock] Finalizing trial: ${success ? 'SUCCESS' : 'FAILURE'}`);
    }
    reset() { console.log('[Mock] Game state reset'); }
}

class MockUIManager {
    constructor() {
        this.eventHandlers = new Map();
    }
    
    on(event, handler) {
        if (!this.eventHandlers.has(event)) {
            this.eventHandlers.set(event, []);
        }
        this.eventHandlers.get(event).push(handler);
    }
    
    showFixation() { console.log('[Mock] Showing fixation display'); }
    updateGameInfo(expIndex, trialIndex, expType) { 
        console.log(`[Mock] Updating game info: Exp ${expIndex}, Trial ${trialIndex}, Type ${expType}`);
    }
    updateGameDisplay(state) { console.log('[Mock] Updating game display'); }
    showTrialFeedbackInContainer(success, container) { 
        console.log(`[Mock] Showing trial feedback: ${success ? 'SUCCESS' : 'FAILURE'}`);
    }
}

// Test class
class IntegrationTest {
    constructor() {
        this.container = document.getElementById('app');
        this.passed = 0;
        this.failed = 0;
    }
    
    log(message, type = 'info') {
        const prefix = type === 'success' ? '✅' : type === 'error' ? '❌' : 'ℹ️';
        console.log(`${prefix} ${message}`);
    }
    
    assert(condition, message) {
        if (condition) {
            this.log(`PASS: ${message}`, 'success');
            this.passed++;
        } else {
            this.log(`FAIL: ${message}`, 'error');
            this.failed++;
        }
    }
    
    async runTests() {
        this.log('🧪 Starting Timeline-ExperimentManager Integration Tests\n');
        
        // Test 1: Basic instantiation
        await this.testBasicInstantiation();
        
        // Test 2: Timeline integration setup
        await this.testTimelineIntegration();
        
        // Test 3: Event handling
        await this.testEventHandling();
        
        // Test 4: Trial flow simulation
        await this.testTrialFlow();
        
        // Print results
        this.printResults();
    }
    
    async testBasicInstantiation() {
        this.log('\n📋 Test 1: Basic Instantiation');
        
        try {
            const gameStateManager = new MockGameStateManager();
            const uiManager = new MockUIManager();
            const timelineManager = new TimelineManager(this.container);
            
            this.assert(gameStateManager !== null, 'GameStateManager created');
            this.assert(uiManager !== null, 'UIManager created');
            this.assert(timelineManager !== null, 'TimelineManager created');
            
            // Test ExperimentManager without timeline
            const experimentManager1 = new ExperimentManager(gameStateManager, uiManager);
            this.assert(experimentManager1.timelineManager === null, 'ExperimentManager works without timeline');
            
            // Test ExperimentManager with timeline
            const experimentManager2 = new ExperimentManager(gameStateManager, uiManager, timelineManager);
            this.assert(experimentManager2.timelineManager === timelineManager, 'ExperimentManager accepts timeline manager');
            
        } catch (error) {
            this.log(`Test 1 error: ${error.message}`, 'error');
            this.failed++;
        }
    }
    
    async testTimelineIntegration() {
        this.log('\n🔗 Test 2: Timeline Integration Setup');
        
        try {
            const gameStateManager = new MockGameStateManager();
            const uiManager = new MockUIManager();
            const timelineManager = new TimelineManager(this.container);
            const experimentManager = new ExperimentManager(gameStateManager, uiManager, timelineManager);
            
            // Check if setupTimelineIntegration was called
            this.assert(typeof experimentManager.setupTimelineIntegration === 'function', 'setupTimelineIntegration method exists');
            
            // Check if timeline event handlers exist
            this.assert(typeof experimentManager.handleFixationDisplay === 'function', 'handleFixationDisplay method exists');
            this.assert(typeof experimentManager.handleTimelineTrialStart === 'function', 'handleTimelineTrialStart method exists');
            this.assert(typeof experimentManager.handleTrialFeedback === 'function', 'handleTrialFeedback method exists');
            
        } catch (error) {
            this.log(`Test 2 error: ${error.message}`, 'error');
            this.failed++;
        }
    }
    
    async testEventHandling() {
        this.log('\n📡 Test 3: Event Handling');
        
        try {
            const gameStateManager = new MockGameStateManager();
            const uiManager = new MockUIManager();
            const timelineManager = new TimelineManager(this.container);
            const experimentManager = new ExperimentManager(gameStateManager, uiManager, timelineManager);
            
            // Test fixation event
            let fixationHandled = false;
            const originalShowFixation = uiManager.showFixation;
            uiManager.showFixation = () => { fixationHandled = true; originalShowFixation.call(uiManager); };
            
            timelineManager.emit('show-fixation', { experimentType: '1P1G', experimentIndex: 0, trialIndex: 0 });
            this.assert(fixationHandled, 'Fixation event handled correctly');
            
            // Test trial start event
            let trialStarted = false;
            experimentManager.currentTrialCompleteCallback = null;
            
            timelineManager.emit('start-trial', {
                experimentType: '1P1G',
                experimentIndex: 0,
                trialIndex: 0,
                onComplete: (result) => { trialStarted = true; }
            });
            
            this.assert(experimentManager.currentTrialCompleteCallback !== null, 'Trial start event sets completion callback');
            
        } catch (error) {
            this.log(`Test 3 error: ${error.message}`, 'error');
            this.failed++;
        }
    }
    
    async testTrialFlow() {
        this.log('\n🎮 Test 4: Trial Flow Simulation');
        
        try {
            const gameStateManager = new MockGameStateManager();
            const uiManager = new MockUIManager();
            const timelineManager = new TimelineManager(this.container);
            const experimentManager = new ExperimentManager(gameStateManager, uiManager, timelineManager);
            
            // Simulate complete trial flow
            let callbackCalled = false;
            let callbackResult = null;
            
            // Start trial
            experimentManager.handleTimelineTrialStart({
                experimentType: '1P1G',
                experimentIndex: 0,
                trialIndex: 0,
                onComplete: (result) => {
                    callbackCalled = true;
                    callbackResult = result;
                }
            });
            
            this.assert(experimentManager.currentTrialCompleteCallback !== null, 'Trial completion callback stored');
            
            // Complete trial
            const mockResult = { success: true, trialComplete: true, moves: 10 };
            experimentManager.handleTimelineTrialComplete(mockResult);
            
            this.assert(callbackCalled, 'Trial completion callback was called');
            this.assert(callbackResult !== null, 'Trial completion callback received result');
            this.assert(experimentManager.currentTrialCompleteCallback === null, 'Completion callback cleared after use');
            
        } catch (error) {
            this.log(`Test 4 error: ${error.message}`, 'error');
            this.failed++;
        }
    }
    
    printResults() {
        this.log('\n📊 Test Results:');
        this.log(`Passed: ${this.passed}`);
        this.log(`Failed: ${this.failed}`);
        this.log(`Total: ${this.passed + this.failed}`);
        
        if (this.failed === 0) {
            this.log('\n🎉 All tests passed! Timeline integration is working correctly.', 'success');
        } else {
            this.log(`\n⚠️ ${this.failed} test(s) failed. Please check the integration.`, 'error');
        }
    }
}

// Run tests
const test = new IntegrationTest();
test.runTests().catch(error => {
    console.error('Test execution failed:', error);
});