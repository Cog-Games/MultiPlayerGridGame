var MapsForStagHunt = {
    "1": [
        {
            "map_id": 1,
            "grid_size": 9,
            "coordinate_system": "0-indexed (row, col)",
            "ascii": [
                "####O....",
                "####.###.",
                "####.###.",
                "####.###.",
                "........S",
                "####r.###",
                "#####.###",
                "##r##.###",
                "R........"
            ],
            "orange": [0, 4],
            "red": [8, 0],
            "stag": [4, 8],
            "rabbits": [[5, 4], [7, 2]],
            "obstacles": [[0, 0], [0, 1], [0, 2], [0, 3], [1, 0], [1, 1], [1, 2], [1, 3], [1, 5], [1, 6], [1, 7], [2, 0], [2, 1], [2, 2], [2, 3], [2, 5], [2, 6], [2, 7], [3, 0], [3, 1], [3, 2], [3, 3], [3, 5], [3, 6], [3, 7], [5, 0], [5, 1], [5, 2], [5, 3], [5, 6], [5, 7], [5, 8], [6, 0], [6, 1], [6, 2], [6, 3], [6, 4], [6, 6], [6, 7], [6, 8], [7, 0], [7, 1], [7, 3], [7, 4], [7, 6], [7, 7], [7, 8]],
            "signaling": {
                "path_type": "equal-optimal",
                "indicate_action": "right",
                "indicate_step_count": 1,
                "indicate_position": [0, 5]
            },
            "distance_summary": {
                "orange_to_hare": 5,
                "red_to_hare": 3,
                "orange_to_stag": 8,
                "red_to_stag": 12
            },
            "utility_summary": {
                "step_cost_per_move": -1,
                "hare_reward_each": 5,
                "hare_reward_total": 10,
                "stag_reward_each": 10,
                "stag_reward_total": 20,
                "hare_distance_cost_total": -8,
                "stag_distance_cost_total": -20,
                "hare_final_utility": 2,
                "stag_final_utility": 0
            }
        }
    ],
    "2": [
        {
            "map_id": 2,
            "grid_size": 9,
            "coordinate_system": "0-indexed (row, col)",
            "ascii": [
                "####O....",
                "####.###.",
                "####.###.",
                "####.#r#.",
                "........S",
                "#####.###",
                "#####.###",
                "####r.###",
                "R........"
            ],
            "orange": [0, 4],
            "red": [8, 0],
            "stag": [4, 8],
            "rabbits": [[3, 6], [7, 4]],
            "obstacles": [[0, 0], [0, 1], [0, 2], [0, 3], [1, 0], [1, 1], [1, 2], [1, 3], [1, 5], [1, 6], [1, 7], [2, 0], [2, 1], [2, 2], [2, 3], [2, 5], [2, 6], [2, 7], [3, 0], [3, 1], [3, 2], [3, 3], [3, 5], [3, 7], [5, 0], [5, 1], [5, 2], [5, 3], [5, 4], [5, 6], [5, 7], [5, 8], [6, 0], [6, 1], [6, 2], [6, 3], [6, 4], [6, 6], [6, 7], [6, 8], [7, 0], [7, 1], [7, 2], [7, 3], [7, 6], [7, 7], [7, 8]],
            "signaling": {
                "path_type": "equal-optimal",
                "indicate_action": "right",
                "indicate_step_count": 1,
                "indicate_position": [0, 5]
            },
            "distance_summary": {
                "orange_to_hare": 7,
                "red_to_hare": 5,
                "orange_to_stag": 8,
                "red_to_stag": 12
            },
            "utility_summary": {
                "step_cost_per_move": -1,
                "hare_reward_each": 5,
                "hare_reward_total": 10,
                "stag_reward_each": 10,
                "stag_reward_total": 20,
                "hare_distance_cost_total": -12,
                "stag_distance_cost_total": -20,
                "hare_final_utility": -2,
                "stag_final_utility": 0
            }
        }
    ],
    "3": [
        {
            "map_id": 3,
            "grid_size": 9,
            "coordinate_system": "0-indexed (row, col)",
            "ascii": [
                "####O....",
                "####.###.",
                "###r.###.",
                "####.###.",
                "........S",
                "#####.###",
                "#####.###",
                "###r#.###",
                "R........"
            ],
            "orange": [0, 4],
            "red": [8, 0],
            "stag": [4, 8],
            "rabbits": [[2, 3], [7, 3]],
            "obstacles": [[0, 0], [0, 1], [0, 2], [0, 3], [1, 0], [1, 1], [1, 2], [1, 3], [1, 5], [1, 6], [1, 7], [2, 0], [2, 1], [2, 2], [2, 5], [2, 6], [2, 7], [3, 0], [3, 1], [3, 2], [3, 3], [3, 5], [3, 6], [3, 7], [5, 0], [5, 1], [5, 2], [5, 3], [5, 4], [5, 6], [5, 7], [5, 8], [6, 0], [6, 1], [6, 2], [6, 3], [6, 4], [6, 6], [6, 7], [6, 8], [7, 0], [7, 1], [7, 2], [7, 4], [7, 6], [7, 7], [7, 8]],
            "signaling": {
                "path_type": "equal-optimal",
                "indicate_action": "right",
                "indicate_step_count": 1,
                "indicate_position": [0, 5]
            },
            "distance_summary": {
                "orange_to_hare": 3,
                "red_to_hare": 3,
                "orange_to_stag": 8,
                "red_to_stag": 12
            },
            "utility_summary": {
                "step_cost_per_move": -1,
                "hare_reward_each": 5,
                "hare_reward_total": 10,
                "stag_reward_each": 10,
                "stag_reward_total": 20,
                "hare_distance_cost_total": -6,
                "stag_distance_cost_total": -20,
                "hare_final_utility": 4,
                "stag_final_utility": 0
            }
        }
    ],
    "4": [
        {
            "map_id": 4,
            "grid_size": 9,
            "coordinate_system": "0-indexed (row, col)",
            "ascii": [
                "####O....",
                "####.###.",
                "####.###.",
                "####.#r#.",
                "........S",
                "####.####",
                "####.####",
                "####.r###",
                "R........"
            ],
            "orange": [0, 4],
            "red": [8, 0],
            "stag": [4, 8],
            "rabbits": [[3, 6], [7, 5]],
            "obstacles": [[0, 0], [0, 1], [0, 2], [0, 3], [1, 0], [1, 1], [1, 2], [1, 3], [1, 5], [1, 6], [1, 7], [2, 0], [2, 1], [2, 2], [2, 3], [2, 5], [2, 6], [2, 7], [3, 0], [3, 1], [3, 2], [3, 3], [3, 5], [3, 7], [5, 0], [5, 1], [5, 2], [5, 3], [5, 5], [5, 6], [5, 7], [5, 8], [6, 0], [6, 1], [6, 2], [6, 3], [6, 5], [6, 6], [6, 7], [6, 8], [7, 0], [7, 1], [7, 2], [7, 3], [7, 6], [7, 7], [7, 8]],
            "signaling": {
                "path_type": "equal-optimal",
                "indicate_action": "right",
                "indicate_step_count": 1,
                "indicate_position": [0, 5]
            },
            "distance_summary": {
                "orange_to_hare": 7,
                "red_to_hare": 7,
                "orange_to_stag": 8,
                "red_to_stag": 12
            },
            "utility_summary": {
                "step_cost_per_move": -1,
                "hare_reward_each": 5,
                "hare_reward_total": 10,
                "stag_reward_each": 10,
                "stag_reward_total": 20,
                "hare_distance_cost_total": -14,
                "stag_distance_cost_total": -20,
                "hare_final_utility": -4,
                "stag_final_utility": 0
            }
        }
    ],
    "5": [
        {
            "map_id": 5,
            "grid_size": 9,
            "coordinate_system": "0-indexed (row, col)",
            "ascii": [
                "####O....",
                "####.###.",
                "####.###.",
                "####.#r#.",
                "........S",
                "#####.###",
                "#####.###",
                "#####.##r",
                "R........"
            ],
            "orange": [0, 4],
            "red": [8, 0],
            "stag": [4, 8],
            "rabbits": [[3, 6], [7, 8]],
            "obstacles": [[0, 0], [0, 1], [0, 2], [0, 3], [1, 0], [1, 1], [1, 2], [1, 3], [1, 5], [1, 6], [1, 7], [2, 0], [2, 1], [2, 2], [2, 3], [2, 5], [2, 6], [2, 7], [3, 0], [3, 1], [3, 2], [3, 3], [3, 5], [3, 7], [5, 0], [5, 1], [5, 2], [5, 3], [5, 4], [5, 6], [5, 7], [5, 8], [6, 0], [6, 1], [6, 2], [6, 3], [6, 4], [6, 6], [6, 7], [6, 8], [7, 0], [7, 1], [7, 2], [7, 3], [7, 4], [7, 6], [7, 7]],
            "signaling": {
                "path_type": "equal-optimal",
                "indicate_action": "right",
                "indicate_step_count": 1,
                "indicate_position": [0, 5]
            },
            "distance_summary": {
                "orange_to_hare": 7,
                "red_to_hare": 9,
                "orange_to_stag": 8,
                "red_to_stag": 12
            },
            "utility_summary": {
                "step_cost_per_move": -1,
                "hare_reward_each": 5,
                "hare_reward_total": 10,
                "stag_reward_each": 10,
                "stag_reward_total": 20,
                "hare_distance_cost_total": -16,
                "stag_distance_cost_total": -20,
                "hare_final_utility": -6,
                "stag_final_utility": 0
            }
        }
    ],
    "6": [
        {
            "map_id": 6,
            "grid_size": 9,
            "coordinate_system": "0-indexed (row, col)",
            "ascii": [
                "####O....",
                "###r.###.",
                "####.###.",
                "####.###.",
                "........S",
                "#####.###",
                "#####.###",
                "#r###.###",
                "R........"
            ],
            "orange": [0, 4],
            "red": [8, 0],
            "stag": [4, 8],
            "rabbits": [[1, 3], [7, 1]],
            "obstacles": [[0, 0], [0, 1], [0, 2], [0, 3], [1, 0], [1, 1], [1, 2], [1, 5], [1, 6], [1, 7], [2, 0], [2, 1], [2, 2], [2, 3], [2, 5], [2, 6], [2, 7], [3, 0], [3, 1], [3, 2], [3, 3], [3, 5], [3, 6], [3, 7], [5, 0], [5, 1], [5, 2], [5, 3], [5, 4], [5, 6], [5, 7], [5, 8], [6, 0], [6, 1], [6, 2], [6, 3], [6, 4], [6, 6], [6, 7], [6, 8], [7, 0], [7, 2], [7, 3], [7, 4], [7, 6], [7, 7], [7, 8]],
            "signaling": {
                "path_type": "equal-optimal",
                "indicate_action": "right",
                "indicate_step_count": 1,
                "indicate_position": [0, 5]
            },
            "distance_summary": {
                "orange_to_hare": 2,
                "red_to_hare": 2,
                "orange_to_stag": 8,
                "red_to_stag": 12
            },
            "utility_summary": {
                "step_cost_per_move": -1,
                "hare_reward_each": 5,
                "hare_reward_total": 10,
                "stag_reward_each": 10,
                "stag_reward_total": 20,
                "hare_distance_cost_total": -4,
                "stag_distance_cost_total": -20,
                "hare_final_utility": 6,
                "stag_final_utility": 0
            }
        }
    ],
    "7": [
        {
            "map_id": 7,
            "grid_size": 9,
            "coordinate_system": "0-indexed (row, col)",
            "ascii": [
                "####O....",
                "####.###.",
                "####.###.",
                "####.#r#.",
                "........S",
                "#####.###",
                "#####.###",
                "##r##.###",
                "R........"
            ],
            "orange": [0, 4],
            "red": [8, 0],
            "stag": [4, 8],
            "rabbits": [[3, 6], [7, 2]],
            "obstacles": [[0, 0], [0, 1], [0, 2], [0, 3], [1, 0], [1, 1], [1, 2], [1, 3], [1, 5], [1, 6], [1, 7], [2, 0], [2, 1], [2, 2], [2, 3], [2, 5], [2, 6], [2, 7], [3, 0], [3, 1], [3, 2], [3, 3], [3, 5], [3, 7], [5, 0], [5, 1], [5, 2], [5, 3], [5, 4], [5, 6], [5, 7], [5, 8], [6, 0], [6, 1], [6, 2], [6, 3], [6, 4], [6, 6], [6, 7], [6, 8], [7, 0], [7, 1], [7, 3], [7, 4], [7, 6], [7, 7], [7, 8]],
            "signaling": {
                "path_type": "equal-optimal",
                "indicate_action": "right",
                "indicate_step_count": 1,
                "indicate_position": [0, 5]
            },
            "distance_summary": {
                "orange_to_hare": 7,
                "red_to_hare": 3,
                "orange_to_stag": 8,
                "red_to_stag": 12
            },
            "utility_summary": {
                "step_cost_per_move": -1,
                "hare_reward_each": 5,
                "hare_reward_total": 10,
                "stag_reward_each": 10,
                "stag_reward_total": 20,
                "hare_distance_cost_total": -10,
                "stag_distance_cost_total": -20,
                "hare_final_utility": 0,
                "stag_final_utility": 0
            }
        }
    ],
    "8": [
        {
            "map_id": 8,
            "grid_size": 9,
            "coordinate_system": "0-indexed (row, col)",
            "ascii": [
                "####O....",
                "####.###.",
                "####.r##.",
                "####.###.",
                "........S",
                "#####.###",
                "#####.###",
                "#####.r##",
                "R........"
            ],
            "orange": [0, 4],
            "red": [8, 0],
            "stag": [4, 8],
            "rabbits": [[2, 5], [7, 6]],
            "obstacles": [[0, 0], [0, 1], [0, 2], [0, 3], [1, 0], [1, 1], [1, 2], [1, 3], [1, 5], [1, 6], [1, 7], [2, 0], [2, 1], [2, 2], [2, 3], [2, 6], [2, 7], [3, 0], [3, 1], [3, 2], [3, 3], [3, 5], [3, 6], [3, 7], [5, 0], [5, 1], [5, 2], [5, 3], [5, 4], [5, 6], [5, 7], [5, 8], [6, 0], [6, 1], [6, 2], [6, 3], [6, 4], [6, 6], [6, 7], [6, 8], [7, 0], [7, 1], [7, 2], [7, 3], [7, 4], [7, 7], [7, 8]],
            "signaling": {
                "path_type": "equal-optimal",
                "indicate_action": "right",
                "indicate_step_count": 1,
                "indicate_position": [0, 5]
            },
            "distance_summary": {
                "orange_to_hare": 3,
                "red_to_hare": 7,
                "orange_to_stag": 8,
                "red_to_stag": 12
            },
            "utility_summary": {
                "step_cost_per_move": -1,
                "hare_reward_each": 5,
                "hare_reward_total": 10,
                "stag_reward_each": 10,
                "stag_reward_total": 20,
                "hare_distance_cost_total": -10,
                "stag_distance_cost_total": -20,
                "hare_final_utility": 0,
                "stag_final_utility": 0
            }
        }
    ],
    "9": [
        {
            "map_id": 9,
            "grid_size": 9,
            "coordinate_system": "0-indexed (row, col)",
            "ascii": [
                "####O....",
                "####.###.",
                "####.###.",
                "####.###.",
                "........S",
                "####r.###",
                "#####.###",
                "####r.###",
                "R........"
            ],
            "orange": [0, 4],
            "red": [8, 0],
            "stag": [4, 8],
            "rabbits": [[5, 4], [7, 4]],
            "obstacles": [[0, 0], [0, 1], [0, 2], [0, 3], [1, 0], [1, 1], [1, 2], [1, 3], [1, 5], [1, 6], [1, 7], [2, 0], [2, 1], [2, 2], [2, 3], [2, 5], [2, 6], [2, 7], [3, 0], [3, 1], [3, 2], [3, 3], [3, 5], [3, 6], [3, 7], [5, 0], [5, 1], [5, 2], [5, 3], [5, 6], [5, 7], [5, 8], [6, 0], [6, 1], [6, 2], [6, 3], [6, 4], [6, 6], [6, 7], [6, 8], [7, 0], [7, 1], [7, 2], [7, 3], [7, 6], [7, 7], [7, 8]],
            "signaling": {
                "path_type": "equal-optimal",
                "indicate_action": "right",
                "indicate_step_count": 1,
                "indicate_position": [0, 5]
            },
            "distance_summary": {
                "orange_to_hare": 5,
                "red_to_hare": 5,
                "orange_to_stag": 8,
                "red_to_stag": 12
            },
            "utility_summary": {
                "step_cost_per_move": -1,
                "hare_reward_each": 5,
                "hare_reward_total": 10,
                "stag_reward_each": 10,
                "stag_reward_total": 20,
                "hare_distance_cost_total": -10,
                "stag_distance_cost_total": -20,
                "hare_final_utility": 0,
                "stag_final_utility": 0
            }
        }
    ],
    "10": [
        {
            "map_id": 10,
            "grid_size": 9,
            "coordinate_system": "0-indexed (row, col)",
            "ascii": [
                "####O....",
                "####.###.",
                "####.###.",
                "####.###.",
                ".........",
                "####r.#S#",
                "#####.###",
                "##r##.###",
                "R........"
            ],
            "orange": [0, 4],
            "red": [8, 0],
            "stag": [5, 7],
            "rabbits": [[5, 4], [7, 2]],
            "obstacles": [[0, 0], [0, 1], [0, 2], [0, 3], [1, 0], [1, 1], [1, 2], [1, 3], [1, 5], [1, 6], [1, 7], [2, 0], [2, 1], [2, 2], [2, 3], [2, 5], [2, 6], [2, 7], [3, 0], [3, 1], [3, 2], [3, 3], [3, 5], [3, 6], [3, 7], [5, 0], [5, 1], [5, 2], [5, 3], [5, 6], [5, 8], [6, 0], [6, 1], [6, 2], [6, 3], [6, 4], [6, 6], [6, 7], [6, 8], [7, 0], [7, 1], [7, 3], [7, 4], [7, 6], [7, 7], [7, 8]],
            "signaling": {
                "path_type": "costly-suboptimal",
                "indicate_action": "right",
                "indicate_step_count": 1,
                "indicate_position": [0, 5]
            },
            "distance_summary": {
                "orange_to_hare": 5,
                "red_to_hare": 3,
                "orange_to_stag": 8,
                "red_to_stag": 12
            },
            "utility_summary": {
                "step_cost_per_move": -1,
                "hare_reward_each": 5,
                "hare_reward_total": 10,
                "stag_reward_each": 10,
                "stag_reward_total": 20,
                "hare_distance_cost_total": -8,
                "stag_distance_cost_total": -20,
                "hare_final_utility": 2,
                "stag_final_utility": 0
            }
        }
    ],
    "11": [
        {
            "map_id": 11,
            "grid_size": 9,
            "coordinate_system": "0-indexed (row, col)",
            "ascii": [
                "####O....",
                "####.###.",
                "####.###.",
                "####.#r#.",
                ".........",
                "#####.#S#",
                "#####.###",
                "####r.###",
                "R........"
            ],
            "orange": [0, 4],
            "red": [8, 0],
            "stag": [5, 7],
            "rabbits": [[3, 6], [7, 4]],
            "obstacles": [[0, 0], [0, 1], [0, 2], [0, 3], [1, 0], [1, 1], [1, 2], [1, 3], [1, 5], [1, 6], [1, 7], [2, 0], [2, 1], [2, 2], [2, 3], [2, 5], [2, 6], [2, 7], [3, 0], [3, 1], [3, 2], [3, 3], [3, 5], [3, 7], [5, 0], [5, 1], [5, 2], [5, 3], [5, 4], [5, 6], [5, 8], [6, 0], [6, 1], [6, 2], [6, 3], [6, 4], [6, 6], [6, 7], [6, 8], [7, 0], [7, 1], [7, 2], [7, 3], [7, 6], [7, 7], [7, 8]],
            "signaling": {
                "path_type": "costly-suboptimal",
                "indicate_action": "right",
                "indicate_step_count": 1,
                "indicate_position": [0, 5]
            },
            "distance_summary": {
                "orange_to_hare": 7,
                "red_to_hare": 5,
                "orange_to_stag": 8,
                "red_to_stag": 12
            },
            "utility_summary": {
                "step_cost_per_move": -1,
                "hare_reward_each": 5,
                "hare_reward_total": 10,
                "stag_reward_each": 10,
                "stag_reward_total": 20,
                "hare_distance_cost_total": -12,
                "stag_distance_cost_total": -20,
                "hare_final_utility": -2,
                "stag_final_utility": 0
            }
        }
    ],
    "12": [
        {
            "map_id": 12,
            "grid_size": 9,
            "coordinate_system": "0-indexed (row, col)",
            "ascii": [
                "####O....",
                "####.###.",
                "###r.###.",
                "####.###.",
                ".........",
                "#####.#S#",
                "#####.###",
                "###r#.###",
                "R........"
            ],
            "orange": [0, 4],
            "red": [8, 0],
            "stag": [5, 7],
            "rabbits": [[2, 3], [7, 3]],
            "obstacles": [[0, 0], [0, 1], [0, 2], [0, 3], [1, 0], [1, 1], [1, 2], [1, 3], [1, 5], [1, 6], [1, 7], [2, 0], [2, 1], [2, 2], [2, 5], [2, 6], [2, 7], [3, 0], [3, 1], [3, 2], [3, 3], [3, 5], [3, 6], [3, 7], [5, 0], [5, 1], [5, 2], [5, 3], [5, 4], [5, 6], [5, 8], [6, 0], [6, 1], [6, 2], [6, 3], [6, 4], [6, 6], [6, 7], [6, 8], [7, 0], [7, 1], [7, 2], [7, 4], [7, 6], [7, 7], [7, 8]],
            "signaling": {
                "path_type": "costly-suboptimal",
                "indicate_action": "right",
                "indicate_step_count": 1,
                "indicate_position": [0, 5]
            },
            "distance_summary": {
                "orange_to_hare": 3,
                "red_to_hare": 3,
                "orange_to_stag": 8,
                "red_to_stag": 12
            },
            "utility_summary": {
                "step_cost_per_move": -1,
                "hare_reward_each": 5,
                "hare_reward_total": 10,
                "stag_reward_each": 10,
                "stag_reward_total": 20,
                "hare_distance_cost_total": -6,
                "stag_distance_cost_total": -20,
                "hare_final_utility": 4,
                "stag_final_utility": 0
            }
        }
    ],
    "13": [
        {
            "map_id": 13,
            "grid_size": 9,
            "coordinate_system": "0-indexed (row, col)",
            "ascii": [
                "####O....",
                "####.###.",
                "####.###.",
                "####.#r#.",
                ".........",
                "####.##S#",
                "####.####",
                "####.r###",
                "R........"
            ],
            "orange": [0, 4],
            "red": [8, 0],
            "stag": [5, 7],
            "rabbits": [[3, 6], [7, 5]],
            "obstacles": [[0, 0], [0, 1], [0, 2], [0, 3], [1, 0], [1, 1], [1, 2], [1, 3], [1, 5], [1, 6], [1, 7], [2, 0], [2, 1], [2, 2], [2, 3], [2, 5], [2, 6], [2, 7], [3, 0], [3, 1], [3, 2], [3, 3], [3, 5], [3, 7], [5, 0], [5, 1], [5, 2], [5, 3], [5, 5], [5, 6], [5, 8], [6, 0], [6, 1], [6, 2], [6, 3], [6, 5], [6, 6], [6, 7], [6, 8], [7, 0], [7, 1], [7, 2], [7, 3], [7, 6], [7, 7], [7, 8]],
            "signaling": {
                "path_type": "costly-suboptimal",
                "indicate_action": "right",
                "indicate_step_count": 1,
                "indicate_position": [0, 5]
            },
            "distance_summary": {
                "orange_to_hare": 7,
                "red_to_hare": 7,
                "orange_to_stag": 8,
                "red_to_stag": 12
            },
            "utility_summary": {
                "step_cost_per_move": -1,
                "hare_reward_each": 5,
                "hare_reward_total": 10,
                "stag_reward_each": 10,
                "stag_reward_total": 20,
                "hare_distance_cost_total": -14,
                "stag_distance_cost_total": -20,
                "hare_final_utility": -4,
                "stag_final_utility": 0
            }
        }
    ],
    "14": [
        {
            "map_id": 14,
            "grid_size": 9,
            "coordinate_system": "0-indexed (row, col)",
            "ascii": [
                "####O....",
                "####.###.",
                "####.###.",
                "####.#r#.",
                ".........",
                "#####.#S#",
                "#####.###",
                "#####.##r",
                "R........"
            ],
            "orange": [0, 4],
            "red": [8, 0],
            "stag": [5, 7],
            "rabbits": [[3, 6], [7, 8]],
            "obstacles": [[0, 0], [0, 1], [0, 2], [0, 3], [1, 0], [1, 1], [1, 2], [1, 3], [1, 5], [1, 6], [1, 7], [2, 0], [2, 1], [2, 2], [2, 3], [2, 5], [2, 6], [2, 7], [3, 0], [3, 1], [3, 2], [3, 3], [3, 5], [3, 7], [5, 0], [5, 1], [5, 2], [5, 3], [5, 4], [5, 6], [5, 8], [6, 0], [6, 1], [6, 2], [6, 3], [6, 4], [6, 6], [6, 7], [6, 8], [7, 0], [7, 1], [7, 2], [7, 3], [7, 4], [7, 6], [7, 7]],
            "signaling": {
                "path_type": "costly-suboptimal",
                "indicate_action": "right",
                "indicate_step_count": 1,
                "indicate_position": [0, 5]
            },
            "distance_summary": {
                "orange_to_hare": 7,
                "red_to_hare": 9,
                "orange_to_stag": 8,
                "red_to_stag": 12
            },
            "utility_summary": {
                "step_cost_per_move": -1,
                "hare_reward_each": 5,
                "hare_reward_total": 10,
                "stag_reward_each": 10,
                "stag_reward_total": 20,
                "hare_distance_cost_total": -16,
                "stag_distance_cost_total": -20,
                "hare_final_utility": -6,
                "stag_final_utility": 0
            }
        }
    ],
    "15": [
        {
            "map_id": 15,
            "grid_size": 9,
            "coordinate_system": "0-indexed (row, col)",
            "ascii": [
                "####O....",
                "###r.###.",
                "####.###.",
                "####.###.",
                ".........",
                "#####.#S#",
                "#####.###",
                "#r###.###",
                "R........"
            ],
            "orange": [0, 4],
            "red": [8, 0],
            "stag": [5, 7],
            "rabbits": [[1, 3], [7, 1]],
            "obstacles": [[0, 0], [0, 1], [0, 2], [0, 3], [1, 0], [1, 1], [1, 2], [1, 5], [1, 6], [1, 7], [2, 0], [2, 1], [2, 2], [2, 3], [2, 5], [2, 6], [2, 7], [3, 0], [3, 1], [3, 2], [3, 3], [3, 5], [3, 6], [3, 7], [5, 0], [5, 1], [5, 2], [5, 3], [5, 4], [5, 6], [5, 8], [6, 0], [6, 1], [6, 2], [6, 3], [6, 4], [6, 6], [6, 7], [6, 8], [7, 0], [7, 2], [7, 3], [7, 4], [7, 6], [7, 7], [7, 8]],
            "signaling": {
                "path_type": "costly-suboptimal",
                "indicate_action": "right",
                "indicate_step_count": 1,
                "indicate_position": [0, 5]
            },
            "distance_summary": {
                "orange_to_hare": 2,
                "red_to_hare": 2,
                "orange_to_stag": 8,
                "red_to_stag": 12
            },
            "utility_summary": {
                "step_cost_per_move": -1,
                "hare_reward_each": 5,
                "hare_reward_total": 10,
                "stag_reward_each": 10,
                "stag_reward_total": 20,
                "hare_distance_cost_total": -4,
                "stag_distance_cost_total": -20,
                "hare_final_utility": 6,
                "stag_final_utility": 0
            }
        }
    ],
    "16": [
        {
            "map_id": 16,
            "grid_size": 9,
            "coordinate_system": "0-indexed (row, col)",
            "ascii": [
                "####O....",
                "####.###.",
                "####.###.",
                "####.#r#.",
                ".........",
                "#####.#S#",
                "#####.###",
                "##r##.###",
                "R........"
            ],
            "orange": [0, 4],
            "red": [8, 0],
            "stag": [5, 7],
            "rabbits": [[3, 6], [7, 2]],
            "obstacles": [[0, 0], [0, 1], [0, 2], [0, 3], [1, 0], [1, 1], [1, 2], [1, 3], [1, 5], [1, 6], [1, 7], [2, 0], [2, 1], [2, 2], [2, 3], [2, 5], [2, 6], [2, 7], [3, 0], [3, 1], [3, 2], [3, 3], [3, 5], [3, 7], [5, 0], [5, 1], [5, 2], [5, 3], [5, 4], [5, 6], [5, 8], [6, 0], [6, 1], [6, 2], [6, 3], [6, 4], [6, 6], [6, 7], [6, 8], [7, 0], [7, 1], [7, 3], [7, 4], [7, 6], [7, 7], [7, 8]],
            "signaling": {
                "path_type": "costly-suboptimal",
                "indicate_action": "right",
                "indicate_step_count": 1,
                "indicate_position": [0, 5]
            },
            "distance_summary": {
                "orange_to_hare": 7,
                "red_to_hare": 3,
                "orange_to_stag": 8,
                "red_to_stag": 12
            },
            "utility_summary": {
                "step_cost_per_move": -1,
                "hare_reward_each": 5,
                "hare_reward_total": 10,
                "stag_reward_each": 10,
                "stag_reward_total": 20,
                "hare_distance_cost_total": -10,
                "stag_distance_cost_total": -20,
                "hare_final_utility": 0,
                "stag_final_utility": 0
            }
        }
    ],
    "17": [
        {
            "map_id": 17,
            "grid_size": 9,
            "coordinate_system": "0-indexed (row, col)",
            "ascii": [
                "####O....",
                "####.###.",
                "####.r##.",
                "####.###.",
                ".........",
                "#####.#S#",
                "#####.###",
                "#####.r##",
                "R........"
            ],
            "orange": [0, 4],
            "red": [8, 0],
            "stag": [5, 7],
            "rabbits": [[2, 5], [7, 6]],
            "obstacles": [[0, 0], [0, 1], [0, 2], [0, 3], [1, 0], [1, 1], [1, 2], [1, 3], [1, 5], [1, 6], [1, 7], [2, 0], [2, 1], [2, 2], [2, 3], [2, 6], [2, 7], [3, 0], [3, 1], [3, 2], [3, 3], [3, 5], [3, 6], [3, 7], [5, 0], [5, 1], [5, 2], [5, 3], [5, 4], [5, 6], [5, 8], [6, 0], [6, 1], [6, 2], [6, 3], [6, 4], [6, 6], [6, 7], [6, 8], [7, 0], [7, 1], [7, 2], [7, 3], [7, 4], [7, 7], [7, 8]],
            "signaling": {
                "path_type": "costly-suboptimal",
                "indicate_action": "right",
                "indicate_step_count": 1,
                "indicate_position": [0, 5]
            },
            "distance_summary": {
                "orange_to_hare": 3,
                "red_to_hare": 7,
                "orange_to_stag": 8,
                "red_to_stag": 12
            },
            "utility_summary": {
                "step_cost_per_move": -1,
                "hare_reward_each": 5,
                "hare_reward_total": 10,
                "stag_reward_each": 10,
                "stag_reward_total": 20,
                "hare_distance_cost_total": -10,
                "stag_distance_cost_total": -20,
                "hare_final_utility": 0,
                "stag_final_utility": 0
            }
        }
    ],
    "18": [
        {
            "map_id": 18,
            "grid_size": 9,
            "coordinate_system": "0-indexed (row, col)",
            "ascii": [
                "####O....",
                "####.###.",
                "####.###.",
                "####.###.",
                ".........",
                "####r.#S#",
                "#####.###",
                "####r.###",
                "R........"
            ],
            "orange": [0, 4],
            "red": [8, 0],
            "stag": [5, 7],
            "rabbits": [[5, 4], [7, 4]],
            "obstacles": [[0, 0], [0, 1], [0, 2], [0, 3], [1, 0], [1, 1], [1, 2], [1, 3], [1, 5], [1, 6], [1, 7], [2, 0], [2, 1], [2, 2], [2, 3], [2, 5], [2, 6], [2, 7], [3, 0], [3, 1], [3, 2], [3, 3], [3, 5], [3, 6], [3, 7], [5, 0], [5, 1], [5, 2], [5, 3], [5, 6], [5, 8], [6, 0], [6, 1], [6, 2], [6, 3], [6, 4], [6, 6], [6, 7], [6, 8], [7, 0], [7, 1], [7, 2], [7, 3], [7, 6], [7, 7], [7, 8]],
            "signaling": {
                "path_type": "costly-suboptimal",
                "indicate_action": "right",
                "indicate_step_count": 1,
                "indicate_position": [0, 5]
            },
            "distance_summary": {
                "orange_to_hare": 5,
                "red_to_hare": 5,
                "orange_to_stag": 8,
                "red_to_stag": 12
            },
            "utility_summary": {
                "step_cost_per_move": -1,
                "hare_reward_each": 5,
                "hare_reward_total": 10,
                "stag_reward_each": 10,
                "stag_reward_total": 20,
                "hare_distance_cost_total": -10,
                "stag_distance_cost_total": -20,
                "hare_final_utility": 0,
                "stag_final_utility": 0
            }
        }
    ]
};