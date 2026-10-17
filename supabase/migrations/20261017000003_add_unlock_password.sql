-- Add unlock_password field to devices table
-- This stores the Windows login password ONLY for the unlock action
-- It is ONLY readable by the owning user_id (RLS enforced)
-- The agent reads this via a dedicated endpoint to auto-type password on unlock

ALTER TABLE devices
  ADD COLUMN IF NOT EXISTS unlock_password TEXT;

-- RLS is already in place on devices; this column inherits the existing policies
-- so only the authenticated owner can read/write their own device's unlock_password.

