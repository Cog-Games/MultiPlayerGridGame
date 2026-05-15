"""BToM legibility plots for the model-model comparison report.

This reuses the Bayesian Theory of Mind goal-posterior calculation from
``btom_compare_agents.py`` and aligns paths/labels with
``dataAnalysis/model_model/model_model_comparison.html``.
"""
from __future__ import annotations

import argparse
import functools as ft
import gc
import json
import multiprocessing as mp
import subprocess
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import pandas as pd
import seaborn as sns

from btom_compare_agents import solve_goal_policy, softmax_action_probs


ROOT = Path(__file__).resolve().parents[1]
REPORT_DIR = ROOT / "model_model" / "report_assets"

GROUP_ORDER = [
    "sampleJointGoal_afterNewGoal",
    "sampleJointGoalAndSignal_afterNewGoal",
    "sampleJointGoal_fromStart",
    "sampleJointGoalAndSignal_fromStart",
    "sampleJointGoalAndRSASignal_fromStart",
    "samplePosteriorOnlyGoalAndSignal_fromStart",
    "TwoStageSignalAgent_sigmoidThreshold",
    "Human-Human",
]

GROUP_PALETTE = {
    "sampleJointGoal_afterNewGoal": "#4e79a7",
    "sampleJointGoalAndSignal_afterNewGoal": "#59a14f",
    "sampleJointGoal_fromStart": "#f28e2b",
    "sampleJointGoalAndSignal_fromStart": "#b07aa1",
    "sampleJointGoalAndRSASignal_fromStart": "#edc948",
    "samplePosteriorOnlyGoalAndSignal_fromStart": "#76b7b2",
    "TwoStageSignalAgent_sigmoidThreshold": "#e15759",
    "Human-Human": "#777777",
}

GROUP_DISPLAY_LABELS = {
    "sampleJointGoal_afterNewGoal": "sampleJointGoal\nafterNewGoal",
    "sampleJointGoalAndSignal_afterNewGoal": "sampleJointGoal+Signal\nafterNewGoal",
    "sampleJointGoal_fromStart": "sampleJointGoal\nfromStart",
    "sampleJointGoalAndSignal_fromStart": "sampleJointGoal+Signal\nfromStart",
    "sampleJointGoalAndRSASignal_fromStart": "sampleJointGoal+RSA\n(shared-agency model)\nfromStart",
    "samplePosteriorOnlyGoalAndSignal_fromStart": "samplePosteriorOnlyGoal+Signal\nfromStart",
    "TwoStageSignalAgent_sigmoidThreshold": "TwoStageSignal\nsigmoidThreshold",
    "Human-Human": "Human-Human",
}

GROUP_DISPLAY_ORDER = [GROUP_DISPLAY_LABELS[group] for group in GROUP_ORDER]
GROUP_DISPLAY_PALETTE = {
    GROUP_DISPLAY_LABELS[group]: color for group, color in GROUP_PALETTE.items()
}

GROUP_SLUGS = {
    "sampleJointGoal_afterNewGoal": "sample_after_new_goal",
    "sampleJointGoalAndSignal_afterNewGoal": "sample_and_signal_after_new_goal",
    "sampleJointGoal_fromStart": "sample_from_start",
    "sampleJointGoalAndSignal_fromStart": "sample_and_signal_from_start",
    "sampleJointGoalAndRSASignal_fromStart": "sample_and_rsa_signal_from_start",
    "samplePosteriorOnlyGoalAndSignal_fromStart": "sample_posterior_only_and_signal_from_start",
    "TwoStageSignalAgent_sigmoidThreshold": "two_stage_sigmoid_threshold",
    "Human-Human": "human_human",
}


def resolve_json_path(path: Path) -> Path:
    if path.exists():
        return path
    zst_path = Path(f"{path}.zst")
    if zst_path.exists():
        return zst_path
    raise FileNotFoundError(path)


