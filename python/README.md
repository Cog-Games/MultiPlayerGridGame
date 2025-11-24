Python tools for map generation and offline RL testing

Overview

- gameDesign: Scripts to generate gridworld maps (with obstacles) in JSON format compatible with the web app.
- models: A simple Python RL agent (value iteration) to test maps offline and validate obstacle layouts.

Quick start

- Generate maps (writes JSON to python/gameDesign/output):
  - `python3 python/gameDesign/map_generator.py --experiment 2P2G --count 10 --size 15`
  - Outputs: `python/gameDesign/output/2P2G.json`

- Test a single map with the Python RL agent:
  - `python3 python/models/rl_agent.py --map-file python/gameDesign/output/2P2G.json --key 0 --agent ai --steps 50`

JSON schema

- The generator produces an object mapping string keys to arrays of one design object, matching the existing JS map files (MapsFor*.js):
  - 1P1G: `{ "0": [{ initPlayerGrid, target1, obstacles, mapType: "1P1G" }] }`
  - 1P2G: `{ "0": [{ initPlayerGrid, target1, target2, obstacles, mapType: "1P2G" }] }`
  - 2P2G: `{ "0": [{ initPlayerGrid, initAIGrid, target1, target2, obstacles, mapType: "2P2G" }] }`
  - 2P3G: same as 2P2G (the third goal is added dynamically by the app)

Using these maps in the app

- Optional: the client can fetch JSON maps if enabled via `CONFIG.game.maps.source = 'python-json'` and the server serves `/python` statics.
- Place generated files at `python/gameDesign/output/<EXPERIMENT>.json`.

