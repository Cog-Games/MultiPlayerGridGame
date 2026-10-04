"""Read two-kid exports without the old kids=P1/double-AI-log assumptions.

reconstruct() returns the event contract used by collabAIdata's
dyad_coordination_process, analyze_signal_response and analyze_communication_minimal.
Never silently reinterpret legacy files; use their existing loader instead.
"""
import argparse
import json
from pathlib import Path

SCHEMA = 'kids-canonical-events-v1'


def unpack(value):
    if isinstance(value, str):
        try:
            return json.loads(value)
        except (ValueError, TypeError):
            pass
    return value


def require(ok, message):
    if not ok:
        raise ValueError(message)


def load_trials(path):
    """Load JSON exports/checkpoints or the ExperimentData + MoveEvents workbook."""
    path = Path(path)
    if path.suffix.lower() == '.json':
        data = json.loads(path.read_text())
        data = data.get('payload', data)
        context = {k: v for k, v in data.items() if k not in ('allTrialsData', 'trialData', 'gameState')}
        trials = data.get('allTrialsData', [data['trialData']] if 'trialData' in data else [])
        return [{**context, **trial} for trial in trials]
    import pandas as pd
    sheets = pd.read_excel(path, sheet_name=None)
    require('ExperimentData' in sheets, 'missing ExperimentData sheet')
    records = sheets['ExperimentData'].astype(object).where(sheets['ExperimentData'].notna(), None).to_dict('records')
    event_sheet = sheets.get('MoveEvents', pd.DataFrame())
    events = event_sheet.astype(object).where(event_sheet.notna(), None).to_dict('records')
    for row in records:
        row.update({key: unpack(value) for key, value in row.items()})
        require(row.get('dataSchemaVersion') == SCHEMA, 'legacy export: use existing collabAIdata loader')
        row['moveEvents'] = [{key: unpack(value) for key, value in event.items()}
                             for event in events if event['experimentType'] == row['experimentType']
                             and event['trialIndex'] == row['trialIndex']
                             and event.get('trialPhase') == row.get('trialPhase')]
    return records


def reconstruct(row, cohort='Kids', condition=None):
    require(row.get('dataSchemaVersion') == SCHEMA, 'unsupported schema; do not guess legacy event format')
    source = unpack(row.get('moveEvents'))
    require(isinstance(source, list) and source, 'missing move events')
    hi = row.get('humanPlayerIndex')
    # Human-human uses fixed canonical P1/P2 for dyad analysis, independent of file owner.
    human_human = row.get('partnerAgentType') == 'human'
    if human_human or row.get('experimentType', '').startswith('1P'):
        hi = 0
    require(hi in (0, 1), 'missing canonical human identity')
    hi = int(hi)
    initial = unpack(row.get('initialGoalPositions'))
    require(isinstance(initial, list) and initial, 'missing initial goal geometry')
    new = unpack(row.get('newGoalPosition'))
    ng = row.get('newGoalPresented') is True
    reveal = row.get('newGoalPresentedTime') if ng else None
    boundary = row.get('newGoalPresentedAfterEventIndex') if ng else None
    if ng:
        require(isinstance(boundary, (int, float)) and 0 <= boundary <= len(source), 'missing reveal event boundary')
        require(isinstance(reveal, (int, float)) and reveal >= 0, 'missing reveal round')
    positions = [unpack(row.get(f'player{p}StartPosition')) for p in (1, 2)]
    previous_time = [-1, -1]
    counts = [0, 0]
    events = []
    last_round = 0
    for index, item in enumerate(source):
        p = item['playerIndex']
        require(p in (0, 1), 'invalid actor')
        p = int(p)
        require(item['eventIndex'] == index, 'event sequence gap')
        require(item['round'] >= last_round, 'round order conflict')
        require(item['timeMs'] >= previous_time[p], 'nonmonotone RT')
        before, after, action = item['before'], item['after'], item['actualAction']
        require(before == positions[p], 'trajectory discontinuity')
        require(action in [[-1, 0], [1, 0], [0, -1], [0, 1], [0, 0]], 'invalid action')
        require(after == [before[k] + action[k] for k in (0, 1)], 'transition conflict')
        expected_goals = initial + [new] if ng and index >= boundary else initial
        require(item['availableGoals'] == expected_goals, 'reveal visibility conflict')
        for suffix, value in [('Actions', item['action']), ('Trajectory', before), ('RT', item['timeMs'])]:
            stream = unpack(row.get(f'player{p+1}{suffix}'))
            require(isinstance(stream, list) and len(stream) > counts[p] and stream[counts[p]] == value,
                    f'event / player{p+1}{suffix} conflict')
        events.append(dict(round=item['round'], player=p, actor_slot=0 if p == hi else 1,
                           role=('Human 1' if p == 0 else 'Human 2') if human_human else ('Human' if item['actorType'] == 'human' else 'AI'),
                           actor_type=item['actorType'], before=before, after=after, action=action,
                           available=item['availableGoals'], after_arrival=before in item['availableGoals'],
                           time_ms=item['timeMs'], event_index=index))
        positions[p] = after
        previous_time[p] = item['timeMs']
        counts[p] += 1
        last_round = item['round']
    for p in (0, 1):
        for suffix in ['Actions', 'Trajectory', 'RT']:
            require(len(unpack(row.get(f'player{p+1}{suffix}')) or []) == counts[p], 'unlogged trailing move')
        final = unpack(row.get(f'player{p+1}FinalPosition'))
        if final is not None:
            require(final == positions[p], 'final position conflict')
    require(unpack(row.get('currentPlayerIndex')) == [e['player'] for e in events], 'actor order conflict')
    return events, reveal


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('input', type=Path)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    trials = load_trials(args.input)
    result = []
    for row in trials:
        events, reveal = reconstruct(row)
        result.append(dict(participantId=row.get('participantId'), roomId=row.get('roomId'),
                           trialIndex=row['trialIndex'], experimentType=row['experimentType'],
                           partnerAgentType=row.get('partnerAgentType'),
                           partnerFallbackOccurred=row.get('partnerFallbackOccurred'),
                           reveal=reveal, events=events))
    args.output.write_text(json.dumps(result, indent=2))
    print(f'Validated {len(result)} trials / {sum(len(r["events"]) for r in result)} moves')


if __name__ == '__main__':
    main()
