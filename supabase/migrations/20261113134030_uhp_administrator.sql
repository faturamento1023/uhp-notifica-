ALTER TABLE uhp_notifica.users DROP CONSTRAINT users_role_check, ADD CONSTRAINT users_role_check CHECK (role IN ('coordination', 'patient_safety', 'ccih', 'administrator'));
