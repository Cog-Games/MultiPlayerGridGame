from __future__ import annotations

import json
import math
import re
import warnings
import zipfile
from collections import Counter
from datetime import datetime
from html import escape
from io import BytesIO
from pathlib import Path

import pandas as pd


ROOT = Path(__file__).resolve().parents[1]
EXTRACT_DIR = ROOT / "analysis_outputs" / "middle_school_0708_extract"
OUTPUT_HTML = ROOT / "analysis_outputs" / "middle_school_0708_report.html"
SOURCE_ZIP_NAME = "middle school data 0708-20260708T184034Z-3-001.zip"
SOURCE_ZIP = Path.home() / "Downloads" / SOURCE_ZIP_NAME

OUTCOME_ORDER = [
    "stag_captured",
    "rabbit_captured_p1",
    "rabbit_captured_p2",
    "timeout",
]

OUTCOME_LABELS = {
    "stag_captured": "Stag captured",
    "rabbit_captured_p1": "P1 caught rabbit",
    "rabbit_captured_p2": "P2 caught rabbit",
    "timeout": "Timeout",
}

CONDITION_LABELS = {
    "Condition A": "A: human-human",
    "Condition B": "B: human-bot",
}


def is_missing(value) -> bool:
    if value is None:
        return True
    if isinstance(value, float) and math.isnan(value):
        return True
    return pd.isna(value) if not isinstance(value, (list, dict)) else False


def clean_text(value, fallback: str = "") -> str:
    if is_missing(value):
        return fallback
    return str(value)


def to_number(series: pd.Series) -> pd.Series:
    return pd.to_numeric(series, errors="coerce")


def parse_json_list(value):
    if is_missing(value):
        return []
    if isinstance(value, list):
        return value
    text = str(value).strip()
    if not text:
        return []
    try:
        parsed = json.loads(text)
    except json.JSONDecodeError:
        return []
    return parsed if isinstance(parsed, list) else []


def manhattan(a, b) -> float:
    if not isinstance(a, list) or not isinstance(b, list) or len(a) < 2 or len(b) < 2:
        return float("nan")
    return abs(float(a[0]) - float(b[0])) + abs(float(a[1]) - float(b[1]))


def parse_file_player(path_or_name) -> str:
    name = path_or_name.name if hasattr(path_or_name, "name") else str(path_or_name)
    match = re.search(r"-(player[12])\.xlsx$", name)
    return match.group(1) if match else ""


def trial_key(row: pd.Series) -> str:
    match_type = clean_text(row.get("matchType"))
    round_number = clean_text(row.get("roundNumber"), "unknown")
    room_id = clean_text(row.get("roomId"))
    run_id = clean_text(row.get("runId"))
    if match_type == "human" and room_id:
        return f"human:{room_id}:round:{round_number}"
    return f"bot:{run_id}:round:{round_number}"


def condition_sort_key(value: str) -> tuple[int, str]:
    if value == "Condition A":
        return (0, value)
    if value == "Condition B":
        return (1, value)
    return (2, value)


def pct(part: float, whole: float) -> float:
    return (part / whole * 100) if whole else 0.0


def fmt(value, digits: int = 1) -> str:
    if value is None:
        return "-"
    if isinstance(value, float) and math.isnan(value):
        return "-"
    if isinstance(value, (int, float)):
        if abs(value - round(value)) < 1e-9:
            return f"{int(round(value))}"
        return f"{value:.{digits}f}"
    return escape(str(value))


def rate_text(part: float, whole: float) -> str:
    return f"{part:.0f}/{whole:.0f} ({pct(part, whole):.1f}%)" if whole else "0/0 (0.0%)"


def workbook_sources():
    if SOURCE_ZIP.exists():
        with zipfile.ZipFile(SOURCE_ZIP) as archive:
            names = sorted(
                name
                for name in archive.namelist()
                if name.lower().endswith(".xlsx") and "__macosx" not in name.lower()
            )
            for name in names:
                yield Path(name).name, BytesIO(archive.read(name))
        return

    for path in sorted(EXTRACT_DIR.rglob("*.xlsx")):
        yield path.name, path


def load_data() -> tuple[pd.DataFrame, pd.DataFrame, list[str]]:
    sources = list(workbook_sources())
    if not sources:
        raise FileNotFoundError(f"No .xlsx files found in {SOURCE_ZIP} or under {EXTRACT_DIR}")

    trial_frames: list[pd.DataFrame] = []
    summaries: list[dict] = []

    warnings.filterwarnings("ignore", message="Workbook contains no default style")

    for source_name, source in sources:
        workbook = pd.ExcelFile(source)
        trials = pd.read_excel(workbook, sheet_name="Dyadic Trials")
        trials["sourceFile"] = source_name
        trials["filePlayer"] = parse_file_player(source_name)
        trial_frames.append(trials)

        summary_df = pd.read_excel(workbook, sheet_name="Round Summary")
        summary = {
            str(row["field"]): row["value"]
            for _, row in summary_df.iterrows()
            if not is_missing(row.get("field"))
        }
        summary["sourceFile"] = source_name
        summary["filePlayer"] = parse_file_player(source_name)
        summaries.append(summary)

    trials = pd.concat(trial_frames, ignore_index=True)
    summary = pd.DataFrame(summaries)

    for col in [
        "trialIndex",
        "trialNumber",
        "roundNumber",
        "outcomeReward",
        "rabbitIndex",
        "totalSteps",
        "player1Steps",
        "player2Steps",
        "maxPlayerSteps",
        "player1Score",
        "player2Score",
    ]:
        if col in trials.columns:
            trials[col] = to_number(trials[col])

    trials["conditionReadable"] = trials["participantCondition"].map(CONDITION_LABELS).fillna(
        trials["participantCondition"].astype(str)
    )
    trials["analysisTrialKey"] = trials.apply(trial_key, axis=1)
    return trials, summary, [name for name, _ in sources]


def participant_table(trials: pd.DataFrame) -> pd.DataFrame:
    round_counts = trials.groupby("sourceFile").size().rename("roundRows")
    final_rounds = trials.groupby("sourceFile")["roundNumber"].max().rename("finalRound")
    latest = (
        trials.sort_values(["sourceFile", "roundNumber", "completedAt"], na_position="last")
        .groupby("sourceFile", as_index=False)
        .tail(1)
        .copy()
    )
    latest = latest.merge(round_counts, on="sourceFile").merge(final_rounds, on="sourceFile")
    latest["localScore"] = latest.apply(
        lambda row: row["player2Score"] if row.get("localPlayer") == "player2" else row["player1Score"],
        axis=1,
    )
    latest["partnerScore"] = latest.apply(
        lambda row: row["player1Score"] if row.get("localPlayer") == "player2" else row["player2Score"],
        axis=1,
    )
    latest["isComplete"] = (latest["roundRows"] >= 3) & (latest["finalRound"] >= 3)
    return latest


def dedupe_trials(trials: pd.DataFrame) -> pd.DataFrame:
    return (
        trials.sort_values(["analysisTrialKey", "sourceFile"], na_position="last")
        .drop_duplicates("analysisTrialKey", keep="first")
        .copy()
    )


def score_summary(participants: pd.DataFrame) -> pd.DataFrame:
    rows = []
    for condition, group in sorted(
        participants.groupby("participantCondition"), key=lambda item: condition_sort_key(item[0])
    ):
        local = to_number(group["localScore"])
        partner = to_number(group["partnerScore"])
        rows.append(
            {
                "Condition": CONDITION_LABELS.get(condition, condition),
                "Participants": len(group),
                "Complete": int(group["isComplete"].sum()),
                "Mean local score": local.mean(),
                "Median local score": local.median(),
                "Min local score": local.min(),
                "Max local score": local.max(),
                "Mean partner score": partner.mean(),
            }
        )
    return pd.DataFrame(rows)


def outcome_summary(trials: pd.DataFrame) -> pd.DataFrame:
    rows = []
    for condition, group in sorted(
        trials.groupby("participantCondition"), key=lambda item: condition_sort_key(item[0])
    ):
        total = len(group)
        counts = group["outcomeType"].value_counts()
        for outcome in OUTCOME_ORDER:
            count = int(counts.get(outcome, 0))
            rows.append(
                {
                    "Condition": CONDITION_LABELS.get(condition, condition),
                    "Outcome": OUTCOME_LABELS.get(outcome, outcome),
                    "Count": count,
                    "Rate": pct(count, total),
                }
            )
    return pd.DataFrame(rows)


