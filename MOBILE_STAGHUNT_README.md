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

The default phone flow is Online + Base. When a player starts, the server sends
roughly half of joiners into a human-matching queue and half directly to the
scripted bot condition. Human-queue players are paired with each other when
possible. If no other human player is found within 5 seconds, that player
continues with the bot condition.

Online clients connect to the same server over `/ws`, so Render only needs one
Web Service for the static app, save API, and matchmaking relay.

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
