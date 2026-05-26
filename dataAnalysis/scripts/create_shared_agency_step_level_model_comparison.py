#!/usr/bin/env python3
"""Focused step-level report for Individual RL, Joint RL, and shared-agency baselines."""

from __future__ import annotations

import html
import json
import math
import os
import subprocess
import sys
from itertools import product
from pathlib import Path
from typing import Any, Dict, List, Sequence, Tuple

import numpy as np
import pandas as pd

os.environ.setdefault("MPLCONFIGDIR", "/tmp/mplconfig")
import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt

PROJECT_ROOT = Path(__file__).resolve().parents[2]
SCRIPT_DIR = PROJECT_ROOT / "dataAnalysis" / "scripts"
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from create_step_level_model_model_comparison import (  # noqa: E402
    ACTIONS,
    ACTION_TO_INDEX,
    EPS,
    GOAL_REWARD,
    GRID_SIZE,
    HUMAN_RAW,
    SOFTMAX_BETA,
    STEP_COST,
    StepObs,
    build_observations,
    goal_weights,
    load_human_rows,
    nll,
    revealed_posterior,
    refinement_values,
    rsa_signal_likelihood,
    transition,
)
from create_no_latent_joint_rl_shared_agency_baseline_report import (  # noqa: E402
    BETA,
    HUMAN_LABEL,
    INDIVIDUAL_LABEL,
    NO_LATENT_LABEL,
    SHARED_BASELINE_LABEL,
    SHARED_COMMITMENT_LABEL,
    SHARED_FULL_LABEL,
    SHARED_RSA_LEGACY_LABEL,
    TRIALS,
    build_btom_step_tables,
    build_btom_table,
    btom_step1_metric_rows,
    compress_raw,
    plot_btom_trajectory,
    plot_comparison,
    wide_summary,
)
from fit_signal_alpha_beta3 import add_measures, comparison_rows, load_raw, long_player_rows, resolved_raw_path  # noqa: E402


MODEL_ROOT = PROJECT_ROOT / "dataAnalysis" / "model_model"
OUT_DIR = MODEL_ROOT / "shared_agency_step_level_model_comparison"
ASSET_DIR = OUT_DIR / "assets"
SIM_DIR = OUT_DIR / "simulations"
RAW_DIR = (
    PROJECT_ROOT
    / "dataAnalysis"
    / "raw_data"
    / "model_model_simulations"
    / "joint_rl"
    / "shared_agency_step_level_model_comparison"
)
NOTEBOOK_DIR = MODEL_ROOT / "joint_rl" / "notebooks" / "shared_agency_step_level_model_comparison"
NOTEBOOK_PATH = NOTEBOOK_DIR / "shared_agency_step_level_model_comparison.ipynb"
HTML_PATH = MODEL_ROOT / "shared_agency_step_level_model_comparison.html"

JOINT_RL_SCRIPT = PROJECT_ROOT / "dataAnalysis" / "scripts" / "simulate_joint_rl_vs_joint_rl_2p3g.js"
SHARED_SCRIPT = PROJECT_ROOT / "dataAnalysis" / "scripts" / "simulate_always_signal_vs_always_signal_2p3g.js"
TRIAL_BEST_CSV = (
    MODEL_ROOT
    / "joint_rl"
    / "outputs"
    / "no_latent_joint_rl_shared_agency_baseline"
    / "shared_agency_commitment_signaling_best_joint_lambda_alpha.csv"
)
COSTLY_MIXTURE_TRIAL_BEST_CSV = (
    MODEL_ROOT
    / "shared_agency_costly_mixture_rho_sweep"
    / "shared_agency_costly_mixture_best_rho.csv"
)
COSTLY_MIXTURE_STEP_DIR = MODEL_ROOT / "shared_agency_costly_mixture_step_level_fit"
COSTLY_MIXTURE_STEP_RAW_SOURCES_CSV = COSTLY_MIXTURE_STEP_DIR / "costly_mixture_step_level_raw_sources.csv"
COSTLY_MIXTURE_STEP13_LABEL = "Communicative action mixture step-1-3 fit"
CAM_NAME = "Communicative Action Mixture (Legibility Over Alternatives)"

SESSIONS = 30
SEED = 42
CV_FOLDS = 5
COARSE_LAMBDAS = [0.0, 0.05, 0.1, 0.15, 0.3, 0.5, 1.0]
COARSE_ALPHAS = [round(i * 0.1, 10) for i in range(11)]
COARSE_RHOS = [round(i * 0.05, 10) for i in range(21)]
COSTLY_MIXTURE_LAMBDA = 0.2
SIGNAL_WINDOW_START = 1
SIGNAL_WINDOW_END = 3
MODEL_ORDER = [
    INDIVIDUAL_LABEL,
    NO_LATENT_LABEL,
    SHARED_BASELINE_LABEL,
    SHARED_COMMITMENT_LABEL,
    SHARED_FULL_LABEL,
    HUMAN_LABEL,
]
FIT_MODEL_ORDER = MODEL_ORDER[:-1]
PALETTE = {
    INDIVIDUAL_LABEL: "#b07aa1",
    NO_LATENT_LABEL: "#4f79a8",
    SHARED_BASELINE_LABEL: "#59a14f",
    SHARED_COMMITMENT_LABEL: "#9c755f",
    SHARED_FULL_LABEL: "#e15759",
    HUMAN_LABEL: "#f28e2b",
}


def rel(path: Path) -> str:
    return path.resolve().relative_to(MODEL_ROOT.resolve()).as_posix()


def fmt(value: float) -> str:
    return f"{value:g}".replace("-", "neg").replace(".", "p")


def softmax(values: Sequence[float], beta: float = SOFTMAX_BETA) -> np.ndarray:
    arr = np.asarray(values, dtype=np.float64)
    if arr.size == 0 or not np.all(np.isfinite(arr)):
        return np.full(max(1, arr.size), 1.0 / max(1, arr.size), dtype=np.float64)
    scaled = np.clip(beta * (arr - float(np.max(arr))), -700, 700)
    prefs = np.exp(scaled)
    total = float(np.sum(prefs))
    if not math.isfinite(total) or total <= 0:
        return np.full(arr.size, 1.0 / arr.size, dtype=np.float64)
    return prefs / total


_INDIVIDUAL_POLICY_CACHE: Dict[Tuple[Tuple[int, int], ...], Dict[Tuple[int, int], np.ndarray]] = {}


def canonical_goals(goals: Sequence[Tuple[int, int]]) -> Tuple[Tuple[int, int], ...]:
    return tuple(sorted(tuple(goal) for goal in goals))


