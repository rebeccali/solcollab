import { join } from 'node:path';
import { repoRoot } from '../server/src/config.js';
import {
  lintPromptSources,
  parsePromptSources,
  readPromptSources,
} from '../server/src/prompts.js';

const sources = await readPromptSources(join(repoRoot, 'prompts'));
const issues = lintPromptSources(sources);
if (issues.length) {
  console.error(issues.join('\n'));
  process.exitCode = 1;
} else {
  const count = parsePromptSources(sources).reduce(
    (sum, file) => sum + file.prompts.length,
    0,
  );
  console.log(`${count} prompts in ${sources.length} files: valid.`);
}
