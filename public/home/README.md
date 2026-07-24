# Home page section photos

The home page renders a grid of large "image windows", one per section. Each
window shows a branded gradient fallback until a real photo is present here,
then the photo fades in automatically — no code change needed.

## Drop image files in this folder with these exact names

| File            | Section        | Suggested shot                          |
| --------------- | -------------- | --------------------------------------- |
| `players.jpg`   | Players        | A premium player portrait (e.g. Bruno)  |
| `teams.jpg`     | Teams          | A team / celebration shot (e.g. Arsenal)|
| `fixtures.jpg`  | Fixtures       | Pitch / fixtures imagery                 |
| `scouting.jpg`  | Scouting       | Scouting / analysis imagery              |
| `squad.jpg`     | Squad Builder  | Pitch / formation imagery                |
| `myteam.jpg`    | My Team        | Kit / badge / fan imagery                |
| `compare.jpg`   | Compare        | Two-players / head-to-head imagery       |

## Specs

- **Format:** `.jpg` (or re-point the code to `.webp`)
- **Orientation:** landscape; the big Players/Teams cards are ~3:2, the rest wider
- **Resolution:** ~1600px wide is plenty
- **Weight:** compress to roughly ≤300 KB each (these ship with the PWA)
- **Licensing:** make sure each image is licensed for use

The title, kicker and stat chip sit over a dark scrim at the bottom of every
card, so busy or bright photos still keep the text readable.
