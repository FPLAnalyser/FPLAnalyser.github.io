# Expected XI — four directions

Design canvas exploring where the depth-chart data lands on the site. Backlog
#105. Not built; nothing here ships.

Live canvas: https://claude.ai/code/artifact/757cdc00-1e3a-4506-81fa-c4f826caa0cc

## The options

| | Direction | For | Against |
|---|---|---|---|
| A | `Main` — adjusted XI on the pitch | reads in a glance; the pitch does the positional work | hides the depth behind each starter |
| B | `Changes` — the diff is the subject | answers the question the feature exists for | nothing to show in a week with no injuries |
| C | `Ladder` — depth as rows, no pitch | shows the split when two men share a slot; survives a phone | loses the spatial read entirely |
| D | `Module` — a card for the Teams route | reaches people who would never open a lineup page | too small to carry numbers |

## The data in them is real

GW1, Arsenal v Coventry, from `site_data/2026-27/depth_charts.json` through
`lib/minutes`. The two step-up figures are the replacement's xP minus what he
would have had with the first choice fit — measured by running the allocation
twice, once with every player's fitness forced to 1:

    Mosquera  0.47 -> 4.56  (+4.1, Saliba out)
    White     0.55 -> 4.54  (+4.0, Timber out)
    XI total  48.2

Calafiori also gains +0.8 from the freed defensive minutes without being a
change himself — worth remembering if a later version wants to show it.

## Editing

These `.dc.html` files are the source. The published canvas is assembled from
them and is NOT in git — it is 2.15 MB of editor payload and regenerable:

    node "<design skill dir>/seed-canvas.mjs" \
      --template "<design skill dir>/payload.template.html" \
      --out expected-xi.html --title "Expected XI" \
      --artboard mockups/expected-xi/Main.dc.html \
      --artboard mockups/expected-xi/Changes.dc.html \
      --artboard mockups/expected-xi/Ladder.dc.html \
      --artboard mockups/expected-xi/Module.dc.html \
      --canvas mockups/expected-xi/canvas.json

Then republish `expected-xi.html` to the same artifact URL. If the canvas has
been edited in the browser since, read it back first — the browser copy is
newer than these files and re-seeding blind would discard those edits.

Unlike the flat files beside this directory, these are Design Components
rather than plain HTML: they will not open standalone in a browser.