def individual_policy_for_goals(goals: Sequence[Tuple[int, int]]) -> Dict[Tuple[int, int], np.ndarray]:
    goal_tuple = canonical_goals(goals)
    cached = _INDIVIDUAL_POLICY_CACHE.get(goal_tuple)
    if cached is not None:
        return cached
    goal_set = set(goal_tuple)
    states = [(r, c) for r in range(GRID_SIZE) for c in range(GRID_SIZE)]
    value = {state: (0.0 if state in goal_set else 0.1) for state in states}

    for _ in range(100):
        old = dict(value)
        delta = 0.0
        for state in states:
            if state in goal_set:
                continue
            q_values = []
            for action in ACTIONS:
                nxt = transition(state, action)
                reward = STEP_COST + (GOAL_REWARD if nxt in goal_set else 0.0)
                q_values.append(reward + 0.9 * old[nxt])
            best = max(q_values)
            delta = max(delta, abs(best - value[state]))
            value[state] = best
        if delta < 0.001:
            break

    for goal in goal_set:
        value[goal] = GOAL_REWARD

    policy: Dict[Tuple[int, int], np.ndarray] = {}
    for state in states:
        q_values = []
        for action in ACTIONS:
            nxt = transition(state, action)
            reward = STEP_COST + (GOAL_REWARD if nxt in goal_set else 0.0)
            q_values.append(reward + 0.9 * value[nxt])
        policy[state] = softmax(q_values, SOFTMAX_BETA)
    _INDIVIDUAL_POLICY_CACHE[goal_tuple] = policy
    return policy


def individual_action_probabilities(pos: Tuple[int, int], goals: Sequence[Tuple[int, int]]) -> np.ndarray:
    if not goals:
        return np.full(len(ACTIONS), 1.0 / len(ACTIONS), dtype=np.float64)
    return individual_policy_for_goals(goals).get(tuple(pos), np.full(len(ACTIONS), 1.0 / len(ACTIONS)))


def new_goal_time_map(rows: Sequence[Dict[str, Any]]) -> Dict[tuple[str, int], int]:
    out: Dict[tuple[str, int], int] = {}
    for row in rows:
        if not row.get("newGoalPresented"):
            continue
        try:
            out[(str(row.get("roomId")), int(row.get("trialIndex") or 0))] = int(row.get("newGoalPresentedTime"))
        except Exception:
            continue
    return out


def signal_window_observations(rows: Sequence[Dict[str, Any]], start: int = SIGNAL_WINDOW_START, end: int = SIGNAL_WINDOW_END) -> List[StepObs]:
    observations = build_observations(rows, "always_signal_rsa")
    time_map = new_goal_time_map(rows)
    filtered: List[StepObs] = []
    for obs in observations:
        new_time = time_map.get((obs.room_id, obs.trial_index))
        if new_time is None:
            continue
        relative_step = int(obs.step) - int(new_time)
        if start <= relative_step <= end:
            filtered.append(obs)
    return filtered


def log_odds_score(obs: StepObs, goal_idx: int, action_idx: int) -> float:
    post = revealed_posterior(obs.posterior, obs.action_probs_by_goal, action_idx)
    target = max(EPS, min(1.0 - EPS, float(post[goal_idx])))
    other = max(EPS, float(np.sum(post) - target))
    return float(math.log(target) - math.log(other))


def communicative_policy(obs: StepObs, goal_idx: int) -> np.ndarray:
    base_probs = np.maximum(EPS, obs.action_probs_by_goal[goal_idx, :])
    base_probs = base_probs / max(EPS, float(np.sum(base_probs)))
    unnormalized = np.zeros(len(ACTIONS), dtype=np.float64)
    for action_idx in range(len(ACTIONS)):
        unnormalized[action_idx] = base_probs[action_idx] * math.exp(
            max(-700.0, min(700.0, log_odds_score(obs, goal_idx, action_idx)))
        )
    total = float(np.sum(unnormalized))
    if not math.isfinite(total) or total <= 0:
        return base_probs
    probs = np.maximum(EPS, unnormalized / total)
    return probs / max(EPS, float(np.sum(probs)))


def costly_mixture_goal_policy(obs: StepObs, goal_idx: int, rho: float) -> np.ndarray:
    rho = max(0.0, min(1.0, float(rho)))
    base_probs = np.maximum(EPS, obs.action_probs_by_goal[goal_idx, :])
    base_probs = base_probs / max(EPS, float(np.sum(base_probs)))
    comm_probs = communicative_policy(obs, goal_idx)
    probs = (1.0 - rho) * base_probs + rho * comm_probs
    probs = np.maximum(EPS, probs)
    return probs / max(EPS, float(np.sum(probs)))


def costly_mixture_likelihood(obs: StepObs, rho: float, lambda_value: float = COSTLY_MIXTURE_LAMBDA) -> float:
    weights = goal_weights(obs, lambda_value)
    per_goal = np.zeros(len(weights), dtype=np.float64)
    for goal_idx in range(len(weights)):
        per_goal[goal_idx] = costly_mixture_goal_policy(obs, goal_idx, rho)[obs.observed_idx]
    return max(EPS, float(np.sum(weights * per_goal)))


def likelihood(
    obs: StepObs,
    model: str,
    lambda_value: float | None = None,
    alpha: float | None = None,
    rho: float | None = None,
) -> float:
    if model == INDIVIDUAL_LABEL:
        probs = individual_action_probabilities(obs.self_pos, obs.goals)
        return max(EPS, float(probs[obs.observed_idx]))
    if model == NO_LATENT_LABEL:
        return max(EPS, float(obs.action_probs_all[obs.observed_idx]))
    if model == SHARED_BASELINE_LABEL:
        return rsa_signal_likelihood(obs, 0.0, 0.0)
    if model == SHARED_COMMITMENT_LABEL:
        return rsa_signal_likelihood(obs, float(lambda_value), 0.0)
    if model == SHARED_FULL_LABEL:
        lambda_for_costly = COSTLY_MIXTURE_LAMBDA if lambda_value is None else float(lambda_value)
        return costly_mixture_likelihood(obs, float(rho), lambda_for_costly)
    if model == SHARED_RSA_LEGACY_LABEL:
        return rsa_signal_likelihood(obs, float(lambda_value), float(alpha))
    raise ValueError(model)


def score_nll(
    observations: Sequence[StepObs],
    model: str,
    lambda_value: float | None = None,
    alpha: float | None = None,
    rho: float | None = None,
) -> float:
    return nll(observations, lambda obs: likelihood(obs, model, lambda_value, alpha, rho))


def fit_commitment_lambda(observations: Sequence[StepObs]) -> Tuple[pd.DataFrame, Dict[str, Any]]:
    rows = [
        {
            "lambda": float(lambda_value),
            "alpha": 0.0,
            "negative_log_likelihood": score_nll(observations, SHARED_COMMITMENT_LABEL, float(lambda_value), 0.0),
            "fit_stage": "coarse",
        }
        for lambda_value in COARSE_LAMBDAS
    ]
    coarse = pd.DataFrame(rows)
    best_coarse = coarse.loc[coarse["negative_log_likelihood"].idxmin()].to_dict()
    seen = {round(float(row["lambda"]), 10) for row in coarse.to_dict(orient="records")}
    for lambda_value in refinement_values(float(best_coarse["lambda"]), COARSE_LAMBDAS, 0.0, 1.0):
        key = round(float(lambda_value), 10)
        if key in seen:
            continue
        seen.add(key)
        rows.append(
            {
                "lambda": float(lambda_value),
                "alpha": 0.0,
                "negative_log_likelihood": score_nll(observations, SHARED_COMMITMENT_LABEL, float(lambda_value), 0.0),
                "fit_stage": "refine",
            }
        )
    df = pd.DataFrame(rows).sort_values(["lambda", "fit_stage"]).reset_index(drop=True)
    return df, df.loc[df["negative_log_likelihood"].idxmin()].to_dict()


