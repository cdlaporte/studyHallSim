# Study Hall Simulator

A simple top-down pixel-art browser game. You're the teacher on cafeteria study hall duty.

## Play

Open `index.html` in any modern browser. It's plain HTML + JavaScript with no build step or dependencies.
The pixel font loads from Google Fonts; without internet it falls back to a monospace font.

## How it works

- The cafeteria has a 4 × 6 grid of round tables. **Your desk** is in row 2, column 1.
- **Grade papers** by standing inside the dashed circle around your desk. Fill the GRADING bar before the bell rings.
- Students act up at random:
  - **Phone bubble**: walk up to that student and press **A** ("Phone away!").
  - **#@! bubble**: walk up to that table and press **S** ("Shhh!"). If you ignore a rowdy table it gets louder (`#@!` → `#@!!` → `LOUD!`), and a LOUD table riles up the tables next to it.
- The **CHAOS** meter fills while too much is going on at once and drains when the room is calm. If it maxes out, you lose.
- The **principal** shows up now and then. A banner warns you which door she's coming from. She walks the aisles and stops at corners to look around. If a phone or rowdy table stays in her yellow vision cone for a moment, she catches it and you lose.
- Finish your grading and you move on to the next level. Each level brings more trouble, more grading, and more frequent, faster principal visits.

## Controls

| Key | Action |
| --- | --- |
| Arrow keys | Move |
| A | Tell a student to put their phone away |
| S | Shush a rowdy table |
| P | Pause |
| M | Mute |
| Enter | Start / next level / retry |
| R | Restart from level 1 (after losing) |

## Tuning

You can change the difficulty in `levelConfig()` near the top of `game.js`: time limit, grading needed, how often problems appear, and how often the principal visits. Ranges and the principal's vision cone are constants just above it.
