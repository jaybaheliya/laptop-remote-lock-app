-- Allow 'sleep' and 'shutdown' in commands table constraint
ALTER TABLE commands DROP CONSTRAINT IF EXISTS commands_action_check;
ALTER TABLE commands ADD CONSTRAINT commands_action_check CHECK (action IN ('lock', 'sleep', 'shutdown'));

-- Update RLS policy to allow users to insert 'lock', 'sleep', and 'shutdown' commands
DROP POLICY IF EXISTS "Create lock commands for own devices" ON commands;
DROP POLICY IF EXISTS "Create remote commands for own devices" ON commands;

CREATE POLICY "Create remote commands for own devices"
  ON commands
  FOR INSERT
  WITH CHECK (
    auth.uid() = user_id
    AND action IN ('lock', 'sleep', 'shutdown')
    AND status = 'pending'
    AND EXISTS (
      SELECT 1
      FROM devices d
      WHERE d.id = commands.device_id
        AND d.user_id = auth.uid()
    )
  );

