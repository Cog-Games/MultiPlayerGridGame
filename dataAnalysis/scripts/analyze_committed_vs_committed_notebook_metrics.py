import argparse
import json
from pathlib import Path

import numpy as np
import pandas as pd


def parse_args():
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", nargs="+", required=True, help="Raw trial JSON files")
    parser.add_argument("--output", required=True, help="Output summary JSON path")
    return parser.parse_args()


def parse_trajectory(traj_value):
    if traj_value is None:
        return []
    if isinstance(traj_value, float) and np.isnan(traj_value):
        return []
    if isinstance(traj_value, list):
        traj = traj_value
    else:
        try:
            traj = json.loads(str(traj_value))
        except Exception:
            return []
    return [p for p in traj if isinstance(p, (list, tuple)) and len(p) == 2]


def parse_point_str(value):
    if value is None:
        return None
    if isinstance(value, (list, tuple)) and len(value) == 2:
        return list(value)
    try:
        point = json.loads(str(value))
    except Exception:
        return None
    return list(point) if isinstance(point, (list, tuple)) and len(point) == 2 else None


def manhattan(p, q):
    return abs(int(p[0]) - int(q[0])) + abs(int(p[1]) - int(q[1]))


def remove_duplicates(traj):
    if len(traj) <= 1:
        return traj
    cleaned = [traj[0]]
    for i in range(1, len(traj)):
        if traj[i] != traj[i - 1]:
            cleaned.append(traj[i])
    return cleaned


def compute_commitment(row):
    human_index = row.get("humanPlayerIndex", 0)
    first_goal = row.get("player1FirstDetectedGoal") if human_index == 0 else row.get("player2FirstDetectedGoal")
    final_goal = row.get("player1FinalReachedGoal") if human_index == 0 else row.get("player2FinalReachedGoal")
    if pd.isna(first_goal) or pd.isna(final_goal):
        return np.nan
    try:
        return 1 if int(first_goal) == int(final_goal) else 0
    except Exception:
        return np.nan


def compute_efficiency(row):
    human_index = row.get("humanPlayerIndex", 0)
    traj_col = "player1Trajectory" if human_index == 0 else "player2Trajectory"
    traj = parse_trajectory(row.get(traj_col))
    traj = remove_duplicates(traj)
    if len(traj) == 0:
        return np.nan

    try:
        idx = int(row.get("newGoalPresentedTime"))
    except Exception:
        return np.nan

    if idx < 0:
        idx = 0
    if idx >= len(traj):
        idx = len(traj) - 1

    start = traj[idx]
    actual_steps = (len(traj) - 1) - idx
    if actual_steps <= 0:
        return np.nan

    candidates = [
        parse_point_str(row.get("target1")),
        parse_point_str(row.get("target2")),
        parse_point_str(row.get("newGoalPosition")),
    ]
    candidates = [g for g in candidates if g is not None]
    if not candidates:
        return np.nan

    optimal_steps = min(manhattan(start, g) for g in candidates)
    excess = actual_steps - optimal_steps
    eff = (1 - excess / actual_steps) * 100
    return max(0.0, min(100.0, eff))


def compute_signaling(row):
    if not bool(row.get("newGoalPresented", False)):
        return np.nan

    human_index = row.get("humanPlayerIndex", 0)
    traj_col = "player1Trajectory" if human_index == 0 else "player2Trajectory"
    traj = parse_trajectory(row.get(traj_col))
    traj = remove_duplicates(traj)
    if not traj:
        return np.nan

    try:
        new_goal_time = int(row.get("newGoalPresentedTime"))
    except Exception:
        return np.nan

    if new_goal_time < 0 or new_goal_time >= len(traj) - 1:
        return np.nan

    pos_before = traj[new_goal_time]
    pos_after = traj[new_goal_time + 1]

    target1_pos = parse_point_str(row.get("target1"))
    target2_pos = parse_point_str(row.get("target2"))
    new_goal_pos = parse_point_str(row.get("newGoalPosition"))
    if new_goal_pos is None or target1_pos is None or target2_pos is None:
        return np.nan

    final_goal_col = "player1FinalReachedGoal" if human_index == 0 else "player2FinalReachedGoal"
    try:
        final_goal_idx = int(row.get(final_goal_col))
        shared_goal_idx = int(row.get("firstDetectedSharedGoal"))
    except Exception:
        return np.nan

    if shared_goal_idx in (0, 1):
        old_idx_set = {0, 1}
        new_idx_set = {2}
        shared_goal_pos = target1_pos if shared_goal_idx == 0 else target2_pos
        other_old_pos = target2_pos if shared_goal_idx == 0 else target1_pos
    elif shared_goal_idx in (1, 2):
        old_idx_set = {1, 2}
        new_idx_set = {3}
        shared_goal_pos = target1_pos if shared_goal_idx == 1 else target2_pos
        other_old_pos = target2_pos if shared_goal_idx == 1 else target1_pos
    else:
        return np.nan

    if final_goal_idx in new_idx_set:
        reached_goal_pos = new_goal_pos
        other_goal_pos = shared_goal_pos
    elif final_goal_idx == shared_goal_idx:
        reached_goal_pos = shared_goal_pos
        other_goal_pos = new_goal_pos
    elif final_goal_idx in old_idx_set and final_goal_idx != shared_goal_idx:
        reached_goal_pos = other_old_pos
        other_goal_pos = new_goal_pos
    else:
        return np.nan

    moved_closer_to_reached = manhattan(pos_after, reached_goal_pos) < manhattan(pos_before, reached_goal_pos)
    moved_closer_to_other = manhattan(pos_after, other_goal_pos) < manhattan(pos_before, other_goal_pos)
    return 1 if moved_closer_to_reached and not moved_closer_to_other else 0