def load_json(path: Path):
    resolved = resolve_json_path(Path(path))
    if resolved.suffix == ".zst":
        result = subprocess.run(["zstd", "-dc", str(resolved)], text=True, capture_output=True, check=True)
        return json.loads(result.stdout)
    return json.loads(resolved.read_text(encoding="utf-8"))


def primary_always_signal_raw_path() -> Path:
    summary = load_json(ROOT / "model_model" / "signal_agent" / "outputs" / "signal_agent_from_start_lambda_p_fit" / "always_signal_lambda_p_fit_summary.json")
    path = Path(summary.get("best_raw_trials") or summary.get("best_by_binomial_nll", {}).get("raw_trials"))
    return path if path.is_absolute() else ROOT.parent / path


def primary_posterior_only_signal_raw_path() -> Path:
    summary = load_json(ROOT / "model_model" / "signal_agent" / "outputs" / "signal_agent_posterior_only_lambda_p_fit" / "posterior_only_signal_lambda_p_fit_summary.json")
    path = Path(summary.get("best_raw_trials") or summary.get("best_by_binomial_nll", {}).get("raw_trials"))
    return path if path.is_absolute() else ROOT.parent / path


def primary_always_signal_rsa_raw_path() -> Path:
    summary = load_json(ROOT / "model_model" / "signal_agent" / "outputs" / "signal_agent_from_start_rsa_lambda_alpha_fit" / "always_signal_rsa_lambda_alpha_fit_summary.json")
    path = Path(summary.get("best_raw_trials") or summary.get("best_by_binomial_nll", {}).get("raw_trials"))
    return path if path.is_absolute() else ROOT.parent / path


def step_level_always_signal_raw_path() -> Path:
    summary = load_json(ROOT / "model_model" / "step_level_fit_comparison" / "step_level_fit_report_summary.json")
    path = Path(summary["raw_paths"]["sampleJointGoalAndSignal_fromStart"])
    return path if path.is_absolute() else ROOT.parent / path


def step_level_always_signal_rsa_raw_path() -> Path:
    summary = load_json(ROOT / "model_model" / "step_level_fit_comparison" / "step_level_fit_report_summary.json")
    path = Path(summary["raw_paths"]["sampleJointGoalAndRSASignal_fromStart"])
    return path if path.is_absolute() else ROOT.parent / path


def step_level_posterior_only_signal_raw_path() -> Path:
    summary = load_json(ROOT / "model_model" / "step_level_fit_comparison" / "step_level_fit_report_summary.json")
    path = Path(summary["raw_paths"]["samplePosteriorOnlyGoalAndSignal_fromStart"])
    return path if path.is_absolute() else ROOT.parent / path

DATA_PATHS = {
    "sampleJointGoal_afterNewGoal": ROOT
    / "model_model"
    / "committed_agent"
    / "outputs"
    / "btom_primary_raw"
    / "committed_vs_committed_2p3g_raw_trials_beta_3_lambda_0p125_sessions_0_to_29.json",
    "sampleJointGoalAndSignal_afterNewGoal": ROOT
    / "model_model"
    / "signal_agent"
    / "outputs"
    / "signal_agent_mixture_p_fit_beta3"
    / "simulations"
    / "signal_vs_signal_2p3g_raw_trials_beta_3_lambda_0p125_alpha_0p375_sessions_0_to_29.json",
    "sampleJointGoal_fromStart": ROOT
    / "model_model"
    / "always_committed_agent"
    / "outputs"
    / "always_committed_vs_always_committed_simulation"
    / "always_committed_vs_always_committed_2p3g_raw_trials_beta_3_lambda_0p15_sessions_0_to_29.json",
    "sampleJointGoalAndSignal_fromStart": primary_always_signal_raw_path,
    "sampleJointGoalAndRSASignal_fromStart": primary_always_signal_rsa_raw_path,
    "samplePosteriorOnlyGoalAndSignal_fromStart": primary_posterior_only_signal_raw_path,
    "TwoStageSignalAgent_sigmoidThreshold": ROOT
    / "raw_data"
    / "model_model_simulations"
    / "two_stage_signal_agent"
    / "mixture_lambda_p_tau2over3_eta0"
    / "two_stage_signal_vs_two_stage_signal_2p3g_raw_trials_signal_mixture_beta_3_lambda_0p1_tau_0p6666667_alpha_0_eta_0_sessions_0_to_29.json",
    "Human-Human": ROOT
    / "raw_data"
    / "human"
    / "equal_to_both_agent_human_comparison"
    / "human_human_pure_unique_2p3g_raw_trials.json",
}

