# Breakewave

A dependency-free browser arcade game inspired by the gameplay loop in the supplied reference video.

## Gameplay
- Move the paddle using mouse, touch, Left/Right arrows, or A/D.
- Keep the ball alive while it destroys the pixel-art board cell by cell.
- Catch `×3` power-ups to trigger multiball.
- Clear all three artworks to complete a run.
- You have 3 lives. Missing every active ball costs one life.

## Run
No build step is required. Open `index.html` directly, or serve the folder:

```bash
python3 -m http.server 8081
```

Then open `http://localhost:8081`.

## Files
- `index.html` — game shell and accessible controls
- `styles.css` — responsive modern UI
- `game.js` — rendering, physics, input, audio, game state, levels and power-ups