def round_outcome_summary(trials: pd.DataFrame) -> pd.DataFrame:
    rows = []
    for round_number, group in sorted(trials.groupby("roundNumber"), key=lambda item: item[0]):
        total = len(group)
        row = {"Round": int(round_number), "Trials": total}
        for outcome in OUTCOME_ORDER:
            count = int((group["outcomeType"] == outcome).sum())
            row[OUTCOME_LABELS[outcome]] = f"{count} ({pct(count, total):.1f}%)"
        rows.append(row)
    return pd.DataFrame(rows)


def action_summary(trials: pd.DataFrame) -> pd.DataFrame:
    counters = {"player1": Counter(), "player2": Counter(), "stag": Counter()}
    signal_trials = 0
    durations = []

    for _, row in trials.iterrows():
        for role in counters:
            for action in parse_json_list(row.get(f"{role}Actions")):
                counters[role][str(action)] += 1

        p1_signals = parse_json_list(row.get("player1Signals"))
        p2_signals = parse_json_list(row.get("player2Signals"))
        if any(bool(value) for value in p1_signals + p2_signals):
            signal_trials += 1

        history = parse_json_list(row.get("actionHistory"))
        elapsed = [
            item.get("elapsedMs")
            for item in history
            if isinstance(item, dict) and isinstance(item.get("elapsedMs"), (int, float))
        ]
        if elapsed:
            durations.append(max(elapsed) / 1000)

    rows = []
    for role, counter in counters.items():
        total = sum(counter.values())
        for action in ["up", "down", "left", "right", "signal"]:
            count = counter.get(action, 0)
            rows.append(
                {
                    "Actor": role,
                    "Action": action,
                    "Count": count,
                    "Share": pct(count, total),
                }
            )

    return pd.DataFrame(rows), signal_trials, durations


def first_action_rows(trials: pd.DataFrame) -> pd.DataFrame:
    rows = []
    for _, trial in trials.iterrows():
        history = parse_json_list(trial.get("actionHistory"))
        trajectories = {
            "player1": parse_json_list(trial.get("player1Trajectory")),
            "player2": parse_json_list(trial.get("player2Trajectory")),
            "stag": parse_json_list(trial.get("stagTrajectory")),
        }
        starts = {
            "player1": parse_json_list(trial.get("player1StartPosition")),
            "player2": parse_json_list(trial.get("player2StartPosition")),
            "stag": parse_json_list(trial.get("stagStartPosition")),
        }

        for player in ["player1", "player2"]:
            event_index = next(
                (index for index, event in enumerate(history) if isinstance(event, dict) and event.get("agent") == player),
                None,
            )
            if event_index is None:
                continue

            event = history[event_index]
            player_traj = trajectories[player]
            stag_traj = trajectories["stag"]
            before = player_traj[event_index - 1] if event_index > 0 and event_index - 1 < len(player_traj) else starts[player]
            after = player_traj[event_index] if event_index < len(player_traj) else before
            stag_before = stag_traj[event_index - 1] if event_index > 0 and event_index - 1 < len(stag_traj) else starts["stag"]
            action = clean_text(event.get("action") or event.get("actionLabel"))

            moved = before != after
            if action == "signal":
                category = "Explicit signal"
            elif not moved:
                category = "No-move"
            elif manhattan(after, stag_before) < manhattan(before, stag_before):
                category = "Implicit stag move"
            else:
                category = "Non-stag move"

            rows.append(
                {
                    "Condition": CONDITION_LABELS.get(trial.get("participantCondition"), trial.get("participantCondition")),
                    "Raw condition": trial.get("participantCondition"),
                    "Player": "Player 1" if player == "player1" else "Player 2",
                    "Category": category,
                    "Action": action,
                    "Outcome": trial.get("outcomeType"),
                    "Trial": trial.get("analysisTrialKey"),
                }
            )
    return pd.DataFrame(rows)


def first_action_summary(first_actions: pd.DataFrame) -> pd.DataFrame:
    if first_actions.empty:
        return pd.DataFrame()
    category_order = ["No-move", "Implicit stag move", "Non-stag move", "Explicit signal"]
    condition_order = {"A: human-human": 0, "B: human-bot": 1}
    player_order = {"Player 1": 0, "Player 2": 1}
    category_order_map = {category: index for index, category in enumerate(category_order)}
    rows = []
    for (condition, player), group in first_actions.groupby(["Condition", "Player"], sort=False):
        total = len(group)
        counts = group["Category"].value_counts()
        for category in category_order:
            count = int(counts.get(category, 0))
            rows.append(
                {
                    "Condition": condition,
                    "Player": player,
                    "Category": category,
                    "Count": count,
                    "Rate": pct(count, total),
                }
            )
    summary = pd.DataFrame(rows)
    summary["_conditionOrder"] = summary["Condition"].map(condition_order).fillna(99)
    summary["_playerOrder"] = summary["Player"].map(player_order).fillna(99)
    summary["_categoryOrder"] = summary["Category"].map(category_order_map).fillna(99)
    return summary.sort_values(["_conditionOrder", "_playerOrder", "_categoryOrder"]).drop(
        columns=["_conditionOrder", "_playerOrder", "_categoryOrder"]
    )


def capture_by_player_outcome_summary(trials: pd.DataFrame) -> pd.DataFrame:
    rows = []
    for condition, group in sorted(
        trials.groupby("participantCondition"), key=lambda item: condition_sort_key(item[0])
    ):
        total = len(group)
        stag = int((group["outcomeType"] == "stag_captured").sum())
        rabbit_p1 = int((group["outcomeType"] == "rabbit_captured_p1").sum())
        rabbit_p2 = int((group["outcomeType"] == "rabbit_captured_p2").sum())
        condition_label = CONDITION_LABELS.get(condition, condition)
        rows.extend(
            [
                {
                    "Condition": condition_label,
                    "Outcome": "Stag",
                    "Player": "Player 1",
                    "Captures": stag,
                    "Rounds": total,
                    "Rate": pct(stag, total),
                },
                {
                    "Condition": condition_label,
                    "Outcome": "Stag",
                    "Player": "Player 2",
                    "Captures": stag,
                    "Rounds": total,
                    "Rate": pct(stag, total),
                },
                {
                    "Condition": condition_label,
                    "Outcome": "Rabbit",
                    "Player": "Player 1",
                    "Captures": rabbit_p1,
                    "Rounds": total,
                    "Rate": pct(rabbit_p1, total),
                },
                {
                    "Condition": condition_label,
                    "Outcome": "Rabbit",
                    "Player": "Player 2",
                    "Captures": rabbit_p2,
                    "Rounds": total,
                    "Rate": pct(rabbit_p2, total),
                },
            ]
        )
    return pd.DataFrame(rows)


def signal_use_summary(trials: pd.DataFrame) -> pd.DataFrame:
    rows = []
    for condition, group in sorted(
        trials.groupby("participantCondition"), key=lambda item: condition_sort_key(item[0])
    ):
        total = len(group)
        p1_rounds = 0
        p2_rounds = 0
        both_rounds = 0
        p1_actions = 0
        p2_actions = 0
        for _, row in group.iterrows():
            p1_list = parse_json_list(row.get("player1Actions"))
            p2_list = parse_json_list(row.get("player2Actions"))
            p1_signal = p1_list.count("signal")
            p2_signal = p2_list.count("signal")
            p1_actions += p1_signal
            p2_actions += p2_signal
            if p1_signal:
                p1_rounds += 1
            if p2_signal:
                p2_rounds += 1
            if p1_signal and p2_signal:
                both_rounds += 1

        rows.append(
            {
                "Condition": CONDITION_LABELS.get(condition, condition),
                "Rounds": total,
                "Any signal rounds": p1_rounds + p2_rounds - both_rounds,
                "P1 signal rounds": p1_rounds,
                "P2 signal rounds": p2_rounds,
                "Both signal rounds": both_rounds,
                "P1 signal actions": p1_actions,
                "P2 signal actions": p2_actions,
                "Total signal actions": p1_actions + p2_actions,
            }
        )
    return pd.DataFrame(rows)


def run_level_rates(trials: pd.DataFrame) -> pd.DataFrame:
    rows = []
    for source_file, group in trials.groupby("sourceFile", sort=False):
        total = len(group)
        final = group.sort_values("roundNumber").tail(1).iloc[0]
        p1_signal_actions = sum(parse_json_list(value).count("signal") for value in group.get("player1Actions", []))
        p2_signal_actions = sum(parse_json_list(value).count("signal") for value in group.get("player2Actions", []))
        rows.append(
            {
                "File": short_file(source_file),
                "Condition": CONDITION_LABELS.get(final.get("participantCondition"), final.get("participantCondition")),
                "Match": final.get("matchType"),
                "Rounds": total,
                "Stag rate": pct((group["outcomeType"] == "stag_captured").sum(), total),
                "Rabbit rate": pct(group["outcomeType"].astype(str).str.startswith("rabbit_captured").sum(), total),
                "Timeout rate": pct((group["outcomeType"] == "timeout").sum(), total),
                "P1 rabbit": int((group["outcomeType"] == "rabbit_captured_p1").sum()),
                "P2 rabbit": int((group["outcomeType"] == "rabbit_captured_p2").sum()),
                "Signal actions": int(p1_signal_actions + p2_signal_actions),
                "Final local score": final.get("player2Score") if final.get("localPlayer") == "player2" else final.get("player1Score"),
            }
        )
    return pd.DataFrame(rows)


