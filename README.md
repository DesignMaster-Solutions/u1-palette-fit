# U1 Palette Fit

Maps the colour palette of a downloaded multicolour 3MF onto the four slots of a Snapmaker U1, using the filament spools you actually own. Runs in the browser or from the command line, with no dependencies.

## Why

A MakerWorld or Printables project ships with the designer's filaments. The slicer's filament mapping dialog lets you re-assign them, but it does not know what is on your shelf, and the U1 has exactly four slots. This tool reads the palette, tells you which filaments the model really uses, folds the closest pair together when there are more than four, and picks the nearest spool for each slot. Distance is CIEDE2000 (dE00), the perceptual standard: under 2 is hard to see, 2 to 5 is visible side by side, over 5 is clearly different. Above 25 nothing on your shelf is even the same colour family (red vs dark red is 23.8, navy vs black 29.7, white vs yellow 30.5): the plan then says "no spool in reach" for that slot, names the nearest spool and its dE00, and leaves it for a spool you still need, instead of forcing a wrong one and taking it from another colour.

## Use

Web: open `index.html` locally (any static server or straight from disk in a browser that allows module scripts from `file://`), or use https://designmaster-solutions.github.io/u1-palette-fit/. Drop the 3MF, paste your spools as `name,#RRGGBB` lines (or just `#RRGGBB`, or a Spoolman JSON export; if you do not know a spool's hex, type its name, pick the colour in the colour box and press "Add spool"), press Fit. The spool list is kept in `localStorage`. "Copy plan as text" gives the same output as the CLI.

Releases: https://github.com/DesignMaster-Solutions/u1-palette-fit/releases (zip of the CLI, the web page and the examples; nothing to install).

CLI (Node 18 or newer):

```
node cli.mjs model.3mf spools.txt
node cli.mjs model.3mf spools.txt --json
```

Try it with the bundled demo:

```
node cli.mjs examples/six-colour-demo.3mf examples/spools.txt
```

A real file: the OOglees Santa that Snapmaker staff tested on the forum, with the slicer's grams next to the tool's surfaces, is documented in [`examples/ooglees-santa/`](examples/ooglees-santa/README.md) (its licence forbids redistribution, so you download it there).

Tests: `node --test`.

## How it reads the 3MF

Palette comes from `filament_colour` in `Metadata/project_settings.config` (Bambu Studio, OrcaSlicer, Snapmaker Orca). Used filaments come from the `extruder` entries in `Metadata/model_settings.config`. Painted models are decoded: each `paint_color` (Bambu Studio, OrcaSlicer) or `mmu_segmentation` (PrusaSlicer) triangle attribute is walked as the libslic3r `TriangleSelector` bit tree, so a filament counts as used when it is painted on at least one face, when it prints any surface (the unpainted faces of an object that names no extruder go to filament 1, which is then used even if `model_settings.config` never lists it), and a part's own extruder counts as used while any face is left unpainted. Without `project_settings.config` we fall back to `displaycolor` in the `basematerials` of `3D/3dmodel.model`; if nothing is there we say so.

Each filament also gets the surface it prints, in mm² (cm² on screen): the area of every triangle it covers, with a painted triangle shared among its paint leaves by the tree splits (siblings share their parent evenly). Unpainted faces go to the extruder of their part or object in `model_settings.config`. It is surface, not weight: this tool never slices, so it cannot know walls, infill or layer height, and the slicer's gram estimate is the one to trust for filament usage. For a colour decision the visible surface is the number that matters, which is why the merge cost is dE00 times surface.

Merges use that surface. A pair under dE00 2 (nobody can tell them apart) folds first whatever its size; above that the cost is dE00 times the surface that changes colour, so a 2 mm detail folds before a whole body, and the plan says how many cm² are repainted. When no surface is known (a file with no mesh we can read) merges fall back to the closest pair by dE00, keeping the colour with more parts, then the lower palette index.

Spool assignment is exact (brute force over the six nearest spools per slot) for up to four slots, greedy beyond that.

## What it does not do

- No 3D preview. You get tables, not a render.
- Painted faces are read per filament, not per part: a part whose extruder is set in `model_settings.config` counts as used while any face in the file is unpainted, even if that one part is painted over entirely.
- dE00 is computed on the nominal hex in the file, not on the measured filament. Two PLA spools with the same hex can still print differently.
- Only `.3mf` input. STL has no colour.

## Licence

GPL-3.0. See `LICENSE`.
