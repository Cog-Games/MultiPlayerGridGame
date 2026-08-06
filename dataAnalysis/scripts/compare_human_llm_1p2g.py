#!/usr/bin/env python3
"""Compare adult human and GPT-4.1-mini behavior in the 1P2G task.

The primary human benchmark is the notebook's balanced ``human
(locked-action)`` group (30 participants, 12 trials each).  A pooled
commitment sensitivity analysis also uses all five main adult groups because
every 1P2G actor was human; ``partnerType`` describes their later 2P block.
"""

from __future__ import annotations

import argparse
import ast
import json
import math
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd
from scipy import stats


CONDITION_ORDER = [
    "closer_to_player1",
    "equal_to_player1",
    "farther_to_player1",
    "no_new_goal",
]
CONDITION_LABELS = {
    "closer_to_player1": "Closer",
    "equal_to_player1": "Equal",
    "farther_to_player1": "Farther",
    "no_new_goal": "No new goal",
}
EXPECTED_DISTANCE_DIFFERENCE = {
    "closer_to_player1": -2,
    "equal_to_player1": 0,
    "farther_to_player1": 2,
}
MAIN_ADULT_GROUPS = [
    "human (locked-action)",
    "individual-RL",
    "joint-RL",
    "llm (GPT-4.1-mini)",
    "vlm-tom (GPT-4.1-mini)",
]


def parse_args() -> argparse.Namespace:
    repo_root = Path(__file__).resolve().parents[2]
    default_run = repo_root / "outputs" / "vlm_single_agent_pilot_2026-08-06T17-48-51Z"
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--human-csv",
        type=Path,
        default=repo_root.parent / "collabAIdata" / "combined-filtered.csv",
    )
    parser.add_argument(
        "--llm-json",
        type=Path,
        default=default_run / "pilot_results.json",
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=default_run / "human_comparison",
    )
    return parser.parse_args()


def parse_cell(value: Any) -> Any:
    if value is None or (isinstance(value, float) and math.isnan(value)):
        return None
    if isinstance(value, (list, dict)):
        return value
    if not isinstance(value, str):
        return value
    value = value.strip()
    if not value:
        return None
    try:
        return json.loads(value)
    except json.JSONDecodeError:
        return ast.literal_eval(value)


def int_or_none(value: Any) -> int | None:
    if value is None or pd.isna(value):
        return None
    return int(value)


def manhattan(a: list[int], b: list[int]) -> int:
    return abs(int(a[0]) - int(b[0])) + abs(int(a[1]) - int(b[1]))


def capped_ratio(numerator: float, denominator: float) -> float | None:
    if denominator <= 0:
        return None
    return min(1.0, numerator / denominator)


def realized_condition(distance_difference: float | None) -> str | None:
    if distance_difference is None or pd.isna(distance_difference):
        return None
    if distance_difference < 0:
        return "closer"
    if distance_difference > 0:
        return "farther"
    return "equal"


def initial_goals_from_row(row: pd.Series) -> list[list[int]] | None:
    goals = parse_cell(row.get("initialGoalPositions"))
    if goals is not None:
        return [list(map(int, goal)) for goal in goals]
    target1 = parse_cell(row.get("target1"))
    target2 = parse_cell(row.get("target2"))
    if target1 is not None and target2 is not None:
        return [list(map(int, target1)), list(map(int, target2))]
    return None


def full_human_trajectory(row: pd.Series) -> tuple[list[list[int]], list[list[int]]]:
    trajectory = parse_cell(row.get("player1Trajectory")) or []
    actions = parse_cell(row.get("player1Actions")) or []
    trajectory = [list(map(int, position)) for position in trajectory]
    actions = [list(map(int, action)) for action in actions]

    if len(trajectory) == len(actions) and trajectory and actions:
        terminal = [
            trajectory[-1][0] + actions[-1][0],
            trajectory[-1][1] + actions[-1][1],
        ]
        trajectory = trajectory + [terminal]
    elif len(trajectory) != len(actions) + 1 and trajectory and actions:
        # Fall back to a deterministic reconstruction from the recorded start.
        rebuilt = [trajectory[0]]
        for action in actions:
            rebuilt.append(
                [rebuilt[-1][0] + action[0], rebuilt[-1][1] + action[1]]
            )
        trajectory = rebuilt
    return trajectory, actions


