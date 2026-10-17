/**
 * The slice of the Cloudflare runtime this app uses, typed structurally so the same code
 * type-checks for the Worker and for Node tests (Miniflare bindings) without pulling the
 * global Workers types into a project that also uses DOM types.
 */
export interface D1Result<T> {
  results: T[];
  meta: { changes?: number };
}
export interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<D1Result<T>>;
  run(): Promise<D1Result<unknown>>;
}
export interface D1Database {
  prepare(sql: string): D1PreparedStatement;
  batch<T = unknown>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]>;
}
export interface R2ObjectBody {
  arrayBuffer(): Promise<ArrayBuffer>;
}
export interface R2Bucket {
  put(
    key: string,
    value: Uint8Array,
    options?: {
      httpMetadata?: { contentType?: string; cacheControl?: string };
    },
  ): Promise<unknown>;
  get(key: string): Promise<R2ObjectBody | null>;
  delete(key: string): Promise<void>;
}
export interface Fetcher {
  fetch(input: Request | string | URL, init?: RequestInit): Promise<Response>;
}

export interface Env {
  DB: D1Database;
  MEDIA: R2Bucket;
  /** Workers Static Assets (web/dist). Absent in API-only tests. */
  ASSETS?: Fetcher;
  /** "local" | "staging" | "production" */
  ENVIRONMENT?: string;
  STORE_STROKES?: string;
  PUBLIC_DOMAIN?: string;
  /** Secret (wrangler secret put). Required outside local development. */
  IP_HASH_SECRET?: string;
  TURNSTILE_SITE_KEY?: string;
  TURNSTILE_SECRET?: string;
}
