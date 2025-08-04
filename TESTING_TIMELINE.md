# Testing Timeline Integration

This document explains how to test the new Timeline + ExperimentManager integration.

## Quick Start

### Option 1: Browser Test (Recommended)

1. **Open the test page:**
   ```bash
   # Start your development server (if you have one)
   # Or simply open the file directly in a browser:
   open test-timeline-integration.html
   ```

2. **Test the integration:**
   - Click "Start Full Timeline" to test the complete timeline flow
   - Click "Start Human-AI Mode" to test the original experiment manager
   - Use "Skip to Game" to jump directly to a trial
   - Use "Simulate Trial Complete" to test trial completion handling

### Option 2: Command Line Test

```bash
node test-integration.js
```

## Test Features

### Interactive Browser Test (`test-timeline-integration.html`)

**Features:**
- 🎮 **Full Timeline Flow**: Tests the complete timeline with all stages
- 🤖 **Human-AI Mode**: Tests the original experiment manager flow  
- ⏭️ **Skip Controls**: Jump to specific stages for debugging
- 🎯 **Trial Simulation**: Simulate trial completions and results
- 📋 **Debug Console**: Real-time event logging and status updates
- 🔄 **Reset Function**: Clean reset between tests

**Controls:**
- **Start Full Timeline**: Launches the complete timeline flow (consent → welcome → instructions → trials → feedback → questionnaire → completion)
- **Start Human-AI Mode**: Launches just the experiment manager in human-AI mode
- **Skip to Game**: Jumps directly to the first trial stage
- **Simulate Trial Complete**: Triggers a mock trial completion
- **Reset Test**: Cleans up and resets for a new test

### Command Line Test (`test-integration.js`)

**Automated Tests:**
1. ✅ Basic instantiation of all components
2. 🔗 Timeline integration setup verification  
3. 📡 Event handling between timeline and experiment manager
4. 🎮 Complete trial flow simulation

## What to Look For

### ✅ Success Indicators

1. **Timeline Stages Load Correctly**
   - Consent form appears (if enabled)
   - Welcome screen with spacebar instruction
   - Experiment instructions for each game type
   - Trial stages run in sequence

2. **Event Communication Works**
   - Timeline events appear in debug console
   - ExperimentManager responds to timeline events
   - Trial completion callbacks work properly

3. **Game Logic Functions**
   - Players can move using arrow keys
   - AI opponent moves (in 2P games)
   - Goals are detected and trials complete
   - Success/failure feedback appears

4. **Stage Progression**
   - Spacebar advances instruction stages
   - Trials complete and advance automatically
   - Feedback displays show results
   - Experiment sequence continues properly

### 🚨 Potential Issues

1. **Missing Dependencies**
   - Check browser console for import errors
   - Ensure all required files are present

2. **Event Handler Errors**
   - Timeline events not triggering experiment manager actions
   - Trial completion callbacks not firing

3. **UI Integration Problems**
   - Game canvas not appearing in timeline stages
   - Feedback displays not rendering properly
   - Button interactions not working

4. **State Management Issues**
   - Game state not syncing between managers
   - Trial data not being collected properly

## Testing Different Scenarios

### 1. Full Timeline Flow
```javascript
// Tests the complete experiment experience
// - All instruction stages
// - All experiment types in sequence  
// - Data collection and completion
```

### 2. Individual Experiment Types
```javascript
// Test each experiment type separately:
// - 1P1G: Single player, single goal
// - 1P2G: Single player, multiple goals
// - 2P2G: Two players (human + AI), coordination required
// - 2P3G: Two players, multiple goals with dynamic presentation
```

### 3. Success Threshold Testing
```javascript
// For collaboration experiments (2P2G, 2P3G):
// - Test early termination when success threshold is met
// - Test maximum trial limits
// - Test dynamic trial addition
```

### 4. Error Handling
```javascript
// Test error scenarios:
// - Missing trial designs
// - Network failures (for multiplayer)
// - Invalid experiment configurations
```

## Debug Information

The test page provides real-time debug information:

- **Timeline Stage**: Current stage being executed
- **Event Flow**: Timeline events being emitted and handled
- **Trial Status**: Current trial state and completion status
- **Error Messages**: Any integration issues or failures

## Integration Points Tested

1. **TimelineManager → ExperimentManager**:
   - `show-fixation` → `handleFixationDisplay()`
   - `start-trial` → `handleTimelineTrialStart()`
   - `show-trial-feedback` → `handleTrialFeedback()`

2. **ExperimentManager → TimelineManager**:
   - Trial completion callbacks
   - Success/failure result reporting
   - Trial data collection

3. **Backward Compatibility**:
   - ExperimentManager still works without TimelineManager
   - Original game flow remains functional
   - No breaking changes to existing functionality

## Expected Output

### Successful Test Run:
```
✅ Timeline integration setup completed
📡 Timeline event monitoring enabled  
🚀 Timeline flow started successfully
⚡ Showing fixation for 1P1G trial 0
🎮 Timeline starting trial 0 of 1P1G
🎯 Simulated trial completion: SUCCESS
📊 Showing trial feedback for 1P1G trial 0
```

### Issues Found:
```
❌ Error starting timeline: Cannot read property 'emit' of null
❌ Trial completion callback not set
⚠️ Timeline stage not found
```

## Next Steps

After successful testing:

1. **Integration into Main Application**: Update `GameApplication.js` to use TimelineManager
2. **Configuration**: Add timeline vs. standalone mode selection
3. **Multiplayer Integration**: Test with network synchronization
4. **Data Export**: Verify experiment data collection works properly

## Troubleshooting

### Common Issues:

1. **Import errors**: Check file paths in import statements
2. **Missing CONFIG**: Ensure gameConfig.js is properly loaded
3. **DOM not ready**: Make sure tests run after DOMContentLoaded
4. **Event handler conflicts**: Check for duplicate event listeners

### Debug Commands:

```javascript
// In browser console:
window.timelineTestApp.log('Custom debug message');
window.timelineTestApp.reset(); // Reset everything
console.log(window.timelineTestApp.timelineManager.stages); // View all stages
```