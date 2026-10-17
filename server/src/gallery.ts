import { HTTPException } from 'hono/http-exception';
import type { Submission, Page } from '@solcollab/shared';
import type { Database, SubmissionRow } from './db/index.js';

export function publicSubmission(
  row: SubmissionRow,
  storeStrokes: boolean,
): Submission {
  return {
    id: row.id,
    prompt_slug: row.prompt_slug,
    wall: row.wall_id,
    number: row.number,
    background: row.background,
    display_name: row.display_name,
    input_type: row.input_type as Submission['input_type'],
    created_at: row.created_at,
    full_url: `/img/${row.image_key}/full.webp`,
    thumb_url: `/img/${row.image_key}/thumb.webp`,
    strokes_url:
      storeStrokes && row.strokes_key ? `/img/${row.strokes_key}` : null,
  };
}
export function positiveInteger(
  value: string | undefined,
  fallback: number,
  maximum = Number.MAX_SAFE_INTEGER,
): number {
  if (value === undefined) return fallback;
  if (!/^\d+$/.test(value) || +value < 1 || +value > maximum)
    throw new HTTPException(400, {
      message: 'Invalid numeric query parameter.',
    });
  return +value;
}
export async function galleryPage(
  db: Database,
  wall: number,
  slug: string,
  options: {
    sort: string;
    cursor?: string;
    limit: number;
    bucket: number;
    storeStrokes: boolean;
  },
): Promise<Page<Submission>> {
  const { sort, cursor, limit, storeStrokes } = options;
  if (sort === 'new') {
    if (cursor && !/^[0-9A-HJKMNP-TV-Z]{26}$/.test(cursor))
      throw new HTTPException(400, { message: 'Invalid gallery cursor.' });
    const rows = await db.all<SubmissionRow>(
      `SELECT * FROM submissions WHERE wall_id=? AND prompt_slug=? AND status='visible' ${cursor ? 'AND id < ?' : ''} ORDER BY id DESC LIMIT ?`,
      wall,
      slug,
      ...(cursor ? [cursor] : []),
      limit + 1,
    );
    const items = rows.slice(0, limit);
    return {
      items: items.map((row) => publicSubmission(row, storeStrokes)),
      next_cursor: rows.length > limit ? items.at(-1)!.id : null,
    };
  }
  if (sort !== 'random')
    throw new HTTPException(400, { message: 'Choose new or random order.' });
  let bucket = options.bucket,
    wrapped = false,
    lastKey = -1,
    lastId = '';
  if (cursor) {
    const match = /^r\.(\d+)\.(\d+)~([0-9A-HJKMNP-TV-Z]{26})\.([01])$/.exec(
      cursor,
    );
    if (!match || +match[1]! > 63 || +match[2]! > 0xffffffff)
      throw new HTTPException(400, { message: 'Invalid random cursor.' });
    bucket = +match[1]!;
    lastKey = +match[2]!;
    lastId = match[3]!;
    wrapped = match[4] === '1';
  }
  if (!Number.isInteger(bucket) || bucket < 0 || bucket > 63)
    throw new HTTPException(400, { message: 'Invalid shuffle bucket.' });
  const start = bucket * 2 ** 26;
  const query = (wrap: boolean, remaining: number, after: boolean) =>
    db.all<SubmissionRow>(
      `SELECT * FROM submissions WHERE wall_id=? AND prompt_slug=? AND status='visible' AND shuffle_key ${wrap ? '<' : '>='} ? ${after ? 'AND (shuffle_key > ? OR (shuffle_key = ? AND id > ?))' : ''} ORDER BY shuffle_key ASC,id ASC LIMIT ?`,
      wall,
      slug,
      start,
      ...(after ? [lastKey, lastKey, lastId] : []),
      remaining,
    );
  const rows: { row: SubmissionRow; wrapped: boolean }[] = (
    await query(wrapped, limit + 1, !!cursor)
  ).map((row) => ({ row, wrapped }));
  if (!wrapped && rows.length < limit + 1)
    rows.push(
      ...(await query(true, limit + 1 - rows.length, false)).map((row) => ({
        row,
        wrapped: true,
      })),
    );
  const items = rows.slice(0, limit),
    last = items.at(-1);
  return {
    items: items.map(({ row }) => publicSubmission(row, storeStrokes)),
    next_cursor:
      rows.length > limit && last
        ? `r.${bucket}.${last.row.shuffle_key}~${last.row.id}.${last.wrapped ? 1 : 0}`
        : null,
  };
}

/** Newest drawings gain up to 40% of the shuffle range, so the wall leans recent without sorting by date. */
const RECENCY_STEP = 1717987;
export async function wallPage(
  db: Database,
  wall: { id: number; opened_at: number; closed_at: number | null },
  options: {
    seed: number;
    cursor?: string;
    limit: number;
    now: number;
    storeStrokes: boolean;
  },
): Promise<Page<Submission>> {
  let { seed } = options,
    anchor = wall.closed_at ?? options.now,
    after: [number, string] | undefined;
  if (options.cursor) {
    const match = /^(\d+)\.(\d+)\.(\d+)~([0-9A-HJKMNP-TV-Z]{26})$/.exec(
      options.cursor,
    );
    if (!match || +match[1]! > 0xffffffff)
      throw new HTTPException(400, { message: 'Invalid wall cursor.' });
    seed = +match[1]!;
    anchor = +match[2]!;
    after = [+match[3]!, match[4]!];
  }
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff)
    throw new HTTPException(400, { message: 'Invalid shuffle seed.' });
  const span = Math.max(1, anchor - wall.opened_at);
  // XOR the stored shuffle key with the viewer's seed, then add a recency bonus (0–1000 steps).
  const rows = await db.all<SubmissionRow & { score: number }>(
    `SELECT * FROM (SELECT *, ((shuffle_key | ?) - (shuffle_key & ?)) + CAST(MIN(1000, MAX(0, (created_at - ?) * 1000 / ?)) AS INTEGER) * ? AS score FROM submissions WHERE wall_id=? AND status='visible') ${after ? 'WHERE score < ? OR (score = ? AND id > ?)' : ''} ORDER BY score DESC, id ASC LIMIT ?`,
    seed,
    seed,
    wall.opened_at,
    span,
    RECENCY_STEP,
    wall.id,
    ...(after ? [after[0], after[0], after[1]] : []),
    options.limit + 1,
  );
  const items = rows.slice(0, options.limit),
    last = items.at(-1);
  return {
    items: items.map((row) => publicSubmission(row, options.storeStrokes)),
    next_cursor:
      rows.length > options.limit && last
        ? `${seed}.${anchor}.${last.score}~${last.id}`
        : null,
  };
}
