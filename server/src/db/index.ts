import { mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import type { PromptFile } from '../prompts.js';
import { repoRoot } from '../config.js';

export interface WallRow {
  id: number;
  title: string;
  opened_at: number;
  closed_at: number | null;
}
export interface PromptRow {
  slug: string;
  text: string;
  source_file: string;
  active: number;
  accepting: number;
  created_at: number;
}
export interface SubmissionRow {
  id: string;
  wall_id: number;
  prompt_slug: string;
  number: number;
  shuffle_key: number;
  background: string;
  display_name: string | null;
  input_type: string | null;
  image_key: string;
  strokes_key: string | null;
  status: string;
  created_at: number;
}

export class Database {
  readonly connection: DatabaseSync;
  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.connection = new DatabaseSync(path);
    this.connection.exec(
      'PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL; PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON;',
    );
    this.connection.exec(
      'CREATE TABLE IF NOT EXISTS migrations (name TEXT PRIMARY KEY)',
    );
    const directory = join(repoRoot, 'server/migrations');
    for (const name of readdirSync(directory)
      .filter((name) => name.endsWith('.sql'))
      .sort()) {
      if (!this.get('SELECT name FROM migrations WHERE name = ?', name)) {
        this.transaction(() => {
          this.connection.exec(readFileSync(join(directory, name), 'utf8'));
          this.run('INSERT INTO migrations VALUES (?)', name);
        });
      }
    }
    if (!this.get('SELECT id FROM walls LIMIT 1')) {
      this.run(
        'INSERT INTO walls(title, opened_at) VALUES (?, ?)',
        'Wall 1',
        Date.now(),
      );
    }
  }
  get<T = Record<string, unknown>>(
    sql: string,
    ...values: SQLInputValue[]
  ): T | undefined {
    return this.connection.prepare(sql).get(...values) as T | undefined;
  }
  all<T = Record<string, unknown>>(
    sql: string,
    ...values: SQLInputValue[]
  ): T[] {
    return this.connection.prepare(sql).all(...values) as T[];
  }
  run(sql: string, ...values: SQLInputValue[]) {
    return this.connection.prepare(sql).run(...values);
  }
  transaction<T>(work: () => T): T {
    this.connection.exec('BEGIN IMMEDIATE');
    try {
      const result = work();
      this.connection.exec('COMMIT');
      return result;
    } catch (error) {
      this.connection.exec('ROLLBACK');
      throw error;
    }
  }
  currentWall(): WallRow {
    return this.get<WallRow>('SELECT * FROM walls WHERE closed_at IS NULL')!;
  }
  setting(key: string): string {
    return (
      this.get<{ value: string }>(
        'SELECT value FROM settings WHERE key = ?',
        key,
      )?.value ?? ''
    );
  }
  syncPrompts(files: PromptFile[]) {
    this.transaction(() => {
      this.run('UPDATE prompts SET active = 0');
      for (const file of files)
        for (const prompt of file.prompts) {
          this.run(
            `INSERT INTO prompts(slug, text, source_file, created_at) VALUES (?, ?, ?, ?)
          ON CONFLICT(slug) DO UPDATE SET text=excluded.text, source_file=excluded.source_file, active=1`,
            prompt.slug,
            prompt.text,
            file.name,
            Date.now(),
          );
        }
    });
  }
  insertSubmission(
    row: Omit<SubmissionRow, 'number' | 'status'> & {
      ip_hash: string;
      device_id: string;
    },
  ): SubmissionRow {
    return this.transaction(() => {
      this.run(
        `INSERT INTO wall_prompt_counts(wall_id,prompt_slug,count) VALUES (?,?,1)
        ON CONFLICT(wall_id,prompt_slug) DO UPDATE SET count=count+1`,
        row.wall_id,
        row.prompt_slug,
      );
      const number = this.get<{ count: number }>(
        'SELECT count FROM wall_prompt_counts WHERE wall_id=? AND prompt_slug=?',
        row.wall_id,
        row.prompt_slug,
      )!.count;
      this.run(
        `INSERT INTO submissions(id,wall_id,prompt_slug,number,shuffle_key,background,display_name,input_type,image_key,strokes_key,ip_hash,device_id,created_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        row.id,
        row.wall_id,
        row.prompt_slug,
        number,
        row.shuffle_key,
        row.background,
        row.display_name,
        row.input_type,
        row.image_key,
        row.strokes_key,
        row.ip_hash,
        row.device_id,
        row.created_at,
      );
      return { ...row, number, status: 'visible' };
    });
  }
  close() {
    this.connection.close();
  }
}
