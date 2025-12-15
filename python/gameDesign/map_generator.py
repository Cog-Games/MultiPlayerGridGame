#!/usr/bin/env python3
"""
Map generator for the grid game.

Generates JSON maps compatible with the app:
 - Keys: string identifiers
 - Values: arrays of a single design dict
 - Includes optional obstacles (list of [row, col])

Examples:
  python3 python/gameDesign/map_generator.py --experiment 2P2G --count 20 --size 15
  python3 python/gameDesign/map_generator.py --experiment 1P1G --count 10 --size 15 --density 0.06
"""
import argparse
import json
import os
import random
from typing import Dict, List, Tuple


def generate_obstacles(size: int, exclude: List[Tuple[int, int]], density: float = 0.05, rng: random.Random = None) -> List[List[int]]:
    """Generate obstacle coordinates, avoiding excluded cells (players/goals).

    density: approximate fraction of cells to be obstacles.
    """
    rng = rng or random
    n_cells = size * size
    n_obs = int(n_cells * max(0.0, min(0.5, density)))
    excluded = {tuple(p) for p in exclude}
    obstacles = set()
    attempts = 0
    max_attempts = n_obs * 10 + 100
    while len(obstacles) < n_obs and attempts < max_attempts:
        r = rng.randrange(size)
        c = rng.randrange(size)
        if (r, c) in excluded:
            attempts += 1
            continue
        obstacles.add((r, c))
        attempts += 1
    return [[r, c] for (r, c) in sorted(obstacles)]


def gen_1p1g(size: int, count: int, density: float, rng: random.Random) -> Dict[str, List[dict]]:
    maps = {}
    center = size // 2
    for i in range(count):
        start = [center, rng.randrange(max(0, center - 3), min(size, center + 4))]
        goal = [rng.randrange(0, size // 3), rng.randrange(center - 2, min(size, center + 3))]
        obstacles = generate_obstacles(size, exclude=[tuple(start), tuple(goal)], density=density, rng=rng)
        maps[str(i)] = [{
            "initPlayerGrid": start,
            "target1": goal,
            "obstacles": obstacles,
            "mapType": "1P1G",
        }]
    return maps


def gen_1p2g(size: int, count: int, density: float, rng: random.Random) -> Dict[str, List[dict]]:
    maps = {}
    center = size // 2
    for i in range(count):
        start = [center, center]
        g1 = [rng.randrange(1, size // 2), center]
        g2 = [rng.randrange(size // 2, size - 1), center]
        obstacles = generate_obstacles(size, exclude=[tuple(start), tuple(g1), tuple(g2)], density=density, rng=rng)
        maps[str(i)] = [{
            "initPlayerGrid": start,
            "target1": g1,
            "target2": g2,
            "obstacles": obstacles,
            "mapType": "1P2G",
        }]
    return maps


def gen_2p2g(size: int, count: int, density: float, rng: random.Random) -> Dict[str, List[dict]]:
    maps = {}
    center = size // 2
    for i in range(count):
        p1 = [center, max(0, center - 3)]
        p2 = [center, min(size - 1, center + 3)]
        # Two small solo goals placed above/below centre plus an optional big joint goal
        g1 = [rng.randrange(1, max(2, center - 2)), center]
        g2 = [rng.randrange(min(size - 2, center + 1), size - 1), center]
        # Place a big joint goal somewhere on the right side corridor
        big = [center, min(size - 2, center + 4)]

        obstacles = generate_obstacles(
            size,
            exclude=[tuple(p1), tuple(p2), tuple(g1), tuple(g2), tuple(big)],
            density=density,
            rng=rng,
        )

        maps[str(i)] = [{
            "initPlayerGrid": p1,
            "initAIGrid": p2,
            # Legacy targets preserved for backwards compatibility (treated as small goals)
            "target1": g1,
            "target2": g2,
            # New dual-goal encoding used by the JS client:
            "smallGoals": [g1, g2],
            "bigGoals": [big],
            "obstacles": obstacles,
            "mapType": "2P2G",
        }]
    return maps


def gen_2p3g(size: int, count: int, density: float, rng: random.Random) -> Dict[str, List[dict]]:
    # Same structure as 2P2G; the app will add the third goal dynamically
    return gen_2p2g(size, count, density, rng)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--experiment', choices=['1P1G', '1P2G', '2P2G', '2P3G'], required=True)
    parser.add_argument('--count', type=int, default=20)
    parser.add_argument('--size', type=int, default=15)
    parser.add_argument('--density', type=float, default=0.05, help='Obstacle density (0-0.5)')
    parser.add_argument('--seed', type=int, default=None)
    parser.add_argument('--out-dir', default=os.path.join('python', 'gameDesign', 'output'))
    args = parser.parse_args()

    rng = random.Random(args.seed)

    if args.experiment == '1P1G':
        maps = gen_1p1g(args.size, args.count, args.density, rng)
    elif args.experiment == '1P2G':
        maps = gen_1p2g(args.size, args.count, args.density, rng)
    elif args.experiment == '2P2G':
        maps = gen_2p2g(args.size, args.count, args.density, rng)
    else:
        maps = gen_2p3g(args.size, args.count, args.density, rng)

    os.makedirs(args.out_dir, exist_ok=True)
    out_path = os.path.join(args.out_dir, f"{args.experiment}.json")
    with open(out_path, 'w') as f:
        json.dump(maps, f, indent=2)

    print(f"Wrote {len(maps)} maps to {out_path}")


if __name__ == '__main__':
    main()

