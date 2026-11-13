CREATE TABLE uhp_notifica.group_chat_messages (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  author_id text NOT NULL REFERENCES uhp_notifica.users(id),
  author_name text NOT NULL,
  body text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 1000 AND btrim(body) <> ''),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE uhp_notifica.group_chat_messages ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT ON uhp_notifica.group_chat_messages TO uhp_notifica_app;
GRANT USAGE ON SEQUENCE uhp_notifica.group_chat_messages_id_seq TO uhp_notifica_app;

CREATE POLICY app_select ON uhp_notifica.group_chat_messages FOR SELECT TO uhp_notifica_app USING (true);
CREATE POLICY app_insert ON uhp_notifica.group_chat_messages FOR INSERT TO uhp_notifica_app WITH CHECK (true);