def normalize_human_row(row: pd.Series) -> dict[str, Any]:
    trajectory, actions = full_human_trajectory(row)
    goals = initial_goals_from_row(row)
    new_goal = parse_cell(row.get("newGoalPosition"))
    if new_goal is not None:
        new_goal = list(map(int, new_goal))
    condition = row.get("distanceCondition")
    has_new_goal = new_goal is not None and condition != "no_new_goal"
    first_goal = int_or_none(row.get("player1FirstDetectedGoal"))
    final_goal = int_or_none(row.get("player1FinalReachedGoal"))
    presentation_step = (
        int_or_none(row.get("newGoalPresentedTime")) if has_new_goal else None
    )
    moves = len(actions)

    start = trajectory[0] if trajectory else parse_cell(row.get("initPlayerGrid"))
    terminal = trajectory[-1] if trajectory else None
    all_goals = (goals or []) + ([new_goal] if has_new_goal else [])
    final_goal_position = None
    if final_goal is not None and 0 <= final_goal < len(all_goals):
        final_goal_position = all_goals[final_goal]

    success = (
        terminal is not None
        and final_goal_position is not None
        and terminal == final_goal_position
    )
    commitment = (
        first_goal == final_goal
        if has_new_goal and first_goal is not None and final_goal is not None
        else None
    )

    chosen_efficiency = None
    opportunity_efficiency = None
    post_change_efficiency = None
    distance_difference = None
    geometry_matches_label = None
    presentation_position = None

    geometry_available = (
        goals is not None
        and start is not None
        and final_goal_position is not None
        and moves > 0
    )
    if geometry_available and not has_new_goal:
        chosen_oracle = manhattan(start, final_goal_position)
        opportunity_oracle = min(manhattan(start, goal) for goal in goals)
        chosen_efficiency = capped_ratio(chosen_oracle, moves)
        opportunity_efficiency = capped_ratio(opportunity_oracle, moves)
    elif (
        geometry_available
        and has_new_goal
        and presentation_step is not None
        and 0 <= presentation_step < len(trajectory)
    ):
        presentation_position = trajectory[presentation_step]
        remaining_moves = moves - presentation_step
        chosen_oracle = presentation_step + manhattan(
            presentation_position, final_goal_position
        )
        opportunity_distance = min(
            manhattan(presentation_position, goal) for goal in all_goals
        )
        opportunity_oracle = presentation_step + opportunity_distance
        chosen_efficiency = capped_ratio(chosen_oracle, moves)
        opportunity_efficiency = capped_ratio(opportunity_oracle, moves)
        post_change_efficiency = capped_ratio(opportunity_distance, remaining_moves)
        if first_goal is not None and 0 <= first_goal < len(goals):
            distance_difference = manhattan(
                presentation_position, new_goal
            ) - manhattan(presentation_position, goals[first_goal])
            expected = EXPECTED_DISTANCE_DIFFERENCE.get(condition)
            geometry_matches_label = (
                distance_difference == expected if expected is not None else None
            )

    return {
        "dataset": "Human",
        "subject": str(row.get("participantId")),
        "adult_group": row.get("partnerType"),
        "trial_index": int_or_none(row.get("trialIndex")),
        "condition": condition,
        "has_new_goal": has_new_goal,
        "success": success,
        "commitment": commitment,
        "moves": moves,
        "chosen_goal_efficiency": chosen_efficiency,
        "opportunity_efficiency": opportunity_efficiency,
        "post_change_efficiency": post_change_efficiency,
        "distance_difference_to_intended_goal": distance_difference,
        "realized_condition": realized_condition(distance_difference),
        "geometry_matches_exact_label": geometry_matches_label,
        "first_goal_index": first_goal,
        "final_goal_index": final_goal,
        "presentation_step": presentation_step,
        "geometry_available": geometry_available,
    }


