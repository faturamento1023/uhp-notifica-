SET search_path = uhp_notifica, pg_catalog;

CREATE TABLE progress_entries (
  id TEXT PRIMARY KEY,
  assignment_id TEXT NOT NULL REFERENCES assignments(id),
  body TEXT NOT NULL,
  file_name TEXT,
  file_mime TEXT CHECK (file_mime IN ('application/pdf','image/png','image/jpeg')),
  file_content bytea,
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  CHECK ((file_name IS NULL AND file_mime IS NULL AND file_content IS NULL)
      OR (file_name IS NOT NULL AND file_mime IS NOT NULL AND file_content IS NOT NULL))
);
CREATE INDEX progress_assignment ON progress_entries(assignment_id, created_at, id);
ALTER TABLE progress_entries ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT ON progress_entries TO uhp_notifica_app;
CREATE POLICY app_select ON progress_entries FOR SELECT TO uhp_notifica_app USING (true);
CREATE POLICY app_insert ON progress_entries FOR INSERT TO uhp_notifica_app WITH CHECK (true);
