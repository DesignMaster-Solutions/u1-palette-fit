# U1 Palette Fit

Maps the colour palette of a downloaded multicolour 3MF onto the four slots of a Snapmaker U1, using the filament spools you actually own. Runs in the browser or from the command line, with no dependencies.

## Why

A MakerWorld or Printables project ships with the designer's filaments. The slicer's filament mapping dialog lets you re-assign them, but it does not know what is on your shelf, and the U1 has exactly four slots. This tool reads the palette, tells you which filaments the model really uses, folds the closest pair together when there are more than four, and picks the nearest spool for each slot. Distance is CIEDE2000 (dE00), the perceptual standard: under 2 is hard to see, 2 to 5 is visible side by side, over 5 is clearly different.

## Use

Web: open `index.html` locally (any static server or straight from disk in a browser that allows module scripts from `file://`), or use https://designmaster-solutions.github.io/u1-palette-fit/. Drop the 3MF, paste your spools as `name,#RRGGBB` lines (or just `#RRGGBB`, or a Spoolman JSON export), press Fit. The spool list is kept in `localStorage`. "Copy plan as text" gives the same output as the CLI.

CLI (Node 18 or newer):

```
node cli.mjs model.3mf spools.txt
node cli.mjs model.3mf spools.txt --json
```

Try it with the bundled demo:

```
node cli.mjs examples/six-colour-demo.3mf examples/spools.txt
```

Tests: `node --test`.

## How it reads the 3MF

Palette comes from `filament_colour` in `Metadata/project_settings.config` (Bambu Studio, OrcaSlicer, Snapmaker Orca). Used filaments come from the `extruder` entries in `Metadata/model_settings.config`. If any `.model` file carries `paint_color`, the model is painted and every palette entry counts as used. Without `project_settings.config` we fall back to `displaycolor` in the `basematerials` of `3D/3dmodel.model`; if nothing is there we say so.

Spool assignment is exact (brute force over the six nearest spools per slot) for up to four slots, greedy beyond that. Merges keep the colour with more parts, then the lower palette index.

## What it does not do

- No 3D preview. You get tables, not a render.
- The `paint_color` tree is not decoded; a painted model counts all filaments as used.
- dE00 is computed on the nominal hex in the file, not on the measured filament. Two PLA spools with the same hex can still print differently.
- Only `.3mf` input. STL has no colour.

## Licence

GPL-3.0. See `LICENSE`.
