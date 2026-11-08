import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deflateRawSync } from 'node:zlib';
import { readFileSync, writeFileSync } from 'node:fs';
import { deltaE00, hexToLab, parse3mf, parseSpools, reduceTo, assign } from '../palette_fit.mjs';

const HERE = new URL('.', import.meta.url).pathname;

// --- tiny ZIP writer (deflate, with CRC32) so the fixture is a real archive other tools can open
function crc32(b) {
  let c = ~0;
  for (const x of b) { c ^= x; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xEDB88320 & -(c & 1)); }
  return ~c >>> 0;
}
export function makeZip(files) {
  const enc = new TextEncoder(), local = [], central = [];
  let off = 0;
  for (const [name, text] of Object.entries(files)) {
    const n = enc.encode(name), raw = enc.encode(text), z = deflateRawSync(raw), crc = crc32(raw);
    const h = new DataView(new ArrayBuffer(30));
    h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(8, 8, true);
    h.setUint32(14, crc, true); h.setUint32(18, z.length, true); h.setUint32(22, raw.length, true); h.setUint16(26, n.length, true);
    const c = new DataView(new ArrayBuffer(46));
    c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(10, 8, true);
    c.setUint32(16, crc, true); c.setUint32(20, z.length, true); c.setUint32(24, raw.length, true); c.setUint16(28, n.length, true);
    c.setUint32(42, off, true);
    local.push(new Uint8Array(h.buffer), n, z); central.push(new Uint8Array(c.buffer), n);
    off += 30 + n.length + z.length;
  }
  const cdSize = central.reduce((s, p) => s + p.length, 0);
  const e = new DataView(new ArrayBuffer(22));
  e.setUint32(0, 0x06054b50, true); e.setUint16(8, local.length / 3, true); e.setUint16(10, local.length / 3, true);
  e.setUint32(12, cdSize, true); e.setUint32(16, off, true);
  return Buffer.concat([...local, ...central, new Uint8Array(e.buffer)]);
}

const SIX = ['#FF0000', '#FA0505', '#00FF00', '#0000FF', '#FFFFFF', '#000000'];
const demo3mf = () => makeZip({
  '[Content_Types].xml': '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/><Default Extension="config" ContentType="text/xml"/><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/></Types>',
  '_rels/.rels': '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>',
  '3D/3dmodel.model': '<?xml version="1.0"?><model unit="millimeter" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02"><resources><object id="1" type="model"><mesh><vertices><vertex x="0" y="0" z="0"/><vertex x="10" y="0" z="0"/><vertex x="0" y="10" z="0"/><vertex x="0" y="0" z="10"/></vertices><triangles><triangle v1="0" v2="2" v3="1"/><triangle v1="0" v2="1" v3="3"/><triangle v1="0" v2="3" v3="2"/><triangle v1="1" v2="2" v3="3"/></triangles></mesh></object></resources><build><item objectid="1"/></build></model>',
  'Metadata/project_settings.config': JSON.stringify({ filament_colour: SIX, filament_type: SIX.map(() => 'PLA') }),
  'Metadata/model_settings.config': '<?xml version="1.0"?><config><object id="1"><metadata key="name" value="demo"/><metadata key="extruder" value="1"/>'
    + [1, 2, 3, 5, 6].map((e, i) => `<part id="${i + 1}" subtype="normal_part"><metadata key="name" value="part ${e}"/><metadata key="extruder" value="${e}"/></part>`).join('')
    + '</object></config>',
});
const SPOOLS = `Bambu PLA Basic Red,#FF0000
Sunlu Lime,#10F010
eSUN Snow White,#FAFAFA
Polymaker Jet Black,#101010
Sky Blue,#3080FF
Yellow,#FFE000
#808080
`;

test('deltaE00 matches Sharma 2005 pairs', () => {
  const pairs = [
    [[50, 2.6772, -79.7751], [50, 0, -82.7485], 2.0425],
    [[50, 0, 0], [50, -1, 2], 2.3669],
    [[50, 2.5, 0], [73, 25, -18], 27.1492],
    [[60.2574, -34.0099, 36.2677], [60.4626, -34.1751, 39.4387], 1.2644],
  ];
  for (const [p, q, want] of pairs) {
    const lab = ([L, a, b]) => ({ L, a, b });
    assert.ok(Math.abs(deltaE00(lab(p), lab(q)) - want) < 1e-4, `${p} vs ${q}: ${deltaE00(lab(p), lab(q))} != ${want}`);
  }
});

test('hexToLab white and red', () => {
  assert.ok(Math.abs(hexToLab('#FFFFFF').L - 100) < 0.01);
  const red = hexToLab('#FF0000');
  assert.ok(Math.abs(red.L - 53.23) < 0.05 && Math.abs(red.a - 80.11) < 0.05 && Math.abs(red.b - 67.22) < 0.05, JSON.stringify(red));
});

test('synthetic 3MF: parse, reduce, assign', async () => {
  const bytes = demo3mf();
  writeFileSync(`${HERE}../examples/six-colour-demo.3mf`, bytes); // keeps the CLI demo in sync with the test
  writeFileSync(`${HERE}../examples/spools.txt`, SPOOLS);
  const { palette, painted } = await parse3mf(bytes);
  assert.equal(painted, false);
  assert.equal(palette.length, 6);
  const used = palette.filter(c => c.used);
  assert.deepEqual(used.map(c => c.index), [1, 2, 3, 5, 6]);

  const { kept, merges } = reduceTo(used, 4);
  assert.equal(kept.length, 4);
  assert.equal(merges.length, 1);
  assert.deepEqual([merges[0].into.hex, merges[0].from.hex], ['#FF0000', '#FA0505']);
  assert.ok(merges[0].deltaE < 2 && merges[0].label === 'hard to see');

  const spools = parseSpools(SPOOLS);
  assert.equal(spools.length, 7);
  assert.equal(spools[6].name, '#808080');
  const plan = assign(kept, spools);
  assert.equal(plan.length, 4);
  assert.equal(new Set(plan.map(p => p.spool.name)).size, 4);
  assert.deepEqual(plan.map(p => p.slot), ['T1', 'T2', 'T3', 'T4']);
  assert.equal(plan[0].spool.name, 'Bambu PLA Basic Red');
  assert.equal(plan[0].deltaE, 0);
});

test('spoolman JSON export', () => {
  const s = parseSpools(JSON.stringify([{ id: 1, filament: { name: 'PLA Basic Red', color_hex: 'ff0000', vendor: { name: 'Bambu' } } },
    { id: 2, filament: { name: 'Clear', color_hex: 'ffffff80', vendor: null } }]));
  assert.deepEqual(s, [{ name: 'Bambu PLA Basic Red', hex: '#FF0000' }, { name: 'Clear', hex: '#FFFFFF' }]);
  assert.throws(() => parseSpools('Red,#FF00'), /line 1/);
});

test('real coaster.3mf without project_settings does not throw', async () => {
  const bytes = readFileSync('/Users/alandebortolo/Backups/impressora/u1-purge-ledger/examples/coaster/coaster.3mf');
  const r = await parse3mf(bytes);
  assert.ok(r.palette.length >= 1 || r.source === 'none', JSON.stringify(r));
});