STEP_LEVEL_DATA_PATHS = {
    "sampleJointGoal_afterNewGoal": ROOT
    / "model_model"
    / "step_level_fit_comparison"
    / "simulations"
    / "committed_agent"
    / "committed_vs_committed_2p3g_raw_trials_beta_3_lambda_18p14554903468059_sessions_0_to_29.json",
    "sampleJointGoalAndSignal_afterNewGoal": ROOT
    / "model_model"
    / "step_level_fit_comparison"
    / "simulations"
    / "signal_agent"
    / "signal_vs_signal_2p3g_raw_trials_beta_3_lambda_18p145549_alpha_0_sessions_0_to_29.json",
    "sampleJointGoal_fromStart": ROOT
    / "model_model"
    / "step_level_fit_comparison"
    / "simulations"
    / "always_committed_agent"
    / "always_committed_vs_always_committed_2p3g_raw_trials_beta_3_lambda_32p885637682566234_sessions_0_to_29.json",
    "sampleJointGoalAndSignal_fromStart": step_level_always_signal_raw_path,
    "sampleJointGoalAndRSASignal_fromStart": step_level_always_signal_rsa_raw_path,
    "samplePosteriorOnlyGoalAndSignal_fromStart": step_level_posterior_only_signal_raw_path,
    "TwoStageSignalAgent_sigmoidThreshold": ROOT
    / "raw_data"
    / "model_model_simulations"
    / "two_stage_signal_agent"
    / "step_level_fit_comparison"
    / "two_stage_signal_vs_two_stage_signal_2p3g_raw_trials_signal_mixture_beta_3_lambda_50_tau_0p6666666666666666_alpha_0_eta_0_sessions_0_to_29.json",
    "Human-Human": DATA_PATHS["Human-Human"],
}


@ft.lru_cache(maxsize=128)
def goal_action_probabilities(goal: tuple[int, int]) -> dict:
    """Compact cache for the notebook's VI policy.

    The legacy helper caches full Q-tables for every goal, which becomes memory
    heavy when this report compares multiple model-model datasets. This cache
    stores only action probabilities needed for BToM inference.
    """
    q_table = solve_goal_policy(goal)
    return {
        state: softmax_action_probs(q_state, beta=2.5)
        for state, q_state in q_table.items()
    }


def actions_from_trajectory(trajectory: list) -> list[tuple[int, int]]:
    return [
        (
            int(trajectory[i + 1][0]) - int(trajectory[i][0]),
            int(trajectory[i + 1][1]) - int(trajectory[i][1]),
        )
        for i in range(len(trajectory) - 1)
    ]


def infer_goal_posteriors(traj_states: list, actions: list, goal_a: tuple[int, int], goal_b: tuple[int, int]) -> list:
    policy_a = goal_action_probabilities(goal_a)
    policy_b = goal_action_probabilities(goal_b)
    prior = [0.5, 0.5]
    posteriors = [list(prior)]
    for position, action in zip(traj_states, actions):
        position = tuple(int(v) for v in position)
        action = tuple(int(v) for v in action)
        like_a = policy_a.get(position, {}).get(action, 1e-10)
        like_b = policy_b.get(position, {}).get(action, 1e-10)
        unnormalized = [prior[0] * like_a, prior[1] * like_b]
        z = sum(unnormalized)
        prior = [u / z for u in unnormalized] if z > 0 else [0.5, 0.5]
        posteriors.append(list(prior))
    return posteriors