def round_duration_sec(row: pd.Series) -> float:
    history = parse_json_list(row.get("actionHistory"))
    elapsed = [
        item.get("elapsedMs")
        for item in history
        if isinstance(item, dict) and isinstance(item.get("elapsedMs"), (int, float))
    ]
    return max(elapsed) / 1000 if elapsed else float("nan")


def human_room_summary(trials: pd.DataFrame) -> pd.DataFrame:
    human = trials[trials["matchType"] == "human"].copy()
    if human.empty:
        return pd.DataFrame()
    rows = []
    for room_id, group in human.groupby("roomId"):
        dedup = group.drop_duplicates("analysisTrialKey")
        rows.append(
            {
                "Room": short_id(room_id),
                "Participants": group["sourceFile"].nunique(),
                "Rounds": dedup["roundNumber"].nunique(),
                "Stag captures": int((dedup["outcomeType"] == "stag_captured").sum()),
                "Rabbit captures": int(dedup["outcomeType"].astype(str).str.startswith("rabbit_captured").sum()),
                "Timeouts": int((dedup["outcomeType"] == "timeout").sum()),
                "Complete pair": "Yes" if group["sourceFile"].nunique() >= 2 and dedup["roundNumber"].nunique() >= 3 else "No",
            }
        )
    return pd.DataFrame(rows).sort_values(["Complete pair", "Room"], ascending=[False, True])


def short_id(value: str) -> str:
    text = clean_text(value, "")
    if len(text) <= 16:
        return text
    return text[:8] + "..." + text[-5:]


def short_file(value: str) -> str:
    text = clean_text(value, "")
    match = re.search(r"T(\d{2}-\d{2}-\d{2})-\d+Z-([^-]+)-(player[12])\.xlsx$", text)
    if match:
        time_text, code, player = match.groups()
        return f"{time_text} {code} {player.replace('player', 'p')}"
    return short_id(text)


def table_html(df: pd.DataFrame, classes: str = "") -> str:
    if df.empty:
        return "<p class=\"muted\">No rows.</p>"
    headers = "".join(f"<th>{escape(str(col))}</th>" for col in df.columns)
    rows = []
    for _, row in df.iterrows():
        cells = "".join(f"<td>{fmt(row[col])}</td>" for col in df.columns)
        rows.append(f"<tr>{cells}</tr>")
    return f"<table class=\"{classes}\"><thead><tr>{headers}</tr></thead><tbody>{''.join(rows)}</tbody></table>"


def kpi_card(label: str, value: str, sub: str = "") -> str:
    return (
        "<div class=\"kpi\">"
        f"<div class=\"kpi-label\">{escape(label)}</div>"
        f"<div class=\"kpi-value\">{escape(value)}</div>"
        f"<div class=\"kpi-sub\">{escape(sub)}</div>"
        "</div>"
    )


def simple_bar_chart(df: pd.DataFrame, label_col: str, value_col: str, group_col: str | None = None) -> str:
    if df.empty:
        return "<p class=\"muted\">No chart data.</p>"
    max_value = float(df[value_col].max()) if len(df) else 0.0
    max_value = max(max_value, 1.0)

    groups = [(None, df)] if not group_col else list(df.groupby(group_col, sort=False))
    blocks = []
    for group, group_df in groups:
        title = f"<h4>{escape(str(group))}</h4>" if group is not None else ""
        rows = []
        for _, row in group_df.iterrows():
            value = float(row[value_col] or 0)
            width = max(2.0, value / max_value * 100)
            label = escape(str(row[label_col]))
            extra = f"{fmt(value, 1)}"
            if "Rate" in row:
                extra = f"{fmt(value, 0)} ({row['Rate']:.1f}%)"
            rows.append(
                "<div class=\"bar-row\">"
                f"<div class=\"bar-label\">{label}</div>"
                "<div class=\"bar-track\">"
                f"<div class=\"bar-fill\" style=\"width:{width:.1f}%\"></div>"
                "</div>"
                f"<div class=\"bar-value\">{extra}</div>"
                "</div>"
            )
        blocks.append(f"<div class=\"bar-block\">{title}{''.join(rows)}</div>")
    return "".join(blocks)


def condition_balance_bar(participants: pd.DataFrame) -> str:
    counts = participants["participantCondition"].value_counts()
    total = int(counts.sum())
    a = int(counts.get("Condition A", 0))
    b = int(counts.get("Condition B", 0))
    a_width = pct(a, total)
    b_width = pct(b, total)
    return (
        "<div class=\"stacked\">"
        f"<div class=\"stack-a\" style=\"width:{a_width:.1f}%\">A {a}</div>"
        f"<div class=\"stack-b\" style=\"width:{b_width:.1f}%\">B {b}</div>"
        "</div>"
        f"<p class=\"muted\">Participant files: A {a} ({a_width:.1f}%), B {b} ({b_width:.1f}%).</p>"
    )


def mean_sem(values) -> tuple[float, float, int]:
    series = pd.to_numeric(pd.Series(values), errors="coerce").dropna()
    n = int(series.shape[0])
    if n == 0:
        return float("nan"), float("nan"), 0
    mean = float(series.mean())
    sem = float(series.std(ddof=1) / math.sqrt(n)) if n > 1 else 0.0
    return mean, sem, n


def proportion_sem(count: int, n: int) -> tuple[float, float]:
    if n <= 0:
        return float("nan"), float("nan")
    p = count / n
    return p * 100, math.sqrt(p * (1 - p) / n) * 100


def academic_axis_max(values: list[float], minimum: float = 10.0) -> float:
    clean = [value for value in values if not math.isnan(value)]
    if not clean:
        return minimum
    upper = max(clean)
    target = max(minimum, upper * 1.18)
    if target <= 25:
        return math.ceil(target / 5) * 5
    return math.ceil(target / 10) * 10


def svg_text_lines(text: str, x: float, y: float, line_height: float = 15, **attrs) -> str:
    attr_parts = []
    for name, value in attrs.items():
        attr_name = "class" if name == "class_" else name.replace("_", "-")
        attr_parts.append(f"{attr_name}=\"{escape(str(value))}\"")
    attr_text = " ".join(attr_parts)
    lines = str(text).split("\n")
    tspans = []
    for index, line in enumerate(lines):
        dy = "0" if index == 0 else str(line_height)
        tspans.append(f"<tspan x=\"{x:.1f}\" dy=\"{dy}\">{escape(line)}</tspan>")
    return f"<text x=\"{x:.1f}\" y=\"{y:.1f}\" {attr_text}>{''.join(tspans)}</text>"


