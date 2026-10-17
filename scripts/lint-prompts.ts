import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { readPromptSources, repoRoot } from '../server/src/node/files.js';
import {
  lintPromptSources,
  parsePromptSources,
} from '../server/src/prompts.js';

const sources = await readPromptSources(join(repoRoot, 'prompts'));
const issues = lintPromptSources(sources);
// The Worker bundles prompt files through explicit imports, so each file must be listed there.
const bundled = await readFile(
  join(repoRoot, 'server/src/prompt-files.ts'),
  'utf8',
);
for (const { name } of sources)
  if (!bundled.includes(`'../../prompts/${name}'`))
    issues.push(
      `prompts/${name} is not imported in server/src/prompt-files.ts, so the Worker would not serve it.`,
    );
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
