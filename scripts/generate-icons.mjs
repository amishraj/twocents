// Generates the PWA/app icons as PNGs with no native image tooling — just a
// hand-rolled RGBA→PNG encoder over Node's built-in zlib. Draws the TwoCents
// coin mark (a "¢" on a sky-blue gradient coin). Re-run with:
//   node scripts/generate-icons.mjs
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons');
mkdirSync(OUT, { recursive: true });

const crcTable = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const body = Buffer.concat([typeBuf, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}
function encodePng(width, height, rgba) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0; // no filter
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const lerp = (a, b, t) => a + (b - a) * t;
const mix = (c1, c2, t) => [lerp(c1[0], c2[0], t), lerp(c1[1], c2[1], t), lerp(c1[2], c2[2], t)];

const BG_TOP = hex('#0ea5e9');
const BG_BOT = hex('#0369a1');
const COIN_HI = hex('#f0f9ff');
const COIN_LO = hex('#bae6fd');
const MARK = hex('#0369a1');

function render(size) {
  const buf = Buffer.alloc(size * size * 4);
  const c = size / 2;
  const coinR = size * 0.34;
  const ringOuter = coinR * 0.62;
  const ringInner = coinR * 0.4;
  const barW = coinR * 0.12;
  const barH = coinR * 1.02;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      // full-bleed gradient background (maskable-safe)
      let col = mix(BG_TOP, BG_BOT, y / size);
      const dx = x - c;
      const dy = y - c;
      const dist = Math.hypot(dx, dy);
      // coin disc with radial shading
      if (dist <= coinR) {
        const shade = mix(COIN_HI, COIN_LO, Math.min(1, dist / coinR));
        col = shade;
        // "¢" mark: an open-ish ring (annulus) plus a vertical bar
        const inRing = dist <= ringOuter && dist >= ringInner;
        const inBar = Math.abs(dx) <= barW && Math.abs(dy) <= barH / 2;
        // open the ring slightly on the right to read as a "c"
        const angle = Math.atan2(dy, dx);
        const openMouth = inRing && angle > -0.5 && angle < 0.5;
        if ((inRing && !openMouth) || inBar) {
          col = MARK;
        }
      }
      buf[i] = Math.round(col[0]);
      buf[i + 1] = Math.round(col[1]);
      buf[i + 2] = Math.round(col[2]);
      buf[i + 3] = 255;
    }
  }
  return encodePng(size, size, buf);
}

for (const [name, size] of [
  ['icon-192.png', 192],
  ['icon-512.png', 512],
  ['apple-touch-icon.png', 180],
  ['icon-maskable-512.png', 512]
]) {
  writeFileSync(join(OUT, name), render(size));
  console.log('wrote', name);
}
