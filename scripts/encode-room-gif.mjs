// Encode the 32 PNG captures of room-animation.html into a 4.8-second loop.
// Install build-only dependencies outside the repository:
//   npm install --prefix <temp-dir> gifenc@1.0.3 pngjs@7.0.0
// Run: node scripts/encode-room-gif.mjs <frames-dir> <output.gif> <temp-dir>
// Output must not already exist, so earlier artwork cannot be overwritten.
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve, join } from 'node:path';

const [framesDir, output, dependencies] = process.argv.slice(2);
if (!framesDir || !output || !dependencies) {
  throw new Error('Usage: node encode-room-gif.mjs <frames-dir> <output.gif> <dependency-dir>');
}
const require = createRequire(join(resolve(dependencies), 'package.json'));
const { GIFEncoder, quantize, nearestColorIndex } = require('gifenc');
const { PNG } = require('pngjs');
const files = readdirSync(framesDir).filter(name => /^frame-\d{3}\.png$/.test(name)).sort();
if (files.length !== 32 || files.some((name, i) => name !== `frame-${String(i).padStart(3, '0')}.png`)) {
  throw new Error('Expected consecutive frame-000.png through frame-031.png');
}
function readFrame(index) {
  const frame = PNG.sync.read(readFileSync(join(framesDir, files[index])));
  if (frame.width !== 1672 || frame.height !== 941) throw new Error('Expected 1672 × 941 frames');
  for (let i = 3; i < frame.data.length; i += 4) {
    if (frame.data[i] !== 255) throw new Error('Source frames must be opaque');
  }
  return frame;
}

// One shared palette prevents color shifts in the stationary room.
const samples = [0, 8, 16, 24].map(index => readFrame(index).data);
const palette = quantize(Buffer.concat(samples), 255, { format: 'rgb565' });
const transparentIndex = palette.length;
const colorTable = [...palette, [0, 0, 0]];
const colorCache = new Map();
const gif = GIFEncoder();
let previous;
let changedPixels = 0;
for (let index = 0; index < files.length; index++) {
  const { data, width, height } = readFrame(index);
  const indexed = new Uint8Array(width * height);
  for (let pixel = 0; pixel < indexed.length; pixel++) {
    const offset = pixel * 4;
    const key = (data[offset] << 16) | (data[offset + 1] << 8) | data[offset + 2];
    let color = colorCache.get(key);
    if (color === undefined) {
      color = nearestColorIndex(palette, [data[offset], data[offset + 1], data[offset + 2]]);
      colorCache.set(key, color);
    }
    indexed[pixel] = color;
  }
  const delta = indexed.slice();
  if (previous) {
    for (let pixel = 0; pixel < delta.length; pixel++) {
      if (indexed[pixel] === previous[pixel]) delta[pixel] = transparentIndex;
      else changedPixels++;
    }
  }
  gif.writeFrame(delta, width, height, {
    ...(index === 0 ? { palette: colorTable } : {}),
    delay: 150,
    repeat: 0,
    dispose: 1,
    transparent: index > 0,
    transparentIndex,
  });
  previous = indexed;
}
if (!changedPixels) throw new Error('Refusing to save an animation with identical frames');
gif.finish();
const bytes = gif.bytes();
writeFileSync(output, bytes, { flag: 'wx' });
console.log(JSON.stringify({ frames: files.length, durationMs: 4800, bytes: bytes.length, changedPixels }));
