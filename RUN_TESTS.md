# How to Run Timeline Integration Tests

## 🚀 Quick Start

### Option 1: Using Vite Dev Server (Recommended)
```bash
# Install dependencies (if not already done)
npm install

# Start the development server
npm run dev

# Open the test page in your browser
# Navigate to: http://localhost:3000/test-timeline-integration.html
```

### Option 2: Direct File Opening
```bash
# Simply open the test file directly in your browser
open test-timeline-integration.html
# or drag the file into your browser window
```

### Option 3: Command Line Test
```bash
# Run the automated integration tests
node test-integration.js
```

## ✅ Environment Setup Fixed

The `VITE_SERVER_URL` error has been resolved by:

1. **Created `.env` file** with proper environment variables
2. **Updated `gameConfig.js`** to handle missing environment variables gracefully
3. **Added fallback values** for direct HTML file loading

## 🧪 What Each Test Method Does

### Browser Test (`test-timeline-integration.html`)
- **Interactive testing** with real UI components
- **Debug console** showing real-time events
- **Control buttons** to test different scenarios
- **Visual feedback** of timeline stages

### Command Line Test (`test-integration.js`)
- **Automated verification** of integration points
- **Mock components** for server-side testing  
- **Pass/fail reporting** for all integration features
- **No browser required**

## 🔧 Test Controls Explained

| Button | Action |
|--------|--------|
| **Start Full Timeline** | Complete experiment flow with all stages |
| **Start Human-AI Mode** | Original experiment manager only |
| **Skip to Game** | Jump directly to trial execution |
| **Simulate Trial Complete** | Mock a trial completion event |
| **Reset Test** | Clean reset for new test run |

## 📊 Expected Results

### Successful Timeline Integration:
```
✅ Timeline integration setup completed
📡 Timeline event monitoring enabled
🚀 Timeline flow started successfully
⚡ Showing fixation for 1P1G trial 0
🎮 Timeline starting trial 0 of 1P1G
```

### Environment Variables Working:
```
Environment variable VITE_SERVER_URL not available, using default: http://localhost:3001
```
*(This warning is normal when opening HTML directly)*

### Interactive Test Working:
- Welcome screen appears with spacebar instruction
- Debug console shows timeline events
- Game controls respond to arrow keys
- Trial completion advances to next stage

## 🚨 Troubleshooting

### Issue: Module import errors
**Solution**: Use Vite dev server instead of direct file opening
```bash
npm run dev
# Then visit http://localhost:3000/test-timeline-integration.html
```

### Issue: "Cannot read properties of undefined"
**Solution**: This should be fixed now, but if you still see it:
1. Check that `.env` file exists
2. Restart your dev server
3. Clear browser cache

### Issue: Game canvas not showing
**Solution**: Check browser console for errors, ensure all dependencies loaded

### Issue: Timeline events not firing
**Solution**: Check the debug console - events should appear there

## 🎯 Test Scenarios to Try

1. **Complete Flow**: Start Full Timeline → use spacebar to advance → play a trial
2. **Game Mechanics**: Start Human-AI → use arrow keys → complete trials
3. **Stage Skipping**: Skip to Game → test trial execution directly
4. **Error Handling**: Try invalid inputs, check console for graceful handling

## 📝 Test Results You Should See

**Browser Console Messages:**
- Timeline Manager initialization
- Event handler registration
- Stage progression logs
- Trial completion callbacks

**Debug Panel Messages:**
- Timeline events being emitted
- ExperimentManager responses
- Trial state changes
- Success/failure results

**UI Behavior:**
- Smooth stage transitions
- Responsive game controls
- Proper feedback displays
- Data collection working

The tests are now ready to run! The environment variable issue is fixed and you should be able to test the timeline integration successfully.