def fit_joint_lambda_alpha(observations: Sequence[StepObs]) -> Tuple[pd.DataFrame, Dict[str, Any]]:
    rows = []
    seen: set[Tuple[float, float]] = set()
    for lambda_value, alpha in product(COARSE_LAMBDAS, COARSE_ALPHAS):
        key = (round(float(lambda_value), 10), round(float(alpha), 10))
        seen.add(key)
        rows.append(
            {
                "lambda": float(lambda_value),
                "alpha": float(alpha),
                "negative_log_likelihood": score_nll(observations, SHARED_RSA_LEGACY_LABEL, float(lambda_value), float(alpha)),
                "fit_stage": "coarse",
            }
        )
    coarse = pd.DataFrame(rows)
    best_coarse = coarse.loc[coarse["negative_log_likelihood"].idxmin()].to_dict()
    refine_lambdas = refinement_values(float(best_coarse["lambda"]), COARSE_LAMBDAS, 0.0, 1.0)
    refine_alphas = refinement_values(float(best_coarse["alpha"]), COARSE_ALPHAS, 0.0, 1.0)
    for lambda_value, alpha in product(refine_lambdas, refine_alphas):
        key = (round(float(lambda_value), 10), round(float(alpha), 10))
        if key in seen:
            continue
        seen.add(key)
        rows.append(
            {
                "lambda": float(lambda_value),
                "alpha": float(alpha),
                "negative_log_likelihood": score_nll(observations, SHARED_RSA_LEGACY_LABEL, float(lambda_value), float(alpha)),
                "fit_stage": "refine",
            }
        )
    df = pd.DataFrame(rows).sort_values(["lambda", "alpha"]).reset_index(drop=True)
    return df, df.loc[df["negative_log_likelihood"].idxmin()].to_dict()


def fit_costly_mixture_rho(observations: Sequence[StepObs]) -> Tuple[pd.DataFrame, Dict[str, Any]]:
    rows = [
        {
            "lambda": COSTLY_MIXTURE_LAMBDA,
            "rho": float(rho),
            "negative_log_likelihood": score_nll(observations, SHARED_FULL_LABEL, COSTLY_MIXTURE_LAMBDA, rho=float(rho)),
            "fit_stage": "coarse",
        }
        for rho in COARSE_RHOS
    ]
    coarse = pd.DataFrame(rows)
    best_coarse = coarse.loc[coarse["negative_log_likelihood"].idxmin()].to_dict()
    seen = {round(float(row["rho"]), 10) for row in coarse.to_dict(orient="records")}
    for rho in refinement_values(float(best_coarse["rho"]), COARSE_RHOS, 0.0, 1.0):
        key = round(float(rho), 10)
        if key in seen:
            continue
        seen.add(key)
        rows.append(
            {
                "lambda": COSTLY_MIXTURE_LAMBDA,
                "rho": float(rho),
                "negative_log_likelihood": score_nll(observations, SHARED_FULL_LABEL, COSTLY_MIXTURE_LAMBDA, rho=float(rho)),
                "fit_stage": "refine",
            }
        )
    df = pd.DataFrame(rows).sort_values("rho").reset_index(drop=True)
    return df, df.loc[df["negative_log_likelihood"].idxmin()].to_dict()


def fit_all_models(observations: Sequence[StepObs]) -> Tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame, Dict[str, Dict[str, Any]], Dict[str, Any]]:
    commitment_grid, commitment_best = fit_commitment_lambda(observations)
    legacy_rsa_grid, legacy_rsa_best = fit_joint_lambda_alpha(observations)
    costly_grid, costly_best = fit_costly_mixture_rho(observations)
    fits = {
        INDIVIDUAL_LABEL: {"negative_log_likelihood": score_nll(observations, INDIVIDUAL_LABEL), "n_params": 0},
        NO_LATENT_LABEL: {"negative_log_likelihood": score_nll(observations, NO_LATENT_LABEL), "n_params": 0},
        SHARED_BASELINE_LABEL: {"lambda": 0.0, "alpha": 0.0, "negative_log_likelihood": score_nll(observations, SHARED_BASELINE_LABEL), "n_params": 0},
        SHARED_COMMITMENT_LABEL: {"lambda": float(commitment_best["lambda"]), "alpha": 0.0, "negative_log_likelihood": float(commitment_best["negative_log_likelihood"]), "n_params": 1},
        SHARED_FULL_LABEL: {
            "lambda": COSTLY_MIXTURE_LAMBDA,
            "rho": float(costly_best["rho"]),
            "negative_log_likelihood": float(costly_best["negative_log_likelihood"]),
            "n_params": 1,
        },
    }
    legacy_rsa_fit = {
        "lambda": float(legacy_rsa_best["lambda"]),
        "alpha": float(legacy_rsa_best["alpha"]),
        "negative_log_likelihood": float(legacy_rsa_best["negative_log_likelihood"]),
        "n_params": 2,
    }
    return commitment_grid, legacy_rsa_grid, costly_grid, fits, legacy_rsa_fit


def fold_id_map(observations: Sequence[StepObs], n_folds: int) -> Dict[str, int]:
    groups = sorted({obs.room_id or f"trial_{obs.trial_index}" for obs in observations})
    return {group: idx % n_folds for idx, group in enumerate(groups)}


def cross_validated_scores(observations: Sequence[StepObs], n_folds: int = CV_FOLDS) -> pd.DataFrame:
    group_to_fold = fold_id_map(observations, n_folds)
    rows = []
    for fold in range(n_folds):
        train = [obs for obs in observations if group_to_fold.get(obs.room_id or f"trial_{obs.trial_index}") != fold]
        test = [obs for obs in observations if group_to_fold.get(obs.room_id or f"trial_{obs.trial_index}") == fold]
        _, _, _, fits, _legacy_rsa_fit = fit_all_models(train)
        for model in FIT_MODEL_ORDER:
            fit = fits[model]
            test_nll = score_nll(test, model, fit.get("lambda"), fit.get("alpha"), fit.get("rho"))
            train_nll = score_nll(train, model, fit.get("lambda"), fit.get("alpha"), fit.get("rho"))
            rows.append(
                {
                    "fold": fold,
                    "model": model,
                    "lambda": fit.get("lambda", np.nan),
                    "alpha": fit.get("alpha", np.nan),
                    "rho": fit.get("rho", np.nan),
                    "train_negative_log_likelihood": train_nll,
                    "test_negative_log_likelihood": test_nll,
                    "train_actions": len(train),
                    "test_actions": len(test),
                }
            )
    return pd.DataFrame(rows)


def summarize_cv(cv_df: pd.DataFrame, full_fits: Dict[str, Dict[str, Any]], n_actions: int) -> pd.DataFrame:
    rows = []
    for model in FIT_MODEL_ORDER:
        sub = cv_df[cv_df["model"] == model]
        heldout = float(sub["test_negative_log_likelihood"].sum())
        in_sample = float(full_fits[model]["negative_log_likelihood"])
        n_params = int(full_fits[model].get("n_params", 0))
        rows.append(
            {
                "model": model,
                "lambda": full_fits[model].get("lambda", np.nan),
                "alpha": full_fits[model].get("alpha", np.nan),
                "rho": full_fits[model].get("rho", np.nan),
                "n_params": n_params,
                "actions": n_actions,
                "in_sample_nll": in_sample,
                "heldout_nll": heldout,
                "heldout_nll_per_action": heldout / max(1, n_actions),
                "aic": 2 * n_params + 2 * in_sample,
                "bic": math.log(max(1, n_actions)) * n_params + 2 * in_sample,
            }
        )
    out = pd.DataFrame(rows)
    best = float(out["heldout_nll"].min())
    out["delta_heldout_nll"] = out["heldout_nll"] - best
    return out.sort_values("heldout_nll").reset_index(drop=True)


