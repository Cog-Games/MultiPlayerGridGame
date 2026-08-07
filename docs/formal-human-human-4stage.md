# Formal Human–Human four-stage study

## Participant link

Use the named study preset rather than assembling pilot query parameters:

```text
http://localhost:3001/?study=human-human-4stage-v1
```

For Prolific, append its identifiers normally, for example:

```text
https://YOUR-HOST/?study=human-human-4stage-v1&PROLIFIC_PID={{%PROLIFIC_PID%}}&STUDY_ID={{%STUDY_ID%}}&SESSION_ID={{%SESSION_ID%}}
```

## Locked design

| Stage | Experiment | Trials |
|---|---|---:|
| Game 1 | 1P1G | 3 |
| Game 2 | 1P2G | 12 |
| Game 3 | 2P2G | 8 |
| Game 4 | 2P3G | 12 |

- Human matchmaking starts before Game 3 and only matches participants in the
  `human-human-4stage-v1` pool.
- During matchmaking, participants can play the SPACE-to-hop waiting game
  adapted from the `kids` branch. Its score does not affect trials, bonus, map
  selection, matchmaking, or fallback timing.
- The same human pair continues into Game 4.
- Matching waits at most 300 seconds. Manual waiting-room skip is disabled.
- If no human is matched, the participant leaves the waiting room and continues
  with base VLM `gpt-5.6-luna`, `service_tier=fast`, and
  `reasoning_effort=none`.
- Game 4 uses new-goal geometry rule
  `adult-rl-aligned-exact-joint-v1`: strict condition geometry and exact joint
  distance preservation; arbitrary equal-distance fallback positions are not
  relabeled as valid trials.

## Recorded audit fields

The export includes `studyId`, `assignedCondition`, waiting details, waiting
mini-game start/end/duration/jump/collision fields, room ID, VLM prompt version,
fallback reason/stage/model/profile/controlled side, full trajectories, per-call
VLM latency/token/rate metadata, and the 2P3G new-goal geometry audit fields.

Run `npm test` and `npm run build` before deploying the study.

## Short QA link

For end-to-end testing only, use:

```text
http://localhost:3013/?study=human-human-4stage-test-v1
```

This isolated, windowed test preset runs one trial in each game. On the
matchmaking page, press `ENTER` to stop matching and continue with the
configured VLM fallback.

For a direct one-trial 2P3G Human–VLM test using the same Luna Fast profile and
`vlm-human-visible-v3` prompt, use:

```text
http://localhost:3013/?study=human-vlm-2p3g-test-v2&timeline=false&skipNetwork=true&fullscreen=false
```
