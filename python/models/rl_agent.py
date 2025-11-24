#!/usr/bin/env python3
"""
Simple Python RL agent (value iteration) to test maps with obstacles.

CLI usage:
  python3 python/models/rl_agent.py --map-file python/gameDesign/output/2P2G.json --key 0 --agent ai --steps 50

Notes:
 - Supports 1P1G, 1P2G, 2P2G, 2P3G designs produced by map_generator.py
 - Obstacles are respected during transitions.
 - For 2P* maps, you can select which agent to simulate: `--agent ai` or `--agent human`.
"""
import argparse
import json
import random
from typing import Dict, List, Tuple


Action = Tuple[int, int]
Coord = Tuple[int, int]


def softmax(values: List[float], beta: float = 3.0) -> List[float]:
    if not values:
        return []
    max_val = max(values)
    import math
    exp_values = [math.exp(beta * (v - max_val)) for v in values]
    sum_exp = sum(exp_values) or 1.0
    return [ev / sum_exp for ev in exp_values]


class Grid:
    def __init__(self, n: int, obstacles: List[Coord]):
        self.n = n
        self.obstacles = set(obstacles)

    def valid(self, state: Coord) -> bool:
        row, col = state
        return 0 <= row < self.n and 0 <= col < self.n and (row, col) not in self.obstacles


def neighbors(state: Coord, actions: List[Action], grid: Grid) -> List[Coord]:
    """Deterministic transitions: invalid moves (walls/obstacles) keep you in place."""
    neighbors_list: List[Coord] = []
    for action in actions:
        next_row, next_col = state[0] + action[0], state[1] + action[1]
        next_state = (next_row, next_col)
        neighbors_list.append(next_state if grid.valid(next_state) else state)
    return neighbors_list


def value_iteration(
    states: List[Coord],
    goals: List[Coord],
    grid: Grid,
    actions: List[Action],
    gamma: float = 0.9,
    goal_reward: float = 30.0,
    step_cost: float = -1.0,
    bump_penalty: float = -1.5,
    noise: float = 0.0,
    iters: int = 250,
) -> Dict[Coord, float]:
    """Standard VI with obstacles considered via invalid transitions.

    - Terminal states: goals, with V=0.
    - Reward: goal_reward when entering goal; otherwise step_cost each move.
    - Invalid move (into obstacle/wall): remain in place and incur bump_penalty (<= step_cost).
    """
    value_fn: Dict[Coord, float] = {state: (0.0 if state in goals else 0.1) for state in states}
    goal_states = set(goals)
    for _ in range(iters):
        delta = 0.0
        prev_values = value_fn.copy()
        for state in states:
            if state in goal_states:
                value_fn[state] = 0.0
                continue
            q_values: List[float] = []
            for action_index, action in enumerate(actions):
                # Build transition distribution with optional noise over alternative actions
                transitions: List[Tuple[Coord, float, bool]] = []  # (next_state, probability, was_bump)
                # Intended move
                next_row, next_col = state[0] + action[0], state[1] + action[1]
                next_state = (next_row, next_col)
                next_valid = grid.valid(next_state)
                effective_next_state = next_state if next_valid else state
                main_prob = max(0.0, 1.0 - noise)
                transitions.append((effective_next_state, main_prob, not next_valid))

                # Distribute noise among the other actions (if any)
                if noise > 0.0:
                    alt_action_indexes = [j for j in range(len(actions)) if j != action_index]
                    noise_prob_each = noise / max(1, len(alt_action_indexes))
                    for alt_index in alt_action_indexes:
                        alt_action = actions[alt_index]
                        alt_next_row, alt_next_col = state[0] + alt_action[0], state[1] + alt_action[1]
                        alt_next_state = (alt_next_row, alt_next_col)
                        alt_next_valid = grid.valid(alt_next_state)
                        alt_effective_next_state = alt_next_state if alt_next_valid else state
                        transitions.append((alt_effective_next_state, noise_prob_each, not alt_next_valid))

                # Expected value for this action
                expected_q = 0.0
                for trans_next_state, trans_prob, trans_bumped in transitions:
                    if trans_next_state in goal_states:
                        reward = goal_reward
                    else:
                        reward = bump_penalty if trans_bumped else step_cost
                    expected_q += trans_prob * (reward + gamma * prev_values[trans_next_state])
                q_values.append(expected_q)

            value_fn[state] = max(q_values)
            delta = max(delta, abs(value_fn[state] - prev_values[state]))
        if delta < 1e-4:
            break
    return value_fn