def btom_for_player(row: dict, player_index: int) -> list[float] | None:
    target1 = row.get("target1")
    target2 = row.get("target2")
    new_goal_pos = row.get("newGoalPosition")
    if target1 is None or target2 is None or new_goal_pos is None:
        return None

    try:
        shared_idx = int(row.get("firstDetectedSharedGoal"))
    except (TypeError, ValueError):
        return None
    if shared_idx not in (0, 1):
        return None

    old_shared_goal = target1 if shared_idx == 0 else target2
    final_col = "player1FinalReachedGoal" if player_index == 0 else "player2FinalReachedGoal"
    try:
        final_idx = int(row.get(final_col))
    except (TypeError, ValueError):
        return None

    if final_idx == shared_idx:
        reached_idx = 0
    elif final_idx == 2:
        reached_idx = 1
    else:
        return None

    trajectory = row.get(f"player{player_index + 1}Trajectory")
    if not trajectory or len(trajectory) < 2:
        return None

    try:
        new_goal_time = int(row.get("newGoalPresentedTime"))
    except (TypeError, ValueError):
        return None
    if new_goal_time < 0 or new_goal_time >= len(trajectory) - 1:
        return None

    sub_trajectory = trajectory[new_goal_time:]
    sub_actions = actions_from_trajectory(sub_trajectory)
    if not sub_actions:
        return None

    posteriors = infer_goal_posteriors(
        sub_trajectory[:-1],
        sub_actions,
        tuple(int(v) for v in old_shared_goal),
        tuple(int(v) for v in new_goal_pos),
    )
    return [p[reached_idx] for p in posteriors]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output-dir", type=Path, default=REPORT_DIR)
    parser.add_argument(
        "--data-profile",
        choices=["primary", "step_level_fit"],
        default="primary",
        help="Raw model-model simulation set to analyze.",
    )
    parser.add_argument("--max-step", type=int, default=5)
    parser.add_argument(
        "--include-human",
        action=argparse.BooleanOptionalAction,
        default=True,
        help="Include Human-Human reference in the plots.",
    )
    parser.add_argument(
        "--in-process",
        action="store_true",
        help="Load groups in the current process instead of one isolated worker per group.",
    )
    parser.add_argument(
        "--single-group",
        choices=GROUP_ORDER,
        help="Compute and cache BToM trajectories for one group, then exit.",
    )
    parser.add_argument(
        "--combine-cached",
        action="store_true",
        help="Read cached per-group BToM trajectories and only generate plots/summary CSVs.",
    )
    return parser.parse_args()


def participant_id(trial: dict, group: str, player_index: int) -> str:
    field = f"participantId_player{player_index + 1}"
    if field in trial and trial.get(field) is not None:
        return str(trial[field])
    if player_index == 0 and trial.get("participantId") is not None:
        return str(trial["participantId"])
    session = trial.get("sessionIndex", "?")
    trial_index = trial.get("trialIndex", "?")
    return f"{group}_session_{session}_trial_{trial_index}_p{player_index + 1}"


def resolve_data_path(path_or_loader) -> Path:
    path = path_or_loader() if callable(path_or_loader) else path_or_loader
    return resolve_json_path(Path(path))


def load_group(group: str, path: Path) -> pd.DataFrame:
    trials = load_json(path)

    rows = []
    for trial in trials:
        if not trial.get("newGoalPresented"):
            continue
        for player_index in (0, 1):
            posteriors = btom_for_player(trial, player_index)
            if posteriors is None:
                continue
            rows.append(
                {
                    "group": group,
                    "participantId": participant_id(trial, group, player_index),
                    "sessionIndex": trial.get("sessionIndex"),
                    "trialIndex": trial.get("trialIndex"),
                    "playerIndex": player_index + 1,
                    "distanceCondition": trial.get("distanceCondition"),
                    "nSteps": len(posteriors),
                    "posteriors": posteriors,
                }
            )
    return pd.DataFrame(rows)


def load_group_worker(args: tuple[str, str]) -> pd.DataFrame:
    group, path_text = args
    return load_group(group, Path(path_text))


