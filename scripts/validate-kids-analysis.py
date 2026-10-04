"""Run after KIDS_TEST_EXPORT_PATH=/tmp/kids-export-fixture.json npm test.
Uses synthetic fixtures only; never rewrites collabAIdata inputs or outputs.
"""
import argparse
import copy
import json
import sys
import tempfile
from pathlib import Path
import pandas as pd
from collab_ai_data_adapter import load_trials, reconstruct

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--fixture', type=Path, default=Path('/tmp/kids-export-fixture.json'))
parser.add_argument('--collab-data', type=Path, required=True)
args = parser.parse_args()
fixture = json.loads(args.fixture.read_text())
with tempfile.TemporaryDirectory() as folder:
    path = Path(folder) / 'export.xlsx'
    with pd.ExcelWriter(path) as writer:
        for name, sheet in fixture['workbook'].items():
            frame = pd.DataFrame(sheet[1:], columns=sheet[0]) if name == 'ExperimentData' else pd.DataFrame(sheet)
            frame.to_excel(writer, sheet_name=name, index=False)
    rows = load_trials(path)
    events, reveal = reconstruct(rows[0])
    direct, direct_reveal = reconstruct(fixture['trial'])
    assert events == direct and reveal == direct_reveal
    assert events[0]['actor_slot'] == 1 and events[1]['actor_slot'] == 0
    assert len(events[0]['available']) == 2 and len(events[2]['available']) == 3
    for corrupt in ('missing_event', 'role_order', 'visibility', 'trajectory'):
        row = copy.deepcopy(rows[0])
        if corrupt == 'missing_event':
            row['moveEvents'].pop()
        elif corrupt == 'role_order':
            row['currentPlayerIndex'][0] = 1
        elif corrupt == 'visibility':
            row['moveEvents'][0]['availableGoals'].append([2, 2])
        else:
            row['moveEvents'][1]['before'] = [10, 10]
        try:
            reconstruct(row)
        except ValueError:
            pass
        else:
            raise AssertionError(f'Failed to reject {corrupt}')
    sys.path.insert(0, str(args.collab_data.resolve()))
    from analyze_signal_response import prospective, build_states
    from analyze_communication_minimal import snapshots
    from tier2_decomposition import actor_first_moves
    assert len(snapshots(events)) == 4
    assert len(build_states(events)) == 2
    assert [prospective(e) for e in events] == [None, None, None, 2]
    first = actor_first_moves(events, reveal, 0, 0)
    assert first['post_reveal_moves'] == 1
    print('PASS: Excel/JSON roundtrip, player-2 identity, reveal alignment, four corruption checks, and current collabAIdata event analyses')