def academic_bar_plot_svg(
    panel_label: str,
    title: str,
    y_label: str,
    bars: list[dict],
    y_max: float,
    y_ticks: list[float],
    value_suffix: str = "",
    decimals: int = 1,
) -> str:
    width = 520
    height = 390
    left = 78
    right = 24
    top = 64
    bottom = 84
    plot_w = width - left - right
    plot_h = height - top - bottom
    axis_bottom = top + plot_h
    colors = ["#9ecae1", "#fdae6b", "#bcbddc", "#a1d99b"]

    def y_pos(value: float) -> float:
        value = max(0.0, min(float(value), y_max))
        return top + plot_h * (1 - value / y_max)

    tick_marks = []
    for tick in y_ticks:
        y = y_pos(tick)
        tick_marks.append(
            f"<line x1=\"{left}\" y1=\"{y:.1f}\" x2=\"{width - right}\" y2=\"{y:.1f}\" class=\"paper-grid\"/>"
            f"<text x=\"{left - 10}\" y=\"{y + 4:.1f}\" text-anchor=\"end\" class=\"paper-tick\">{fmt(tick, 0)}</text>"
        )

    bar_items = []
    count = max(1, len(bars))
    step = plot_w / count
    bar_w = min(92, step * 0.44)
    for index, bar in enumerate(bars):
        x = left + step * index + step / 2
        value = float(bar["value"])
        sem = float(bar.get("sem", 0) or 0)
        y = y_pos(value)
        bar_h = axis_bottom - y
        err_top = y_pos(value + sem)
        err_bottom = y_pos(max(0, value - sem))
        fill = bar.get("fill", colors[index % len(colors)])
        annotation = bar.get("annotation", f"{value:.{decimals}f}{value_suffix}")
        n_label = bar.get("nLabel", "")

        bar_items.append(
            f"<rect x=\"{x - bar_w / 2:.1f}\" y=\"{y:.1f}\" width=\"{bar_w:.1f}\" height=\"{bar_h:.1f}\" "
            f"fill=\"{fill}\" stroke=\"#111111\" stroke-width=\"1.4\"/>"
            f"<line x1=\"{x:.1f}\" y1=\"{err_top:.1f}\" x2=\"{x:.1f}\" y2=\"{err_bottom:.1f}\" class=\"paper-error\"/>"
            f"<line x1=\"{x - 13:.1f}\" y1=\"{err_top:.1f}\" x2=\"{x + 13:.1f}\" y2=\"{err_top:.1f}\" class=\"paper-error\"/>"
            f"<line x1=\"{x - 13:.1f}\" y1=\"{err_bottom:.1f}\" x2=\"{x + 13:.1f}\" y2=\"{err_bottom:.1f}\" class=\"paper-error\"/>"
            f"<text x=\"{x:.1f}\" y=\"{err_top - 9:.1f}\" text-anchor=\"middle\" class=\"paper-value\">{escape(annotation)}</text>"
            f"{svg_text_lines(bar['label'], x, axis_bottom + 26, 15, text_anchor='middle', class_='paper-x')}"
            f"<text x=\"{x:.1f}\" y=\"{axis_bottom + 62:.1f}\" text-anchor=\"middle\" class=\"paper-n\">{escape(n_label)}</text>"
        )

    return f"""
<svg class="paper-plot" viewBox="0 0 {width} {height}" role="img" aria-label="{escape(title)}">
  <text x="20" y="29" class="paper-panel">{escape(panel_label)}</text>
  <text x="{left}" y="29" class="paper-title">{escape(title)}</text>
  {''.join(tick_marks)}
  <line x1="{left}" y1="{top}" x2="{left}" y2="{axis_bottom}" class="paper-axis"/>
  <line x1="{left}" y1="{axis_bottom}" x2="{width - right}" y2="{axis_bottom}" class="paper-axis"/>
  <text transform="translate(22 {top + plot_h / 2:.1f}) rotate(-90)" text-anchor="middle" class="paper-y">{escape(y_label)}</text>
  {''.join(bar_items)}
</svg>
"""


def academic_grouped_rate_plot_svg(analysis_trials: pd.DataFrame) -> str:
    width = 900
    height = 470
    left = 82
    right = 34
    top = 62
    bottom = 102
    plot_w = width - left - right
    plot_h = height - top - bottom
    axis_bottom = top + plot_h
    y_max = 100
    outcome_groups = [
        ("Rabbit", lambda frame: frame["outcomeType"].astype(str).str.startswith("rabbit_captured")),
        ("Stag", lambda frame: frame["outcomeType"] == "stag_captured"),
        ("Timeout", lambda frame: frame["outcomeType"] == "timeout"),
    ]
    condition_specs = [
        ("Condition A", "Human-human", "#9ecae1"),
        ("Condition B", "Human-bot", "#fdae6b"),
    ]

    def y_pos(value: float) -> float:
        return top + plot_h * (1 - max(0.0, min(float(value), y_max)) / y_max)

    ticks = []
    for tick in range(0, 101, 20):
        y = y_pos(tick)
        ticks.append(
            f"<line x1=\"{left}\" y1=\"{y:.1f}\" x2=\"{width - right}\" y2=\"{y:.1f}\" class=\"paper-grid\"/>"
            f"<text x=\"{left - 10}\" y=\"{y + 4:.1f}\" text-anchor=\"end\" class=\"paper-tick\">{tick}</text>"
        )

    group_step = plot_w / len(outcome_groups)
    bar_w = min(72, group_step * 0.22)
    bar_gap = 14
    bars = []
    for group_index, (outcome_label, mask_fn) in enumerate(outcome_groups):
        group_center = left + group_step * group_index + group_step / 2
        bars.append(
            f"<text x=\"{group_center:.1f}\" y=\"{axis_bottom + 36:.1f}\" text-anchor=\"middle\" class=\"paper-x-main\">{escape(outcome_label)}</text>"
        )
        for condition_index, (condition, condition_label, fill) in enumerate(condition_specs):
            condition_frame = analysis_trials[analysis_trials["participantCondition"] == condition]
            n = int(condition_frame.shape[0])
            count = int(mask_fn(condition_frame).sum()) if n else 0
            rate, se = proportion_sem(count, n)
            x = group_center + (condition_index - 0.5) * (bar_w + bar_gap)
            y = y_pos(rate)
            bar_h = axis_bottom - y
            err_top = y_pos(rate + se)
            err_bottom = y_pos(max(0, rate - se))
            bars.append(
                f"<rect x=\"{x - bar_w / 2:.1f}\" y=\"{y:.1f}\" width=\"{bar_w:.1f}\" height=\"{bar_h:.1f}\" "
                f"fill=\"{fill}\" stroke=\"#111111\" stroke-width=\"1.4\"/>"
                f"<line x1=\"{x:.1f}\" y1=\"{err_top:.1f}\" x2=\"{x:.1f}\" y2=\"{err_bottom:.1f}\" class=\"paper-error\"/>"
                f"<line x1=\"{x - 11:.1f}\" y1=\"{err_top:.1f}\" x2=\"{x + 11:.1f}\" y2=\"{err_top:.1f}\" class=\"paper-error\"/>"
                f"<line x1=\"{x - 11:.1f}\" y1=\"{err_bottom:.1f}\" x2=\"{x + 11:.1f}\" y2=\"{err_bottom:.1f}\" class=\"paper-error\"/>"
                f"<text x=\"{x:.1f}\" y=\"{max(22, err_top - 8):.1f}\" text-anchor=\"middle\" class=\"paper-value\">{rate:.1f}%</text>"
                f"<text x=\"{x:.1f}\" y=\"{axis_bottom + 58:.1f}\" text-anchor=\"middle\" class=\"paper-n\">{count}/{n}</text>"
            )

    legend_x = width - right - 238
    legend_y = 26
    legend = []
    for index, (_, condition_label, fill) in enumerate(condition_specs):
        x = legend_x + index * 120
        legend.append(
            f"<rect x=\"{x:.1f}\" y=\"{legend_y - 11:.1f}\" width=\"16\" height=\"16\" fill=\"{fill}\" stroke=\"#111111\" stroke-width=\"1.2\"/>"
            f"<text x=\"{x + 23:.1f}\" y=\"{legend_y + 2:.1f}\" class=\"paper-legend\">{escape(condition_label)}</text>"
        )

    return f"""
<svg class="paper-plot outcome-rate-plot" viewBox="0 0 {width} {height}" role="img" aria-label="Rabbit, stag, and timeout rates by condition">
  <text x="20" y="30" class="paper-panel">A</text>
  <text x="{left}" y="30" class="paper-title">Round outcomes by partner condition</text>
  {''.join(legend)}
  {''.join(ticks)}
  <line x1="{left}" y1="{top}" x2="{left}" y2="{axis_bottom}" class="paper-axis"/>
  <line x1="{left}" y1="{axis_bottom}" x2="{width - right}" y2="{axis_bottom}" class="paper-axis"/>
  <text transform="translate(24 {top + plot_h / 2:.1f}) rotate(-90)" text-anchor="middle" class="paper-y">Outcome rate (%)</text>
  {''.join(bars)}
  <text x="{left + plot_w / 2:.1f}" y="{height - 15}" text-anchor="middle" class="paper-y">Round outcome</text>
</svg>
"""


