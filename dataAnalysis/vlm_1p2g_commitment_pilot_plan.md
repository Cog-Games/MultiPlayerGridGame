# GPT-4.1 mini single-player commitment pilot

## Research questions

1. Can GPT-4.1 mini finish single-player navigation efficiently?
2. In 1P2G, does it remain committed to its originally inferred restaurant after a
   third restaurant appears?

## Prompt-matching rule

Use the existing base-VLM system prompt, section order, numeric grid, coordinate
descriptions, movement history, action definitions, and output format. Make only the
singular-player changes required to avoid mentioning a nonexistent second traveler,
and replace the game-rules paragraph with the 1P2G rules. Do not expose internal
condition labels or tell the model whether it should switch.

System prompt:

```text
You are a precise navigator. Consider the image and text; output only one token: up, down, left, or right.
```

1P2G game-rules paragraph:

```text
GAME RULES: You will play alone. Each round, you can win if you go to one of the identical restaurants. Note that some restaurants are already open when the round starts. Others may appear later. For each round that you win, you earn an additional 10 points.
```

The remaining prompt follows the existing base-VLM scaffold:

```text
=== GAME CONTEXT ===
You are playing a navigation game in a 2D grid world. You are a hungry traveler who needs to reach restaurants as quickly as possible.

[GAME RULES]

=== CURRENT STATE ===
Grid map and legend:
Legend: 0=blank, 1=traveler1, 3=restaurant
Grid matrix:
[FULL 15 x 15 NUMERIC MATRIX]

Player positions:
  Traveler1 (red): ([ROW], [COL])
Restaurants (blue): ([ROW], [COL]); ...

YOU ARE: Traveler 1 (red)

=== ACTIONS ===
Movement directions (coordinate deltas):
  left = [0, -1]  (move left, column decreases)
  right = [0, 1]  (move right, column increases)
  up = [-1, 0]    (move up, row decreases)
  down = [1, 0]   (move down, row increases)

=== RECENT MOVEMENT HISTORY ===
Traveler1 path: ([ROW], [COL]) -> ...

=== YOUR TASK ===
Choose the best single-step action.

=== OUTPUT FORMAT ===
Reply with exactly one action token:
  up | down | left | right

Do NOT include any explanations, reasoning, JSON, or additional text.
```

A 196 x 196 PNG of the same state is attached with image detail `low`.

## Pilot design

- Model: `gpt-4.1-mini`
- Five independent agent sessions using the same model and prompt
- Twelve sequential 1P2G trials per session; 60 trials total
- Within every session: exactly three closer, three farther, three equal, and three
  no-new-goal trials, randomly ordered
- Across the pilot: 15 trials per condition; 45 trials with a newly presented goal
  and 15 no-new-goal controls
- Match the legacy participant design by sampling maps independently with replacement
  for each session and independently randomizing each session's condition sequence
- Each agent's trials run sequentially; the five agents may run concurrently
- Independent map/condition/goal-generation seed per agent; all seeds saved
- Temperature 0, low-detail image, 50-position within-trial memory, 60-move cap
- No memory is carried between trials

The new goal follows the legacy 1P2G geometry exactly:

- closer: new-goal distance is exactly two steps shorter than the original-goal distance
- farther: new-goal distance is exactly two steps longer
- equal: distances are exactly equal
- no-new-goal: no third goal appears

## Outcomes

Primary navigation outcome:

- Chosen-goal path efficiency = online shortest path to the goal ultimately reached /
  actual moves. This measures navigation quality without treating commitment itself as
  a navigation error.

Primary commitment outcome:

- Record the inferred goal immediately before the third goal appears.
- Committed = the final reached goal equals that original inferred goal.
- Commitment rate = committed trials / valid new-goal-presented trials.

Adaptation outcomes:

- Opportunity-adjusted efficiency: shortest route to any available restaurant after
  presentation / actual route.
- Post-change excess moves.
- Switch rate to the new goal.
- Steps from presentation to the first action aligned with the final destination.
- Reversals, repeated states, invalid actions, failures, latency, tokens, and cost.

Report pooled results, per-condition results, and five agent-level results. Treat the
five sessions as repeated runs of one model, not five independent human-like subjects.
Use agent-clustered bootstrap intervals only as a descriptive stability analysis.

## Quality-control gates

Before interpreting commitment:

1. Verify every session has exactly 3/3/3/3 trials.
2. Verify realized distance differences are -2, +2, and 0 for closer, farther, and
   equal trials.
3. Require a non-null original inferred goal before including a trial in the
   commitment denominator.
4. Treat failed goal generation, API failure, invalid output, or fallback as explicit
   failures; never silently replace or exclude them.
5. Confirm that no prompt contains a condition label or switching recommendation.

## Reproducible commands

Preflight only:

```bash
node dataAnalysis/scripts/run_vlm_single_agent_pilot.js --types 1P2G --agents 5 --trials-per-agent 12 --map-selection original-random --concurrency 5 --max-steps 60 --seed 4101 --dry-run
```

Paid pilot after prompt approval:

```bash
node dataAnalysis/scripts/run_vlm_single_agent_pilot.js --types 1P2G --agents 5 --trials-per-agent 12 --map-selection original-random --concurrency 5 --max-steps 60 --seed 4101
```