def load_group_isolated(group: str, path: Path) -> pd.DataFrame:
    """Run each BToM group in a fresh process to release VI-policy memory."""
    ctx = mp.get_context("fork")
    with ctx.Pool(processes=1) as pool:
        return pool.apply(load_group_worker, ((group, str(path)),))


def group_cache_path(output_dir: Path, group: str) -> Path:
    return output_dir / f"btom_model_model_player_trajectories_{GROUP_SLUGS[group]}.csv"


def write_group_cache(df: pd.DataFrame, output_dir: Path, group: str) -> Path:
    cached = df.copy()
    cached["posteriors"] = cached["posteriors"].apply(json.dumps)
    out = group_cache_path(output_dir, group)
    cached.to_csv(out, index=False)
    return out


def read_group_cache(output_dir: Path, group: str) -> pd.DataFrame:
    path = group_cache_path(output_dir, group)
    if not path.exists():
        raise FileNotFoundError(f"Missing cached BToM trajectories for {group}: {path}")
    df = pd.read_csv(path)
    df["posteriors"] = df["posteriors"].apply(json.loads)
    return df


def build_step_tables(btom_df: pd.DataFrame, max_step: int) -> tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame]:
    step_rows = []
    for _, row in btom_df.iterrows():
        for step, posterior in enumerate(row["posteriors"][: max_step + 1]):
            step_rows.append(
                {
                    "group": row["group"],
                    "participantId": row["participantId"],
                    "sessionIndex": row["sessionIndex"],
                    "trialIndex": row["trialIndex"],
                    "playerIndex": row["playerIndex"],
                    "distanceCondition": row["distanceCondition"],
                    "stepFromNewGoal": step,
                    "posterior": posterior,
                }
            )

    step_long = pd.DataFrame(step_rows)
    step_participant = (
        step_long.groupby(["participantId", "group", "stepFromNewGoal"], observed=False)["posterior"]
        .mean()
        .reset_index()
    )
    mean_participant = (
        step_participant.groupby(["participantId", "group"], observed=False)["posterior"]
        .mean()
        .reset_index()
    )
    return step_long, step_participant, mean_participant


def add_chance_line(ax) -> None:
    ax.axhline(0.5, ls="--", lw=1.2, color="#6b7280", alpha=0.55)


def plot_first5_line(step_participant: pd.DataFrame, output_dir: Path, max_step: int) -> Path:
    fig, ax = plt.subplots(figsize=(11.5, 7))
    sns.lineplot(
        data=step_participant,
        x="stepFromNewGoal",
        y="posterior",
        hue="plotGroup",
        hue_order=GROUP_DISPLAY_ORDER,
        palette=GROUP_DISPLAY_PALETTE,
        errorbar=("ci", 95),
        marker="o",
        linewidth=2.4,
        ax=ax,
    )
    add_chance_line(ax)
    ax.set(
        xlabel="Steps from new-goal presentation",
        ylabel="BToM posterior P(final reached goal)",
        title="BToM Legibility Over First 5 Steps After New Goal",
        xlim=(-0.1, max_step + 0.1),
        ylim=(0.4, 1.02),
    )
    ax.set_xticks(range(max_step + 1))
    ax.legend(title="Group", bbox_to_anchor=(1.02, 1), loc="upper left", fontsize=12, title_fontsize=13)
    sns.despine()
    fig.tight_layout()
    out = output_dir / "btom_model_model_first5_trajectory.png"
    fig.savefig(out, dpi=160, bbox_inches="tight")
    plt.close(fig)
    return out