def expected_shared_raw(lambda_value: float, alpha: float, raw_dir: Path) -> Path:
    suffix = f"beta_{fmt(BETA)}_lambda_{fmt(lambda_value)}_alpha_{fmt(alpha)}_sessions_0_to_{SESSIONS - 1}"
    return raw_dir / f"always_signal_vs_always_signal_2p3g_raw_trials_{suffix}.json"


def expected_costly_mixture_raw(rho: float, raw_dir: Path) -> Path:
    suffix = f"beta_{fmt(BETA)}_lambda_{fmt(COSTLY_MIXTURE_LAMBDA)}_alpha_{fmt(rho)}_score_costly_mixture_sessions_0_to_{SESSIONS - 1}"
    return raw_dir / f"always_signal_vs_always_signal_2p3g_raw_trials_{suffix}.json"


def expected_joint_raw(policy: str, raw_dir: Path, unshaped: bool) -> Path:
    prefix = "individual_" if policy == "individual" else ""
    shape = "unshaped_" if unshaped else ""
    suffix = f"{prefix}{shape}sessions_0_to_{SESSIONS - 1}"
    return raw_dir / f"joint_rl_vs_joint_rl_2p3g_raw_trials_{suffix}.json"


def raw_exists(path: Path) -> Path | None:
    try:
        return resolved_raw_path(path)
    except FileNotFoundError:
        return None


def run_json_command(cmd: List[str], expected_raw: Path) -> Dict[str, Any]:
    existing = raw_exists(expected_raw)
    if existing is not None:
        return {"rawTrialsPath": str(existing), "command": " ".join(cmd)}
    result = subprocess.run(cmd, cwd=PROJECT_ROOT, text=True, capture_output=True)
    if result.returncode != 0:
        if result.stdout:
            print(result.stdout)
        if result.stderr:
            print(result.stderr)
        result.check_returncode()
    out = json.loads(result.stdout)
    out["command"] = " ".join(cmd)
    return out


def compress_result_raw(result: Dict[str, Any]) -> Path:
    raw_path = Path(result["rawTrialsPath"])
    if raw_path.suffix == ".zst":
        return raw_path
    return compress_raw(raw_path)


def run_joint_simulation(policy: str, output_dir: Path, raw_dir: Path) -> Dict[str, Any]:
    unshaped = policy == "joint"
    expected = expected_joint_raw(policy, raw_dir, unshaped)
    cmd = [
        "node",
        str(JOINT_RL_SCRIPT),
        "--sessions",
        str(SESSIONS),
        "--trials",
        str(TRIALS),
        "--seed",
        str(SEED),
        "--output-dir",
        str(output_dir),
        "--raw-output-dir",
        str(raw_dir),
    ]
    if policy == "individual":
        cmd.append("--individual-rl")
    if unshaped:
        cmd.append("--unshaped-joint-rl")
    result = run_json_command(cmd, expected)
    result["rawTrialsPath"] = str(compress_result_raw(result))
    return result


def run_shared_simulation(lambda_value: float, alpha: float, output_dir: Path, raw_dir: Path) -> Dict[str, Any]:
    expected = expected_shared_raw(lambda_value, alpha, raw_dir)
    cmd = [
        "node",
        str(SHARED_SCRIPT),
        "--sessions",
        str(SESSIONS),
        "--trials",
        str(TRIALS),
        "--seed",
        str(SEED),
        "--lambda",
        str(lambda_value),
        "--alpha",
        str(alpha),
        "--beta",
        str(BETA),
        "--score",
        "logposterior",
        "--horizon",
        "1",
        "--unshaped-joint-rl",
        "--compact-diagnostics",
        "--output-dir",
        str(output_dir),
        "--raw-output-dir",
        str(raw_dir),
    ]
    result = run_json_command(cmd, expected)
    result["rawTrialsPath"] = str(compress_result_raw(result))
    return result


def run_costly_mixture_simulation(rho: float, output_dir: Path, raw_dir: Path) -> Dict[str, Any]:
    expected = expected_costly_mixture_raw(rho, raw_dir)
    cmd = [
        "node",
        str(SHARED_SCRIPT),
        "--sessions",
        str(SESSIONS),
        "--trials",
        str(TRIALS),
        "--seed",
        str(SEED),
        "--lambda",
        str(COSTLY_MIXTURE_LAMBDA),
        "--alpha",
        str(rho),
        "--beta",
        str(BETA),
        "--score",
        "costly_mixture",
        "--horizon",
        "1",
        "--unshaped-joint-rl",
        "--compact-diagnostics",
        "--output-dir",
        str(output_dir),
        "--raw-output-dir",
        str(raw_dir),
    ]
    result = run_json_command(cmd, expected)
    result["rawTrialsPath"] = str(compress_result_raw(result))
    return result


def load_costly_mixture_step_source(rho: float) -> Dict[str, Any] | None:
    if not COSTLY_MIXTURE_STEP_RAW_SOURCES_CSV.exists():
        return None
    raw_sources = pd.read_csv(COSTLY_MIXTURE_STEP_RAW_SOURCES_CSV)
    if "label" not in raw_sources.columns:
        return None
    candidates = raw_sources[raw_sources["label"] == COSTLY_MIXTURE_STEP13_LABEL]
    if candidates.empty and "rho" in raw_sources.columns:
        candidates = raw_sources[np.isclose(raw_sources["rho"].astype(float), float(rho))]
    if candidates.empty:
        return None
    return candidates.iloc[0].to_dict()


def run_report_simulations(fits: Dict[str, Dict[str, Any]]) -> Tuple[Dict[str, Path], pd.DataFrame]:
    SIM_DIR.mkdir(parents=True, exist_ok=True)
    RAW_DIR.mkdir(parents=True, exist_ok=True)
    sources = []
    raw_paths: Dict[str, Path] = {}

    result = run_joint_simulation("individual", SIM_DIR / "individual_rl", RAW_DIR / "individual_rl")
    raw_paths[INDIVIDUAL_LABEL] = Path(result["rawTrialsPath"])
    sources.append({"model": INDIVIDUAL_LABEL, **result})

    result = run_joint_simulation("joint", SIM_DIR / "joint_rl", RAW_DIR / "joint_rl")
    raw_paths[NO_LATENT_LABEL] = Path(result["rawTrialsPath"])
    sources.append({"model": NO_LATENT_LABEL, **result})

    shared_settings = [
        (SHARED_BASELINE_LABEL, 0.0, 0.0, "shared_agency_no_commitment_no_signaling"),
        (SHARED_COMMITMENT_LABEL, float(fits[SHARED_COMMITMENT_LABEL]["lambda"]), 0.0, "shared_agency_commitment_no_signaling"),
    ]
    for label, lambda_value, alpha, subdir in shared_settings:
        result = run_shared_simulation(lambda_value, alpha, SIM_DIR / subdir, RAW_DIR / subdir)
        raw_paths[label] = Path(result["rawTrialsPath"])
        sources.append({"model": label, "lambda": lambda_value, "alpha": alpha, **result})

    rho = float(fits[SHARED_FULL_LABEL]["rho"])
    costly_source = load_costly_mixture_step_source(rho)
    if costly_source is None:
        costly_source = run_costly_mixture_simulation(rho, SIM_DIR / "shared_agency_costly_mixture", RAW_DIR / "shared_agency_costly_mixture")
    raw_paths[SHARED_FULL_LABEL] = Path(str(costly_source["rawTrialsPath"]))
    sources.append(
        {
            "model": SHARED_FULL_LABEL,
            "lambda": COSTLY_MIXTURE_LAMBDA,
            "rho": rho,
            "alpha": np.nan,
            "score": "costly_mixture",
            **costly_source,
        }
    )

    return raw_paths, pd.DataFrame(sources)


