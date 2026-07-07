# Mobile Stag Hunt

This phone entry uses the existing Dynamic Stag Hunt rules from the browser game:

- 7 x 7 grid
- two hunters
- one moving stag
- two fixed rabbits
- obstacles
- Player 1, Player 2, then stag turn order
- optional signaling condition
- 10 rounds, up to 20 moves per player per round

## Online matching

The default phone flow is Online + Base. Matching starts as soon as the phone
page opens. The server always tries to match a human partner first. Players are
paired with each other when possible. If no other human player is found within
10 seconds, that player continues with the bot condition.

The phone UI keeps players in a neutral partner-matching stage for at least 10
seconds before the first round starts, even when the assignment is available
sooner. After the matching stage, players see `Partner found! Let's play.` and
press Start. Human-human sessions start only after both matched players press
Start.

Participant-facing labels do not say human or bot. The phone UI shows `A` for
human-human sessions and `B` for human-bot sessions.
Saved data still includes the explicit `matchType` field for analysis.

Online clients connect to the same server over `/ws`, so Render only needs one
Web Service for the static app, save API, and matchmaking relay.

## Classroom matching

Use a unique session query parameter for each classroom run, for example
`/mobile-staghunt.html?session=class-2026-07-07`. Matching is balanced
dynamically within that session: the server alternates toward a 50/50 split of
human-human players and human-bot players without needing to know the class size
up front. If a human-pool player waits 10 seconds without a partner, they are
assigned to the bot condition so the game can continue.

## Data saving

After every round, the phone posts a full movement snapshot to
`/api/save-mobile-round`. The server writes a local JSON backup in
`data/experiments/` and uploads a spreadsheet copy to Google Drive through the
configured Apps Script endpoint. Local JSON and Drive spreadsheet filenames both
start with `cellPhoneStagHunt`.

For Render, set `GOOGLE_DRIVE_APPS_SCRIPT_URL` to the deployed Apps Script web
app URL if you do not want to use the legacy grid-game endpoint. The `/health`
endpoint reports whether Drive upload is configured and whether the legacy
endpoint is being used.

## Run

```bash
npm run dev:mobile
```

Open:

```text
http://localhost:3000/mobile-staghunt.html
```

For phone testing, open the same path with the computer's LAN IP address:

```text
http://YOUR_LOCAL_IP:3000/mobile-staghunt.html
```

The page supports a solo mode with a scripted Player 2 partner and a two-player hotseat mode on the same phone.
