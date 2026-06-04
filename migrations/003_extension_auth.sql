ALTER TABLE heartbeats ADD COLUMN IF NOT EXISTS extension_id TEXT;
ALTER TABLE heartbeats ADD COLUMN IF NOT EXISTS extension_install_type TEXT;
ALTER TABLE heartbeats ADD COLUMN IF NOT EXISTS extension_version TEXT;
ALTER TABLE heartbeats ADD COLUMN IF NOT EXISTS extension_official BOOLEAN;
ALTER TABLE heartbeats ADD COLUMN IF NOT EXISTS extension_verification_reason TEXT;
