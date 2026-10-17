import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Prompt } from '@solcollab/shared';

export interface PromptSource {
  name: string;
  content: string;
}

export interface PromptFile {
  name: string;
  weight: number;
  prompts: Prompt[];
}

interface ParsedLine {
  text: string;
  override?: string;
  location: string;
}

export function slugify(text: string): string {
  return (
    text
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'prompt'
  );
}

function parseLine(line: string, location: string): ParsedLine {
  const override = /\s*\{slug:\s*([^{}]*)\}\s*$/.exec(line);
  if (line.includes('{slug:') && !override) {
    throw new Error(`${location}: malformed {slug: ...} override.`);
  }
  if (!override) return { text: line, location };
  const slug = override[1]!.trim();
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
    throw new Error(
      `${location}: slug overrides must use lowercase words separated by hyphens.`,
    );
  }
  const text = line.slice(0, override.index).trim();
  if (!text)
    throw new Error(`${location}: a prompt must have instruction text.`);
  return { text, override: slug, location };
}

/** Sort filenames first so identities do not depend on filesystem enumeration order. */
export function parsePromptSources(
  sources: readonly PromptSource[],
): PromptFile[] {
  const parsed = [...sources]
    .sort((a, b) => a.name.localeCompare(b.name, 'en'))
    .map((source) => {
      let weight = 1;
      let weightSeen = false;
      const lines: ParsedLine[] = [];
      source.content
        .replace(/^\uFEFF/, '')
        .split(/\r?\n/)
        .forEach((raw, index) => {
          const line = raw.trim();
          const location = `${source.name}:${index + 1}`;
          if (!line) return;
          if (line.startsWith('#')) {
            const metadata = /^#\s*weight\s*:\s*(.*)$/.exec(line);
            if (metadata) {
              if (lines.length || weightSeen) {
                throw new Error(
                  `${location}: weight must appear once, before the prompts.`,
                );
              }
              const value = metadata[1]!;
              weight = Number(value);
              if (!value || !Number.isFinite(weight) || weight <= 0) {
                throw new Error(
                  `${location}: weight must be a finite positive number.`,
                );
              }
              weightSeen = true;
            }
            return;
          }
          lines.push(parseLine(line, location));
        });
      return { name: source.name, weight, lines };
    });

  // Reserve explicit identities before generating any automatic slugs.
  const used = new Set<string>();
  for (const file of parsed) {
    for (const line of file.lines) {
      if (!line.override) continue;
      if (used.has(line.override)) {
        throw new Error(
          `${line.location}: duplicate explicit slug "${line.override}".`,
        );
      }
      used.add(line.override);
    }
  }
  return parsed.map(({ name, weight, lines }) => ({
    name,
    weight,
    prompts: lines.map(({ text, override }) => {
      let slug = override;
      if (!slug) {
        const base = slugify(text);
        slug = base;
        for (let suffix = 2; used.has(slug); suffix++)
          slug = `${base}-${suffix}`;
        used.add(slug);
      }
      return { slug, text };
    }),
  }));
}

/** Long enough for LeWitt's full wall-drawing instructions, verbatim. */
export const MAX_PROMPT_LENGTH = 1000;

/** Lint source text, keeping line numbers useful for a one-line prompt PR. */
export function lintPromptSources(sources: readonly PromptSource[]): string[] {
  const issues: string[] = [];
  const seen = new Map<string, string>();
  for (const source of sources) {
    source.content
      .replace(/^\uFEFF/, '')
      .split(/\r?\n/)
      .forEach((raw, index) => {
        const location = `${source.name}:${index + 1}`;
        if (/[^\S\r\n]$/.test(raw))
          issues.push(`${location}: trailing whitespace.`);
        const line = raw.trim();
        if (!line || line.startsWith('#')) return;
        try {
          const { text } = parseLine(line, location);
          if ([...text].length > MAX_PROMPT_LENGTH)
            issues.push(
              `${location}: prompt exceeds ${MAX_PROMPT_LENGTH} characters.`,
            );
          const key = text.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ');
          const previous = seen.get(key);
          if (previous)
            issues.push(
              `${location}: duplicate prompt (first at ${previous}).`,
            );
          else seen.set(key, location);
        } catch (error) {
          issues.push((error as Error).message);
        }
      });
  }
  try {
    const files = parsePromptSources(sources);
    if (!files.some((file) => file.prompts.length))
      issues.push('No prompts found.');
  } catch (error) {
    const message = (error as Error).message;
    if (!issues.includes(message)) issues.push(message);
  }
  return issues;
}

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

export const MAX_EXCLUDED_PROMPTS = 50;
export const MAX_EXCLUDE_LENGTH = 8192;

/** Exclusions are hints, with bounded parsing even if the query is untrusted. */
export function parseExclude(value = ''): string[] {
  return [
    ...new Set(value.slice(0, MAX_EXCLUDE_LENGTH).split(',').filter(Boolean)),
  ].slice(0, MAX_EXCLUDED_PROMPTS);
}

/** Choose a weighted file, then choose uniformly among its eligible prompts. */
export function selectRandomPrompt(
  files: readonly PromptFile[],
  exclude: readonly string[] = [],
  rng: () => number = Math.random,
): Prompt {
  const excluded = new Set(exclude.slice(0, MAX_EXCLUDED_PROMPTS));
  const available = files.filter((file) => file.prompts.length > 0);
  if (!available.length) throw new Error('No prompts are available.');
  const filtered = available
    .map((file) => ({
      ...file,
      prompts: file.prompts.filter((prompt) => !excluded.has(prompt.slug)),
    }))
    .filter((file) => file.prompts.length > 0);
  const candidates = filtered.length ? filtered : available;
  // Scale first so even very large, valid individual weights cannot overflow the sum.
  const maxWeight = Math.max(...candidates.map((file) => file.weight));
  const totalWeight = candidates.reduce(
    (sum, file) => sum + file.weight / maxWeight,
    0,
  );
  let ticket = rng() * totalWeight;
  let chosen = candidates[candidates.length - 1]!;
  for (const file of candidates) {
    ticket -= file.weight / maxWeight;
    if (ticket < 0) {
      chosen = file;
      break;
    }
  }
  return chosen.prompts[Math.floor(rng() * chosen.prompts.length)]!;
}
