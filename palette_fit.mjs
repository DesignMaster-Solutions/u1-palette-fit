// U1 Palette Fit: read a 3MF palette, reduce it to the printer's slots, map slots to the owner's spools by CIEDE2000.
import { listZip } from './zip.mjs';

export const SLOTS = 4;

export function hexToRgb(hex) {
  const m = /^#?([0-9a-f]{6})(?:[0-9a-f]{2})?$/i.exec(String(hex).trim());
  if (!m) throw new Error(`bad colour ${JSON.stringify(hex)}`);
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export const normHex = (hex) => '#' + hexToRgb(hex).map((c) => c.toString(16).padStart(2, '0')).join('').toUpperCase();

/** sRGB (D65) -> XYZ -> CIELAB. */
export function hexToLab(hex) {
  const [r, g, b] = hexToRgb(hex).map((c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
  const x = (0.4124564 * r + 0.3575761 * g + 0.1804375 * b) / 0.95047;
  const y = 0.2126729 * r + 0.7151522 * g + 0.0721750 * b;
  const z = (0.0193339 * r + 0.1191920 * g + 0.9503041 * b) / 1.08883;
  const f = (t) => (t > 216 / 24389 ? Math.cbrt(t) : ((24389 / 27) * t + 16) / 116);
  const [fx, fy, fz] = [x, y, z].map(f);
  return { L: 116 * fy - 16, a: 500 * (fx - fy), b: 200 * (fy - fz) };
}

const rad = (deg) => (deg * Math.PI) / 180;
const hue = (a, b) => { if (a === 0 && b === 0) return 0; const h = (Math.atan2(b, a) * 180) / Math.PI; return h < 0 ? h + 360 : h; };

/** CIEDE2000, Sharma, Wu, Dalal 2005 (kL = kC = kH = 1). */
export function deltaE00(lab1, lab2) {
  const { L: L1, a: a1, b: b1 } = lab1, { L: L2, a: a2, b: b2 } = lab2;
  const Cbar = (Math.hypot(a1, b1) + Math.hypot(a2, b2)) / 2;
  const G = 0.5 * (1 - Math.sqrt(Cbar ** 7 / (Cbar ** 7 + 25 ** 7)));
  const a1p = (1 + G) * a1, a2p = (1 + G) * a2;
  const C1p = Math.hypot(a1p, b1), C2p = Math.hypot(a2p, b2);
  const h1p = hue(a1p, b1), h2p = hue(a2p, b2);
  const dLp = L2 - L1, dCp = C2p - C1p;
  let dhp = 0;
  if (C1p * C2p !== 0) dhp = Math.abs(h2p - h1p) <= 180 ? h2p - h1p : h2p - h1p > 180 ? h2p - h1p - 360 : h2p - h1p + 360;
  const dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin(rad(dhp / 2));
  const Lbp = (L1 + L2) / 2, Cbp = (C1p + C2p) / 2;
  let hbp = h1p + h2p;
  if (C1p * C2p !== 0) hbp = Math.abs(h1p - h2p) <= 180 ? (h1p + h2p) / 2 : h1p + h2p < 360 ? (h1p + h2p + 360) / 2 : (h1p + h2p - 360) / 2;
  const T = 1 - 0.17 * Math.cos(rad(hbp - 30)) + 0.24 * Math.cos(rad(2 * hbp)) + 0.32 * Math.cos(rad(3 * hbp + 6)) - 0.20 * Math.cos(rad(4 * hbp - 63));
  const dTheta = 30 * Math.exp(-(((hbp - 275) / 25) ** 2));
  const RC = 2 * Math.sqrt(Cbp ** 7 / (Cbp ** 7 + 25 ** 7));
  const SL = 1 + (0.015 * (Lbp - 50) ** 2) / Math.sqrt(20 + (Lbp - 50) ** 2);
  const SC = 1 + 0.045 * Cbp;
  const SH = 1 + 0.015 * Cbp * T;
  const RT = -Math.sin(rad(2 * dTheta)) * RC;
  const l = dLp / SL, c = dCp / SC, h = dHp / SH;
  return Math.sqrt(l * l + c * c + h * h + RT * c * h);
}

export const label = (dE) => (dE < 2 ? 'hard to see' : dE <= 5 ? 'visible side by side' : 'clearly different');

/**
 * Leaf states of one painted triangle (`paint_color` in Bambu Studio / OrcaSlicer / Snapmaker Orca,
 * `slic3rpe:mmu_segmentation` in PrusaSlicer). 0 = the part's own extruder, n = filament n.
 * Format: libslic3r TriangleSelector::serialize + FacetsAnnotation::set_triangle_from_string (OrcaSlicer main):
 * hex digits are read from the END of the string, 4 bits each, least significant bit first; per triangle
 * 2 bits = split sides (0 = leaf); split: 2 bits special side, then split+1 children; leaf: 2 bits state,
 * state 3 = escape, +4 bits (state - 3), nibble 15 = second escape, +4 bits (state - 18).
 */
export function paintStates(hex) {
  const bits = [];
  for (let i = hex.length - 1; i >= 0; i--) {
    const d = parseInt(hex[i], 16);
    if (Number.isNaN(d)) throw new Error(`paint_color: bad digit "${hex[i]}"`);
    for (let b = 0; b < 4; b++) bits.push((d >> b) & 1);
  }
  let p = 0;
  const states = [];
  const read = (n) => {
    if (p + n > bits.length) throw new Error('paint_color: truncated');
    let v = 0;
    for (let b = 0; b < n; b++) v |= bits[p++] << b;
    return v;
  };
  const walk = () => {
    const split = read(2);
    if (split) { read(2); for (let c = 0; c <= split; c++) walk(); return; }
    let n = read(2);
    if (n === 3) { n = 3 + read(4); if (n === 18) n = 18 + read(4); }
    states.push(n);
  };
  walk();
  return states;
}

/** -> { palette: [{index, hex, uses, painted, used}], painted, source: 'project_settings' | 'basematerials' | 'none' } */
export async function parse3mf(data) {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  const zip = listZip(bytes);
  const dec = new TextDecoder();
  const text = async (name) => (zip.has(name) ? dec.decode(await zip.get(name).read()) : '');
  const main = await text('3D/3dmodel.model');
  const onFaces = new Set(); // filaments painted on at least one face
  let plain = 0; // faces (or leaves) left to the part's own extruder
  const scan = (xml) => {
    for (const m of xml.matchAll(/<triangle\b([^>]*)>/g)) {
      const pc = /(?:paint_color|mmu_segmentation)="([0-9A-Fa-f]+)"/.exec(m[1]);
      if (!pc) { plain++; continue; }
      for (const s of paintStates(pc[1])) s ? onFaces.add(s) : plain++;
    }
  };
  scan(main);
  for (const name of zip.keys()) if (/^3D\/Objects\/.*\.model$/.test(name)) scan(await text(name));
  const painted = onFaces.size > 0;
  let source = 'project_settings';
  const settings = await text('Metadata/project_settings.config');
  let hexes = settings ? JSON.parse(settings).filament_colour ?? [] : [];
  if (!hexes.length) { source = 'basematerials'; hexes = [...main.matchAll(/<base\b[^>]*\bdisplaycolor="([^"]+)"/g)].map((m) => m[1]); }
  if (!hexes.length) return { palette: [], painted, source: 'none' };
  const uses = new Map();
  for (const m of (await text('Metadata/model_settings.config')).matchAll(/<metadata key="extruder" value="(\d+)"/g)) uses.set(+m[1], (uses.get(+m[1]) ?? 0) + 1);
  // shortcut: a part's own extruder counts as used whenever any face anywhere is unpainted (not per part); refine if a user hits it
  const byPart = (i) => (plain > 0 || !painted) && (!uses.size || uses.has(i));
  const palette = hexes.map((hex, i) => ({ index: i + 1, hex: normHex(hex), uses: uses.get(i + 1) ?? 0, painted: onFaces.has(i + 1), used: onFaces.has(i + 1) || byPart(i + 1) }));
  return { palette, painted, source };
}

/** Lines "name,#RRGGBB" / "#RRGGBB", or a Spoolman JSON export. -> [{name, hex}] */
export function parseSpools(text) {
  const t = text.trim();
  if (t.startsWith('[') || t.startsWith('{')) {
    const list = JSON.parse(t);
    return (Array.isArray(list) ? list : list.spools ?? []).filter((s) => s.filament?.color_hex).map((s) => ({
      name: [s.filament.vendor?.name, s.filament.name].filter(Boolean).join(' '), hex: normHex(s.filament.color_hex),
    }));
  }
  return t.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map((line, i) => {
    const m = /^(?:(.*?)\s*,\s*)?(#?[0-9a-f]{6}(?:[0-9a-f]{2})?)$/i.exec(line);
    if (!m) throw new Error(`line ${i + 1}: expected "name,#RRGGBB", got ${JSON.stringify(line)}`);
    const hex = normHex(m[2]);
    return { name: m[1] || hex, hex };
  });
}

/** Greedy merge of the closest pair until n colours remain. -> { kept, merges: [{from, into, deltaE, label}] } */
export function reduceTo(colours, n = SLOTS) {
  const kept = colours.map((c) => ({ ...c }));
  const labs = new Map(kept.map((c) => [c, hexToLab(c.hex)]));
  const merges = [];
  while (kept.length > n) {
    let best = { deltaE: Infinity };
    for (let i = 0; i < kept.length; i++) for (let j = i + 1; j < kept.length; j++) {
      const d = deltaE00(labs.get(kept[i]), labs.get(kept[j]));
      if (d < best.deltaE) best = { i, j, deltaE: d };
    }
    const a = kept[best.i], b = kept[best.j]; // a has the lower palette index
    const [into, from] = (b.uses ?? 0) > (a.uses ?? 0) ? [b, a] : [a, b];
    into.uses = (into.uses ?? 0) + (from.uses ?? 0);
    kept.splice(kept.indexOf(from), 1);
    merges.push({ from, into, deltaE: best.deltaE, label: label(best.deltaE) });
  }
  return { kept, merges };
}

/** Distinct spool per slot minimising total dE00. Exact over the 6 nearest per slot when slots <= SLOTS, else greedy. */
export function assign(colours, spools, nearest = 6) {
  if (spools.length < colours.length) throw new Error(`need at least ${colours.length} spools, got ${spools.length}`);
  const spoolLabs = spools.map((s) => hexToLab(s.hex));
  const sorted = colours.map((c) => {
    const lab = hexToLab(c.hex);
    return spools.map((spool, k) => ({ spool, deltaE: deltaE00(lab, spoolLabs[k]) })).sort((x, y) => x.deltaE - y.deltaE);
  });
  let pick;
  if (colours.length <= SLOTS) {
    const cands = sorted.map((s) => s.slice(0, nearest));
    let bestTotal = Infinity;
    const cur = [], used = new Set();
    (function go(i, total) {
      if (total >= bestTotal) return;
      if (i === cands.length) { bestTotal = total; pick = cur.slice(); return; }
      for (const c of cands[i]) {
        if (used.has(c.spool)) continue;
        used.add(c.spool); cur.push(c); go(i + 1, total + c.deltaE); cur.pop(); used.delete(c.spool);
      }
    })(0, 0);
  } else {
    const used = new Set();
    pick = sorted.map((s) => { const c = s.find((x) => !used.has(x.spool)); used.add(c.spool); return c; });
  }
  return pick.map((p, i) => ({ slot: `T${i + 1}`, modelHex: colours[i].hex, spool: p.spool, deltaE: p.deltaE, label: label(p.deltaE) }));
}

/** Whole pipeline, shared by the page and the CLI. */
export async function fit(bytes, spoolsText, slots = SLOTS) {
  const model = await parse3mf(bytes);
  if (!model.palette.length) return { ...model, merges: [], plan: [] };
  const { kept, merges } = reduceTo(model.palette.filter((c) => c.used), slots);
  return { ...model, merges, plan: assign(kept, parseSpools(spoolsText)) };
}

export function planText(r) {
  if (!r.palette.length) return 'No colours found in this 3MF (no project_settings.config and no basematerials).';
  const n = (x) => x.toFixed(2);
  const out = [`Palette: ${r.palette.length} colours, ${r.palette.filter((c) => c.used).length} used (source: ${r.source}${r.painted ? `, ${r.palette.filter((c) => c.painted).length} painted on faces` : ''})`];
  for (const c of r.palette) out.push(`  ${c.index}  ${c.hex}  ${c.used ? 'used' : 'unused'}${c.uses ? ` (${c.uses} part${c.uses === 1 ? '' : 's'})` : ''}`);
  out.push('', r.merges.length ? 'Merges (closest pairs folded to fit 4 slots):' : 'Merges: none');
  for (const m of r.merges) out.push(`  ${m.from.hex} -> ${m.into.hex}  dE00 ${n(m.deltaE)} (${m.label})`);
  out.push('', 'Slot plan:');
  for (const p of r.plan) out.push(`  ${p.slot}  ${p.modelHex} -> ${p.spool.name} ${p.spool.hex}  dE00 ${n(p.deltaE)} (${p.label})`);
  return out.join('\n');
}
