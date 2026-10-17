import { init as initPng } from '@jsquash/png/decode.js';
import { init as initWebpEnc } from '@jsquash/webp/encode.js';
import { initResize } from '@jsquash/resize';
import PNG_WASM from '../node_modules/@jsquash/png/codec/pkg/squoosh_png_bg.wasm';
import WEBP_ENC_SIMD_WASM from '../node_modules/@jsquash/webp/codec/enc/webp_enc_simd.wasm';
import RESIZE_WASM from '../node_modules/@jsquash/resize/lib/resize/pkg/squoosh_resize_bg.wasm';
import { processImage } from './pipeline.js';

let ready;
function initCodecs() {
  // Once per isolate. webp's init() picks its SIMD glue when SIMD is available (it is in workerd),
  // so it must be handed the SIMD build of the module.
  ready ??= Promise.all([initPng(PNG_WASM), initWebpEnc(WEBP_ENC_SIMD_WASM), initResize(RESIZE_WASM)]);
  return ready;
}

export default {
  async fetch(request) {
    const url = new URL(request.url);
    if (request.method !== 'POST' || url.pathname !== '/process') return new Response('POST /process', { status: 404 });
    const loops = Math.min(20, Number(url.searchParams.get('loops') ?? 1));
    const bytes = new Uint8Array(await request.arrayBuffer());
    const t0 = Date.now();
    const p0 = performance.now();
    await initCodecs();
    const initMs = performance.now() - p0;
    const runs = [];
    try {
      for (let i = 0; i < loops; i++) runs.push(await processImage(bytes.slice(), url.searchParams.get('bg') ?? '#ffffff'));
    } catch (error) {
      return Response.json({ error: String(error) }, { status: 422 });
    }
    return Response.json({ initMs, totalMsDate: Date.now() - t0, totalMsPerf: performance.now() - p0, runs });
  },
};
