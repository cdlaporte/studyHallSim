# Study Hall Simulator (starring Mr. Laporte)

A simple top-down pixel-art roguelike for the browser. You're Mr. Laporte, on cafeteria study hall duty.

## Play

Open `index.html` in any modern browser. It's plain HTML + JavaScript with no build step or dependencies.
The pixel font loads from Google Fonts; without internet it falls back to a monospace font.

## How it works

- The cafeteria has a 4 × 6 grid of round tables. **Your desk** is in row 2, column 1.
- **Grade papers** by standing inside the dashed circle around your desk. Fill the GRADING bar before the bell rings.
- Students act up at random. Walk over and press **Space** to deal with whatever is nearby:
  - **Phone bubble**: "Phone away!"
  - **#@! bubble**: "Shhh!" If you ignore a rowdy table it gets louder (`#@!` → `#@!!` → `LOUD!`), and a LOUD table riles up the tables next to it.
- The **CHAOS** meter rises while too much is going on at once and falls when the room is calm.
- The **principal** shows up now and then. A banner warns you which door she's coming from. She walks the aisles and stops at corners to look around. If a phone or rowdy table stays in her vision cone for a moment, she spots it: her cone turns orange, then red, then flashes while she marches over. You have about 3.5 seconds to fix it. Do it in time and she says "Hmph. Carry on." and leaves. Otherwise your run is over.

### Mr. Laporte's hair (your health)

The side panel shows a big pixel portrait of Mr. Laporte. Chaos stresses him out, and stress makes his hair fall out. His HAIR meter carries over from round to round for the whole run. As it drops, you can watch his hairline recede, then the horseshoe, then completely bald on top. His face also reacts to what's happening: calm, annoyed, frustrated, furious, shocked when the principal shows up, and happy when you win. If he runs out of hair, the run is over. He regrows a little hair between rounds.

### Roguelike runs

Losing ends the run. Beating a level lets you make two picks:

1. **A stat upgrade** (1 of 3), such as Comfy Sneakers (move speed), Red Pen Pro (grading speed), Bigger Desk, Teacher Voice (shush range), Long Arms (phone range), Stern Reputation, Lo-fi Playlist, Zen Breathing, Rogaine, Good Rapport, Walkie-Talkie, Overtime, Organized Desk, or Classroom Mgmt.
2. **An active item** (1 of 3), used with **Q W E / A S D** (six slots). If you pick an item you already own, it levels up.

| Item | What it does |
| --- | --- |
| Teaching Assistant | A TA walks the aisles and fixes problems for a while |
| Rolling Chair | Hop in your rolling chair for a quick burst of speed |
| Rubber Chicken | Throw it; the principal stops and stares at it |
| Security Escort | Two guards in red march the closest table out for the rest of the round |
| Coach Whistle | Quiet every rowdy table near you |
| Unplug the Wi-Fi | Clear all phones; no new phones for a while |
| Pop Quiz | No new problems for a while, and loud tables stop getting louder |
| Espresso Shot | Grade 3× faster for a few seconds |
| Clipboard | Grade anywhere for a few seconds |
| Cardboard Cutout | A cardboard Mr. Laporte keeps the nearby tables in line |
| Fake Memo | Sends the principal back to her office, reading the whole way |
| Pizza Party | Fixes every problem in the room at once |
| Shiny Apple | Automatic: saves you once per round from the principal |
| Stress Ball | Big chaos drop, and no hair loss for a few seconds |
| Hair Tonic | Regrow some hair |

## Controls

| Key | Action |
| --- | --- |
| Arrow keys | Move |
| Space | Take a phone / shush a table (whatever is nearby) |
| Q W E / A S D | Use items |
| P | Pause |
| M | Mute |
| Enter | Start / new run / pick on the upgrade screen |
| 1–3 | Pick a card on the upgrade screen |

On the upgrade screen you can also use the arrow keys, number keys or the mouse.

## Tuning

You can change the difficulty in `levelConfig()` near the top of `game.js`. The stat upgrades (`STAT_UPGRADES`) and items (`ITEM_DEFS`) are defined further down, with their numbers next to them. How fast hair falls out is set in `updateHair()`.