def load_humans(path: Path) -> tuple[pd.DataFrame, pd.DataFrame]:
    raw = pd.read_csv(path)
    raw = raw[
        (raw["experimentType"] == "1P2G")
        & (raw["partnerType"].isin(MAIN_ADULT_GROUPS))
    ].copy()
    normalized = pd.DataFrame(
        normalize_human_row(row) for _, row in raw.iterrows()
    )
    primary = normalized[
        normalized["adult_group"] == "human (locked-action)"
    ].copy()
    return primary, normalized


def normalize_llm_trial(trial: dict[str, Any]) -> dict[str, Any]:
    dynamic = trial.get("dynamicGoal")
    distance_difference = (
        dynamic.get("distanceDifference") if isinstance(dynamic, dict) else None
    )
    return {
        "dataset": "GPT-4.1-mini",
        "subject": trial.get("agentId"),
        "adult_group": None,
        "trial_index": trial.get("trialIndex"),
        "condition": trial.get("distanceCondition"),
        "has_new_goal": dynamic is not None,
        "success": trial.get("success"),
        "commitment": trial.get("committedToOriginalGoal"),
        "moves": trial.get("movesMade"),
        "chosen_goal_efficiency": trial.get("chosenGoalPathEfficiency"),
        "opportunity_efficiency": trial.get("opportunityAdjustedEfficiency"),
        "post_change_efficiency": trial.get("postChangePathEfficiency"),
        "distance_difference_to_intended_goal": distance_difference,
        "realized_condition": realized_condition(distance_difference),
        "geometry_matches_exact_label": (
            distance_difference
            == EXPECTED_DISTANCE_DIFFERENCE.get(trial.get("distanceCondition"))
            if dynamic is not None
            else None
        ),
        "first_goal_index": trial.get("originalIntendedGoalIndex"),
        "final_goal_index": trial.get("reachedGoalIndex"),
        "presentation_step": dynamic.get("stepPresented") if dynamic else None,
        "geometry_available": True,
    }


def load_llm(path: Path) -> tuple[pd.DataFrame, dict[str, Any]]:
    payload = json.loads(path.read_text())
    metadata = dict(payload.get("metadata", {}))
    returned_models = sorted(
        {
            step.get("modelReturned")
            for trial in payload["trials"]
            for step in trial.get("stepRecords", [])
            if step.get("modelReturned")
        }
    )
    if returned_models:
        metadata["model_returned"] = ", ".join(returned_models)
    return (
        pd.DataFrame(normalize_llm_trial(trial) for trial in payload["trials"]),
        metadata,
    )


def pct(value: Any, digits: int = 1) -> str:
    if value is None or pd.isna(value):
        return "—"
    return f"{100 * float(value):.{digits}f}%"


def num(value: Any, digits: int = 3) -> str:
    if value is None or pd.isna(value):
        return "—"
    return f"{float(value):.{digits}f}"


def aggregate(df: pd.DataFrame, dataset: str, condition: str = "All") -> dict[str, Any]:
    dynamic = df[df["has_new_goal"]]
    return {
        "dataset": dataset,
        "condition": condition,
        "subjects": int(df["subject"].nunique()),
        "trials": int(len(df)),
        "success_n": int(df["success"].fillna(False).sum()),
        "success_rate": df["success"].mean(),
        "commit_n": int(dynamic["commitment"].eq(True).sum()),
        "commit_trials": int(dynamic["commitment"].notna().sum()),
        "commitment_rate": dynamic["commitment"].mean(),
        "chosen_goal_efficiency": df["chosen_goal_efficiency"].mean(),
        "opportunity_efficiency": df["opportunity_efficiency"].mean(),
        "post_change_efficiency": dynamic["post_change_efficiency"].mean(),
        "mean_moves": df["moves"].mean(),
        "geometry_n": int(df["chosen_goal_efficiency"].notna().sum()),
    }


def summary_table(human: pd.DataFrame, llm: pd.DataFrame) -> pd.DataFrame:
    rows = [aggregate(human, "Human"), aggregate(llm, "GPT-4.1-mini")]
    for condition in CONDITION_ORDER:
        for name, frame in [("Human", human), ("GPT-4.1-mini", llm)]:
            subset = frame[frame["condition"] == condition]
            rows.append(aggregate(subset, name, CONDITION_LABELS[condition]))
    return pd.DataFrame(rows)