def models_for_metric_helpers(raw_paths: Dict[str, Path]) -> List[Dict[str, Any]]:
    return [
        {"key": "individual_rl", "label": INDIVIDUAL_LABEL, "raw_trials": str(raw_paths[INDIVIDUAL_LABEL])},
        {"key": "joint_rl", "label": NO_LATENT_LABEL, "raw_trials": str(raw_paths[NO_LATENT_LABEL])},
        {"key": "shared_agency_no_commitment_no_signaling", "label": SHARED_BASELINE_LABEL, "raw_trials": str(raw_paths[SHARED_BASELINE_LABEL])},
        {"key": "shared_agency_commitment_no_signaling", "label": SHARED_COMMITMENT_LABEL, "raw_trials": str(raw_paths[SHARED_COMMITMENT_LABEL])},
        {"key": "shared_agency_commitment_signaling", "label": SHARED_FULL_LABEL, "raw_trials": str(raw_paths[SHARED_FULL_LABEL])},
    ]


def build_metric_table(models: List[Dict[str, Any]]) -> pd.DataFrame:
    human_raw = load_raw(HUMAN_RAW)
    human_df = add_measures(long_player_rows(human_raw, HUMAN_LABEL))
    rows: List[Dict[str, Any]] = []
    for scope, condition in [("average", None), ("equal_to_both", "equal_to_both")]:
        for model in models:
            raw_trials = load_raw(Path(model["raw_trials"]))
            df = add_measures(long_player_rows(raw_trials, model["label"]))
            for item in comparison_rows(model["label"], raw_trials, df, condition):
                item["condition_scope"] = scope
                rows.append(item)
        for item in comparison_rows(HUMAN_LABEL, human_raw, human_df, condition):
            item["condition_scope"] = scope
            rows.append(item)
    return pd.DataFrame(rows)


def build_behavior_outputs(raw_paths: Dict[str, Path]) -> Dict[str, Path]:
    models = models_for_metric_helpers(raw_paths)
    btom_df = build_btom_table(models)
    _btom_step_long, btom_step_participant, btom_mean_participant = build_btom_step_tables(btom_df, max_step=5)
    metric_df = build_metric_table(models)
    btom_metric_df = pd.DataFrame(
        btom_step1_metric_rows(btom_step_participant, None, "average")
        + btom_step1_metric_rows(btom_step_participant, "equal_to_both", "equal_to_both")
    )
    metric_df = pd.concat([metric_df, btom_metric_df], ignore_index=True)
    summary_df = wide_summary(metric_df)
    average_df = metric_df[metric_df["condition_scope"] == "average"].copy()
    equal_df = metric_df[metric_df["condition_scope"] == "equal_to_both"].copy()

    outputs = {
        "metric_long_csv": OUT_DIR / "shared_agency_step_level_behavior_metric_long.csv",
        "summary_csv": OUT_DIR / "shared_agency_step_level_behavior_summary.csv",
        "average_plot": ASSET_DIR / "shared_agency_step_level_average_6panel.png",
        "equal_plot": ASSET_DIR / "shared_agency_step_level_equal_to_both_6panel.png",
        "btom_trajectory_plot": ASSET_DIR / "shared_agency_step_level_btom_first5_trajectory.png",
        "btom_step_csv": OUT_DIR / "shared_agency_step_level_btom_first5_step_per_participant.csv",
        "btom_mean_csv": OUT_DIR / "shared_agency_step_level_btom_first5_mean_per_participant.csv",
        "btom_trajectory_csv": OUT_DIR / "shared_agency_step_level_btom_player_trajectories.csv",
    }
    metric_df.to_csv(outputs["metric_long_csv"], index=False)
    summary_df.to_csv(outputs["summary_csv"], index=False)
    btom_csv = btom_df.copy()
    btom_csv["posteriors"] = btom_csv["posteriors"].apply(json.dumps)
    btom_csv.to_csv(outputs["btom_trajectory_csv"], index=False)
    btom_step_participant.to_csv(outputs["btom_step_csv"], index=False)
    btom_mean_participant.to_csv(outputs["btom_mean_csv"], index=False)
    plot_comparison(average_df, outputs["average_plot"], "Step-Level Fitted Parameters: All Distance Conditions", btom_step_participant)
    plot_comparison(equal_df, outputs["equal_plot"], "Step-Level Fitted Parameters: Equal-to-Both", btom_step_participant, "equal_to_both")
    plot_btom_trajectory(btom_step_participant, outputs["btom_trajectory_plot"], max_step=5)
    return outputs


def plot_step_level_heatmap(grid_df: pd.DataFrame, best: Dict[str, Any], path: Path) -> None:
    df = grid_df.copy()
    lambdas = sorted(float(value) for value in df["lambda"].unique())
    alphas = sorted(float(value) for value in df["alpha"].unique())
    x_lookup = {value: idx for idx, value in enumerate(lambdas)}
    y_lookup = {value: idx for idx, value in enumerate(alphas)}
    x = [x_lookup[float(value)] for value in df["lambda"]]
    y = [y_lookup[float(value)] for value in df["alpha"]]
    values = df["negative_log_likelihood"].to_numpy(dtype=float)
    best_x = x_lookup[float(best["lambda"])]
    best_y = y_lookup[float(best["alpha"])]
    fig, ax = plt.subplots(figsize=(10.8, 7.4))
    im = ax.scatter(
        x,
        y,
        c=values,
        marker="s",
        s=920,
        cmap="magma_r",
        edgecolor="white",
        linewidth=0.9,
    )
    ax.scatter([best_x], [best_y], marker="*", s=360, color="white", edgecolor="black", linewidth=1.0, zorder=5)
    ax.set_title("Legacy RSA Step-Level Lambda x Alpha Diagnostic", fontsize=15, fontweight="bold")
    ax.set_xlabel("lambda")
    ax.set_ylabel("alpha")
    ax.set_xticks(np.arange(len(lambdas)))
    ax.set_xticklabels([f"{value:g}" for value in lambdas], rotation=45, ha="right")
    ax.set_yticks(np.arange(len(alphas)))
    ax.set_yticklabels([f"{value:g}" for value in alphas])
    ax.set_xlim(-0.5, len(lambdas) - 0.5)
    ax.set_ylim(-0.5, len(alphas) - 0.5)
    ax.grid(color="#e5e7eb", linewidth=0.8)
    cbar = fig.colorbar(im, ax=ax)
    cbar.set_label("Human action negative log likelihood")
    for row, xi, yi in zip(df.itertuples(index=False), x, y):
        ax.text(xi, yi, f"{float(row.negative_log_likelihood):.0f}", ha="center", va="center", fontsize=6.4, color="white")
    fig.tight_layout()
    fig.savefig(path, dpi=200, bbox_inches="tight")
    plt.close(fig)


