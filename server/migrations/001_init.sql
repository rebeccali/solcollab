CREATE TABLE walls (
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL,
  opened_at INTEGER NOT NULL,
  closed_at INTEGER
);
CREATE UNIQUE INDEX one_current_wall ON walls((1)) WHERE closed_at IS NULL;
CREATE TABLE prompts (
  slug TEXT PRIMARY KEY, text TEXT NOT NULL, source_file TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1, accepting INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL
);
CREATE TABLE wall_prompt_counts (
  wall_id INTEGER NOT NULL REFERENCES walls(id),
  prompt_slug TEXT NOT NULL REFERENCES prompts(slug), count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (wall_id, prompt_slug)
);
CREATE TABLE submissions (
  id TEXT PRIMARY KEY, wall_id INTEGER NOT NULL REFERENCES walls(id),
  prompt_slug TEXT NOT NULL REFERENCES prompts(slug), number INTEGER NOT NULL,
  shuffle_key INTEGER NOT NULL, background TEXT NOT NULL DEFAULT '#FFFFFF',
  display_name TEXT, input_type TEXT, image_key TEXT NOT NULL, strokes_key TEXT,
  status TEXT NOT NULL DEFAULT 'visible', report_count INTEGER NOT NULL DEFAULT 0,
  ip_hash TEXT NOT NULL, device_id TEXT NOT NULL, created_at INTEGER NOT NULL,
  UNIQUE(wall_id, prompt_slug, number)
);
CREATE INDEX idx_sub_gallery ON submissions(wall_id, prompt_slug, status, id DESC);
CREATE INDEX idx_sub_random ON submissions(wall_id, prompt_slug, status, shuffle_key, id);
CREATE INDEX idx_sub_ip ON submissions(ip_hash, created_at);
CREATE TABLE reports (
  submission_id TEXT NOT NULL REFERENCES submissions(id), device_id TEXT NOT NULL,
  reason TEXT, created_at INTEGER NOT NULL, PRIMARY KEY(submission_id, device_id)
);
CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
INSERT INTO settings VALUES ('submissions_open', 'true'), ('read_only', 'false'), ('banner_message', '');
