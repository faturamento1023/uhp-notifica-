CREATE TABLE uhp_notifica.profile_avatars (
  user_id text PRIMARY KEY REFERENCES uhp_notifica.users(id) ON DELETE CASCADE,
  content bytea NOT NULL CHECK (octet_length(content) BETWEEN 1 AND 262144)
);

ALTER TABLE uhp_notifica.profile_avatars ENABLE ROW LEVEL SECURITY;

GRANT SELECT ON uhp_notifica.profile_avatars TO uhp_notifica_app;

CREATE POLICY app_select ON uhp_notifica.profile_avatars
  FOR SELECT TO uhp_notifica_app USING (true);