def plot_costly_mixture_rho_sweep(grid_df: pd.DataFrame, best: Dict[str, Any], path: Path) -> None:
    df = grid_df.sort_values("rho")
    fig, ax = plt.subplots(figsize=(10.6, 5.8))
    ax.plot(df["rho"], df["negative_log_likelihood"], marker="o", linewidth=2.2, color="#e15759")
    ax.axvline(float(best["rho"]), color="#111827", linestyle="--", linewidth=1.2)
    ax.set_title(f"Full Shared Agency: {CAM_NAME} Rho Fit", fontsize=15, fontweight="bold")
    ax.set_xlabel("rho")
    ax.set_ylabel("new-goal steps 1-3 action NLL")
    ax.grid(axis="y", color="#d8dde3")
    ax.grid(axis="x", visible=False)
    for spine in ["top", "right"]:
        ax.spines[spine].set_visible(False)
    fig.tight_layout()
    fig.savefig(path, dpi=200, bbox_inches="tight")
    plt.close(fig)


def plot_model_nll(summary: pd.DataFrame, path: Path) -> None:
    df = summary.set_index("model").reindex(FIT_MODEL_ORDER).reset_index()
    x = np.arange(df.shape[0])
    fig, axes = plt.subplots(1, 2, figsize=(15.5, 5.8))
    colors = [PALETTE[model] for model in df["model"]]
    axes[0].bar(x, df["heldout_nll_per_action"], color=colors, edgecolor="white")
    axes[0].set_title("Held-Out Step-Level NLL per Action", fontweight="bold")
    axes[0].set_ylabel("NLL / action")
    axes[1].bar(x, df["delta_heldout_nll"], color=colors, edgecolor="white")
    axes[1].set_title("Delta Held-Out NLL", fontweight="bold")
    axes[1].set_ylabel("delta from best")
    for ax in axes:
        ax.set_xticks(x)
        ax.set_xticklabels([plot_label(model) for model in df["model"]], rotation=12, ha="right")
        ax.grid(axis="y", color="#d8dde3")
        ax.grid(axis="x", visible=False)
        for spine in ["top", "right"]:
            ax.spines[spine].set_visible(False)
    fig.tight_layout()
    fig.savefig(path, dpi=200, bbox_inches="tight")
    plt.close(fig)


def plot_label(model: str) -> str:
    labels = {
        SHARED_BASELINE_LABEL: "Shared agency\n(no commitment,\nno signaling)",
        SHARED_COMMITMENT_LABEL: "Shared agency\n(commitment,\nno signaling)",
        SHARED_FULL_LABEL: "Shared agency\n(commitment,\nsignaling,\ncommunicative\naction mixture)",
    }
    return labels.get(model, model)


def behavior_summary_for_raw(raw_path: Path, label: str) -> Dict[str, Any]:
    raw = load_raw(raw_path)
    df = add_measures(long_player_rows(raw, label))
    out: Dict[str, Any] = {}
    for prefix, condition in [("average", None), ("equal", "equal_to_both")]:
        rows = comparison_rows(label, raw, df, condition)
        values = {row["metric"]: row["mean_percent"] for row in rows}
        out[f"{prefix}_success_percent"] = values.get("Success Rate (%)")
        out[f"{prefix}_efficiency_percent"] = values.get("Coordination Efficiency (%)")
        out[f"{prefix}_commitment_percent"] = values.get("Commitment (%)")
        out[f"{prefix}_signaling_percent"] = values.get("Signaling Move (%)")
    return out


def trial_vs_step_best(full_obs: Sequence[StepObs], step_fit: Dict[str, Any], step_raw: Path) -> pd.DataFrame:
    rows = []
    if COSTLY_MIXTURE_TRIAL_BEST_CSV.exists():
        trial = pd.read_csv(COSTLY_MIXTURE_TRIAL_BEST_CSV).iloc[0].to_dict()
        trial_raw = Path(str(trial["raw_trials"]))
        rows.append(
            {
                "fit_source": "trial-level commitment+signaling binomial NLL",
                "lambda": float(trial["lambda"]),
                "rho": float(trial["rho"]),
                "signal_window_step_level_nll": score_nll(full_obs, SHARED_FULL_LABEL, float(trial["lambda"]), rho=float(trial["rho"])),
                "raw_trials": str(trial_raw),
                **behavior_summary_for_raw(trial_raw, SHARED_FULL_LABEL),
            }
        )
    rows.append(
        {
            "fit_source": "step-level new-goal steps 1-3 action NLL",
            "lambda": float(step_fit["lambda"]),
            "rho": float(step_fit["rho"]),
            "signal_window_step_level_nll": score_nll(full_obs, SHARED_FULL_LABEL, float(step_fit["lambda"]), rho=float(step_fit["rho"])),
            "raw_trials": str(step_raw),
            **behavior_summary_for_raw(step_raw, SHARED_FULL_LABEL),
        }
    )
    return pd.DataFrame(rows)


def html_table(df: pd.DataFrame, columns: Sequence[str]) -> str:
    header = "".join(f"<th>{html.escape(col)}</th>" for col in columns)
    body = []
    for record in df[columns].to_dict(orient="records"):
        cells = []
        for col in columns:
            value = record[col]
            if isinstance(value, float) and math.isnan(value):
                text = ""
                cls = "num"
            elif isinstance(value, float):
                text = f"{value:.3f}" if "nll" in col.lower() else f"{value:.2f}"
                cls = "num"
            else:
                text = str(value)
                cls = ""
            cells.append(f"<td class=\"{cls}\">{html.escape(text)}</td>")
        body.append(f"<tr>{''.join(cells)}</tr>")
    return f"<table><thead><tr>{header}</tr></thead><tbody>{''.join(body)}</tbody></table>"