def first_action_stacked_svg(first_summary: pd.DataFrame) -> str:
    if first_summary.empty:
        return "<p class=\"muted\">No first-action data available.</p>"

    width = 940
    height = 430
    left = 188
    right = 106
    top = 78
    bottom = 76
    plot_w = width - left - right
    row_h = 42
    row_gap = 20
    rows_order = [
        ("A: human-human", "Player 1"),
        ("A: human-human", "Player 2"),
        ("B: human-bot", "Player 1"),
        ("B: human-bot", "Player 2"),
    ]
    categories = [
        ("No-move", "#b7c1ce"),
        ("Implicit stag move", "#2ca25f"),
        ("Non-stag move", "#fdae6b"),
        ("Explicit signal", "#756bb1"),
    ]

    ticks = []
    for tick in [0, 25, 50, 75, 100]:
        x = left + plot_w * tick / 100
        ticks.append(
            f"<line x1=\"{x:.1f}\" y1=\"{top - 14}\" x2=\"{x:.1f}\" y2=\"{height - bottom + 7}\" class=\"paper-grid\"/>"
            f"<text x=\"{x:.1f}\" y=\"{height - bottom + 30}\" text-anchor=\"middle\" class=\"paper-tick\">{tick}%</text>"
        )

    row_items = []
    for row_index, (condition, player) in enumerate(rows_order):
        row_y = top + row_index * (row_h + row_gap)
        group = first_summary[
            (first_summary["Condition"] == condition)
            & (first_summary["Player"] == player)
        ]
        total = int(group["Count"].sum()) if not group.empty else 0
        condition_short = "Human-human" if condition.startswith("A:") else "Human-bot"
        row_items.append(
            f"<text x=\"{left - 14}\" y=\"{row_y + 16:.1f}\" text-anchor=\"end\" class=\"paper-row-label\">{escape(condition_short)}</text>"
            f"<text x=\"{left - 14}\" y=\"{row_y + 34:.1f}\" text-anchor=\"end\" class=\"paper-row-sub\">{escape(player)}</text>"
        )

        x_cursor = left
        for category, color in categories:
            match = group[group["Category"] == category]
            count = int(match["Count"].iloc[0]) if not match.empty else 0
            rate = float(match["Rate"].iloc[0]) if not match.empty else 0.0
            seg_w = plot_w * rate / 100
            if seg_w > 0:
                row_items.append(
                    f"<rect x=\"{x_cursor:.1f}\" y=\"{row_y:.1f}\" width=\"{seg_w:.1f}\" height=\"{row_h}\" "
                    f"fill=\"{color}\" stroke=\"#ffffff\" stroke-width=\"1.5\"/>"
                )
                if seg_w >= 58:
                    text_color = "#ffffff" if category in {"Implicit stag move", "Explicit signal"} else "#111111"
                    row_items.append(
                        f"<text x=\"{x_cursor + seg_w / 2:.1f}\" y=\"{row_y + 26:.1f}\" text-anchor=\"middle\" "
                        f"class=\"segment-label\" fill=\"{text_color}\">{count} ({rate:.0f}%)</text>"
                    )
                elif count > 0:
                    row_items.append(
                        f"<text x=\"{x_cursor + seg_w + 5:.1f}\" y=\"{row_y + 14:.1f}\" class=\"tiny-segment-label\">{count}</text>"
                    )
            x_cursor += seg_w

        row_items.append(
            f"<rect x=\"{left:.1f}\" y=\"{row_y:.1f}\" width=\"{plot_w:.1f}\" height=\"{row_h}\" fill=\"none\" stroke=\"#111111\" stroke-width=\"1.1\"/>"
            f"<text x=\"{left + plot_w + 14:.1f}\" y=\"{row_y + 26:.1f}\" class=\"paper-n\">n = {total}</text>"
        )

    legend = []
    legend_x = left
    legend_y = 42
    x_cursor = legend_x
    for category, color in categories:
        legend.append(
            f"<rect x=\"{x_cursor:.1f}\" y=\"{legend_y - 12}\" width=\"15\" height=\"15\" fill=\"{color}\" stroke=\"#111111\" stroke-width=\"0.8\"/>"
            f"<text x=\"{x_cursor + 21:.1f}\" y=\"{legend_y:.1f}\" class=\"paper-legend\">{escape(category)}</text>"
        )
        x_cursor += 160 if category != "Implicit stag move" else 190

    return f"""
<svg class="paper-plot first-action-plot" viewBox="0 0 {width} {height}" role="img" aria-label="First-action implicit signaling coding">
  <text x="20" y="30" class="paper-panel">A</text>
  <text x="{left}" y="30" class="paper-title">First-action coding by condition and player</text>
  {''.join(legend)}
  {''.join(ticks)}
  <line x1="{left}" y1="{height - bottom + 7}" x2="{left + plot_w}" y2="{height - bottom + 7}" class="paper-axis"/>
  {''.join(row_items)}
  <text x="{left + plot_w / 2:.1f}" y="{height - 18}" text-anchor="middle" class="paper-y">Share of first actions within condition/player (%)</text>
</svg>
"""


def capture_by_player_svg(capture_summary: pd.DataFrame) -> str:
    if capture_summary.empty:
        return "<p class=\"muted\">No capture data available.</p>"

    width = 940
    height = 450
    left = 82
    right = 34
    top = 72
    bottom = 92
    plot_w = width - left - right
    plot_h = height - top - bottom
    axis_bottom = top + plot_h
    y_max = 100
    panel_gap = 58
    panel_w = (plot_w - panel_gap) / 2
    outcomes = [
        ("Stag", "#2ca25f"),
        ("Rabbit", "#756bb1"),
    ]
    condition_specs = [
        ("A: human-human", "Human-human", {"Player 1": "Player 1", "Player 2": "Player 2"}),
        ("B: human-bot", "Human-bot", {"Player 1": "Player 1", "Player 2": "Player 2 (AI)"}),
    ]

    def y_pos(value: float) -> float:
        return top + plot_h * (1 - max(0, min(float(value), y_max)) / y_max)

    ticks = []
    for tick in [0, 25, 50, 75, 100]:
        y = y_pos(tick)
        ticks.append(
            f"<line x1=\"{left}\" y1=\"{y:.1f}\" x2=\"{width - right}\" y2=\"{y:.1f}\" class=\"paper-grid\"/>"
            f"<text x=\"{left - 10}\" y=\"{y + 4:.1f}\" text-anchor=\"end\" class=\"paper-tick\">{tick}</text>"
        )

    bars = []
    bar_w = 54
    bar_gap = 12
    players = ["Player 1", "Player 2"]
    for panel_index, (condition, condition_label, player_labels) in enumerate(condition_specs):
        panel_x = left + panel_index * (panel_w + panel_gap)
        bars.append(
            f"<text x=\"{panel_x + panel_w / 2:.1f}\" y=\"{top - 22:.1f}\" text-anchor=\"middle\" class=\"paper-title\">{escape(condition_label)}</text>"
        )
        player_step = panel_w / len(players)
        for player_index, player in enumerate(players):
            player_center = panel_x + player_step * player_index + player_step / 2
            display_player = player_labels[player]
            bars.append(
                f"<text x=\"{player_center:.1f}\" y=\"{axis_bottom + 30:.1f}\" text-anchor=\"middle\" class=\"paper-x-main\">{escape(display_player)}</text>"
            )
            for outcome_index, (outcome, fill) in enumerate(outcomes):
                row = capture_summary[
                    (capture_summary["Outcome"] == outcome)
                    & (capture_summary["Player"] == player)
                    & (capture_summary["Condition"] == condition)
                ]
                if row.empty:
                    count = 0
                    rounds = 0
                    rate = 0.0
                    se = 0.0
                else:
                    count = int(row["Captures"].iloc[0])
                    rounds = int(row["Rounds"].iloc[0])
                    rate = float(row["Rate"].iloc[0])
                    _, se = proportion_sem(count, rounds)

                x = player_center + (outcome_index - 0.5) * (bar_w + bar_gap)
                y = y_pos(rate)
                bar_h = axis_bottom - y
                err_top = y_pos(rate + se)
                err_bottom = y_pos(max(0, rate - se))
                label_y = max(top + 12, err_top - 8)
                bars.append(
                    f"<rect x=\"{x - bar_w / 2:.1f}\" y=\"{y:.1f}\" width=\"{bar_w:.1f}\" height=\"{bar_h:.1f}\" "
                    f"fill=\"{fill}\" stroke=\"#111111\" stroke-width=\"1.3\"/>"
                    f"<line x1=\"{x:.1f}\" y1=\"{err_top:.1f}\" x2=\"{x:.1f}\" y2=\"{err_bottom:.1f}\" class=\"paper-error\"/>"
                    f"<line x1=\"{x - 10:.1f}\" y1=\"{err_top:.1f}\" x2=\"{x + 10:.1f}\" y2=\"{err_top:.1f}\" class=\"paper-error\"/>"
                    f"<line x1=\"{x - 10:.1f}\" y1=\"{err_bottom:.1f}\" x2=\"{x + 10:.1f}\" y2=\"{err_bottom:.1f}\" class=\"paper-error\"/>"
                    f"<text x=\"{x:.1f}\" y=\"{label_y:.1f}\" text-anchor=\"middle\" class=\"paper-value\">{rate:.1f}%</text>"
                    f"<text x=\"{x:.1f}\" y=\"{axis_bottom + 50:.1f}\" text-anchor=\"middle\" class=\"paper-n\">{count}/{rounds}</text>"
                )

    legend_x = width - right - 182
    legend_y = 26
    legend = []
    for index, (outcome_label, fill) in enumerate(outcomes):
        x = legend_x + index * 90
        legend.append(
            f"<rect x=\"{x:.1f}\" y=\"{legend_y - 11:.1f}\" width=\"16\" height=\"16\" fill=\"{fill}\" stroke=\"#111111\" stroke-width=\"1.2\"/>"
            f"<text x=\"{x + 23:.1f}\" y=\"{legend_y + 2:.1f}\" class=\"paper-legend\">{escape(outcome_label)}</text>"
        )

    separator_x = left + panel_w + panel_gap / 2
    return f"""
<svg class="paper-plot capture-player-plot" viewBox="0 0 {width} {height}" role="img" aria-label="Stag and rabbit capture rates by player within human-human and human-bot conditions">
  <text x="20" y="30" class="paper-panel">A</text>
  <text x="{left}" y="30" class="paper-title">Capture rates by player within condition</text>
  {''.join(legend)}
  {''.join(ticks)}
  <line x1="{left}" y1="{top}" x2="{left}" y2="{axis_bottom}" class="paper-axis"/>
  <line x1="{left}" y1="{axis_bottom}" x2="{width - right}" y2="{axis_bottom}" class="paper-axis"/>
  <line x1="{separator_x:.1f}" y1="{top - 8}" x2="{separator_x:.1f}" y2="{axis_bottom + 12}" class="paper-divider"/>
  <text transform="translate(24 {top + plot_h / 2:.1f}) rotate(-90)" text-anchor="middle" class="paper-y">Capture rate (% of rounds)</text>
  {''.join(bars)}
  <text x="{left + plot_w / 2:.1f}" y="{height - 15}" text-anchor="middle" class="paper-y">Player credited with capture</text>
</svg>
"""


