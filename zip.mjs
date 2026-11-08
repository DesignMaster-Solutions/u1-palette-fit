// Minimal ZIP reader: central directory listing plus inflate (deflate-raw) or stored entries. No dependencies.
// shortcut: no ZIP64 and no CRC check, 3MF projects stay far below 4 GB; add when one shows up.
const u16 = (b, o) => b[o] | (b[o + 1] << 8);
const u32 = (b, o) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16)) + b[o + 3] * 0x1000000;

async function inflateRaw(bytes) {
  if (typeof DecompressionStream === 'function') {
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }
  const { inflateRawSync } = await import('node:zlib');
  return new Uint8Array(inflateRawSync(bytes));
}

/** Returns Map<name, {name, method, read()}>; read() resolves to the entry bytes. */
export function listZip(bytes) {
  let eocd = bytes.length - 22;
  while (eocd >= 0 && u32(bytes, eocd) !== 0x06054b50) eocd--;
  if (eocd < 0) throw new Error('not a ZIP file');
  const count = u16(bytes, eocd + 10);
  let p = u32(bytes, eocd + 16);
  const dec = new TextDecoder();
  const entries = new Map();
  for (let i = 0; i < count; i++) {
    if (u32(bytes, p) !== 0x02014b50) throw new Error('bad ZIP central directory');
    const method = u16(bytes, p + 10), csize = u32(bytes, p + 20), nameLen = u16(bytes, p + 28), local = u32(bytes, p + 42);
    const name = dec.decode(bytes.subarray(p + 46, p + 46 + nameLen));
    entries.set(name, {
      name, method,
      async read() {
        const start = local + 30 + u16(bytes, local + 26) + u16(bytes, local + 28);
        const raw = bytes.subarray(start, start + csize);
        if (method === 0) return raw;
        if (method === 8) return inflateRaw(raw);
        throw new Error(`unsupported compression method ${method} in ${name}`);
      },
    });
    p += 46 + nameLen + u16(bytes, p + 30) + u16(bytes, p + 32);
  }
  return entries;
}
