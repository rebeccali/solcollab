import PNG_WASM from '@jsquash/png/codec/pkg/squoosh_png_bg.wasm';
import WEBP_ENCODE_SIMD_WASM from '@jsquash/webp/codec/enc/webp_enc_simd.wasm';
import RESIZE_WASM from '@jsquash/resize/lib/resize/pkg/squoosh_resize_bg.wasm';
import { createApp } from './app.js';
import { initCodecs } from './codecs.js';
import { parsePromptSources } from './prompts.js';
import { promptSources } from './prompt-files.js';

void initCodecs({
  png: PNG_WASM,
  webpEncodeSimd: WEBP_ENCODE_SIMD_WASM,
  resize: RESIZE_WASM,
});

export default createApp({ files: parsePromptSources(promptSources) });
