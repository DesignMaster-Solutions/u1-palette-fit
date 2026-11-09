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
export const cm2 = (mm2) => `${(mm2 / 100).toFixed(1)} cm²`;
/** dE00 above which nothing on the shelf is the same colour family: red vs dark red is 23.8, navy vs black 29.7, white vs yellow 30.5. */
export const NO_MATCH = 25;

/**
 * Leaf states of one painted triangle (`paint_color` in Bambu Studio / OrcaSlicer / Snapmaker Orca,
 * `slic3rpe:mmu_segmentation` in PrusaSlicer). 0 = the part's own extruder, n = filament n. Pass an array as
 * `weights` to also get, per leaf, the fraction of the triangle's area it covers.
 * Format: libslic3r TriangleSelector::serialize + FacetsAnnotation::set_triangle_from_string (OrcaSlicer main):
 * hex digits are read from the END of the string, 4 bits each, least significant bit first; per triangle
 * 2 bits = split sides (0 = leaf); split: 2 bits special side, then split+1 children; leaf: 2 bits state,
 * state 3 = escape, +4 bits (state - 3), nibble 15 = second escape, +4 bits (state - 18).
 */
export function paintStates(hex, weights) {
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
  // shortcut: siblings share their parent evenly (libslic3r's 2-side split is really 1/4, 3/8, 3/8), refine if a user needs it
  const walk = (w) => {
    const split = read(2);
    if (split) { read(2); for (let c = 0; c <= split; c++) walk(w / (split + 1)); return; }
    let n = read(2);
    if (n === 3) { n = 3 + read(4); if (n === 18) n = 18 + read(4); }
    states.push(n); weights?.push(w);
  };
  walk(1);
  return states;
}

/** -> { palette: [{index, hex, uses, painted, used}], painted, source: 'project_settings' | 'basematerials' | 'none' } */
export async function parse3mf(data) {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  const zip = listZip(bytes);
  const dec = new TextDecoder();
  const text = async (name) => (zip.has(name) ? dec.decode(await zip.get(name).read()) : '');
  const main = await text('3D/3dmodel.model');
  const modelSettings = await text('Metadata/model_settings.config');
  const uses = new Map();
  for (const m of modelSettings.matchAll(/<metadata key="extruder" value="(\d+)"/g)) uses.set(+m[1], (uses.get(+m[1]) ?? 0) + 1);
  const own = new Map(); // part/object id -> its extruder; unpainted faces of that mesh print with it (part wins over object)
  for (const m of modelSettings.matchAll(/<(object|part) id="(\d+)"[^>]*>(?:(?!<\/?(?:object|part)\b)[\s\S])*?<metadata key="extruder" value="(\d+)"/g)) if (m[1] === 'part' || !own.has(m[2])) own.set(m[2], +m[3]);
  const onFaces = new Set(); // filaments painted on at least one face
  let plain = 0; // faces (or leaves) left to the part's own extruder
  const area = new Map(); // filament -> mm² of surface it prints
  const add = (f, a) => area.set(f, (area.get(f) ?? 0) + a);
  const scan = (xml) => {
    for (const o of xml.matchAll(/<object\b([^>]*)>([\s\S]*?)<\/object>/g)) {
      const ext = own.get(/\bid="(\d+)"/.exec(o[1])?.[1]) ?? 1;
      const v = [...o[2].matchAll(/<vertex x="([^"]+)" y="([^"]+)" z="([^"]+)"/g)].map((m) => [+m[1], +m[2], +m[3]]);
      for (const m of o[2].matchAll(/<triangle\b([^>]*)>/g)) {
        const a = triArea(v, m[1]);
        const pc = /(?:paint_color|mmu_segmentation)="([0-9A-Fa-f]+)"/.exec(m[1]);
        if (!pc) { plain++; add(ext, a); continue; }
        const w = []; // fraction of the face under each leaf
        paintStates(pc[1], w).forEach((s, k) => { s ? onFaces.add(s) : plain++; add(s || ext, a * w[k]); });
      }
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
  // shortcut: a part's own extruder counts as used whenever any face anywhere is unpainted (not per part); refine if a user hits it
  const byPart = (i) => (plain > 0 || !painted) && (!uses.size || uses.has(i));
  // a filament with surface is used whatever model_settings says: the unpainted faces of an object with no extruder print in filament 1
  const palette = hexes.map((hex, i) => ({ index: i + 1, hex: normHex(hex), uses: uses.get(i + 1) ?? 0, area: area.get(i + 1) ?? 0, painted: onFaces.has(i + 1), used: onFaces.has(i + 1) || (area.get(i + 1) ?? 0) > 0 || byPart(i + 1) }));
  return { palette, painted, source };
}

/** mm² of one <triangle v1 v2 v3> over the mesh's vertex list; 0 when a vertex is missing. */
const triArea = (v, attrs) => {
  const [a, b, c] = ['v1', 'v2', 'v3'].map((k) => v[+new RegExp(`\\b${k}="(\\d+)"`).exec(attrs)?.[1]]);
  if (!a || !b || !c) return 0;
  const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], w = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  return Math.hypot(u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]) / 2;
};

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