def write_notebook() -> None:
    NOTEBOOK_DIR.mkdir(parents=True, exist_ok=True)
    nb = {
        "cells": [
            {"cell_type": "markdown", "metadata": {}, "source": ["# Shared-Agency Step-Level Model Comparison\n"]},
            {
                "cell_type": "code",
                "execution_count": None,
                "metadata": {},
                "outputs": [],
                "source": [
                    "from pathlib import Path\n",
                    "import pandas as pd\n",
                    f"OUT = Path(r'{OUT_DIR}')\n",
                    "model_nll = pd.read_csv(OUT / 'step_level_model_comparison_nll.csv')\n",
                    "cv = pd.read_csv(OUT / 'step_level_model_comparison_cv_folds.csv')\n",
                    "costly_grid = pd.read_csv(OUT / 'shared_agency_step_level_costly_mixture_rho_grid.csv')\n",
                    "legacy_rsa_grid = pd.read_csv(OUT / 'legacy_rsa_step_level_lambda_alpha_grid.csv')\n",
                    "behavior = pd.read_csv(OUT / 'shared_agency_step_level_behavior_summary.csv')\n",
                    "trial_vs_step = pd.read_csv(OUT / 'trial_level_vs_step_level_best_shared_agency.csv')\n",
                ],
            },
            {"cell_type": "markdown", "metadata": {}, "source": ["## Held-Out Step-Level Model Comparison\n"]},
            {"cell_type": "code", "execution_count": None, "metadata": {}, "outputs": [], "source": ["model_nll.round(3)\n"]},
            {"cell_type": "markdown", "metadata": {}, "source": [f"## Full Shared-Agency {CAM_NAME} Rho Grid\n"]},
            {"cell_type": "code", "execution_count": None, "metadata": {}, "outputs": [], "source": ["costly_grid.sort_values('negative_log_likelihood').head(10).round(3)\n"]},
            {"cell_type": "markdown", "metadata": {}, "source": ["## Legacy RSA Lambda x Alpha Diagnostic Grid\n"]},
            {"cell_type": "code", "execution_count": None, "metadata": {}, "outputs": [], "source": ["legacy_rsa_grid.sort_values('negative_log_likelihood').head(10).round(3)\n"]},
            {"cell_type": "markdown", "metadata": {}, "source": ["## Behavioral Posterior Predictive Checks\n"]},
            {"cell_type": "code", "execution_count": None, "metadata": {}, "outputs": [], "source": ["behavior.round(2)\n"]},
            {"cell_type": "markdown", "metadata": {}, "source": ["## Trial-Level Best vs Step-Level Best\n"]},
            {"cell_type": "code", "execution_count": None, "metadata": {}, "outputs": [], "source": ["trial_vs_step.round(3)\n"]},
        ],
        "metadata": {
            "kernelspec": {"display_name": "Python 3", "language": "python", "name": "python3"},
            "language_info": {"name": "python", "pygments_lexer": "ipython3"},
        },
        "nbformat": 4,
        "nbformat_minor": 5,
    }
    NOTEBOOK_PATH.write_text(json.dumps(nb, indent=2), encoding="utf-8")


def write_html(
    model_nll: pd.DataFrame,
    costly_grid: pd.DataFrame,
    costly_best: Dict[str, Any],
    legacy_rsa_grid: pd.DataFrame,
    legacy_rsa_best: Dict[str, Any],
    behavior_outputs: Dict[str, Path],
    trial_step_df: pd.DataFrame,
    raw_sources: pd.DataFrame,
) -> None:
    best_model = model_nll.iloc[0]["model"]
    nll_cols = [
        "model",
        "lambda",
        "alpha",
        "rho",
        "n_params",
        "actions",
        "in_sample_nll",
        "heldout_nll",
        "heldout_nll_per_action",
        "delta_heldout_nll",
        "aic",
        "bic",
    ]
    best_cols = [
        "fit_source",
        "lambda",
        "rho",
        "signal_window_step_level_nll",
        "average_commitment_percent",
        "average_signaling_percent",
        "equal_commitment_percent",
        "equal_signaling_percent",
    ]
    raw_cols = ["model", "lambda", "alpha", "rho", "score", "rawTrialsPath"]
    html_text = f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Shared-Agency Step-Level {CAM_NAME} Comparison</title>
