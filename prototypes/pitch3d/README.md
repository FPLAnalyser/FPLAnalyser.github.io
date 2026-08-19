# 3D pitch — prototype

Three ways a pitch board could work in three.js, built against the real
`site_data/2026-27` ratings and the real mirrored headshots, so what you are
looking at is this site's data and this site's card metals rather than a
generic WebGL demo.

**Nothing here is wired into the app.** It is a separate entry under
`prototypes/`, outside `tsconfig.app.json`'s `include`, so `npm run typecheck`
and `npm run build` neither check it nor ship it, and `three` is a
devDependency. Deleting the folder and the two devDependencies removes it
completely.

## Run it

```bash
node prototypes/pitch3d/build.mjs     # -> dist/pitch3d.html, prints what it costs
node prototypes/pitch3d/shoot.mjs     # -> shots/*.png + frame times, both devices
npx tsc -b prototypes/pitch3d         # typecheck (NOT bare `npx tsc --noEmit`)
```

`dist/pitch3d.html` is one self-contained file — three.js, the scene, the squad
and the fifteen headshots as data URIs — so it opens straight off disk with no
server and survives being dropped into an Artifact, where a strict CSP blocks
every external host.

## The three

| | what it is | what it buys |
|---|---|---|
| **Standing XI** | Cards stand on the grass and yaw to face you | Depth without cost — nothing is ever foreshortened, so it stays exactly as legible as the flat board |
| **Tabletop** | Cards lie on the grass like magnets on a tactics board | The formation becomes an object you can spin, with real perspective and real shadows |
| **Value columns** | Each card rides a plinth as tall as that player's xP | The only one that shows something the flat pitch cannot: the squad's shape *and* its distribution at once |

## What the prototype settled

**Cost, measured.** three.js as this scene uses it is **136.9 KB gzipped**.
The whole site's JavaScript today is 410 KB gzipped across every lazy route;
its entry chunk is 89 KB and the entire SquadBuilder route is 90 KB. So a 3D
pitch on one route is a bigger download than the whole of Squad Builder, and
half again the app's entry bundle. Our own scene code is 7.6 KB of that — the
library *is* the cost, and no amount of writing it more tightly changes that.

**The scene itself is trivial for a GPU.** 50 draw calls, ~1,400 triangles, 15
textures, 8 shader programs. There is no geometry problem here; on a real
device the cost would be fill rate at dpr 3 and the shadow-map pass, not the
scene graph.

**Frame time is NOT measured.** This container has no graphics hardware —
Chromium reports `ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)),
SwiftShader driver)`, i.e. software rasterisation — so the 4–6 fps the harness
records is the CPU drawing every pixel and says nothing about a phone. The
readout is left on screen in the build for exactly this reason: open
`dist/pitch3d.html` on a real iPhone and it reports that device's number.
Until someone does, "it runs fine on mobile" is unproven.

**A 3D bar chart lies unless you scaffold it.** The first `columns` render was
unreadable in the way 3D bar charts always are: a near 4.6 xP looked taller
than a far 6.4. Rings at each whole xP fixed it, because you stop comparing bar
against bar and start reading each one off a datum that perspective does not
distort. Any version of this that ships needs them.

**Framing has to be solved, not tuned.** Three hand-placed camera positions
looked right at 1440×900 and put half the XI off-screen at 393. `frame()`
projects every card corner and iterates the camera until they fit the part of
the viewport the caption panel is not covering — one code path for both, no
breakpoints. The panel height is measured from the DOM rather than assumed,
because the three captions wrap to different heights.

**Occlusion is a layout problem, not a camera problem.** Four defenders and
four midfielders on the same spread meant every midfielder stood exactly in
front of a defender, and from behind the goal the front row erased the back
one. Different row widths (54m / 44m / 26m) stagger them, which is also how a
team actually stands.

## Known rough edges

- The squad is the best-rated player per position with a mirrored headshot,
  which costs **£110.5m** — not a legal squad. Fine for a board that exists to
  be looked at; wrong for anything that ships.
- One texture per card (320×420). Fifteen is nothing; a 600-player board would
  need an atlas.
- Goal nets are a single translucent plane, not a mesh.
- No interaction beyond orbit — no tapping a card to open the player sheet,
  which is the first thing a real version would need.

## Where the data comes from

Rating is `season_overall_score × 20`, traced to `SquadBuilder.tsx:1527`. The
`season_overall_rating` field sitting next to it in `ratings.json` is a string
of stars (`"⭐⭐⭐⭐"`) — reading from the obviously-named field would have
painted stars on every card. `xp` is `season_xpts_per_game`.