def paper_figure_html(analysis_trials: pd.DataFrame, participants: pd.DataFrame) -> str:
    score_bars = []
    for condition, label, fill in [
        ("Condition A", "Human-human\nCondition A", "#9ecae1"),
        ("Condition B", "Human-bot\nCondition B", "#fdae6b"),
    ]:
        participant_group = participants[participants["participantCondition"] == condition]
        mean_score, sem_score, n_participants = mean_sem(participant_group["localScore"])
        score_bars.append(
            {
                "label": label,
                "value": mean_score,
                "sem": sem_score,
                "fill": fill,
                "annotation": f"{mean_score:.1f}",
                "nLabel": f"n = {n_participants} players",
            }
        )

    score_y_max = academic_axis_max([bar["value"] + bar["sem"] for bar in score_bars], minimum=16)
    score_tick_step = 5 if score_y_max <= 25 else 10
    score_ticks = list(range(0, int(score_y_max) + 1, score_tick_step))

    return f"""
<article class="card paper-figure-card">
  <h2>Proposal-Style Summary Figure</h2>
  <div class="paper-panels paper-panels-outcomes">
    {academic_grouped_rate_plot_svg(analysis_trials)}
    {academic_bar_plot_svg("B", "Final earned points", "Points earned by player", score_bars, score_y_max, score_ticks)}
  </div>
  <p class="figure-caption"><strong>Figure 1.</strong> Stag Hunt outcomes by partner condition. Panel A shows the percentage of deduplicated rounds ending in rabbit capture, joint stag capture, or timeout, with condition shown by bar color; error bars are binomial standard errors. Panel B shows each phone/player file's final earned points; error bars are SEM. Condition labels follow the recorded participant condition, and the data-quality table below notes one condition/match mismatch.</p>
</article>
"""


def mini_report_coverage_table() -> pd.DataFrame:
    return pd.DataFrame(
        [
            {
                "Mini report analysis": "Rabbit, stag, and timeout rates",
                "Mobile report status": "Included",
                "Where": "Proposal-style Figure 1A and outcome-rate table",
            },
            {
                "Mini report analysis": "Final score comparison",
                "Mobile report status": "Included",
                "Where": "Figure 1B and final displayed score table",
            },
            {
                "Mini report analysis": "Run-level capture rates",
                "Mobile report status": "Included",
                "Where": "Mini-report-style run-level rates table",
            },
            {
                "Mini report analysis": "Stag/rabbit captures by player",
                "Mobile report status": "Included",
                "Where": "Stag/Rabbit captures by player section",
            },
            {
                "Mini report analysis": "First-action / implicit signaling coding",
                "Mobile report status": "Adapted",
                "Where": "First-action coding section; movement toward stag is treated as implicit stag intent",
            },
            {
                "Mini report analysis": "Explicit signal-use analysis",
                "Mobile report status": "Included if present",
                "Where": "Signal-use summary; current collected data show no signal actions",
            },
            {
                "Mini report analysis": "Baseline vs signaling manipulation",
                "Mobile report status": "Not applicable",
                "Where": "Mobile class game manipulates partner type, not base vs signal condition",
            },
            {
                "Mini report analysis": "Partner human/AI guess accuracy",
                "Mobile report status": "Unavailable",
                "Where": "Current workbooks do not contain partner-guess fields",
            },
        ]
    )


def mini_style_analyses_html(
    analysis_trials: pd.DataFrame,
    raw_trials: pd.DataFrame,
    first_summary: pd.DataFrame,
    capture_player: pd.DataFrame,
    signal_summary_df: pd.DataFrame,
    run_rates: pd.DataFrame,
) -> str:
    signal_total = int(signal_summary_df["Total signal actions"].sum()) if not signal_summary_df.empty else 0
    signal_note = (
        "No explicit signal actions were observed in these mobile workbooks, so the signal-use analysis is reported as zeros."
        if signal_total == 0
        else "Explicit signal actions were observed and are summarized below."
    )

    return f"""
<article class="card">
  <h2>Mini-Report Analysis Coverage</h2>
  <p class="muted">Compared against the mini-StagHunt expanded pilot report. Analyses that depend on unavailable fields or a different experimental manipulation are marked below.</p>
  <div class="scroll">{table_html(mini_report_coverage_table(), "compact-table")}</div>
</article>

<article class="card">
  <h2>First-Action Coding</h2>
  <p class="muted">Adapted from the mini report's implicit-signaling analysis. Each row sums to 100% within that condition/player group, making player and condition differences easier to compare.</p>
  {first_action_stacked_svg(first_summary)}
  <p class="figure-caption"><strong>Coding rule.</strong> No-move means the first action did not change the player's grid position. Implicit stag move means the first movement reduced Manhattan distance to the stag. Non-stag move means the player moved but did not get closer to the stag. Explicit signal is listed for completeness; no explicit signal actions appeared in these mobile workbooks.</p>
  <div class="scroll">{table_html(first_summary, "compact-table")}</div>
</article>

<article class="card">
  <h2>Stag/Rabbit Captures By Player</h2>
  <p class="muted">Rates are computed from deduplicated dyadic rounds. Stag captures are credited to both players because both players receive the joint stag outcome.</p>
  <p class="figure-caption"><strong>Remark.</strong> In the human-bot condition, Player 2 is the AI partner; Player 1 is the human participant.</p>
  {capture_by_player_svg(capture_player)}
  <div class="scroll">{table_html(capture_player, "compact-table")}</div>
</article>

<article class="card half">
  <h2>Signal-Use Summary</h2>
  <p class="muted">{escape(signal_note)}</p>
  <div class="scroll">{table_html(signal_summary_df, "compact-table")}</div>
</article>

<article class="card half">
  <h2>Mini-Style Run-Level Rates</h2>
  <p class="muted">One row per saved phone/player workbook. Human-human pairs therefore appear once per participant file.</p>
  <div class="scroll">{table_html(run_rates, "compact-table")}</div>
</article>
"""


def build_findings(metrics: dict) -> list[str]:
    findings = []
    findings.append(
        f"Condition balance was close: {metrics['condition_a_participants']} participants in A and "
        f"{metrics['condition_b_participants']} in B."
    )
    findings.append(
        f"After deduplicating human-human phone copies, stag capture occurred in "
        f"{metrics['stag_capture_trials']} of {metrics['analysis_trials']} analyzable rounds "
        f"({pct(metrics['stag_capture_trials'], metrics['analysis_trials']):.1f}%)."
    )
    findings.append(
        f"Most rounds ended with a rabbit: {metrics['rabbit_capture_trials']} of "
        f"{metrics['analysis_trials']} rounds ({pct(metrics['rabbit_capture_trials'], metrics['analysis_trials']):.1f}%)."
    )
    if metrics["incomplete_participants"]:
        findings.append(
            f"{metrics['incomplete_participants']} participant file(s) had fewer than 3 rounds, so completion rates should be read with that data-quality note."
        )
    if metrics["condition_match_mismatches"]:
        findings.append(
            f"{metrics['condition_match_mismatches']} participant file(s) had a condition/match mismatch, most likely from a fallback or interrupted matching state."
        )
    if not metrics["has_partner_guess"]:
        findings.append("The partner-guess fields were not present in these workbooks, so belief/accuracy analysis is not available for this dataset.")
    return findings


