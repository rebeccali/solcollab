// Cross-check in Node 22 (same V8 + same wasm): CPU time via process.cpuUsage and memory per run.
import { readFileSync } from 'node:fs';
import { init as initPng } from '@jsquash/png/decode.js';
import { init as initWebpEnc } from '@jsquash/webp/encode.js';
import { initResize } from '@jsquash/resize';
import { processImage } from './src/pipeline.js';

const wasm = (p) => WebAssembly.compile(readFileSync(new URL(p, import.meta.url)));
await Promise.all([
  initPng(await wasm('./node_modules/@jsquash/png/codec/pkg/squoosh_png_bg.wasm')),
  initWebpEnc(await wasm('./node_modules/@jsquash/webp/codec/enc/webp_enc_simd.wasm')),
  initResize(await wasm('./node_modules/@jsquash/resize/lib/resize/pkg/squoosh_resize_bg.wasm')),
]);
const mb = (b) => (b / 1048576).toFixed(0);
const base = process.memoryUsage();
console.log(`after init: rss ${mb(base.rss)} MB, heapUsed ${mb(base.heapUsed)} MB, arrayBuffers ${mb(base.arrayBuffers)} MB`);
for (const name of ['sparse', 'typical', 'noise_cap', 'noise_full']) {
  const bytes = readFileSync(`images/${name}.png`);
  await processImage(bytes.slice()); // warm-up
  const cpu = [], wall = [];
  let peakAB = 0, peakHeap = 0;
  for (let i = 0; i < 10; i++) {
    const c0 = process.cpuUsage(), w0 = performance.now();
    await processImage(bytes.slice());
    const c = process.cpuUsage(c0);
    cpu.push((c.user + c.system) / 1000); wall.push(performance.now() - w0);
    const m = process.memoryUsage();
    peakAB = Math.max(peakAB, m.arrayBuffers); peakHeap = Math.max(peakHeap, m.heapUsed);
  }
  const med = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)].toFixed(0);
  console.log(`${name.padEnd(10)} cpu median ${med(cpu)} ms (max ${Math.max(...cpu).toFixed(0)}), wall median ${med(wall)} ms, peak arrayBuffers ${mb(peakAB)} MB, peak heap ${mb(peakHeap)} MB`);
}
const end = process.memoryUsage();
console.log(`end: rss ${mb(end.rss)} MB, arrayBuffers ${mb(end.arrayBuffers)} MB (WebAssembly memories count in arrayBuffers)`);
