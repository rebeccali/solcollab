/**
 * Prompt files bundled into the Worker as text (wrangler.jsonc "rules": Text for *.txt).
 * Every file in prompts/ must be listed here; `npm run lint:prompts` checks this.
 */
import massmoca from '../../prompts/massmoca.txt';
import type { PromptSource } from './prompts.js';

export const promptSources: PromptSource[] = [
  { name: 'massmoca.txt', content: massmoca },
];