<style>
body {{ margin:0; font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; background:#f6f8fb; color:#1f2933; }}
header {{ padding:34px 48px 24px; background:#ffffff; border-bottom:1px solid #d9e2ec; }}
main {{ max-width:1200px; margin:0 auto; padding:28px 24px 60px; }}
h1 {{ margin:0 0 8px; font-size:31px; }}
h2 {{ margin:30px 0 12px; font-size:21px; }}
p {{ line-height:1.55; }}
.note {{ color:#52606d; max-width:980px; }}
.panel {{ background:#fff; border:1px solid #d9e2ec; border-radius:8px; padding:18px; margin:18px 0; }}
.links a {{ display:inline-block; margin:0 12px 10px 0; color:#2458a6; text-decoration:none; }}
img {{ width:100%; height:auto; display:block; border:1px solid #d9e2ec; border-radius:6px; background:white; }}
table {{ width:100%; border-collapse:collapse; font-size:13px; background:white; }}
th,td {{ border:1px solid #d9e2ec; padding:8px 10px; text-align:left; vertical-align:top; }}
th {{ background:#eef3f8; }}
td.num {{ text-align:right; font-variant-numeric:tabular-nums; }}
code {{ background:#eef3f8; padding:2px 5px; border-radius:4px; }}
</style>
</head>
<body>
<header>
  <h1>Shared-Agency Step-Level {CAM_NAME} Comparison</h1>
  <p class="note">Human actions are fit on the new-goal signal window, steps 1-3 after the new goal appears. The primary full shared-agency row is {CAM_NAME} with fixed lambda=0.2 and fitted rho.</p>
  <div class="links">
    <a href="{rel(OUT_DIR / 'step_level_model_comparison_nll.csv')}">model NLL CSV</a>
    <a href="{rel(OUT_DIR / 'shared_agency_step_level_costly_mixture_rho_grid.csv')}">communicative action mixture rho grid CSV</a>
    <a href="{rel(OUT_DIR / 'legacy_rsa_step_level_lambda_alpha_grid.csv')}">legacy RSA lambda x alpha grid CSV</a>
    <a href="{rel(OUT_DIR / 'shared_agency_step_level_behavior_summary.csv')}">behavior summary CSV</a>
    <a href="{rel(OUT_DIR / 'trial_level_vs_step_level_best_shared_agency.csv')}">trial-vs-step CSV</a>
    <a href="{rel(NOTEBOOK_PATH)}">notebook</a>
    <a href="shared_agency_signal_window_model_comparison.html">signal-window fit report</a>
    <a href="shared_agency_uncertainty_gated_rho_fit.html">uncertainty-gated rho fit</a>
    <a href="shared_agency_information_gain_fit.html">information-gain fit</a>
    <a href="shared_agency_tiebreak_signal_fit.html">tie-break signaling fit</a>
    <a href="shared_agency_costly_legibility_fit.html">costly legibility fit</a>
    <a href="shared_agency_log_odds_legibility_fit.html">log-odds legibility fit</a>
    <a href="shared_agency_log_odds_eta_sweep.html">log-odds full eta sweep</a>
    <a href="shared_agency_costly_mixture_rho_sweep.html">communicative action mixture rho sweep</a>
    <a href="shared_agency_costly_mixture_step_level_fit.html">communicative action mixture step-level report</a>
    <a href="shared_agency_joint_lambda_alpha_baseline_comparison.html">trial-level baseline report</a>
  </div>
</header>
<main>
  <section class="panel">
    <h2>Primary Signal-Window Model Comparison</h2>
    <p class="note">Best held-out model: <strong>{html.escape(str(best_model))}</strong>. Lower NLL is better. Held-out folds are grouped by room ID to avoid scoring actions from the same dyad in both train and test splits.</p>
    {html_table(model_nll, nll_cols)}
  </section>

  <section class="panel">
    <h2>Full Shared-Agency {CAM_NAME} Fit</h2>
    <p class="note">Full-data signal-window best: lambda={float(costly_best['lambda']):g}, rho={float(costly_best['rho']):g}, NLL={float(costly_best['negative_log_likelihood']):.2f}. This setting is used for the simulated shared-agency commitment+signaling row below.</p>
    <a href="{rel(ASSET_DIR / 'shared_agency_step_level_costly_mixture_rho_sweep.png')}"><img src="{rel(ASSET_DIR / 'shared_agency_step_level_costly_mixture_rho_sweep.png')}" alt="shared agency step-level communicative action mixture rho sweep"></a>
  </section>

  <section class="panel">
    <h2>Legacy RSA Lambda x Alpha Diagnostic</h2>
    <p class="note">The former RSA/log-posterior signaling fit is retained as a diagnostic only. Full-data legacy best: lambda={float(legacy_rsa_best['lambda']):g}, alpha={float(legacy_rsa_best['alpha']):g}, NLL={float(legacy_rsa_best['negative_log_likelihood']):.2f}. It is not the primary full shared-agency row.</p>
    <a href="{rel(ASSET_DIR / 'legacy_rsa_step_level_lambda_alpha_heatmap.png')}"><img src="{rel(ASSET_DIR / 'legacy_rsa_step_level_lambda_alpha_heatmap.png')}" alt="legacy RSA step-level lambda alpha heatmap"></a>
  </section>

  <section class="panel">
    <h2>Held-Out NLL Plot</h2>
    <a href="{rel(ASSET_DIR / 'step_level_model_nll_comparison.png')}"><img src="{rel(ASSET_DIR / 'step_level_model_nll_comparison.png')}" alt="held-out step-level NLL comparison"></a>
  </section>

  <section class="panel">
    <h2>Posterior Predictive Checks: All Distance Conditions</h2>
    <a href="{rel(behavior_outputs['average_plot'])}"><img src="{rel(behavior_outputs['average_plot'])}" alt="step-level fitted all-distance behavioral comparison"></a>
  </section>

  <section class="panel">
    <h2>Posterior Predictive Checks: Equal-to-Both</h2>
    <a href="{rel(behavior_outputs['equal_plot'])}"><img src="{rel(behavior_outputs['equal_plot'])}" alt="step-level fitted equal-to-both behavioral comparison"></a>
  </section>

  <section class="panel">
    <h2>BToM Trajectory</h2>
    <a href="{rel(behavior_outputs['btom_trajectory_plot'])}"><img src="{rel(behavior_outputs['btom_trajectory_plot'])}" alt="step-level fitted BToM trajectory"></a>
  </section>

  <section class="panel">
    <h2>Trial-Level Best vs Step-Level Best</h2>
    <p class="note">This table compares the {CAM_NAME} setting selected by trial-level commitment+signaling binomial NLL against the setting selected by new-goal steps 1-3 human action NLL.</p>
    {html_table(trial_step_df, best_cols)}
  </section>

  <section class="panel">
    <h2>Raw Sources</h2>
    {html_table(raw_sources, raw_cols)}
  </section>
</main>
</body>
</html>
"""
    HTML_PATH.write_text(html_text, encoding="utf-8")


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    ASSET_DIR.mkdir(parents=True, exist_ok=True)
    NOTEBOOK_DIR.mkdir(parents=True, exist_ok=True)

    human_rows = load_human_rows()
    signal_window_obs = signal_window_observations(human_rows)
    commitment_grid, legacy_rsa_grid, costly_grid, full_fits, legacy_rsa_fit = fit_all_models(signal_window_obs)
    cv_df = cross_validated_scores(signal_window_obs, CV_FOLDS)
    model_nll = summarize_cv(cv_df, full_fits, len(signal_window_obs))

    commitment_grid.to_csv(OUT_DIR / "shared_agency_step_level_commitment_lambda_grid.csv", index=False)
    legacy_rsa_grid.to_csv(OUT_DIR / "legacy_rsa_step_level_lambda_alpha_grid.csv", index=False)
    legacy_rsa_grid.to_csv(OUT_DIR / "shared_agency_step_level_lambda_alpha_grid.csv", index=False)
    costly_grid.to_csv(OUT_DIR / "shared_agency_step_level_costly_mixture_rho_grid.csv", index=False)
    cv_df.to_csv(OUT_DIR / "step_level_model_comparison_cv_folds.csv", index=False)
    model_nll.to_csv(OUT_DIR / "step_level_model_comparison_nll.csv", index=False)

    plot_step_level_heatmap(legacy_rsa_grid, legacy_rsa_fit, ASSET_DIR / "legacy_rsa_step_level_lambda_alpha_heatmap.png")
    plot_step_level_heatmap(legacy_rsa_grid, legacy_rsa_fit, ASSET_DIR / "shared_agency_step_level_lambda_alpha_heatmap.png")
    plot_costly_mixture_rho_sweep(costly_grid, full_fits[SHARED_FULL_LABEL], ASSET_DIR / "shared_agency_step_level_costly_mixture_rho_sweep.png")
    plot_model_nll(model_nll, ASSET_DIR / "step_level_model_nll_comparison.png")

    raw_paths, raw_sources = run_report_simulations(full_fits)
    raw_sources.to_csv(OUT_DIR / "shared_agency_step_level_raw_sources.csv", index=False)
    behavior_outputs = build_behavior_outputs(raw_paths)

    trial_step_df = trial_vs_step_best(signal_window_obs, full_fits[SHARED_FULL_LABEL], raw_paths[SHARED_FULL_LABEL])
    trial_step_df.to_csv(OUT_DIR / "trial_level_vs_step_level_best_shared_agency.csv", index=False)
    write_notebook()
    write_html(
        model_nll,
        costly_grid,
        full_fits[SHARED_FULL_LABEL],
        legacy_rsa_grid,
        legacy_rsa_fit,
        behavior_outputs,
        trial_step_df,
        raw_sources,
    )

    summary = {
        "html": str(HTML_PATH),
        "actions": len(signal_window_obs),
        "signal_window": {"start": SIGNAL_WINDOW_START, "end": SIGNAL_WINDOW_END},
        "cv_folds": CV_FOLDS,
        "best_heldout_model": str(model_nll.iloc[0]["model"]),
        "full_data_fits": full_fits,
        "legacy_rsa_fit": legacy_rsa_fit,
        "outputs": {
            "model_nll_csv": str(OUT_DIR / "step_level_model_comparison_nll.csv"),
            "costly_mixture_rho_grid_csv": str(OUT_DIR / "shared_agency_step_level_costly_mixture_rho_grid.csv"),
            "costly_mixture_rho_sweep": str(ASSET_DIR / "shared_agency_step_level_costly_mixture_rho_sweep.png"),
            "legacy_rsa_lambda_alpha_grid_csv": str(OUT_DIR / "legacy_rsa_step_level_lambda_alpha_grid.csv"),
            "legacy_rsa_lambda_alpha_heatmap": str(ASSET_DIR / "legacy_rsa_step_level_lambda_alpha_heatmap.png"),
            "behavior_summary_csv": str(behavior_outputs["summary_csv"]),
            "notebook": str(NOTEBOOK_PATH),
        },
    }
    (OUT_DIR / "shared_agency_step_level_report_summary.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