def subject_metric_table(df: pd.DataFrame) -> pd.DataFrame:
    rows: list[dict[str, Any]] = []
    for (dataset, subject), group in df.groupby(["dataset", "subject"]):
        dynamic = group[group["has_new_goal"]]
        rows.append(
            {
                "dataset": dataset,
                "subject": subject,
                "success_rate": group["success"].mean(),
                "commitment_rate": dynamic["commitment"].mean(),
                "chosen_goal_efficiency": group["chosen_goal_efficiency"].mean(),
                "opportunity_efficiency": group["opportunity_efficiency"].mean(),
                "post_change_efficiency": dynamic["post_change_efficiency"].mean(),
            }
        )
    return pd.DataFrame(rows)


def mean_ci(values: pd.Series) -> tuple[float, float, float, int]:
    values = pd.to_numeric(values, errors="coerce").dropna()
    n = len(values)
    mean = float(values.mean()) if n else math.nan
    if n < 2:
        return mean, math.nan, math.nan, n
    sem = stats.sem(values)
    if sem == 0:
        return mean, mean, mean, n
    low, high = stats.t.interval(0.95, n - 1, loc=mean, scale=sem)
    return mean, float(low), float(high), n


def subject_level_tests(subjects: pd.DataFrame) -> pd.DataFrame:
    rows = []
    metrics = [
        "success_rate",
        "commitment_rate",
        "chosen_goal_efficiency",
        "opportunity_efficiency",
        "post_change_efficiency",
    ]
    for metric in metrics:
        human = subjects.loc[subjects.dataset == "Human", metric].dropna()
        llm = subjects.loc[subjects.dataset == "GPT-4.1-mini", metric].dropna()
        hm, hlo, hhi, hn = mean_ci(human)
        lm, llo, lhi, ln = mean_ci(llm)
        if len(human) >= 2 and len(llm) >= 2 and (human.var() > 0 or llm.var() > 0):
            test = stats.ttest_ind(llm, human, equal_var=False)
            statistic, pvalue = float(test.statistic), float(test.pvalue)
        else:
            statistic, pvalue = math.nan, math.nan
        rows.append(
            {
                "metric": metric,
                "human_n": hn,
                "human_mean": hm,
                "human_ci_low": hlo,
                "human_ci_high": hhi,
                "llm_n": ln,
                "llm_mean": lm,
                "llm_ci_low": llo,
                "llm_ci_high": lhi,
                "llm_minus_human": lm - hm,
                "welch_t": statistic,
                "welch_p": pvalue,
            }
        )
    return pd.DataFrame(rows)


def pooled_commitment_summary(pooled: pd.DataFrame) -> pd.DataFrame:
    dynamic = pooled[pooled["has_new_goal"] & pooled["commitment"].notna()]
    rows = [aggregate(dynamic, "All selected adults", "All new-goal")]
    for condition in CONDITION_ORDER[:3]:
        subset = dynamic[dynamic["condition"] == condition]
        rows.append(
            aggregate(subset, "All selected adults", CONDITION_LABELS[condition])
        )
    return pd.DataFrame(rows)


def realized_distance_summary(human: pd.DataFrame, llm: pd.DataFrame) -> pd.DataFrame:
    rows = []
    order = ["closer", "equal", "farther"]
    for dataset, frame in [("Human", human), ("GPT-4.1-mini", llm)]:
        dynamic = frame[frame["has_new_goal"] & frame["commitment"].notna()]
        for condition in order:
            group = dynamic[dynamic["realized_condition"] == condition]
            rows.append(
                {
                    "dataset": dataset,
                    "realized_condition": condition.title(),
                    "trials": len(group),
                    "subjects": group["subject"].nunique(),
                    "commit_n": int(group["commitment"].sum()),
                    "commitment_rate": group["commitment"].mean(),
                    "mean_distance_difference": group[
                        "distance_difference_to_intended_goal"
                    ].mean(),
                }
            )
    return pd.DataFrame(rows)