def generate_report() -> Path:
    trials, summary, files = load_data()
    participants = participant_table(trials)
    analysis_trials = dedupe_trials(trials)
    analysis_trials["roundDurationSec"] = analysis_trials.apply(round_duration_sec, axis=1)
    outcomes = outcome_summary(analysis_trials)
    scores = score_summary(participants)
    round_outcomes = round_outcome_summary(analysis_trials)
    actions, signal_trials, durations = action_summary(analysis_trials)
    human_rooms = human_room_summary(trials)
    first_actions = first_action_rows(analysis_trials)
    first_summary = first_action_summary(first_actions)
    capture_player = capture_by_player_outcome_summary(analysis_trials)
    signal_summary_df = signal_use_summary(analysis_trials)
    run_rates = run_level_rates(trials)

    condition_counts = participants["participantCondition"].value_counts()
    match_counts = participants["matchType"].value_counts()
    condition_match_mismatch = participants[
        ((participants["participantCondition"] == "Condition A") & (participants["matchType"] != "human"))
        | ((participants["participantCondition"] == "Condition B") & (participants["matchType"] != "bot"))
    ].copy()
    complete_participants = int(participants["isComplete"].sum())
    incomplete = participants[~participants["isComplete"]].copy()
    stag_capture_trials = int((analysis_trials["outcomeType"] == "stag_captured").sum())
    rabbit_capture_trials = int(
        analysis_trials["outcomeType"].astype(str).str.startswith("rabbit_captured").sum()
    )

    metrics = {
        "workbooks": len(files),
        "participant_rows": len(trials),
        "participants": len(participants),
        "complete_participants": complete_participants,
        "analysis_trials": len(analysis_trials),
        "condition_a_participants": int(condition_counts.get("Condition A", 0)),
        "condition_b_participants": int(condition_counts.get("Condition B", 0)),
        "human_participants": int(match_counts.get("human", 0)),
        "bot_participants": int(match_counts.get("bot", 0)),
        "human_rooms": int(human_rooms.shape[0]) if not human_rooms.empty else 0,
        "complete_human_rooms": int((human_rooms["Complete pair"] == "Yes").sum()) if not human_rooms.empty else 0,
        "stag_capture_trials": stag_capture_trials,
        "rabbit_capture_trials": rabbit_capture_trials,
        "incomplete_participants": int(len(incomplete)),
        "condition_match_mismatches": int(len(condition_match_mismatch)),
        "has_partner_guess": any("guess" in col.lower() for col in trials.columns),
    }

    condition_trial_counts = (
        analysis_trials.groupby("participantCondition")
        .size()
        .rename("Trial count")
        .reset_index()
    )
    condition_trial_counts["Condition"] = condition_trial_counts["participantCondition"].map(CONDITION_LABELS)
    condition_trial_counts = condition_trial_counts[["Condition", "Trial count"]]

    condition_rates = []
    for condition, group in sorted(
        analysis_trials.groupby("participantCondition"), key=lambda item: condition_sort_key(item[0])
    ):
        total = len(group)
        condition_rates.append(
            {
                "Condition": CONDITION_LABELS.get(condition, condition),
                "Trials": total,
                "Stag capture rate": pct((group["outcomeType"] == "stag_captured").sum(), total),
                "Rabbit capture rate": pct(group["outcomeType"].astype(str).str.startswith("rabbit_captured").sum(), total),
                "Timeout rate": pct((group["outcomeType"] == "timeout").sum(), total),
                "Mean total steps": group["totalSteps"].mean(),
                "Mean P1 steps": group["player1Steps"].mean(),
                "Mean P2 steps": group["player2Steps"].mean(),
                "Mean round duration sec": group["roundDurationSec"].mean(),
            }
        )
    condition_rates_df = pd.DataFrame(condition_rates)

    participant_display = participants[
        [
            "sourceFile",
            "participantCondition",
            "matchType",
            "localPlayer",
            "roundRows",
            "finalRound",
            "localScore",
            "partnerScore",
            "outcomeType",
        ]
    ].copy()
    participant_display["sourceFile"] = participant_display["sourceFile"].map(short_file)
    participant_display["participantCondition"] = participant_display["participantCondition"].map(CONDITION_LABELS)
    participant_display = participant_display.rename(
        columns={
            "sourceFile": "File",
            "participantCondition": "Condition",
            "matchType": "Match",
            "localPlayer": "Local player",
            "roundRows": "Rows",
            "finalRound": "Final round",
            "localScore": "Local score",
            "partnerScore": "Partner score",
            "outcomeType": "Last outcome",
        }
    )

    incomplete_display = incomplete[
        ["sourceFile", "participantCondition", "matchType", "roundRows", "finalRound", "outcomeType"]
    ].copy()
    if not incomplete_display.empty:
        incomplete_display["sourceFile"] = incomplete_display["sourceFile"].map(short_file)
        incomplete_display["participantCondition"] = incomplete_display["participantCondition"].map(CONDITION_LABELS)
        incomplete_display = incomplete_display.rename(
            columns={
                "sourceFile": "File",
                "participantCondition": "Condition",
                "matchType": "Match",
                "roundRows": "Rows",
                "finalRound": "Final round",
                "outcomeType": "Last outcome",
            }
        )

    mismatch_display = condition_match_mismatch[
        ["sourceFile", "participantCondition", "matchType", "playerMode", "roundRows", "finalRound", "outcomeType"]
    ].copy()
    if not mismatch_display.empty:
        mismatch_display["sourceFile"] = mismatch_display["sourceFile"].map(short_file)
        mismatch_display["participantCondition"] = mismatch_display["participantCondition"].map(CONDITION_LABELS)
        mismatch_display = mismatch_display.rename(
            columns={
                "sourceFile": "File",
                "participantCondition": "Condition",
                "matchType": "Match",
                "playerMode": "Player mode",
                "roundRows": "Rows",
                "finalRound": "Final round",
                "outcomeType": "Last outcome",
            }
        )

    action_chart = actions.copy()
    action_chart["Actor"] = action_chart["Actor"].map(
        {"player1": "Player 1", "player2": "Player 2", "stag": "Stag"}
    )
    action_chart = action_chart[action_chart["Count"] > 0]

    findings = build_findings(metrics)

    html = f"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Middle School Stag Hunt Analysis</title>
  <style>
    :root {{
      --ink: #172033;
      --muted: #617085;
      --line: #dbe3ee;
      --panel: #ffffff;
      --bg: #f5f7fb;
      --blue: #1d66d8;
      --cyan: #04a9c8;
      --orange: #f58220;
      --green: #2ea95f;
      --purple: #5a42c9;
      --red: #d24545;
    }}
    * {{ box-sizing: border-box; }}
    body {{
      margin: 0;
      background: var(--bg);
      color: var(--ink);
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      line-height: 1.45;
    }}
    main {{
      width: min(1180px, calc(100vw - 32px));
      margin: 0 auto;
      padding: 28px 0 48px;
    }}
    header {{
      padding: 24px;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: var(--panel);
      margin-bottom: 16px;
    }}
    h1, h2, h3, h4, p {{ margin-top: 0; }}
    h1 {{ margin-bottom: 8px; font-size: clamp(1.8rem, 4vw, 3rem); letter-spacing: 0; }}
    h2 {{ margin-bottom: 12px; font-size: 1.28rem; }}
    h3 {{ margin-bottom: 10px; font-size: 1rem; }}
    h4 {{ margin: 0 0 8px; font-size: 0.9rem; color: var(--muted); }}
    .subhead {{ color: var(--muted); max-width: 900px; margin-bottom: 0; }}
    .grid {{
      display: grid;
      grid-template-columns: repeat(12, 1fr);
      gap: 16px;
    }}
    .card {{
      grid-column: span 12;
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 18px;
      min-width: 0;
    }}
    .half {{ grid-column: span 6; }}
    .third {{ grid-column: span 4; }}
    .kpis {{
      display: grid;
      grid-template-columns: repeat(5, minmax(0, 1fr));
      gap: 12px;
      margin-bottom: 16px;
    }}
    .kpi {{
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 14px;
    }}
    .kpi-label {{ color: var(--muted); font-size: 0.78rem; font-weight: 750; text-transform: uppercase; }}
    .kpi-value {{ font-size: 1.75rem; font-weight: 850; margin-top: 2px; }}
    .kpi-sub {{ color: var(--muted); font-size: 0.82rem; min-height: 1.2em; }}
    .findings {{
      margin: 0;
      padding-left: 18px;
      color: #263247;
    }}
    .findings li {{ margin: 7px 0; }}
    .muted {{ color: var(--muted); font-size: 0.9rem; }}
    table {{
      width: 100%;
      border-collapse: collapse;
      font-size: 0.9rem;
    }}
    th, td {{
      padding: 9px 10px;
      border-bottom: 1px solid var(--line);
      text-align: left;
      vertical-align: top;
    }}
    th {{
      color: #3a4658;
      background: #f0f4fa;
      font-size: 0.78rem;
      text-transform: uppercase;
      letter-spacing: 0.02em;
    }}
    .compact-table td, .compact-table th {{ padding: 7px 8px; }}
    .scroll {{ overflow-x: auto; }}
    .stacked {{
      display: flex;
      width: 100%;
      height: 40px;
      overflow: hidden;
      border-radius: 7px;
      border: 1px solid var(--line);
      background: #eef3f8;
      margin: 12px 0 8px;
      font-weight: 850;
      color: white;
    }}
    .stack-a, .stack-b {{
      display: flex;
      align-items: center;
      justify-content: center;
      min-width: 38px;
      white-space: nowrap;
    }}
    .stack-a {{ background: var(--cyan); }}
    .stack-b {{ background: var(--orange); }}
    .bar-block {{ margin-bottom: 14px; }}
    .bar-row {{
      display: grid;
      grid-template-columns: minmax(115px, 1.1fr) minmax(110px, 3fr) 92px;
      gap: 10px;
      align-items: center;
      margin: 8px 0;
    }}
    .bar-label {{ color: #334057; font-weight: 720; font-size: 0.86rem; }}
    .bar-track {{
      height: 13px;
      background: #e7edf5;
      border-radius: 999px;
      overflow: hidden;
    }}
    .bar-fill {{
      height: 100%;
      background: linear-gradient(90deg, var(--blue), #0aa6c8);
      border-radius: inherit;
    }}
    .bar-value {{ color: var(--muted); font-size: 0.84rem; text-align: right; }}
    .paper-figure-card {{
      background: #ffffff;
      border-color: #ccd4df;
    }}
    .paper-panels {{
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 18px;
      align-items: start;
    }}
    .paper-panels-outcomes {{
      grid-template-columns: minmax(0, 1.55fr) minmax(320px, 0.95fr);
    }}
    .paper-plot {{
      width: 100%;
      height: auto;
      display: block;
      background: #ffffff;
      border: 1px solid #e2e6ed;
    }}
    .paper-axis,
    .paper-error {{
      stroke: #111111;
      stroke-width: 1.4;
      vector-effect: non-scaling-stroke;
    }}
    .paper-divider {{
      stroke: #8d98a8;
      stroke-width: 1;
      stroke-dasharray: 4 5;
      vector-effect: non-scaling-stroke;
    }}
    .paper-grid {{
      stroke: #e7ebf1;
      stroke-width: 1;
      vector-effect: non-scaling-stroke;
    }}
    .paper-panel {{
      font-size: 20px;
      font-weight: 850;
      fill: #111111;
    }}
    .paper-title {{
      font-size: 16px;
      font-weight: 800;
      fill: #111111;
    }}
    .paper-y,
    .paper-x,
    .paper-tick,
    .paper-n,
    .paper-value {{
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      fill: #111111;
    }}
    .paper-y {{ font-size: 13px; font-weight: 760; }}
    .paper-x {{ font-size: 12px; font-weight: 760; }}
    .paper-x-main {{ font-size: 13px; font-weight: 800; }}
    .paper-tick {{ font-size: 11px; }}
    .paper-n {{ font-size: 11px; fill: #4f5c6d; }}
    .paper-value {{ font-size: 12px; font-weight: 800; }}
    .paper-legend {{ font-size: 12px; font-weight: 760; fill: #111111; }}
    .paper-row-label {{
      font-size: 13px;
      font-weight: 820;
      fill: #111111;
    }}
    .paper-row-sub {{
      font-size: 12px;
      font-weight: 700;
      fill: #4f5c6d;
    }}
    .segment-label {{
      font-size: 12px;
      font-weight: 850;
      paint-order: stroke;
      stroke: rgba(255,255,255,0.18);
      stroke-width: 2px;
    }}
    .tiny-segment-label {{
      font-size: 10px;
      font-weight: 800;
      fill: #111111;
    }}
    .figure-caption {{
      margin: 12px 2px 0;
      color: #2d3545;
      font-size: 0.92rem;
      line-height: 1.45;
    }}
    details summary {{
      cursor: pointer;
      color: var(--blue);
      font-weight: 800;
      margin-bottom: 12px;
    }}
    .note {{
      border-left: 4px solid var(--blue);
      padding: 10px 12px;
      background: #f1f6ff;
      color: #2d3a50;
      border-radius: 0 6px 6px 0;
      margin-bottom: 14px;
    }}
    @media (max-width: 820px) {{
      main {{ width: min(100vw - 20px, 760px); padding-top: 12px; }}
      .kpis {{ grid-template-columns: repeat(2, minmax(0, 1fr)); }}
      .half, .third {{ grid-column: span 12; }}
      .paper-panels,
      .paper-panels-outcomes {{ grid-template-columns: 1fr; }}
      .bar-row {{ grid-template-columns: 1fr; gap: 5px; }}
      .bar-value {{ text-align: left; }}
    }}
  </style>
</head>
<body>
<main>
  <header>
    <h1>Middle School Stag Hunt Analysis</h1>
    <p class="subhead">Source: {escape(SOURCE_ZIP_NAME)}. Generated {escape(datetime.now().strftime("%Y-%m-%d %H:%M"))}. Human-human rounds are deduplicated by room and round, because each phone saves a copy of the same dyadic round.</p>
  </header>

  <section class="kpis">
    {kpi_card("Workbooks", str(metrics["workbooks"]), "one file per phone/player")}
    {kpi_card("Participants", str(metrics["participants"]), f"{metrics['complete_participants']} complete")}
    {kpi_card("Analysis rounds", str(metrics["analysis_trials"]), "human copies deduplicated")}
    {kpi_card("Human rooms", str(metrics["human_rooms"]), f"{metrics['complete_human_rooms']} complete pairs")}
    {kpi_card("Bot match files", str(metrics["bot_participants"]), "matchType=bot")}
  </section>

  <section class="grid">
    <article class="card">
      <h2>Key Findings</h2>
      <ul class="findings">
        {''.join(f'<li>{escape(item)}</li>' for item in findings)}
      </ul>
    </article>

    {paper_figure_html(analysis_trials, participants)}

    <article class="card half">
      <h2>Condition Balance</h2>
      {condition_balance_bar(participants)}
      <div class="scroll">{table_html(condition_trial_counts, "compact-table")}</div>
    </article>

    {mini_style_analyses_html(analysis_trials, trials, first_summary, capture_player, signal_summary_df, run_rates)}

    <article class="card half">
      <h2>Outcome Counts by Condition</h2>
      {simple_bar_chart(outcomes, "Outcome", "Count", "Condition")}
    </article>

    <article class="card half">
      <h2>Outcome Rates and Movement</h2>
      <div class="scroll">{table_html(condition_rates_df, "compact-table")}</div>
    </article>

    <article class="card half">
      <h2>Final Displayed Scores</h2>
      <div class="scroll">{table_html(scores, "compact-table")}</div>
    </article>

    <article class="card half">
      <h2>Outcomes by Round</h2>
      <div class="scroll">{table_html(round_outcomes, "compact-table")}</div>
    </article>

    <article class="card half">
      <h2>Action Counts</h2>
      <p class="muted">Computed from deduplicated dyadic trial action histories. Signal was used in {signal_trials} analysis round(s).</p>
      {simple_bar_chart(action_chart, "Action", "Count", "Actor")}
    </article>

    <article class="card">
      <h2>Human-Human Room Check</h2>
      <p class="muted">A complete pair means at least two player files and three deduplicated rounds for that room.</p>
      <div class="scroll">{table_html(human_rooms, "compact-table")}</div>
    </article>

    <article class="card">
      <h2>Data Quality Notes</h2>
      <div class="note">The dataset has {metrics["participant_rows"]} raw participant-round rows. The report uses {metrics["analysis_trials"]} deduplicated analysis rounds for dyadic outcomes.</div>
      <h3>Incomplete participant files</h3>
      <div class="scroll">{table_html(incomplete_display, "compact-table")}</div>
      <h3>Condition/match mismatch</h3>
      <div class="scroll">{table_html(mismatch_display, "compact-table")}</div>
    </article>

    <article class="card">
      <details>
        <summary>Participant-level file summary</summary>
        <div class="scroll">{table_html(participant_display, "compact-table")}</div>
      </details>
    </article>
  </section>
</main>
</body>
</html>
"""

    OUTPUT_HTML.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_HTML.write_text(html, encoding="utf-8")
    print(f"Wrote {OUTPUT_HTML}")
    print(json.dumps(metrics, indent=2))
    return OUTPUT_HTML


if __name__ == "__main__":
    generate_report()