def greedy_action(
    state: Coord,
    value_fn: Dict[Coord, float],
    grid: Grid,
    actions: List[Action],
    goals: List[Coord],
    beta: float = 3.0,
    goal_reward: float = 30.0,
    step_cost: float = -1.0,
    bump_penalty: float = -1.5,
    gamma: float = 0.9,
    noise: float = 0.0,
) -> Action:
    q_values: List[float] = []
    goal_states = set(goals)
    for action_index, action in enumerate(actions):
        # Expected value with the same noise model as VI
        transitions: List[Tuple[Coord, float, bool]] = []
        next_row, next_col = state[0] + action[0], state[1] + action[1]
        next_state = (next_row, next_col)
        next_valid = grid.valid(next_state)
        effective_next_state = next_state if next_valid else state
        main_prob = max(0.0, 1.0 - noise)
        transitions.append((effective_next_state, main_prob, not next_valid))

        if noise > 0.0:
            alt_action_indexes = [j for j in range(len(actions)) if j != action_index]
            noise_prob_each = noise / max(1, len(alt_action_indexes))
            for alt_index in alt_action_indexes:
                alt_action = actions[alt_index]
                alt_next_row, alt_next_col = state[0] + alt_action[0], state[1] + alt_action[1]
                alt_next_state = (alt_next_row, alt_next_col)
                alt_next_valid = grid.valid(alt_next_state)
                alt_effective_next_state = alt_next_state if alt_next_valid else state
                transitions.append((alt_effective_next_state, noise_prob_each, not alt_next_valid))

        expected_q = 0.0
        for trans_next_state, trans_prob, trans_bumped in transitions:
            if trans_next_state in goal_states:
                reward = goal_reward
            else:
                reward = bump_penalty if trans_bumped else step_cost
            expected_q += trans_prob * (reward + gamma * value_fn[trans_next_state])
        q_values.append(expected_q)
    probs = softmax(q_values, beta)
    # Sample from softmax distribution
    r = random.random()
    acc = 0.0
    for i, p in enumerate(probs):
        acc += p
        if r <= acc:
            return actions[i]
    return actions[-1]


def simulate(
    design: dict,
    agent: str,
    steps: int,
    size: int,
    gamma: float = 0.9,
    goal_reward: float = 30.0,
    step_cost: float = -1.0,
    bump_penalty: float = -1.5,
    noise: float = 0.0,
):
    # Extract positions
    player_start = tuple(design.get('initPlayerGrid', ()))
    ai_start = tuple(design.get('initAIGrid', ())) if 'initAIGrid' in design else None
    goal_list = [tuple(design['target1'])]
    if 'target2' in design:
        goal_list.append(tuple(design['target2']))

    obstacles = [tuple(o) for o in design.get('obstacles', [])]
    grid = Grid(size, obstacles)
    actions = [(0, -1), (0, 1), (-1, 0), (1, 0)]

    # Build state list (valid cells only)
    valid_states = [(r, c) for r in range(size) for c in range(size) if grid.valid((r, c))]
    value_fn = value_iteration(valid_states, goal_list, grid, actions, gamma=gamma, goal_reward=goal_reward, step_cost=step_cost, bump_penalty=bump_penalty, noise=noise)

    position = ai_start if agent == 'ai' and ai_start else player_start
    trajectory = [position]
    for _ in range(steps):
        action = greedy_action(position, value_fn, grid, actions, goal_list, goal_reward=goal_reward, step_cost=step_cost, bump_penalty=bump_penalty, gamma=gamma, noise=noise)
        next_row, next_col = position[0] + action[0], position[1] + action[1]
        next_pos = (next_row, next_col) if grid.valid((next_row, next_col)) else position
        trajectory.append(next_pos)
        position = next_pos
        if position in goal_list:
            break
    return trajectory


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--map-file', required=True)
    ap.add_argument('--key', type=str, default='0', help='Map key in the JSON (string or int)')
    ap.add_argument('--agent', choices=['human', 'ai'], default='ai')
    ap.add_argument('--steps', type=int, default=50)
    ap.add_argument('--size', type=int, default=15)
    ap.add_argument('--gamma', type=float, default=0.9)
    ap.add_argument('--goal-reward', type=float, default=30.0)
    ap.add_argument('--step-cost', type=float, default=-1.0)
    ap.add_argument('--bump-penalty', type=float, default=-1.5, help='Cost when attempting to move into an obstacle or wall')
    ap.add_argument('--noise', type=float, default=0.0, help='Action noise: probability mass spread uniformly over other actions')
    args = ap.parse_args()

    with open(args.map_file, 'r') as f:
        data = json.load(f)

    key = str(args.key)
    if key not in data:
        # allow numeric index for convenience
        if isinstance(args.key, int) and str(args.key) not in data:
            raise SystemExit(f"Key {args.key} not found in map file")
        if isinstance(args.key, int):
            key = str(args.key)
        else:
            raise SystemExit(f"Key {args.key} not found in map file")

    arr = data[key]
    if not isinstance(arr, list) or not arr:
        raise SystemExit("Invalid design array under the key")
    design = arr[0]

    trajectory = simulate(
        design,
        agent=args.agent,
        steps=args.steps,
        size=args.size,
        gamma=args.gamma,
        goal_reward=args.goal_reward,
        step_cost=args.step_cost,
        bump_penalty=args.bump_penalty,
        noise=args.noise,
    )
    print(json.dumps({
        'agent': args.agent,
        'steps': len(trajectory) - 1,
        'trajectory': trajectory,
        'reached_goal': (tuple(trajectory[-1]) in [tuple(design['target1'])] + ([tuple(design['target2'])] if 'target2' in design else []))
    }, indent=2))


if __name__ == '__main__':
    main()