def participant_summary(df, value_col):
    valid = df.dropna(subset=[value_col]).copy()
    if valid.empty:
        return None
    participant = (
        valid.groupby(["participantId", "partnerType"], as_index=False)[value_col]
        .mean()
    )
    vals = participant[value_col].to_numpy(dtype=float)
    mean = float(np.mean(vals))
    sd = float(np.std(vals, ddof=1)) if len(vals) > 1 else 0.0
    se = float(sd / np.sqrt(len(vals))) if len(vals) > 0 else np.nan
    ci = 1.96 * se if np.isfinite(se) else np.nan
    return {
        "n_participants": int(participant["participantId"].nunique()),
        "participant_rows": int(len(participant)),
        "mean": mean,
        "sd": sd,
        "se": se,
        "ci_lower": float(mean - ci) if np.isfinite(ci) else np.nan,
        "ci_upper": float(mean + ci) if np.isfinite(ci) else np.nan,
    }


def by_distance_summary(df, value_col):
    out = {}
    valid = df.dropna(subset=[value_col, "distanceCondition"]).copy()
    if valid.empty:
      return out
    grouped = (
        valid.groupby(["participantId", "partnerType", "distanceCondition"], as_index=False)[value_col]
        .mean()
    )
    for condition, sub in grouped.groupby("distanceCondition"):
        vals = sub[value_col].to_numpy(dtype=float)
        out[str(condition)] = {
            "n_participants": int(sub["participantId"].nunique()),
            "mean": float(np.mean(vals)),
            "sd": float(np.std(vals, ddof=1)) if len(vals) > 1 else 0.0,
        }
    return out


def main():
    args = parse_args()
    records = []
    for input_path in args.input:
        records.extend(json.loads(Path(input_path).read_text()))

    base = pd.DataFrame(records)
    if base.empty:
        raise ValueError("No raw trial rows found.")

    long_rows = []
    for row in base.to_dict(orient="records"):
        for human_index in (0, 1):
            long_rows.append({
                **row,
                "participantId": row["participantId_player1"] if human_index == 0 else row["participantId_player2"],
                "humanPlayerIndex": human_index,
            })

    df = pd.DataFrame(long_rows)
    df["commitment"] = df.apply(compute_commitment, axis=1)
    df["efficiencyPercent"] = df.apply(compute_efficiency, axis=1)
    df["signalingMove"] = df.apply(compute_signaling, axis=1)

    df_new_goal = df[df["newGoalPresented"] == True].copy()
    df_new_goal_success = df_new_goal[df_new_goal["collaborationSucceeded"] == True].copy()

    summary = {
        "source_rows": int(len(df)),
        "new_goal_rows": int(len(df_new_goal)),
        "successful_new_goal_rows": int(len(df_new_goal_success)),
        "commitment_notebook_definition": "firstDetectedGoal == finalReachedGoal for the focal agent",
        "efficiency_notebook_definition": "per-agent trajectory efficiency after new goal presentation",
        "signaling_notebook_definition": "first move after new goal gets closer to reached goal but not to the alternative goal",
        "overall": {
            "efficiency_success_only": participant_summary(df_new_goal_success, "efficiencyPercent"),
            "signaling_all_new_goal": participant_summary(df_new_goal, "signalingMove"),
            "signaling_when_commitment_1": participant_summary(df_new_goal[df_new_goal["commitment"] == 1], "signalingMove"),
            "signaling_when_commitment_0": participant_summary(df_new_goal[df_new_goal["commitment"] == 0], "signalingMove"),
        },
        "by_distance_condition": {
            "efficiency_success_only": by_distance_summary(df_new_goal_success, "efficiencyPercent"),
            "signaling_all_new_goal": by_distance_summary(df_new_goal, "signalingMove"),
        }
    }

    output = {
        "summary": summary,
        "row_level_measures": df.to_dict(orient="records"),
    }

    out_path = Path(args.output)
    out_path.write_text(json.dumps(output, indent=2))
    print(json.dumps({"output": str(out_path), "summary": summary}, indent=2))


if __name__ == "__main__":
    main()
