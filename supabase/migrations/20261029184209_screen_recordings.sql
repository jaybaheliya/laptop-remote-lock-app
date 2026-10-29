-- Recording clips are private and are written/read only by authenticated Edge Functions.
ALTER TABLE public.commands DROP CONSTRAINT IF EXISTS commands_action_check;
ALTER TABLE public.commands ADD CONSTRAINT commands_action_check
  CHECK (action IN (
    'lock', 'sleep', 'shutdown', 'screenshot', 'unlock', 'panic',
    'display_message', 'task_list', 'end_task', 'refresh_status', 'save_note', 'screen_record', 'rename_recording'
  ));

DROP POLICY IF EXISTS "Create remote commands for own devices" ON public.commands;
CREATE POLICY "Create remote commands for own devices"
  ON public.commands FOR INSERT TO authenticated
  WITH CHECK (
    (select auth.uid()) = user_id
    AND action IN (
      'lock', 'sleep', 'shutdown', 'screenshot', 'unlock', 'panic',
      'display_message', 'task_list', 'end_task', 'refresh_status', 'save_note', 'screen_record', 'rename_recording'
    )
    AND status = 'pending'
    AND EXISTS (
      SELECT 1 FROM public.devices d
      WHERE d.id = commands.device_id AND d.user_id = (select auth.uid())
    )
  );

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('screen-recordings', 'screen-recordings', false, 157286400, ARRAY['video/mp4'])
ON CONFLICT (id) DO UPDATE SET
  public = false,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;
