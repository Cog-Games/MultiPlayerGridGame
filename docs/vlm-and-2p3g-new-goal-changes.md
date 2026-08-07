# VLM and 2P3G new-goal changes

This document records the current LLM/VLM-facing behavior and the 2P3G
new-goal generation fix. It is intended to make future runs reproducible and
to prevent data generated under different geometry or prompt rules from being
pooled silently.

## VLM information and prompt contract

- Base VLM prompt version: `vlm-human-visible-v3`.
- VLM-ToM prompt version: `vlm-tom-human-visible-v3`.
- The VLM receives the visible grid, the current player identity and position,
  restaurant positions, the same movement/payoff rules shown to participants,
  and previously visible trajectories.
- The prompt explains that grid value `4` is an obstacle that cannot be
  entered, and that both players' moves take effect after both have acted.
- Player coordinates are resolved for the side actually controlled by the VLM;
  a player-1 VLM is no longer accidentally described using player-2's current
  position.
- Derived assistance that is unavailable to human participants is not sent.
  In particular, there is no legal-action list, nearest-goal label, Manhattan
  distance, or goal-direction delta.
- VLM reward wording uses **points**. Participant-facing instructions continue
  to use **cents**, as required by the human study materials.
- A base VLM response must be exactly one of `up`, `down`, `left`, or `right`.
  Malformed prose is treated as an API/agent error and enters the existing
  fallback path; the server no longer converts malformed output into a random
  movement.

## Model profile and telemetry

The formal unmatched-partner fallback and direct Human-VLM test use execution
profile `human-human-fallback-luna-fast`:

| Setting | Value |
|---|---|
| Model | `gpt-5.6-luna` |
| `service_tier` | `fast` |
| `reasoning_effort` | `none` |
| Temperature | `0` |

Each VLM call records prompt version, requested profile, requested and returned
model, reasoning effort, requested and returned service tier, latency, token
usage, rate-limit metadata, and selected action in `trialData.aiApiCalls`.
VLM-ToM calls also preserve the inferred goal.

## 2P3G new-goal geometry fix

New 2P3G data uses geometry rule
`adult-rl-aligned-exact-joint-v1`. For old goal `o`, proposed new goal `n`, and
players `p1` and `p2`, every accepted new goal satisfies:

```text
d(p1, n) + d(p2, n) = d(p1, o) + d(p2, o)
```

The condition-specific rule must also hold:

- `closer_to_player1`: the new goal improves player 1's distance by at least
  two cells.
- `closer_to_player2`: the new goal improves player 2's distance by at least
  two cells.
- `equal_to_both`: both players have equal Manhattan distance to the new goal.

If no strict candidate exists at the current step, no new goal is presented at
that step. The generator retries as the players move. It does not use the old
relaxed/equal-distance fallback or relabel an invalid candidate as the assigned
condition.

The following fields are exported for trial-level geometry audits:

- `newGoalGeometryRuleVersion`
- `newGoalGenerationMode`
- `newGoalStrictCandidateCount`
- old and new distances to both players
- old and new joint-distance sums
- `newGoalJointDistanceDelta`
- `newGoalDistanceDifferenceBetweenPlayers`
- `newGoalTargetedDistanceImprovement`

For data generated under this rule, accepted new-goal trials should have
`newGoalJointDistanceDelta == 0`. Analyses should still verify the recorded
fields rather than infer validity only from the assigned condition label.

## Formal and QA study presets

- Formal study: `?study=human-human-4stage-v1`
- Four stages: 3 × 1P1G, 12 × 1P2G, 8 × 2P2G, and 12 × 2P3G.
- Human matching is isolated by study pool and waits up to five minutes.
- Participants may play the SPACE-to-hop waiting game while matching; its
  score is not used by the experiment.
- If matching times out, the participant leaves the waiting room and continues
  with the Luna Fast base-VLM profile above. The fallback side, stage, reason,
  profile, room provenance, and waiting statistics are recorded.
- Four-stage QA: `?study=human-human-4stage-test-v1` (one trial per stage;
  `ENTER` activates test fallback while waiting).
- Direct Human-VLM 2P3G QA: `?study=human-vlm-2p3g-test-v2&timeline=false&skipNetwork=true&fullscreen=false`.

## Verification

Before deployment, run:

```bash
npm test
npm run build
```

The automated tests cover the study presets, Luna Fast profile, prompt
information boundary, strict VLM response parsing, match-pool isolation,
exact-joint-distance new-goal rules, and waiting mini-game listener cleanup.
