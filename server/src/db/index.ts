import type { D1Database, D1PreparedStatement } from '../env.js';
import type { PromptFile } from '../prompts.js';

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

/**
 * Thin async wrapper over D1. Migrations are applied by `wrangler d1 migrations apply`
 * (tests apply the same files). D1 has no BEGIN/COMMIT, so multi-statement writes use
 * `batch()`, which runs as one transaction and rolls back as a unit.
 */
export class Database {
  constructor(readonly d1: D1Database) {}
  statement(sql: string, ...values: unknown[]): D1PreparedStatement {
    const prepared = this.d1.prepare(sql);
    return values.length ? prepared.bind(...values) : prepared;
  }
  async get<T = Record<string, unknown>>(
    sql: string,
    ...values: unknown[]
  ): Promise<T | undefined> {
    return (await this.statement(sql, ...values).first<T>()) ?? undefined;
  }
  async all<T = Record<string, unknown>>(
    sql: string,
    ...values: unknown[]
  ): Promise<T[]> {
    return (await this.statement(sql, ...values).all<T>()).results;
  }
  async run(sql: string, ...values: unknown[]) {
    return this.statement(sql, ...values).run();
  }
  async batch(statements: D1PreparedStatement[]) {
    return this.d1.batch(statements);
  }
  async currentWall(): Promise<WallRow> {
    const wall = await this.get<WallRow>(
      'SELECT * FROM walls WHERE closed_at IS NULL',
    );
    if (!wall) throw new Error('No current wall. Apply the D1 migrations.');
    return wall;
  }
  async setting(key: string): Promise<string> {
    return (
      (
        await this.get<{ value: string }>(
          'SELECT value FROM settings WHERE key = ?',
          key,
        )
      )?.value ?? ''
    );
  }
  async syncPrompts(files: PromptFile[]) {
    const now = Date.now();
    await this.batch([
      this.statement('UPDATE prompts SET active = 0'),
      ...files.flatMap((file) =>
        file.prompts.map((prompt) =>
          this.statement(
            `INSERT INTO prompts(slug, text, source_file, created_at) VALUES (?, ?, ?, ?)
          ON CONFLICT(slug) DO UPDATE SET text=excluded.text, source_file=excluded.source_file, active=1`,
            prompt.slug,
            prompt.text,
            file.name,
            now,
          ),
        ),
      ),
    ]);
  }
  /** The per-wall number comes from a subquery: a batch cannot pass results between statements. */
  async insertSubmission(
    row: Omit<SubmissionRow, 'number' | 'status'> & {
      ip_hash: string;
      device_id: string;
    },
  ): Promise<SubmissionRow> {
    const [, inserted] = await this.batch([
      this.statement(
        `INSERT INTO wall_prompt_counts(wall_id,prompt_slug,count) VALUES (?,?,1)
        ON CONFLICT(wall_id,prompt_slug) DO UPDATE SET count=count+1`,
        row.wall_id,
        row.prompt_slug,
      ),
      this.statement(
        `INSERT INTO submissions(id,wall_id,prompt_slug,number,shuffle_key,background,display_name,input_type,image_key,strokes_key,ip_hash,device_id,created_at)
        VALUES (?,?,?,(SELECT count FROM wall_prompt_counts WHERE wall_id=? AND prompt_slug=?),?,?,?,?,?,?,?,?,?)
        RETURNING number`,
        row.id,
        row.wall_id,
        row.prompt_slug,
        row.wall_id,
        row.prompt_slug,
        row.shuffle_key,
        row.background,
        row.display_name,
        row.input_type,
        row.image_key,
        row.strokes_key,
        row.ip_hash,
        row.device_id,
        row.created_at,
      ),
    ]);
    const number = (inserted?.results[0] as { number: number } | undefined)
      ?.number;
    if (number === undefined) throw new Error('Submission was not numbered.');
    return { ...row, number, status: 'visible' };
  }
}
