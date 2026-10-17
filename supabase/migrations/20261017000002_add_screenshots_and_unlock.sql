-- 1. Create screenshots table
CREATE TABLE IF NOT EXISTS screenshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id UUID NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  image_data TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Enable RLS on screenshots
ALTER TABLE screenshots ENABLE ROW LEVEL SECURITY;

-- Allow users to select their own screenshots
CREATE POLICY "Users can view own screenshots"
  ON screenshots
  FOR SELECT
  USING (auth.uid() = user_id);

-- Allow users to delete their own screenshots
CREATE POLICY "Users can delete own screenshots"
  ON screenshots
  FOR DELETE
  USING (auth.uid() = user_id);

-- 2. Update commands check constraint to include 'screenshot' and 'unlock'
ALTER TABLE commands DROP CONSTRAINT IF EXISTS commands_action_check;
ALTER TABLE commands ADD CONSTRAINT commands_action_check 
  CHECK (action IN ('lock', 'sleep', 'shutdown', 'screenshot', 'unlock'));

-- 3. Update RLS policy on commands table
DROP POLICY IF EXISTS "Create remote commands for own devices" ON commands;

CREATE POLICY "Create remote commands for own devices"
  ON commands
  FOR INSERT
  WITH CHECK (
    auth.uid() = user_id
    AND action IN ('lock', 'sleep', 'shutdown', 'screenshot', 'unlock')
    AND status = 'pending'
    AND EXISTS (
      SELECT 1
      FROM devices d
      WHERE d.id = commands.device_id
        AND d.user_id = auth.uid()
    )
  );

