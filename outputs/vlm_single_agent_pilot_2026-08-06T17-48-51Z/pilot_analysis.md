# GPT-4.1 mini 1P2G commitment pilot

## Validity checks

- Model snapshot returned by the API: `gpt-4.1-mini-2025-04-14`
- Five agent sessions, 12 sequential trials per session, 60 total
- Every agent received exactly 3 closer, 3 farther, 3 equal, and 3 no-new-goal trials
- Realized distance differences were exactly -2, +2, and 0 for all closer,
  farther, and equal trials
- 45/45 expected new goals were generated; 15/15 no-new-goal controls had no new goal
- 60/60 trials reached a restaurant
- No API errors, invalid responses, invalid moves, or fallback actions
- The original inferred goal was non-null for all 45 new-goal trials

## Main results

| Outcome | Result |
|---|---:|
| Success | 60/60 (100%) |
| Mean moves | 12.23 |
| Mean chosen-goal path efficiency | 99.05% |
| Mean opportunity-adjusted efficiency | 95.24% |
| Opportunity-optimal trials | 43/60 (71.67%) |
| Mean post-change path efficiency, new-goal trials | 89.83% |
| Commitment to original inferred goal | 37/45 (82.22%) |
| Switch to newly presented goal | 8/45 (17.78%) |
| Repeated-state moves | 13 |

The Wilson 95% interval for the pooled commitment proportion is 68.67% to 90.71%.
This interval treats trials as independent and is therefore descriptive; the five
agent sessions are repeated runs of one model.

The no-new-goal controls give the cleanest navigation baseline: all 15 followed an
optimal route, with 100% chosen-goal and opportunity-adjusted efficiency. Thus the
model can solve the single-player navigation task efficiently. Efficiency falls when
a new option appears because the model often remains committed to its prior goal.

## Results by condition

| Condition | N | Success | Mean moves | Chosen-goal efficiency | Opportunity efficiency | Post-change efficiency | Committed | Switched to new goal |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Closer | 15 | 100% | 13.13 | 98.52% | 85.27% | 74.70% | 13/15 (86.67%) | 2/15 (13.33%) |
| Farther | 15 | 100% | 11.87 | 100.00% | 98.02% | 97.86% | 13/15 (86.67%) | 2/15 (13.33%) |
| Equal | 15 | 100% | 12.53 | 97.69% | 97.69% | 96.92% | 11/15 (73.33%) | 4/15 (26.67%) |
| No new goal | 15 | 100% | 11.40 | 100.00% | 100.00% | — | — | — |

The closer condition is the strongest commitment test. Although the new restaurant
was exactly two steps closer, the model stayed with its original goal in 13/15 trials.
This produced most of the opportunity loss: 30 of the 40 post-change excess moves.

## Results by agent session

| Agent | Success | Chosen-goal efficiency | Opportunity efficiency | Commitment | Switched to new goal |
|---|---:|---:|---:|---:|---:|
| Agent 1 | 12/12 | 100.00% | 96.14% | 9/9 (100.00%) | 0/9 |
| Agent 2 | 12/12 | 98.96% | 96.49% | 7/9 (77.78%) | 2/9 |
| Agent 3 | 12/12 | 98.15% | 94.41% | 7/9 (77.78%) | 2/9 |
| Agent 4 | 12/12 | 100.00% | 94.44% | 7/9 (77.78%) | 2/9 |
| Agent 5 | 12/12 | 98.15% | 94.75% | 7/9 (77.78%) | 2/9 |

All five sessions showed more commitment than switching. The model therefore shows a
stable descriptive commitment pattern across these runs, rather than a result driven
by one session.

## Interpretation and next control

This pilot supports both intended conclusions:

1. GPT-4.1 mini can complete the single-player task efficiently: success was 100%,
   chosen-goal efficiency was 99.05%, and no-new-goal efficiency was 100%.
2. It shows a descriptive single-player commitment bias: commitment was 82.22%
   overall and 86.67% even when the new restaurant was closer.

One important control remains. The original inferred goal was goal index 0 in all 45
new-goal trials, and the new goal is appended last in the textual restaurant list.
That ordering matches the social-agent prompt and should remain for the matched main
comparison, but a separate coordinate-order counterbalancing or image-only ablation is
needed before claiming that all of the effect is psychological commitment rather than
text-list ordering.

## Runtime and cost

- Wall-clock runtime: 123.23 seconds
- API calls: 734
- Tokens: 674,973 prompt; 734 completion; 675,707 total
- Estimated API cost: $0.27116
- API latency: 701 ms p50; 1,267 ms p95; 1,821 ms p99; 8,150 ms maximum