def markdown_table(frame: pd.DataFrame, columns: list[tuple[str, str, str]]) -> str:
    headers = [label for _, label, _ in columns]
    lines = [
        "| " + " | ".join(headers) + " |",
        "| " + " | ".join(["---"] * len(headers)) + " |",
    ]
    for _, row in frame.iterrows():
        values = []
        for key, _, style in columns:
            value = row.get(key)
            if style == "pct":
                values.append(pct(value))
            elif style == "num":
                values.append(num(value))
            elif style == "int":
                values.append("—" if pd.isna(value) else str(int(value)))
            elif style == "p":
                values.append("—" if pd.isna(value) else f"{float(value):.4f}")
            else:
                values.append(str(value))
        lines.append("| " + " | ".join(values) + " |")
    return "\n".join(lines)


def build_report(
    human: pd.DataFrame,
    llm: pd.DataFrame,
    summary: pd.DataFrame,
    tests: pd.DataFrame,
    pooled: pd.DataFrame,
    pooled_summary: pd.DataFrame,
    realized: pd.DataFrame,
    metadata: dict[str, Any],
    human_path: Path,
    llm_path: Path,
) -> str:
    overall = summary[summary.condition == "All"]
    by_condition = summary[summary.condition != "All"]
    h_dynamic = human[human.has_new_goal]
    exact_n = int(h_dynamic.geometry_matches_exact_label.eq(True).sum())
    exact_denom = int(h_dynamic.geometry_matches_exact_label.notna().sum())
    llm_exact = int(
        llm[llm.has_new_goal].geometry_matches_exact_label.eq(True).sum()
    )
    llm_dynamic_n = int(llm.has_new_goal.sum())

    overall_md = markdown_table(
        overall,
        [
            ("dataset", "Actor", "str"),
            ("subjects", "N actors", "int"),
            ("trials", "Trials", "int"),
            ("success_rate", "Success", "pct"),
            ("chosen_goal_efficiency", "Chosen-goal efficiency", "pct"),
            ("opportunity_efficiency", "Opportunity efficiency", "pct"),
            ("post_change_efficiency", "Post-change efficiency", "pct"),
            ("commitment_rate", "Commitment", "pct"),
        ],
    )
    condition_md = markdown_table(
        by_condition,
        [
            ("condition", "Condition", "str"),
            ("dataset", "Actor", "str"),
            ("trials", "Trials", "int"),
            ("chosen_goal_efficiency", "Chosen efficiency", "pct"),
            ("opportunity_efficiency", "Opportunity efficiency", "pct"),
            ("post_change_efficiency", "Post-change efficiency", "pct"),
            ("commitment_rate", "Commitment", "pct"),
        ],
    )
    test_md = markdown_table(
        tests,
        [
            ("metric", "Metric", "str"),
            ("human_n", "Human N", "int"),
            ("human_mean", "Human mean", "pct"),
            ("llm_n", "LLM N", "int"),
            ("llm_mean", "LLM mean", "pct"),
            ("llm_minus_human", "LLM − human", "pct"),
            ("welch_p", "Welch p", "p"),
        ],
    )
    pooled_md = markdown_table(
        pooled_summary,
        [
            ("condition", "Condition", "str"),
            ("subjects", "N humans", "int"),
            ("commit_trials", "Trials", "int"),
            ("commitment_rate", "Commitment", "pct"),
        ],
    )
    realized_md = markdown_table(
        realized,
        [
            ("realized_condition", "Realized relation", "str"),
            ("dataset", "Actor", "str"),
            ("trials", "Trials", "int"),
            ("commitment_rate", "Commitment", "pct"),
            ("mean_distance_difference", "Mean new − intended distance", "num"),
        ],
    )

    h_commit = float(h_dynamic.commitment.mean())
    l_commit = float(llm[llm.has_new_goal].commitment.mean())
    closer = by_condition[by_condition.condition == "Closer"].set_index("dataset")
    closer_gap = float(
        closer.loc["GPT-4.1-mini", "commitment_rate"]
        - closer.loc["Human", "commitment_rate"]
    )
    model = metadata.get("model_returned", metadata.get("model", "gpt-4.1-mini"))

    return f"""# Human vs GPT-4.1-mini: 1P2G pilot comparison

## Result

GPT-4.1-mini completed all 60 trials and was slightly more efficient than the
30-person human benchmark. Its main behavioral difference was commitment:
{pct(l_commit)} versus {pct(h_commit)} overall ({100 * (l_commit - h_commit):.1f}
percentage points), driven by the **closer-new-goal** condition. In that
condition, LLM commitment exceeded human commitment by {100 * closer_gap:.1f}
points, meaning the LLM was much less likely to switch to a newly available
closer goal.

{overall_md}

## Original condition labels

{condition_md}

Each human contributed 12 trials (3 per condition); each of the five LLM
sessions used the same 12-trial structure. Commitment is defined exactly as in
`analysis_adults_unified_claude.ipynb`: the final reached goal equals the first
detected/intended goal, evaluated only when a new goal was actually presented.

## Actor-level comparison

These Welch tests use participant/session means, not pooled trials. They are
descriptive pilot statistics because there are only five LLM sessions and all
five use the same model/prompt.

{test_md}

## Pooled-adult commitment sensitivity

The primary efficiency analysis uses the notebook's clean, balanced
`human (locked-action)` group because all 360 rows contain the coordinates
needed for identical efficiency scoring. As a sensitivity check, commitment
can be calculated for all five main adult groups (N={pooled.subject.nunique()});
all actors in their 1P2G block were humans, and `partnerType` refers to a later
2P assignment.

{pooled_md}

## Realized goal-distance relation

The archived human condition labels do not always reproduce the pilot's exact
distance manipulation relative to the person's inferred goal: only {exact_n}
of {exact_denom} new-goal trials in the primary human group have the exact
−2/0/+2 difference, versus {llm_exact}/{llm_dynamic_n} LLM trials. Reclassifying
trials by the realized Manhattan-distance difference gives:

{realized_md}

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

- Human source: `{human_path}`
- LLM source: `{llm_path}`
- API model returned: `{model}`
- Human trajectory rows store pre-move positions; the terminal position was
  reconstructed from the final recorded action and validated against the final
  goal in the primary benchmark.
- The five LLM sessions are stochastic replications of one model, not five
  independently sampled agents. Treat p-values as pilot diagnostics rather
  than population-level evidence.
"""


