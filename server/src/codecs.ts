import { init as initPngDecode } from '@jsquash/png/decode.js';
import { init as initWebpEncode } from '@jsquash/webp/encode.js';
import { initResize } from '@jsquash/resize';

/** Compiled WebAssembly modules: imported by the Worker, read from disk in Node. */
export interface CodecModules {
  png: WebAssembly.Module;
  /** The SIMD build: jSquash picks its SIMD glue whenever SIMD is available (it is in workerd and Node). */
  webpEncodeSimd: WebAssembly.Module;
  resize: WebAssembly.Module;
}

let ready: Promise<unknown> | undefined;
/** Once per isolate. */
export function initCodecs(modules: CodecModules) {
  ready ??= Promise.all([
    initPngDecode(modules.png),
    initWebpEncode(modules.webpEncodeSimd),
    initResize(modules.resize),
  ]);
  return ready;
}
export async function codecsReady() {
  if (!ready) throw new Error('Image codecs were not initialized.');
  await ready;
}