/**
 * Greedy merge until n colours remain. -> { kept, merges: [{from, into, deltaE, label, area?}] }
 * With a surface area (mm²) known for every colour, a pair under dE00 2 (nobody can tell them apart) folds first whatever
 * its size; above that the cost is dE00 x the surface that changes colour, so a small detail folds before a whole body,
 * and `area` is the mm² repainted. Without areas it is the closest pair by dE00, keeping the colour with more parts.
 */
export function reduceTo(colours, n = SLOTS) {
  const kept = colours.map((c) => ({ ...c }));
  const labs = new Map(kept.map((c) => [c, hexToLab(c.hex)]));
  const weighted = kept.length > n && kept.every((c) => c.area > 0);
  const score = (d, a, b) => (!weighted || d < 2 ? d : 2 + d * Math.min(a.area, b.area)); // weighted scores stay above any d < 2
  const size = (c) => (weighted ? c.area : c.uses ?? 0);
  const merges = [];
  while (kept.length > n) {
    let best = { score: Infinity };
    for (let i = 0; i < kept.length; i++) for (let j = i + 1; j < kept.length; j++) {
      const d = deltaE00(labs.get(kept[i]), labs.get(kept[j]));
      const s = score(d, kept[i], kept[j]);
      if (s < best.score) best = { i, j, deltaE: d, score: s };
    }
    const a = kept[best.i], b = kept[best.j]; // a has the lower palette index
    const [into, from] = size(b) > size(a) ? [b, a] : [a, b];
    into.uses = (into.uses ?? 0) + (from.uses ?? 0);
    into.area = (into.area ?? 0) + (from.area ?? 0);
    kept.splice(kept.indexOf(from), 1);
    merges.push({ from, into, deltaE: best.deltaE, label: label(best.deltaE), ...(weighted && { area: from.area }) });
  }
  return { kept, merges };
}

/**
 * Distinct spool per slot minimising total dE00. Exact over the 6 nearest per slot when slots <= SLOTS, else greedy.
 * A colour with nothing within NO_MATCH gets `spool: null` and its `nearest`, keeps its slot and takes no spool from the others.
 */
export function assign(colours, spools, nearest = 6) {
  if (!spools.length) throw new Error('add at least one spool');
  const spoolLabs = spools.map((s) => hexToLab(s.hex));
  const sorted = colours.map((c) => {
    const lab = hexToLab(c.hex);
    return spools.map((spool, k) => ({ spool, deltaE: deltaE00(lab, spoolLabs[k]) })).sort((x, y) => x.deltaE - y.deltaE);
  });
  const reach = colours.map((_, i) => i).filter((i) => sorted[i][0].deltaE <= NO_MATCH);
  if (spools.length < reach.length) throw new Error(`need at least ${reach.length} spools, got ${spools.length}`);
  let pick;
  if (reach.length <= SLOTS) {
    const cands = reach.map((i) => sorted[i].slice(0, nearest));
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
    pick = reach.map((i) => { const c = sorted[i].find((x) => !used.has(x.spool)); used.add(c.spool); return c; });
  }
  const chosen = new Map(reach.map((i, k) => [i, pick[k]]));
  return colours.map((c, i) => {
    const p = chosen.get(i), near = sorted[i][0];
    return p ? { slot: `T${i + 1}`, modelHex: c.hex, spool: p.spool, deltaE: p.deltaE, label: label(p.deltaE) }
      : { slot: `T${i + 1}`, modelHex: c.hex, spool: null, nearest: near.spool, deltaE: near.deltaE, label: 'no spool in reach' };
  });
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
  for (const c of r.palette) out.push(`  ${c.index}  ${c.hex}  ${c.used ? 'used' : 'unused'}${c.uses ? ` (${c.uses} part${c.uses === 1 ? '' : 's'})` : ''}${c.area ? `  ${cm2(c.area)}` : ''}`);
  if (r.palette.some((c) => c.area)) out.push('  (cm² = surface of the faces printed in that filament, what you see; not weight, the slicer knows the grams)');
  out.push('', r.merges.length ? 'Merges (closest pairs folded to fit 4 slots):' : 'Merges: none');
  for (const m of r.merges) out.push(`  ${m.from.hex} -> ${m.into.hex}  dE00 ${n(m.deltaE)} (${m.label})${m.area ? `, ${cm2(m.area)} repainted` : ''}`);
  out.push('', 'Slot plan:');
  for (const p of r.plan) out.push(p.spool
    ? `  ${p.slot}  ${p.modelHex} -> ${p.spool.name} ${p.spool.hex}  dE00 ${n(p.deltaE)} (${p.label})`
    : `  ${p.slot}  ${p.modelHex} -> no spool within dE00 ${NO_MATCH} (nearest ${p.nearest.name} ${p.nearest.hex}, dE00 ${n(p.deltaE)}): load a spool near ${p.modelHex}`);
  return out.join('\n');
}