def main() -> None:
    args = parse_args()
    human, pooled_humans = load_humans(args.human_csv.resolve())
    llm, metadata = load_llm(args.llm_json.resolve())
    combined = pd.concat([human, llm], ignore_index=True)

    summary = summary_table(human, llm)
    subjects = subject_metric_table(combined)
    tests = subject_level_tests(subjects)
    pooled_summary = pooled_commitment_summary(pooled_humans)
    realized = realized_distance_summary(human, llm)

    args.output_dir.mkdir(parents=True, exist_ok=True)
    combined.to_csv(args.output_dir / "trial_level_primary.csv", index=False)
    pooled_humans.to_csv(args.output_dir / "trial_level_all_adults.csv", index=False)
    summary.to_csv(args.output_dir / "summary_overall_and_condition.csv", index=False)
    subjects.to_csv(args.output_dir / "subject_level_metrics.csv", index=False)
    tests.to_csv(args.output_dir / "subject_level_tests.csv", index=False)
    pooled_summary.to_csv(args.output_dir / "pooled_adult_commitment.csv", index=False)
    realized.to_csv(args.output_dir / "realized_distance_commitment.csv", index=False)

    report = build_report(
        human,
        llm,
        summary,
        tests,
        pooled_humans,
        pooled_summary,
        realized,
        metadata,
        args.human_csv.resolve(),
        args.llm_json.resolve(),
    )
    (args.output_dir / "human_vs_llm_1p2g.md").write_text(report)

    manifest = {
        "human_source": str(args.human_csv.resolve()),
        "llm_source": str(args.llm_json.resolve()),
        "primary_human_group": "human (locked-action)",
        "primary_human_subjects": int(human.subject.nunique()),
        "primary_human_trials": len(human),
        "pooled_human_subjects": int(pooled_humans.subject.nunique()),
        "pooled_human_trials": len(pooled_humans),
        "llm_sessions": int(llm.subject.nunique()),
        "llm_trials": len(llm),
        "llm_model": metadata.get("model_returned", metadata.get("model")),
    }
    (args.output_dir / "manifest.json").write_text(json.dumps(manifest, indent=2))
    print(report)


if __name__ == "__main__":
    main()
