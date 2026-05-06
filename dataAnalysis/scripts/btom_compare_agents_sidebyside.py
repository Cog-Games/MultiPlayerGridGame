"""Side-by-side BToM legibility plots: all new-goal trials vs equal_to_both only."""
from __future__ import annotations

import json
from pathlib import Path

import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
import seaborn as sns
from scipy.interpolate import interp1d

from btom_compare_agents import (DATA_PATHS, GROUP_ORDER, GROUP_PALETTE,
                                 _q_cache, _btom_for_player)

ROOT = Path(__file__).resolve().parents[1]
OUT_DIR = ROOT / 'btom_legibility'
OUT_DIR.mkdir(exist_ok=True)


def load_group(name, fp, condition_filter=None):
    """condition_filter=None  -> use all new-goal trials.
       condition_filter='equal_to_both' -> filter."""
    trials = json.load(open(fp))
    rows = []
    for t in trials:
        if not t.get('newGoalPresented'):
            continue
        if condition_filter is not None and t.get('distanceCondition') != condition_filter:
            continue
        for player_index in (0, 1):
            posts = _btom_for_player(t, player_index)
            if posts is None:
                continue
            pid_field = f'participantId_player{player_index + 1}'
            if pid_field in t:
                pid = t[pid_field]
            elif 'participantId' in t and player_index == 0:
                pid = t['participantId']
            else:
                pid = f"{name}_session_{t.get('sessionIndex','?')}_p{player_index + 1}"
            rows.append({
                'group':         name,
                'participantId': str(pid),
                'trialIndex':    t.get('trialIndex'),
                'playerIndex':   player_index,
                'distanceCondition': t.get('distanceCondition'),
                'posteriors':    posts,
                'n_steps':       len(posts),
            })
    return pd.DataFrame(rows)


def build_dataset(condition_filter):
    frames = []
    for name in GROUP_ORDER:
        fp = DATA_PATHS[name]
        if not fp.exists():
            continue
        df = load_group(name, fp, condition_filter)
        frames.append(df)
    return pd.concat(frames, ignore_index=True)


def derive_panels(btom_df):
    """Return (btom_part, btom_step_part, btom_step_mean, btom_traj_mean)."""
    N_INTERP = 11
    x_pct = np.linspace(0, 1, N_INTERP)

    def interp(pl):
        if len(pl) < 2:
            return None
        return interp1d(np.linspace(0, 1, len(pl)), pl, kind='linear')(x_pct)

    df = btom_df.copy()
    df['btom_interp'] = df['posteriors'].apply(interp)
    df = df.dropna(subset=['btom_interp']).copy()

    rows = []
    for _, r in df.iterrows():
        for ti, val in enumerate(r['btom_interp']):
            rows.append({'group': r['group'], 'participantId': r['participantId'],
                         'time_pct': x_pct[ti] * 100, 'posterior': val})
    btom_long = pd.DataFrame(rows)
    btom_part = (btom_long
                 .groupby(['participantId', 'group', 'time_pct'], observed=False)['posterior']
                 .mean().reset_index())

    MAX_STEP = 5
    rows = []
    for _, r in btom_df.iterrows():
        for step, val in enumerate(r['posteriors'][:MAX_STEP + 1]):
            rows.append({'group': r['group'], 'participantId': r['participantId'],
                         'step': step, 'posterior': val})
    btom_step_long = pd.DataFrame(rows)
    btom_step_part = (btom_step_long
                      .groupby(['participantId', 'group', 'step'], observed=False)['posterior']
                      .mean().reset_index())

    btom_step_mean = (btom_step_part
                      .groupby(['participantId', 'group'], observed=False)['posterior']
                      .mean().reset_index())
    btom_traj_mean = (btom_part
                      .groupby(['participantId', 'group'], observed=False)['posterior']
                      .mean().reset_index())
    return btom_part, btom_step_part, btom_step_mean, btom_traj_mean


