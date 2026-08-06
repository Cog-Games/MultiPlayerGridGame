# Human vs GPT-4.1-mini: 1P2G pilot comparison

## Result

GPT-4.1-mini completed all 60 trials and was slightly more efficient than the
30-person human benchmark. Its main behavioral difference was commitment:
82.2% versus 69.3% overall (13.0
percentage points), driven by the **closer-new-goal** condition. In that
condition, LLM commitment exceeded human commitment by 44.4
points, meaning the LLM was much less likely to switch to a newly available
closer goal.

| Actor | N actors | Trials | Success | Chosen-goal efficiency | Opportunity efficiency | Post-change efficiency | Commitment |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Human | 30 | 360 | 100.0% | 96.7% | 93.7% | 86.6% | 69.3% |
| GPT-4.1-mini | 5 | 60 | 100.0% | 99.1% | 95.2% | 89.8% | 82.2% |

## Original condition labels

| Condition | Actor | Trials | Chosen efficiency | Opportunity efficiency | Post-change efficiency | Commitment |
| --- | --- | --- | --- | --- | --- | --- |
| Closer | Human | 90 | 91.4% | 85.3% | 71.8% | 42.2% |
| Closer | GPT-4.1-mini | 15 | 98.5% | 85.3% | 74.7% | 86.7% |
| Equal | Human | 90 | 97.8% | 94.1% | 91.9% | 75.6% |
| Equal | GPT-4.1-mini | 15 | 97.7% | 97.7% | 96.9% | 73.3% |
| Farther | Human | 90 | 98.7% | 96.8% | 96.1% | 90.0% |
| Farther | GPT-4.1-mini | 15 | 100.0% | 98.0% | 97.9% | 86.7% |
| No new goal | Human | 90 | 98.8% | 98.8% | — | — |
| No new goal | GPT-4.1-mini | 15 | 100.0% | 100.0% | — | — |

Each human contributed 12 trials (3 per condition); each of the five LLM
sessions used the same 12-trial structure. Commitment is defined exactly as in
`analysis_adults_unified_claude.ipynb`: the final reached goal equals the first
detected/intended goal, evaluated only when a new goal was actually presented.

## Actor-level comparison

These Welch tests use participant/session means, not pooled trials. They are
descriptive pilot statistics because there are only five LLM sessions and all
five use the same model/prompt.

| Metric | Human N | Human mean | LLM N | LLM mean | LLM − human | Welch p |
| --- | --- | --- | --- | --- | --- | --- |
| success_rate | 30 | 100.0% | 5 | 100.0% | 0.0% | — |
| commitment_rate | 30 | 69.3% | 5 | 82.2% | 13.0% | 0.0491 |
| chosen_goal_efficiency | 30 | 96.7% | 5 | 99.1% | 2.4% | 0.0038 |
| opportunity_efficiency | 30 | 93.7% | 5 | 95.2% | 1.5% | 0.1153 |
| post_change_efficiency | 30 | 86.6% | 5 | 89.8% | 3.2% | 0.0357 |

## Pooled-adult commitment sensitivity

The primary efficiency analysis uses the notebook's clean, balanced
`human (locked-action)` group because all 360 rows contain the coordinates
needed for identical efficiency scoring. As a sensitivity check, commitment
can be calculated for all five main adult groups (N=150);
all actors in their 1P2G block were humans, and `partnerType` refers to a later
2P assignment.

| Condition | N humans | Trials | Commitment |
| --- | --- | --- | --- |
| All new-goal | 150 | 1344 | 70.0% |
| Closer | 150 | 449 | 48.1% |
| Equal | 150 | 449 | 74.6% |
| Farther | 150 | 446 | 87.4% |

## Realized goal-distance relation

The archived human condition labels do not always reproduce the pilot's exact
distance manipulation relative to the person's inferred goal: only 48
of 270 new-goal trials in the primary human group have the exact
−2/0/+2 difference, versus 45/45 LLM trials. Reclassifying
trials by the realized Manhattan-distance difference gives:

| Realized relation | Actor | Trials | Commitment | Mean new − intended distance |
| --- | --- | --- | --- | --- |
| Closer | Human | 112 | 37.5% | -3.268 |
| Equal | Human | 25 | 72.0% | 0.000 |
| Farther | Human | 133 | 95.5% | 4.195 |
| Closer | GPT-4.1-mini | 15 | 86.7% | -2.000 |
| Equal | GPT-4.1-mini | 15 | 73.3% | 0.000 |
| Farther | GPT-4.1-mini | 15 | 86.7% | 2.000 |

This supports the same qualitative conclusion: humans usually switch when the
new goal is truly closer, whereas GPT-4.1-mini remains committed much more
often. The original label-based table should be used for direct design
reporting; the realized-distance table is the stronger behavioral check.

## Metric definitions

- **Chosen-goal efficiency:** optimal moves to the goal actually chosen divided
  by actual moves. On new-goal trials, the observed pre-presentation prefix is
  fixed and only the remaining route is optimized. 100% is optimal.
- **Opportunity efficiency:** the same ratio, but the oracle may choose the
  closest available goal after presentation. 100% is optimal.
- **Post-change efficiency:** shortest distance from the presentation position
  to any available goal divided by actual remaining moves. 100% is optimal.
- **Commitment:** first detected/intended goal equals final reached goal.

## Sources and limitations

- Human source: `/Users/chengshaozhe/Documents/DukeECClab/code/collabAIdata/combined-filtered.csv`
- LLM source: `/Users/chengshaozhe/Documents/DukeECClab/code/multiplePlayerGridGame_socketIO/outputs/vlm_single_agent_pilot_2026-08-06T17-48-51Z/pilot_results.json`
- API model returned: `gpt-4.1-mini-2025-04-14`
- Human trajectory rows store pre-move positions; the terminal position was
  reconstructed from the final recorded action and validated against the final
  goal in the primary benchmark.
- The five LLM sessions are stochastic replications of one model, not five
  independently sampled agents. Treat p-values as pilot diagnostics rather
  than population-level evidence.
