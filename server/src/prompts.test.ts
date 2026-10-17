import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  lintPromptSources,
  MAX_EXCLUDE_LENGTH,
  parseExclude,
  parsePromptSources,
  selectRandomPrompt,
  slugify,
  type PromptSource,
} from './prompts.js';
import { loadPrompts, readPromptSources, repoRoot } from './node/files.js';
import { promptSources } from './prompt-files.js';

const source = (content: string, name = 'test.txt'): PromptSource => ({
  name,
  content,
});

describe('prompt parsing and identity', () => {
  it('ignores comments and blank lines, handles BOM/CRLF, and defaults weight to one', () => {
    expect(
      parsePromptSources([
        source('\uFEFF# A note\r\n\r\n  Draw a line.\r\n# Another note\r\n'),
      ]),
    ).toEqual([
      {
        name: 'test.txt',
        weight: 1,
        prompts: [{ text: 'Draw a line.', slug: 'draw-a-line' }],
      },
    ]);
  });

  it('reads positive fractional weights in front matter', () => {
    expect(
      parsePromptSources([source('# comment\n# weight: 2.5\nDraw a line.')])[0]
        ?.weight,
    ).toBe(2.5);
  });

  it.each(['0', '-1', 'Infinity', 'NaN', '', 'many'])(
    'rejects weight %j',
    (weight) => {
      expect(() =>
        parsePromptSources([source(`# weight: ${weight}\nDraw.`)]),
      ).toThrow('finite positive number');
    },
  );

  it.each(['# weight: 2\n# weight: 3\nDraw.', 'Draw.\n# weight: 2'])(
    'rejects repeated or late weights',
    (content) => {
      expect(() => parsePromptSources([source(content)])).toThrow(
        'before the prompts',
      );
    },
  );

  it('generates readable slugs and a fallback for text without ASCII characters', () => {
    expect(slugify('A grid, with one square that refuses.')).toBe(
      'a-grid-with-one-square-that-refuses',
    );
    expect(slugify('  Café — déjà vu!  ')).toBe('cafe-deja-vu');
    expect(slugify('円')).toBe('prompt');
  });

  it('handles collisions across files in deterministic filename order', () => {
    const sources = [
      source('A line!\nA line?', 'b.txt'),
      source('A line.', 'a.txt'),
    ];
    const files = parsePromptSources(sources);
    expect(
      files.flatMap((file) => file.prompts.map((prompt) => prompt.slug)),
    ).toEqual(['a-line', 'a-line-2', 'a-line-3']);
    expect(parsePromptSources([...sources].reverse())).toEqual(files);
  });

  it('keeps explicit identities and reserves them before generated slugs', () => {
    const files = parsePromptSources([
      source('Sad cat.\nA corrected instruction. {slug: sad-cat}'),
    ]);
    expect(files[0]?.prompts).toEqual([
      { text: 'Sad cat.', slug: 'sad-cat-2' },
      { text: 'A corrected instruction.', slug: 'sad-cat' },
    ]);
  });

  it.each([
    'Draw. {slug: Bad_slug}',
    'Draw. {slug: }',
    'Draw. {slug: unfinished',
    '{slug: no-text}',
  ])('rejects malformed overrides: %s', (content) => {
    expect(() => parsePromptSources([source(content)])).toThrow('test.txt:1');
  });

  it('rejects duplicate explicit identities instead of silently changing them', () => {
    expect(() =>
      parsePromptSources([
        source('First. {slug: stable}\nSecond. {slug: stable}'),
      ]),
    ).toThrow('duplicate explicit slug "stable"');
  });
});

describe('prompt lint', () => {
  it('finds duplicate display text across sources, independent of overrides and case', () => {
    const issues = lintPromptSources([
      source('Draw a line. {slug: one}', 'a.txt'),
      source('DRAW  A LINE. {slug: two}', 'b.txt'),
    ]);
    expect(issues).toEqual(['b.txt:1: duplicate prompt (first at a.txt:1).']);
  });

  it('counts Unicode characters, permits 1000, and excludes the override suffix', () => {
    expect(
      lintPromptSources([source(`${'é'.repeat(1000)} {slug: long}`)]),
    ).toEqual([]);
    expect(lintPromptSources([source('🟦'.repeat(1001))])).toContain(
      'test.txt:1: prompt exceeds 1000 characters.',
    );
  });

  it('finds trailing whitespace on instructions, comments, and blank lines', () => {
    expect(lintPromptSources([source('# note \nDraw.\t\n \n')])).toEqual([
      'test.txt:1: trailing whitespace.',
      'test.txt:2: trailing whitespace.',
      'test.txt:3: trailing whitespace.',
    ]);
  });

  it('reports syntax errors once, and rejects an empty catalog', () => {
    expect(lintPromptSources([source('Draw. {slug: BAD}')])).toHaveLength(1);
    expect(lintPromptSources([source('# comment only\n')])).toEqual([
      'No prompts found.',
    ]);
    expect(lintPromptSources([source('# weight: -1\nDraw.')])[0]).toContain(
      'positive number',
    );
  });
});