def main():
    sns.set_theme(style='whitegrid', context='talk')

    print('Building all-new-goal dataset ...')
    df_all   = build_dataset(None)
    print(f'  total player-trials = {len(df_all)}')
    print('Building equal_to_both dataset ...')
    df_equal = build_dataset('equal_to_both')
    print(f'  total player-trials = {len(df_equal)}')
    print(f'Q-cache size: {len(_q_cache)} unique goals')

    panels_all   = derive_panels(df_all)
    panels_equal = derive_panels(df_equal)

    titles = ('All new-goal trials', 'Equal-to-both only')

    # ---- Figure 1: posterior over % trajectory ----
    fig, axes = plt.subplots(1, 2, figsize=(16, 6), sharey=True)
    for ax, (btom_part, *_), title in zip(axes,
                                          (panels_all, panels_equal),
                                          titles):
        sns.lineplot(data=btom_part, x='time_pct', y='posterior',
                     hue='group', hue_order=GROUP_ORDER, palette=GROUP_PALETTE,
                     errorbar=('ci', 95), ax=ax, legend=(ax is axes[1]))
        ax.axhline(0.5, ls='--', color='grey', alpha=0.5)
        ax.set(xlabel='Trajectory progress after new goal (%)',
               ylabel='Posterior P(reached goal)' if ax is axes[0] else '',
               title=title, ylim=(0.4, 1.05))
    axes[1].legend(title='Partner type', bbox_to_anchor=(1.02, 1), loc='upper left')
    fig.suptitle('BToM legibility over trajectory', y=1.02)
    sns.despine(); plt.tight_layout()
    plt.savefig(OUT_DIR / 'btom_posterior_over_trajectory_sidebyside.png',
                dpi=140, bbox_inches='tight')
    plt.close()

    # ---- Figure 2: posterior over first 5 steps ----
    MAX_STEP = 5
    fig, axes = plt.subplots(1, 2, figsize=(16, 6), sharey=True)
    for ax, (_, btom_step_part, *__), title in zip(axes,
                                                   (panels_all, panels_equal),
                                                   titles):
        sns.lineplot(data=btom_step_part, x='step', y='posterior',
                     hue='group', hue_order=GROUP_ORDER, palette=GROUP_PALETTE,
                     errorbar=('ci', 95), marker='o', ax=ax,
                     legend=(ax is axes[1]))
        ax.axhline(0.5, ls='--', color='grey', alpha=0.5)
        ax.set(xlabel='Steps after new goal appears',
               ylabel='Posterior P(reached goal)' if ax is axes[0] else '',
               title=title, xlim=(-0.1, MAX_STEP + 0.1), ylim=(0.4, 1.05))
        ax.set_xticks(range(MAX_STEP + 1))
    axes[1].legend(title='Partner type', bbox_to_anchor=(1.02, 1), loc='upper left')
    fig.suptitle('BToM legibility over first 5 steps', y=1.02)
    sns.despine(); plt.tight_layout()
    plt.savefig(OUT_DIR / 'btom_posterior_first5_steps_sidebyside.png',
                dpi=140, bbox_inches='tight')
    plt.close()

    # ---- Figure 3: bar first 5 ----
    fig, axes = plt.subplots(1, 2, figsize=(14, 6), sharey=True)
    for ax, (_, _, btom_step_mean, _), title in zip(axes,
                                                    (panels_all, panels_equal),
                                                    titles):
        sns.barplot(data=btom_step_mean, x='group', y='posterior',
                    order=GROUP_ORDER, hue='group', palette=GROUP_PALETTE,
                    legend=False, errorbar=('ci', 95),
                    err_kws={'color': 'black', 'linewidth': 1.5}, capsize=0.1,
                    alpha=0.9, ax=ax)
        ax.axhline(0.5, ls='--', color='grey', alpha=0.5)
        ax.set(xlabel='Partner type',
               ylabel='Mean posterior P(reached goal)' if ax is axes[0] else '',
               title=title, ylim=(0.4, 1.0))
        for c in ax.containers:
            ax.bar_label(c, fmt='%.3f')
        for lbl in ax.get_xticklabels():
            lbl.set_rotation(20); lbl.set_ha('right')
    fig.suptitle('BToM legibility — first 5 steps', y=1.02)
    sns.despine(); plt.tight_layout()
    plt.savefig(OUT_DIR / 'btom_bar_first5_steps_sidebyside.png',
                dpi=140, bbox_inches='tight')
    plt.close()

    # ---- Figure 4: bar full sub-trajectory ----
    fig, axes = plt.subplots(1, 2, figsize=(14, 6), sharey=True)
    for ax, (_, _, _, btom_traj_mean), title in zip(axes,
                                                    (panels_all, panels_equal),
                                                    titles):
        sns.barplot(data=btom_traj_mean, x='group', y='posterior',
                    order=GROUP_ORDER, hue='group', palette=GROUP_PALETTE,
                    legend=False, errorbar=('ci', 95),
                    err_kws={'color': 'black', 'linewidth': 1.5}, capsize=0.1,
                    alpha=0.9, ax=ax)
        ax.axhline(0.5, ls='--', color='grey', alpha=0.5)
        ax.set(xlabel='Partner type',
               ylabel='Mean posterior P(reached goal)' if ax is axes[0] else '',
               title=title, ylim=(0.4, 1.0))
        for c in ax.containers:
            ax.bar_label(c, fmt='%.3f')
        for lbl in ax.get_xticklabels():
            lbl.set_rotation(20); lbl.set_ha('right')
    fig.suptitle('BToM legibility — full sub-trajectory', y=1.02)
    sns.despine(); plt.tight_layout()
    plt.savefig(OUT_DIR / 'btom_bar_full_trajectory_sidebyside.png',
                dpi=140, bbox_inches='tight')
    plt.close()

    # ---- Summary tables ----
    sumtab = []
    for cond_label, panels in [('all_new_goal', panels_all),
                               ('equal_to_both', panels_equal)]:
        _, _, step_mean, traj_mean = panels
        s5 = (step_mean.groupby('group', observed=False)['posterior']
              .agg(['mean', 'std', 'count']).reset_index())
        s5.insert(0, 'condition', cond_label)
        s5.insert(2, 'measure', 'first5')
        sf = (traj_mean.groupby('group', observed=False)['posterior']
              .agg(['mean', 'std', 'count']).reset_index())
        sf.insert(0, 'condition', cond_label)
        sf.insert(2, 'measure', 'full_traj')
        sumtab.append(s5); sumtab.append(sf)
    summary = pd.concat(sumtab, ignore_index=True)
    print('\nSummary:')
    print(summary.to_string(index=False))
    summary.to_csv(OUT_DIR / 'btom_summary_sidebyside.csv', index=False)
    print(f'\nWrote outputs to {OUT_DIR}')


if __name__ == '__main__':
    main()