def plot_first5_mean(mean_participant: pd.DataFrame, output_dir: Path) -> Path:
    fig, ax = plt.subplots(figsize=(12, 6.8))
    sns.barplot(
        data=mean_participant,
        x="plotGroup",
        y="posterior",
        order=GROUP_DISPLAY_ORDER,
        hue="plotGroup",
        palette=GROUP_DISPLAY_PALETTE,
        legend=False,
        errorbar=("ci", 95),
        err_kws={"color": "black", "linewidth": 1.3},
        capsize=0.08,
        alpha=0.92,
        ax=ax,
    )
    add_chance_line(ax)
    ax.set(
        xlabel="Group",
        ylabel="Mean BToM posterior P(final reached goal)",
        title="Mean BToM Posterior Across First 5 Steps",
        ylim=(0.4, 1.0),
    )
    for container in ax.containers:
        ax.bar_label(container, fmt="%.3f", fontsize=10, padding=3)
    for label in ax.get_xticklabels():
        label.set_rotation(0)
        label.set_ha("center")
    ax.tick_params(axis="x", labelsize=12)
    sns.despine()
    fig.tight_layout()
    out = output_dir / "btom_model_model_first5_mean_posterior.png"
    fig.savefig(out, dpi=160, bbox_inches="tight")
    plt.close(fig)
    return out


def main() -> None:
    args = parse_args()
    args.output_dir.mkdir(parents=True, exist_ok=True)
    sns.set_theme(style="whitegrid", context="talk")

    data_paths = DATA_PATHS if args.data_profile == "primary" else STEP_LEVEL_DATA_PATHS
    groups = GROUP_ORDER if args.include_human else GROUP_ORDER[:-1]

    if args.single_group:
        group = args.single_group
        path = resolve_data_path(data_paths[group])
        print(f"Loading {group} ...", flush=True)
        df = load_group(group, path)
        out = write_group_cache(df, args.output_dir, group)
        print(f"{group}: {len(df)} BToM player-trajectories")
        print(f"Wrote {out}")
        return

    frames = []
    if args.combine_cached:
        for group in groups:
            df = read_group_cache(args.output_dir, group)
            print(f"{group}: {len(df)} cached BToM player-trajectories")
            frames.append(df)
    else:
        for group in groups:
            path = resolve_data_path(data_paths[group])
            goal_action_probabilities.cache_clear()
            gc.collect()
            print(f"Loading {group} ...", flush=True)
            if args.in_process:
                df = load_group(group, path)
            else:
                df = load_group_isolated(group, path)
            print(f"{group}: {len(df)} BToM player-trajectories from {path}")
            write_group_cache(df, args.output_dir, group)
            del df
            goal_action_probabilities.cache_clear()
            gc.collect()
        for group in groups:
            df = read_group_cache(args.output_dir, group)
            print(f"{group}: {len(df)} cached BToM player-trajectories")
            frames.append(df)

    btom_df = pd.concat(frames, ignore_index=True)
    step_long, step_participant, mean_participant = build_step_tables(btom_df, args.max_step)
    step_long["plotGroup"] = step_long["group"].map(GROUP_DISPLAY_LABELS)
    step_participant["plotGroup"] = step_participant["group"].map(GROUP_DISPLAY_LABELS)
    mean_participant["plotGroup"] = mean_participant["group"].map(GROUP_DISPLAY_LABELS)

    line_path = plot_first5_line(step_participant, args.output_dir, args.max_step)
    mean_path = plot_first5_mean(mean_participant, args.output_dir)

    rows_for_csv = btom_df.copy()
    rows_for_csv["posteriors"] = rows_for_csv["posteriors"].apply(json.dumps)
    rows_for_csv.to_csv(args.output_dir / "btom_model_model_player_trajectories.csv", index=False)
    step_long.to_csv(args.output_dir / "btom_model_model_first5_step_long.csv", index=False)
    step_participant.to_csv(args.output_dir / "btom_model_model_first5_step_per_participant.csv", index=False)
    mean_participant.to_csv(args.output_dir / "btom_model_model_first5_mean_per_participant.csv", index=False)

    summary = (
        mean_participant.groupby("group", observed=False)["posterior"]
        .agg(["mean", "std", "count"])
        .reset_index()
    )
    summary.to_csv(args.output_dir / "btom_model_model_first5_summary.csv", index=False)

    print(f"Unique compact BToM goal policies solved: {goal_action_probabilities.cache_info().currsize}")
    print("\nMean posterior across first 5 steps:")
    print(summary.to_string(index=False))
    print(f"\nWrote {line_path}")
    print(f"Wrote {mean_path}")


if __name__ == "__main__":
    main()
