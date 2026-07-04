# Mobile 2P3G Grid World Add-on

This branch/package adds a phone-friendly 2P3G pilot task based on the uploaded Dynamic Stag Hunt codebase.

## New participant flow

1. Participant opens `/mobile-2p3g.html` on a phone.
2. Participant plays 4 rounds on a 9 × 9 grid.
3. Participant controls the cyan player using large touch-screen arrow buttons.
4. The orange partner is a simple scripted partner that moves after the participant.
5. Two blue goals are visible at the start of each round.
6. A third green goal appears when both agents initially move toward the same blue goal.
7. The round ends when both agents reach a goal, or when the round times out.
8. After 4 rounds, the participant answers 3 questions.

## Run in development

Start the existing API server in one terminal:

```bash
npm run server:dev
```

Start the mobile client in another terminal:

```bash
npm run dev:mobile
```

Then open:

```text
http://localhost:3000/mobile-2p3g.html
```

For real phone testing on the same Wi-Fi, use your computer's local IP address:

```text
http://YOUR_LOCAL_IP:3000/mobile-2p3g.html
```

## Production build

```bash
npm run build
npm start
```

Then open:

```text
http://localhost:3001/mobile-2p3g.html
```

## Data output

The mobile task posts to the existing `/api/save-experiment` endpoint. Server-side data is saved as JSON in:

```text
data/experiments/
```

The mobile task also writes a local browser backup under a `mobile-2p3g-*` localStorage key.

## Files changed or added

- `client/mobile-2p3g.html` — mobile study page.
- `client/src/mobile2p3g.js` — 9 × 9 2P3G game logic, touch controls, partner policy, survey, and data export.
- `vite.config.js` — adds `mobile-2p3g.html` as a build entry.
- `package.json` — adds `npm run dev:mobile`.