describe('weighted selection and exclusions', () => {
  const files = parsePromptSources([
    source('# weight: 2\nFirst.\nSecond.', 'a.txt'),
    source('# weight: 1\nThird.', 'b.txt'),
    source('# empty file', 'c.txt'),
  ]);
  const draw = (
    fileRoll: number,
    promptRoll: number,
    exclude: string[] = [],
  ) => {
    const rolls = [fileRoll, promptRoll];
    return selectRandomPrompt(files, exclude, () => rolls.shift()!);
  };

  it('uses file weight rather than prompt count, with uniform choices within a file', () => {
    expect(draw(0, 0).text).toBe('First.');
    expect(draw(0.66, 0.99).text).toBe('Second.');
    expect(draw(0.67, 0).text).toBe('Third.');
    expect(draw(0.999, 0.999).text).toBe('Third.');
  });

  it('removes completed prompts and reweights only files that still have choices', () => {
    expect(draw(0, 0, ['first']).text).toBe('Second.');
    expect(draw(0, 0, ['first', 'second']).text).toBe('Third.');
    expect(draw(0.99, 0.99, ['third']).text).toBe('Second.');
  });

  it('falls back when all are excluded, tolerates unknown slugs, and does not mutate the catalog', () => {
    const before = structuredClone(files);
    expect(draw(0, 0, ['first', 'second', 'third']).text).toBe('First.');
    expect(draw(0, 0, ['unknown']).text).toBe('First.');
    expect(files).toEqual(before);
  });

  it('handles one prompt and fails clearly for an empty catalog', () => {
    const single = parsePromptSources([source('One.')]);
    expect(selectRandomPrompt(single, ['one'])).toEqual({
      text: 'One.',
      slug: 'one',
    });
    expect(() => selectRandomPrompt([])).toThrow('No prompts');
  });

  it('does not overflow when individual weights are very large', () => {
    const large = files.slice(0, 2).map((file) => ({ ...file, weight: 1e308 }));
    expect(selectRandomPrompt(large, [], () => 0.75).text).toBe('Third.');
  });

  it('bounds and deduplicates exclusion hints', () => {
    expect(parseExclude('first,,first,second')).toEqual(['first', 'second']);
    expect(
      parseExclude(Array.from({ length: 70 }, (_, i) => `p-${i}`).join(',')),
    ).toHaveLength(50);
    expect(parseExclude('a'.repeat(MAX_EXCLUDE_LENGTH + 10))[0]).toHaveLength(
      MAX_EXCLUDE_LENGTH,
    );
    expect(parseExclude()).toEqual([]);
  });
});

describe('prompt files on disk', () => {
  let directory: string | undefined;
  afterEach(async () => {
    if (directory) await rm(directory, { recursive: true, force: true });
  });

  it('loads only regular .txt files and validates their contents', async () => {
    directory = await mkdtemp(join(tmpdir(), 'solcollab-prompts-'));
    await writeFile(join(directory, 'a.txt'), '# weight: 2\nDraw a room.\n');
    await writeFile(join(directory, 'notes.md'), 'Not a prompt');
    await mkdir(join(directory, 'nested.txt'));
    expect(await readPromptSources(directory)).toHaveLength(1);
    expect((await loadPrompts(directory))[0]?.prompts[0]?.slug).toBe(
      'draw-a-room',
    );
    await writeFile(join(directory, 'a.txt'), 'Draw. \n');
    await expect(loadPrompts(directory)).rejects.toThrow('trailing whitespace');
  });

  it('ships the MASS MoCA wall drawings with unique slugs fixed to each drawing number', async () => {
    const files = await loadPrompts(join(repoRoot, 'prompts'));
    expect(files.map((file) => file.name)).toEqual(['massmoca.txt']);
    const prompts = files.flatMap((file) => file.prompts);
    expect(prompts).toHaveLength(12);
    expect(new Set(prompts.map((prompt) => prompt.slug)).size).toBe(
      prompts.length,
    );
    for (const prompt of prompts)
      expect(prompt.slug).toMatch(/^wall-drawing-\d+[a-z0-9-]*$/);
  });

  it('bundles exactly the prompt files on disk into the Worker', async () => {
    expect(parsePromptSources(promptSources)).toEqual(
      await loadPrompts(join(repoRoot, 'prompts')),
    );
  });
});
