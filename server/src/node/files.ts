/** Node-only helpers for tests and scripts. Never imported by the Worker. */
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  lintPromptSources,
  parsePromptSources,
  type PromptFile,
  type PromptSource,
} from '../prompts.js';
import { initCodecs } from '../codecs.js';

export const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));

export async function readPromptSources(
  directory: string,
): Promise<PromptSource[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  return Promise.all(
    entries
      .filter((entry) => entry.isFile() && entry.name.endsWith('.txt'))
      .map(async (entry) => ({
        name: entry.name,
        content: await readFile(join(directory, entry.name), 'utf8'),
      })),
  );
}

export async function loadPrompts(directory: string): Promise<PromptFile[]> {
  const sources = await readPromptSources(directory);
  const issues = lintPromptSources(sources);
  if (issues.length)
    throw new Error(`Invalid prompt files:\n${issues.join('\n')}`);
  return parsePromptSources(sources);
}

const wasm = async (path: string) =>
  WebAssembly.compile(
    new Uint8Array(await readFile(join(repoRoot, 'node_modules', path))),
  );
/** The same WebAssembly the Worker bundles, compiled from node_modules. */
export async function initCodecsFromDisk() {
  await initCodecs({
    png: await wasm('@jsquash/png/codec/pkg/squoosh_png_bg.wasm'),
    webpEncodeSimd: await wasm('@jsquash/webp/codec/enc/webp_enc_simd.wasm'),
    resize: await wasm('@jsquash/resize/lib/resize/pkg/squoosh_resize_bg.wasm'),
  });
}
