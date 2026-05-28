# Kids Two-Player Bug Fixes

## 1. Map Changed at the Start of a 2P Trial

Bug: The map could suddenly change at the beginning of a two-player trial.

Cause: A stale network state update from a previous 2P trial could arrive after the next trial had already started.

Fix: Added trial identity checks using `experimentIndex`, `trialIndex`, and `trialSequenceId`. Remote state updates, actions, proposed moves, and trial-complete messages are ignored when they do not match the current trial.

## 2. Same Goal Marked as Failed

Bug: Both players could visibly reach the same restaurant, but the feedback still said "Collaboration failed!".

Cause: 2P success could still be affected by a stale `result.success: false` flag.

Fix: 2P success is now recomputed from the final board positions and goal locations. If both players are on the same restaurant, the trial is scored as a success.

## 3. 2P Trial Failed Immediately After Starting

Bug: A new two-player trial could show failure immediately before players had moved.

Cause: A stale timeout or stale `trial-completed` event from an earlier trial could fire during the new trial.

Fix: Trial timeout callbacks now capture the trial identity when they are created and do nothing if the app has moved to another trial. Inbound 2P network messages must include the current trial token.

## 4. Teammate Found Page Skipped by Space

Bug: The "We found your teammate!" page could be skipped immediately because kids were still pressing Space from the waiting mini-game.

Cause: The teammate-found page used Space as the start control.

Fix: Removed Space-to-start from that page and added a click-only `Click to start!` button.

## 5. Missing Team-Goal Reminder

Bug: The teammate-found page did not remind children how to win the team game.

Fix: Added the reminder below the red/orange circles:

`To win the team game, you and your teammate need to go to the same restaurant.`
