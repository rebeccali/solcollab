-- The first wall used to be created by the Node server at startup; on D1 it is a migration.
INSERT INTO walls(title, opened_at)
SELECT 'Wall 1', CAST(strftime('%s', 'now') AS INTEGER) * 1000
WHERE NOT EXISTS (SELECT 1 FROM walls);
