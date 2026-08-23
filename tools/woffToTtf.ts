import { inflateSync } from "node:zlib";

/**
 * Unwraps a WOFF back into the plain TTF inside it.
 *
 * resvg reads raw sfnt fonts and has no idea what a WOFF is, while the only
 * formats published for most open faces are WOFF and WOFF2. A WOFF is not a
 * different font format though — it is an sfnt with the table directory
 * rewritten and each table individually zlib-compressed — so unwrapping it is
 * mechanical rather than a real conversion, and needs no network or toolchain.
 *
 * WOFF2 genuinely is a different format (Brotli, plus transformed glyf/loca
 * tables) and is deliberately not handled here.
 */
export function woffToTtf(woff: Buffer): Buffer {
  if (woff.readUInt32BE(0) !== 0x774f4646) throw new Error("not a WOFF file (bad signature)");

  const flavor = woff.readUInt32BE(4);
  const numTables = woff.readUInt16BE(12);

  interface Table { tag: number; data: Buffer; checksum: number }
  const tables: Table[] = [];

  for (let i = 0; i < numTables; i++) {
    const entry = 44 + i * 20;
    const tag = woff.readUInt32BE(entry);
    const offset = woff.readUInt32BE(entry + 4);
    const compLength = woff.readUInt32BE(entry + 8);
    const origLength = woff.readUInt32BE(entry + 12);
    const checksum = woff.readUInt32BE(entry + 16);

    const raw = woff.subarray(offset, offset + compLength);
    // Per spec a table is stored uncompressed when compression didn't help,
    // signalled by the two lengths matching rather than by any flag.
    const data = compLength === origLength ? Buffer.from(raw) : inflateSync(raw);
    if (data.length !== origLength) throw new Error(`table ${i} inflated to ${data.length}, expected ${origLength}`);
    tables.push({ tag, data, checksum });
  }

  // The sfnt directory must be sorted by tag; WOFF stores it that way already,
  // but sorting is cheap next to trusting the input.
  tables.sort((a, b) => a.tag - b.tag);

  const entrySelector = Math.floor(Math.log2(numTables));
  const searchRange = 2 ** entrySelector * 16;
  const header = Buffer.alloc(12);
  header.writeUInt32BE(flavor, 0);
  header.writeUInt16BE(numTables, 4);
  header.writeUInt16BE(searchRange, 6);
  header.writeUInt16BE(entrySelector, 8);
  header.writeUInt16BE(numTables * 16 - searchRange, 10);

  const directory = Buffer.alloc(numTables * 16);
  const body: Buffer[] = [];
  let offset = 12 + numTables * 16;

  tables.forEach((table, i) => {
    directory.writeUInt32BE(table.tag, i * 16);
    directory.writeUInt32BE(table.checksum, i * 16 + 4);
    directory.writeUInt32BE(offset, i * 16 + 8);
    directory.writeUInt32BE(table.data.length, i * 16 + 12);
    body.push(table.data);
    // Every table starts on a four-byte boundary.
    const padding = (4 - (table.data.length % 4)) % 4;
    if (padding) body.push(Buffer.alloc(padding));
    offset += table.data.length + padding;
  });

  return Buffer.concat([header, directory, ...body]);
}
