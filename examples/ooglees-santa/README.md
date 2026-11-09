# OOglees Santa Claus, a real multicolour 3MF

The file Zoe_M (Snapmaker community team) used to test the tool on [forum topic 44138](https://forum.snapmaker.com/t/44138): a one-piece, four-colour Santa sliced in Snapmaker Orca for the U1, from [Snapmaker Space model 47460](https://space.snapmaker.com/en/model/47460) by Altenife (print profile 51649).

The model is under the Standard Digital File License, which forbids redistribution, so the 3MF is not in this repository. To run the example, log in to Snapmaker Space, press "Download 3MF" on the model page and save it here as `santa.3mf` (sha256 `0b8caabb100198bce0e3cba1bc2c4d600647f06ba4fe43291bee943db5644c12`, 1 586 668 bytes). `.gitignore` keeps it out of commits; without it the test in `test/palette_fit.test.mjs` is skipped.

```
node cli.mjs examples/ooglees-santa/santa.3mf examples/ooglees-santa/zoe-shelf.txt
```

`zoe-shelf.txt` is the four spools from her screenshot (red #FF0000, black #000000, yellow #FFFF00, green #008000). `expected.json` is the committed record the test compares against.

## What the file taught the tool

- The object carries `extruder` 0 in `model_settings.config`: the unpainted faces (the red body, 60 cm²) print in filament 1 without the file ever naming it. Before 66fb092 the tool measured that surface and still said "used: no".
- With no white spool on the shelf, the model's white (156 cm², the largest surface) has nothing within dE00 25: the plan says "no spool in reach, nearest yellow 30.5" instead of forcing the red spool at dE00 45.8.

## Surface versus the slicer's grams

The print profile on Snapmaker Space publishes the slicer's filament usage. Same order, different ratio: grams depend on walls and infill, surface is what you see, which is why the tool reports cm² and leaves grams to the slicer.

| filament | surface (cm²) | slicer (g) | g per cm² |
|---|---|---|---|
| 1 #C12E1F red | 60.2 | 10.78 | 0.18 |
| 2 #000000 black | 17.1 | 5.01 | 0.29 |
| 3 #FFFFFF white | 156.5 | 24.82 | 0.16 |
| 4 #F0BE02 gold | 31.5 | 8.46 | 0.27 |
